/**
 * 拼车到期推送提醒（定时任务）+ 拼车专属 webhook 通知。
 *
 * 由 index.ts 的补丁在 Cron 阶段调用 `runCarpoolReminders(env)`。拼车通知**独立于系统订阅通知**：
 * 只走用户在拼车页面单独配置的一个 webhook（系统 webhook 的 URL/方法/负载是给订阅用的，不适用）。
 * 发送时把拼车 webhook 的 4 个字段覆盖进一份默认 settings，复用上游 `sendChannel(env,"webhook",...)`。
 *
 * Cron 每分钟触发，用 `carpool_member_meta.reminded_for` 去重：每个到期日只发一次（发送成败都记）。
 *
 * 注意：`notification-channel-send` 传递依赖 `smtp.ts → cloudflare:sockets`（Workers 专有模块），Node 下的
 * vitest 无法解析，所以只在真正发送时 `import()`，避免测试加载 index.ts 时被拖累。
 */
import type { NotificationEmailMessage } from "@renewlet/shared/email-template";
import { createDefaultAppSettings } from "@renewlet/shared/settings-defaults";
import { DEFAULT_SERVER_I18N_LOCALE } from "../../server-i18n";
import type { Env } from "../../types";
import { getCarpoolNotification, listActiveSubscriptions, type CarpoolNotificationConfig } from "./store";

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
  const lines = due.map((d) => {
    const when = d.days < 0 ? `已过期 ${-d.days} 天` : d.days === 0 ? "今天到期" : `${d.days} 天后到期`;
    return `· ${d.subName} — ${d.memberName}：${when}（${d.expiry}）`;
  });
  return {
    title: "拼车到期提醒",
    content: `以下拼车车友即将到期或已过期：\n${lines.join("\n")}`,
    timestamp: now.toISOString(),
    hasPayload: false,
    items: [],
  };
}

/** 用拼车 webhook 配置覆盖一份默认 settings（sendWebhook 只读这 4 个字段）。 */
function carpoolWebhookSettings(config: CarpoolNotificationConfig) {
  return {
    ...createDefaultAppSettings(),
    webhookUrl: config.webhookUrl,
    webhookMethod: config.webhookMethod,
    webhookHeaders: config.webhookHeaders,
    webhookPayload: config.webhookPayload,
  };
}

/** 通过拼车专属 webhook 发送一条消息（动态 import 以避开测试环境的 cloudflare:sockets）。 */
async function sendViaCarpoolWebhook(env: Env, config: CarpoolNotificationConfig, message: NotificationEmailMessage): Promise<void> {
  const { sendChannel } = await import("../../notification-channel-send");
  await sendChannel(env, "webhook", carpoolWebhookSettings(config), message, DEFAULT_SERVER_I18N_LOCALE);
}

/** 供「测试」按钮调用：用给定配置发一条测试通知（配置无效会抛错，由路由转成错误响应）。 */
export async function sendCarpoolTestNotification(env: Env, config: CarpoolNotificationConfig): Promise<void> {
  await sendViaCarpoolWebhook(env, config, {
    title: "拼车通知测试",
    content: "这是一条来自「拼车」的测试通知。收到即说明 webhook 配置正确。",
    timestamp: new Date().toISOString(),
    hasPayload: false,
    items: [],
  });
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
      due.push({ subId: sub.id, subName: sub.name, memberId: member.id, memberName: member.name, expiry: member.effectiveExpiry, days });
    }
  }
  if (due.length === 0) return;

  try {
    await sendViaCarpoolWebhook(env, config, buildMessage(due, now));
  } catch (error) {
    // 发送失败也照常记 reminded_for，避免 webhook 抖动时每分钟重复轰炸；错误只记日志。
    console.error("carpool_reminder_send_failed", { event: "carpool_reminder_send_failed", userId, error: error instanceof Error ? error.message : String(error) });
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
  // Cron 每分钟触发；只扫描「开启了拼车通知」的用户。
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
