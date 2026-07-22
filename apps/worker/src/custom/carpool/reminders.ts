/**
 * 拼车到期推送提醒（定时任务）+ 拼车专属 webhook 通知。
 *
 * 由 index.ts 的补丁在 Cron 阶段调用 `runCarpoolReminders(env)`。拼车通知**独立于系统订阅通知**：
 * 只走用户在拼车页面单独配置的一个 webhook。发送用自建发送器（不复用系统 sendWebhook，因为后者强制
 * 负载为 JSON）——JSON 模板走 JSON 替换并转义，纯文本模板原样替换，兼容 ntfy 等纯文本 webhook；
 * URL 走上游 `assertSafeOutboundUrl` 做 SSRF 校验。
 *
 * Cron 每分钟触发，用 `carpool_member_meta.reminded_for` 去重：每个到期日只发一次（发送成败都记）。
 *
 * 注意：`assertSafeOutboundUrl` 只在真正发送时 `import()`，避免测试加载 index.ts 时牵连（与 cloudflare:sockets 同理）。
 */
import type { NotificationEmailMessage } from "@renewlet/shared/email-template";
import { DEFAULT_SERVER_I18N_LOCALE } from "../../server-i18n";
import type { Env } from "../../types";
import { appendCarpoolNotificationLog, getCarpoolNotification, listActiveSubscriptions, type CarpoolNotificationConfig } from "./store";

function overlayKey(subscriptionId: string, memberId: string): string {
  return `${subscriptionId} ${memberId}`;
}

/** 到期日与「今天」相差的天数（UTC，date-only）；负数=已过期。 */
function daysBetween(now: Date, expiry: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;
  const target = new Date(`${expiry}T00:00:00Z`).getTime();
  if (Number.isNaN(target)) return null;
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round((target - today) / 86_400_000);
}

interface DueMember {
  subId: string;
  subName: string;
  memberId: string;
  memberName: string;
  wechat: string | null;
  email: string | null;
  expiry: string;
  days: number;
}

async function fetchRemindedMap(env: Env, userId: string): Promise<Map<string, string>> {
  const rows = await env.DB.prepare(
    `SELECT subscription_id, member_id, reminded_for FROM carpool_member_meta WHERE user_id = ? AND reminded_for IS NOT NULL`,
  )
    .bind(userId)
    .all<{ subscription_id: string; member_id: string; reminded_for: string | null }>();
  const map = new Map<string, string>();
  for (const row of rows.results ?? []) {
    if (row.reminded_for) map.set(overlayKey(row.subscription_id, row.member_id), row.reminded_for);
  }
  return map;
}

function buildMessage(due: DueMember[], now: Date): NotificationEmailMessage {
  const blocks = due.map((d) => {
    const when = d.days < 0 ? `已过期 ${-d.days} 天` : d.days === 0 ? "今天到期" : `${d.days} 天后到期`;
    const lines = [d.subName, `车友：${d.memberName}`];
    if (d.wechat) lines.push(`微信：${d.wechat}`);
    if (d.email) lines.push(`邮箱：${d.email}`);
    lines.push(`到期：${d.expiry}（${when}）`);
    return lines.join("\n");
  });
  return {
    title: "拼车通知提醒",
    content: `以下拼车车友即将到期或已过期：\n\n${blocks.join("\n\n")}`,
    timestamp: now.toISOString(),
    hasPayload: false,
    items: [],
  };
}

// ---- webhook 负载渲染 ----

function applyPlain(template: string, m: NotificationEmailMessage): string {
  return template.replaceAll("{title}", m.title).replaceAll("{content}", m.content).replaceAll("{timestamp}", m.timestamp);
}

function substituteJson(value: unknown, m: NotificationEmailMessage): unknown {
  if (typeof value === "string") return applyPlain(value, m);
  if (Array.isArray(value)) return value.map((item) => substituteJson(item, m));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, substituteJson(item, m)]));
  }
  return value;
}

/** JSON 模板走 JSON 替换（自动转义多行正文），纯文本模板原样替换。 */
function renderCarpoolPayload(template: string, m: NotificationEmailMessage): string {
  const tpl = template.trim();
  if (!tpl) return `${m.title}\n${m.content}\n${m.timestamp}`;
  try {
    return JSON.stringify(substituteJson(JSON.parse(tpl), m));
  } catch {
    return applyPlain(tpl, m);
  }
}

function parseHeaders(raw: string): Headers {
  const headers = new Headers();
  if (!raw.trim()) return headers;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("请求头不是合法 JSON");
  }
  for (const [key, value] of Object.entries(parsed)) headers.set(key, String(value));
  return headers;
}

function collectSecrets(headers: Headers): string[] {
  const out: string[] = [];
  headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (name === "authorization" || name.includes("token") || name.includes("secret") || name.includes("key") || name.includes("signature")) {
      out.push(value);
    }
  });
  return out;
}

/** 拼车专属 webhook 发送：支持纯文本或 JSON 负载。出站统一走上游 `sendNotificationRequest`（超时/SSRF/脱敏），不用裸 fetch。 */
async function sendRawWebhook(config: CarpoolNotificationConfig, message: NotificationEmailMessage): Promise<void> {
  const [{ assertSafeOutboundUrl }, { sendNotificationRequest, requireNotificationHttpOk }] = await Promise.all([
    import("../../outbound-url-policy"),
    import("../../notification-http"),
  ]);
  const url = await assertSafeOutboundUrl(config.webhookUrl, DEFAULT_SERVER_I18N_LOCALE);

  const headers = parseHeaders(config.webhookHeaders);
  // 请求头的值里也支持 {title}/{timestamp} 占位符（如 ntfy 的 Title 头）；不替换 {content}（多行会破坏请求头）。
  for (const [key, value] of [...headers]) {
    if (value.includes("{title}") || value.includes("{timestamp}")) {
      headers.set(key, value.replaceAll("{title}", message.title).replaceAll("{timestamp}", message.timestamp));
    }
  }
  const method = config.webhookMethod === "GET" ? "GET" : "POST";
  if (method !== "GET" && !headers.has("content-type")) headers.set("content-type", "text/plain; charset=utf-8");

  const init: RequestInit = { method, headers };
  if (method !== "GET") init.body = renderCarpoolPayload(config.webhookPayload, message);

  const secrets = collectSecrets(headers);
  const response = await sendNotificationRequest(url, init, "Carpool", DEFAULT_SERVER_I18N_LOCALE, { secrets });
  await requireNotificationHttpOk(response, "Carpool", DEFAULT_SERVER_I18N_LOCALE, { secrets });
}

/** 发送并记录日志（成功/失败原因）；失败会抛出，由调用方决定是否吞掉。 */
async function sendCarpoolWebhook(
  env: Env,
  userId: string,
  config: CarpoolNotificationConfig,
  message: NotificationEmailMessage,
  context: string,
): Promise<void> {
  try {
    await sendRawWebhook(config, message);
    await appendCarpoolNotificationLog(env, userId, true, null, context);
  } catch (error) {
    await appendCarpoolNotificationLog(env, userId, false, error instanceof Error ? error.message : String(error), context);
    throw error;
  }
}

/** 供「测试」按钮调用：用给定配置发一条测试通知并记日志（失败会抛错，由路由转成错误响应）。 */
export async function sendCarpoolTestNotification(env: Env, userId: string, config: CarpoolNotificationConfig): Promise<void> {
  await sendCarpoolWebhook(
    env,
    userId,
    config,
    {
      title: "拼车通知测试",
      content: "这是一条来自「拼车」的测试通知。收到即说明 webhook 配置正确。",
      timestamp: new Date().toISOString(),
      hasPayload: false,
      items: [],
    },
    "测试发送",
  );
}

async function remindUser(env: Env, userId: string, now: Date): Promise<void> {
  const config = await getCarpoolNotification(env, userId);
  if (!config.enabled || !config.webhookUrl.trim()) return;

  const [subs, remindedMap] = await Promise.all([listActiveSubscriptions(env, userId), fetchRemindedMap(env, userId)]);

  const due: DueMember[] = [];
  for (const sub of subs) {
    for (const member of sub.members) {
      if (member.reminderDays < 0 || !member.effectiveExpiry) continue;
      const days = daysBetween(now, member.effectiveExpiry);
      if (days === null || days > member.reminderDays) continue; // 还没进入提醒窗口
      if (remindedMap.get(overlayKey(sub.id, member.id)) === member.effectiveExpiry) continue; // 已提醒过该到期日
      due.push({ subId: sub.id, subName: sub.name, memberId: member.id, memberName: member.name, wechat: member.wechat, email: member.email, expiry: member.effectiveExpiry, days });
    }
  }
  if (due.length === 0) return;

  try {
    await sendCarpoolWebhook(env, userId, config, buildMessage(due, now), `到期提醒 ${due.length} 位车友`);
  } catch {
    // 发送失败（原因已写入通知日志）也照常记 reminded_for，避免 webhook 抖动时每分钟重复轰炸。
  }

  await env.DB.batch(
    due.map((d) =>
      env.DB.prepare(`UPDATE carpool_member_meta SET reminded_for = ? WHERE user_id = ? AND subscription_id = ? AND member_id = ?`).bind(
        d.expiry,
        userId,
        d.subId,
        d.memberId,
      ),
    ),
  );
}

/** Cron 入口：为所有开启了拼车通知的用户发送到期推送。 */
export async function runCarpoolReminders(env: Env): Promise<void> {
  const now = new Date();
  const enabled = await env.DB.prepare(`SELECT user_id FROM carpool_notification WHERE enabled = 1`).all<{ user_id: string }>();

  for (const { user_id: userId } of enabled.results ?? []) {
    try {
      await remindUser(env, userId, now);
    } catch (error) {
      console.error("carpool_reminder_failed", {
        event: "carpool_reminder_failed",
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
