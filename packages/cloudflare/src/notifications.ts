import { z } from "zod";
import {
  notificationHistoryResponseSchema,
  notificationsRunBodySchema,
  notificationsTestBodySchema,
  type NotificationHistoryStatusFilter,
} from "@renewlet/shared/schemas/notifications";
import { effectiveReminderDays } from "@renewlet/shared/runtime";
import { appSettingsSchema, settingsUpdateBodySchema, type ApiAppSettings } from "@renewlet/shared/schemas/settings";
import type { ApiSubscription } from "@renewlet/shared/schemas/subscriptions";
import { cleanBuiltInIconSourceSettingsPatch, mergeBuiltInIconSourceSettings } from "@renewlet/shared/built-in-icons";
import { getSettings, listSubscriptions, newId, nowIso, NOTIFICATION_JOB_COLUMNS, parseJobResult, toApiSubscription } from "./db";
import { HttpError, json, ok, readOptionalJson, readJson, requestLocale, tr } from "./http";
import { requireAuth } from "./auth";
import { notificationSmtpConfig, sendSmtpEmail } from "./smtp";
import type { Env, NotificationJobRow } from "./types";

type Channel = ApiAppSettings["enabledChannels"][number];

interface NotificationMessage {
  title: string;
  content: string;
  timestamp: string;
  hasPayload: boolean;
  items: Array<Record<string, unknown>>;
}

export async function notificationTest(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const body = await readJson(request, notificationsTestBodySchema, locale);
  const settings = await effectiveSettings(env, auth.user.id, body.settings);
  const message = buildTestMessage(new Date(), settings);
  await sendChannel(env, body.channel, settings, message, locale);
  return ok();
}

export async function notificationRun(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const body = await readOptionalJson(request, notificationsRunBodySchema, locale);
  const result = await runForUser(env, auth.user.id, body.force === true, body.settings, "manual", locale);
  if (!result.sent) return json({ ok: true, sent: false, reason: "no_due_items" });
  return json({ ok: true, sent: true, summary: result.summary });
}

export async function notificationHistory(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  const url = new URL(request.url);
  const status = parseHistoryStatus(url.searchParams.get("status"));
  const limit = clamp(parseIntOr(url.searchParams.get("limit"), 20), 1, 50);
  const offset = Math.max(0, parseIntOr(url.searchParams.get("offset"), 0));
  const settings = await getSettings(env, auth.user.id);
  const subscriptions = (await listSubscriptions(env, auth.user.id)).map(toApiSubscription);
  const overview = buildOverview(new Date(), settings, subscriptions);
  const params: unknown[] = [auth.user.id];
  let filter = "WHERE user_id = ?";
  if (status !== "all") {
    filter += " AND status = ?";
    params.push(status);
  }
  params.push(limit + 1, offset);
  const rows = await env.DB.prepare(`SELECT ${NOTIFICATION_JOB_COLUMNS} FROM notification_jobs ${filter} ORDER BY scheduled_instant_utc DESC, created_at DESC LIMIT ? OFFSET ?`)
    .bind(...params)
    .all<NotificationJobRow>();
  const hasMore = rows.results.length > limit;
  const jobs = rows.results.slice(0, limit).map(toHistoryJob);
  const latestJob = await latestJobForUser(env, auth.user.id);
  const latestFailedJob = await latestJobForUser(env, auth.user.id, "failed");
  return json(notificationHistoryResponseSchema.parse({
    summary: {
      ...overview.summary,
      latestJob: latestJob ? toHistoryJob(latestJob) : null,
      latestFailedJob: latestFailedJob ? toHistoryJob(latestFailedJob) : null,
    },
    upcoming: overview.upcoming,
    history: { jobs, status, limit, offset, hasMore },
  }));
}

export async function runScheduledNotifications(env: Env): Promise<void> {
  const users = await env.DB.prepare("SELECT id FROM users WHERE banned = 0").all<{ id: string }>();
  // 单个用户通知失败不能阻断其它用户；失败详情落到 notification_jobs 供 UI 查看。
  await Promise.all(users.results.map((user) => runScheduledForUser(env, user.id).catch(() => undefined)));
}

async function runScheduledForUser(env: Env, userId: string): Promise<void> {
  const settings = await getSettings(env, userId);
  const now = new Date();
  const localDate = dateOnlyInZone(now, settings.timezone);
  const localTime = localTimeInZone(now, settings.timezone);
  if (localTime !== settings.notificationTimeLocal) return;
  const occurrence = scheduleOccurrence(localDate, settings.notificationTimeLocal, settings.timezone);
  const timestamp = nowIso();
  // Cron 每分钟触发且可能重试；唯一键把“某用户某本地日期时间”压成一次发送窗口。
  const insert = await env.DB.prepare(`
    INSERT OR IGNORE INTO notification_jobs (
      id, user_id, scheduled_local_date, scheduled_local_time, time_zone, scheduled_instant_utc,
      status, attempts, last_error, result_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, '{}', ?, ?)
  `).bind(newId("job"), userId, occurrence.scheduledLocalDate, occurrence.scheduledLocalTime, occurrence.timeZone, occurrence.scheduledInstantUtc, timestamp, timestamp).run();
  if ((insert.meta.changes ?? 0) === 0) return;
  await runForUser(env, userId, false, undefined, "cron", "zh-CN", occurrence);
}

async function runForUser(
  env: Env,
  userId: string,
  force: boolean,
  settingsPatch: SettingsPatch | undefined,
  source: "cron" | "manual",
  locale: "zh-CN" | "en-US",
  occurrence?: ReturnType<typeof scheduleOccurrence>,
): Promise<{ sent: boolean; summary: SendSummary }> {
  const settings = await effectiveSettings(env, userId, settingsPatch);
  const subscriptions = (await listSubscriptions(env, userId)).map(toApiSubscription);
  const now = new Date();
  const schedule = occurrence ?? scheduleOccurrence(dateOnlyInZone(now, settings.timezone), settings.notificationTimeLocal, settings.timezone);
  const message = buildDueMessage(now, settings, subscriptions, true);
  if (!message.hasPayload && !force) {
    // cron 空跑也要写 skipped，历史页才能解释“调度正常但没有到期内容”。
    if (source === "cron") await finalizeJob(env, userId, schedule, "skipped", 0, null, {});
    return { sent: false, summary: { attempted: [], succeeded: [], failed: [] } };
  }
  if (settings.enabledChannels.length === 0) {
    throw new HttpError(400, tr(locale, "未启用任何通知渠道，请先到设置页勾选通知方式。", "No notification channels are enabled. Enable one in Settings first."));
  }
  const summary = await sendChannels(env, settings.enabledChannels, settings, message, locale);
  const status = summary.failed.length > 0 && summary.succeeded.length === 0 ? "failed" : "sent";
  await finalizeJob(env, userId, schedule, status, summary.attempted.length, summary.failed[0]?.error ?? null, {
    // 历史详情保存的是产品可解释结果，不保存 provider token 或完整外部响应。
    source: "cron",
    reason: null,
    force,
    windowMinutes: 1,
    triggeredAtUtc: now.toISOString(),
    schedule,
    settings: {
      timezone: settings.timezone,
      locale: settings.locale,
      notificationTimeLocal: settings.notificationTimeLocal,
      enabledChannels: settings.enabledChannels,
      showExpired: settings.showExpired,
    },
    message,
    channels: summary,
  });
  return { sent: true, summary };
}

type SettingsPatch = z.infer<typeof settingsUpdateBodySchema>;

async function effectiveSettings(env: Env, userId: string, patch?: SettingsPatch): Promise<ApiAppSettings> {
  const current = await getSettings(env, userId);
  const stripped = stripUndefined(patch ?? {});
  return appSettingsSchema.parse({
    ...current,
    ...stripped,
    builtInIconSources: mergeBuiltInIconSourceSettings(current.builtInIconSources, cleanBuiltInIconSourceSettingsPatch(stripped.builtInIconSources)),
  });
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

interface SendSummary {
  attempted: Channel[];
  succeeded: Channel[];
  failed: Array<{ channel: Channel; error: string }>;
}

async function sendChannels(env: Env, channels: Channel[], settings: ApiAppSettings, message: NotificationMessage, locale: "zh-CN" | "en-US"): Promise<SendSummary> {
  const summary: SendSummary = { attempted: channels, succeeded: [], failed: [] };
  for (const channel of channels) {
    try {
      // 多渠道是“尽力发送”：一个渠道失败要进入 summary，不能吞掉其它渠道的成功。
      await sendChannel(env, channel, settings, message, locale);
      summary.succeeded.push(channel);
    } catch (error) {
      summary.failed.push({ channel, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return summary;
}

async function sendChannel(env: Env, channel: Channel, settings: ApiAppSettings, message: NotificationMessage, locale: "zh-CN" | "en-US"): Promise<void> {
  switch (channel) {
    case "telegram":
      await postJson(`https://api.telegram.org/bot${required(settings.telegramBotToken, "Telegram Bot Token", locale)}/sendMessage`, {
        chat_id: required(settings.telegramChatId, "Telegram Chat ID", locale),
        text: textMessage(message),
        disable_web_page_preview: true,
      });
      return;
    case "notifyx":
      await postJson(`https://www.notifyx.cn/api/v1/send/${encodeURIComponent(required(settings.notifyxApiKey, "Notifyx API Key", locale))}`, {
        title: message.title,
        content: message.content,
        description: message.timestamp,
      });
      return;
    case "webhook":
      await sendWebhook(settings, message, locale);
      return;
    case "wechat":
      await postJson(safeHttpsUrl(required(settings.wechatWebhookUrl, "WeCom Webhook URL", locale), locale), {
        msgtype: settings.wechatMessageType,
        [settings.wechatMessageType]: settings.wechatMessageType === "markdown" ? { content: textMessage(message) } : { content: textMessage(message), mentioned_mobile_list: settings.wechatAtAll ? ["@all"] : splitList(settings.wechatAtPhones) },
      });
      return;
    case "bark":
      await fetch(barkUrl(settings, message, locale));
      return;
    case "email":
      await sendEmail(env, settings, message, locale);
      return;
  }
}

async function sendWebhook(settings: ApiAppSettings, message: NotificationMessage, locale: "zh-CN" | "en-US"): Promise<void> {
  const endpoint = safeHttpsUrl(required(settings.webhookUrl, "Webhook URL", locale), locale);
  const headers = parseHeaders(settings.webhookHeaders);
  if (settings.webhookMethod === "GET") {
    // GET webhook 只能把模板字段放 query，避免对方服务忽略 body 导致测试“成功但无内容”。
    const url = new URL(endpoint);
    url.searchParams.set("title", message.title);
    url.searchParams.set("content", message.content);
    url.searchParams.set("timestamp", message.timestamp);
    await fetch(url, { method: "GET", headers });
    return;
  }
  headers.set("content-type", headers.get("content-type") ?? "application/json");
  const body = settings.webhookPayload.trim()
    ? applyTemplate(settings.webhookPayload, message)
    : JSON.stringify({ title: message.title, content: message.content, timestamp: message.timestamp });
  await fetch(endpoint, { method: "POST", headers, body });
}

async function sendEmail(env: Env, settings: ApiAppSettings, message: NotificationMessage, locale: "zh-CN" | "en-US"): Promise<void> {
  let to = splitList(settings.recipientEmail);
  if (!settings.notifyMultipleAddresses && to.length > 1) to = to.slice(0, 1);
  if (to.length === 0) throw new Error(tr(locale, "收件人邮箱为空", "Recipient email is empty"));
  await sendSmtpEmail(notificationSmtpConfig(settings, locale), { to, subject: message.title, text: textMessage(message) }, locale);
}

function buildOverview(now: Date, settings: ApiAppSettings, subscriptions: ApiSubscription[]) {
  const localDate = dateOnlyInZone(now, settings.timezone);
  const nextCheck = scheduleOccurrence(localDate, settings.notificationTimeLocal, settings.timezone);
  // 预览只看未来 30 天，保证设置页打开时不会按订阅总量无限扩展调度计算。
  const upcoming = Array.from({ length: 30 }, (_, offset) => addDays(localDate, offset))
    .map((date) => ({ ...scheduleOccurrence(date, settings.notificationTimeLocal, settings.timezone), items: collectItems(date, settings, subscriptions, { includeExpired: false }) }))
    .filter((batch) => batch.items.length > 0);
  return {
    summary: {
      nextCheck,
      nextContentBatch: upcoming[0] ?? null,
      blockers: notificationBlockers(settings),
      enabledChannels: settings.enabledChannels,
      upcomingDays: 30,
    },
    upcoming,
  };
}

function buildTestMessage(now: Date, settings: ApiAppSettings): NotificationMessage {
  return { title: "Renewlet", content: settings.locale === "en-US" ? "This is a Renewlet test notification." : "这是一条 Renewlet 测试通知。", timestamp: displayTime(now, settings), hasPayload: true, items: [] };
}

function buildDueMessage(now: Date, settings: ApiAppSettings, subscriptions: ApiSubscription[], includeExpired: boolean): NotificationMessage {
  const items = collectItems(dateOnlyInZone(now, settings.timezone), settings, subscriptions, { includeExpired });
  const locale = settings.locale;
  const content = items.length === 0
    ? (locale === "en-US" ? "No subscriptions are due right now." : "当前没有需要提醒的订阅。")
    : items.map((item) => `- ${String(item["name"])}: ${String(item["targetDate"])} ${String(item["price"])} ${String(item["currency"])}`).join("\n");
  return { title: locale === "en-US" ? "Renewlet renewal reminder" : "Renewlet 续费提醒", content, timestamp: displayTime(now, settings), hasPayload: items.length > 0, items };
}

function collectItems(localDate: string, settings: ApiAppSettings, subscriptions: ApiSubscription[], options: { includeExpired: boolean }) {
  const items: Array<Record<string, unknown>> = [];
  for (const sub of subscriptions) {
    // one-time 是买断记录；Worker 通知不能把购买日当成续费/过期日生成提醒。
    if (sub.billingCycle === "one-time") continue;
    const reminderDays = effectiveReminderDays(sub.reminderDays, settings.notificationReminderDays);
    const daysUntilNext = daysBetween(localDate, sub.nextBillingDate);
    if (daysUntilNext < 0 && settings.showExpired && options.includeExpired) items.push(item("expired", sub, sub.nextBillingDate, daysUntilNext, reminderDays));
    if (daysUntilNext === reminderDays) items.push(item("renewal", sub, sub.nextBillingDate, daysUntilNext, reminderDays));
    if (sub.status === "trial" && sub.trialEndDate) {
      const daysUntilTrial = daysBetween(localDate, sub.trialEndDate);
      if (daysUntilTrial === reminderDays) items.push(item("trial", sub, sub.trialEndDate, daysUntilTrial, reminderDays));
    }
  }
  return items;
}

function item(type: "renewal" | "trial" | "expired", sub: ApiSubscription, targetDate: string, daysUntil: number, reminderDays: number) {
  return {
    type,
    subscriptionId: sub.id,
    name: sub.name,
    price: sub.price,
    currency: sub.currency,
    status: sub.status,
    targetDate,
    // -1 只在订阅存储层表示“继承设置”；通知历史和渠道 payload 保存解析后的可解释天数。
    reminderDays,
    daysUntil,
    ...(sub.repeatReminderEnabled ? { repeatReminder: { interval: sub.repeatReminderInterval, window: sub.repeatReminderWindow } } : {}),
  };
}

async function finalizeJob(env: Env, userId: string, schedule: ReturnType<typeof scheduleOccurrence>, status: string, attempts: number, error: string | null, result: unknown): Promise<void> {
  const timestamp = nowIso();
  // finalize 只按调度窗口更新，不按 job id；这样 cron 插入后的发送阶段可复用同一幂等键。
  await env.DB.prepare(`
    UPDATE notification_jobs SET status = ?, attempts = ?, last_error = ?, result_json = ?, updated_at = ?
    WHERE user_id = ? AND scheduled_local_date = ? AND scheduled_local_time = ? AND time_zone = ?
  `).bind(status, attempts, error, JSON.stringify(result), timestamp, userId, schedule.scheduledLocalDate, schedule.scheduledLocalTime, schedule.timeZone).run();
}

function toHistoryJob(row: NotificationJobRow) {
  return {
    id: row.id,
    scheduledLocalDate: row.scheduled_local_date,
    scheduledLocalTime: row.scheduled_local_time,
    timeZone: row.time_zone,
    scheduledInstantUtc: row.scheduled_instant_utc,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    result: parseJobResult(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function latestJobForUser(env: Env, userId: string, status?: string): Promise<NotificationJobRow | null> {
  const filter = status ? "WHERE user_id = ? AND status = ?" : "WHERE user_id = ?";
  const params = status ? [userId, status] : [userId];
  return await env.DB.prepare(`SELECT ${NOTIFICATION_JOB_COLUMNS} FROM notification_jobs ${filter} ORDER BY scheduled_instant_utc DESC, created_at DESC LIMIT 1`).bind(...params).first<NotificationJobRow>();
}

function parseHistoryStatus(value: string | null): NotificationHistoryStatusFilter {
  return z.enum(["all", "sent", "failed", "skipped", "sending"]).catch("all").parse(value ?? "all");
}

function notificationBlockers(settings: ApiAppSettings): string[] {
  const blockers: string[] = [];
  if (settings.enabledChannels.length === 0) blockers.push("no_enabled_channels");
  if (settings.enabledChannels.includes("email") && !settings.recipientEmail.trim()) blockers.push("email_recipient_missing");
  return blockers;
}

async function postJson(url: string, payload: unknown, headers?: Record<string, string>): Promise<void> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(headers ?? {}) }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text().catch(() => response.statusText)}`);
}

function safeHttpsUrl(raw: string, locale: "zh-CN" | "en-US"): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(tr(locale, "URL 无效", "URL is invalid"));
  }
  if (url.protocol !== "https:") throw new Error(tr(locale, "URL 必须使用 https://", "URL must use https://"));
  // 用户可配置 webhook/Bark 地址；禁止内网和本机目标，避免 Worker 变成 SSRF 跳板。
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(url.hostname)) {
    throw new Error(tr(locale, "URL 不允许指向内网或本机地址", "URL cannot point to private or localhost addresses"));
  }
  return url.toString();
}

function barkUrl(settings: ApiAppSettings, message: NotificationMessage, locale: "zh-CN" | "en-US"): string {
  const server = safeHttpsUrl(settings.barkServerUrl || "https://api.day.app", locale).replace(/\/+$/, "");
  const key = required(settings.barkDeviceKey, "Bark Device Key", locale);
  const url = new URL(`${server}/${encodeURIComponent(key)}/${encodeURIComponent(message.title)}/${encodeURIComponent(message.content)}`);
  if (settings.barkSilentPush) url.searchParams.set("isArchive", "1");
  return url.toString();
}

function parseHeaders(value: string): Headers {
  const headers = new Headers();
  if (!value.trim()) return headers;
  // headers 是高级配置，保持 JSON 对象语义；解析失败应让测试发送显式失败。
  const parsed = JSON.parse(value) as Record<string, string>;
  for (const [key, item] of Object.entries(parsed)) headers.set(key, item);
  return headers;
}

function required(value: string, label: string, locale: "zh-CN" | "en-US"): string {
  if (value.trim()) return value.trim();
  throw new Error(tr(locale, `${label} 不能为空`, `${label} is required`));
}

function textMessage(message: NotificationMessage): string {
  return `${message.title}\n\n${message.content}\n\n${message.timestamp}`;
}

function applyTemplate(template: string, message: NotificationMessage): string {
  return template.replaceAll("{title}", message.title).replaceAll("{content}", message.content).replaceAll("{timestamp}", message.timestamp);
}

function splitList(input: string): string[] {
  return input.split(/[,\n;]/).map((item) => item.trim()).filter(Boolean);
}

function scheduleOccurrence(date: string, time: string, timezone: string) {
  return { scheduledLocalDate: date, scheduledLocalTime: time, timeZone: timezone, scheduledInstantUtc: zonedWallTimeToUtc(date, time, timezone) };
}

function dateOnlyInZone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}

function localTimeInZone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false, hourCycle: "h23" }).formatToParts(date);
  return `${part(parts, "hour")}:${part(parts, "minute")}`;
}

function displayTime(date: Date, settings: ApiAppSettings): string {
  return `${dateOnlyInZone(date, settings.timezone)} ${localTimeInZone(date, settings.timezone)} ${settings.timezone}`;
}

function zonedWallTimeToUtc(date: string, time: string, timezone: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  let utc = Date.UTC(year, month - 1, day, hour, minute);
  // Intl 只能从 UTC 推本地时间；两轮校正把“本地墙钟时间”反推成 UTC instant。
  for (let i = 0; i < 2; i++) {
    const shownDate = dateOnlyInZone(new Date(utc), timezone);
    const shownTime = localTimeInZone(new Date(utc), timezone);
    const [sy, sm, sd] = shownDate.split("-").map(Number) as [number, number, number];
    const [sh, smin] = shownTime.split(":").map(Number) as [number, number];
    utc += Date.UTC(year, month - 1, day, hour, minute) - Date.UTC(sy, sm - 1, sd, sh, smin);
  }
  return new Date(utc).toISOString();
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((item) => item.type === type)?.value ?? "00";
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function addDays(date: string, days: number): string {
  const value = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return value.toISOString().slice(0, 10);
}

function parseIntOr(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
