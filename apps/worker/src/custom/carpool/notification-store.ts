/**
 * 拼车专属通知的配置与发送日志存储。
 *
 * 拼车通知独立于系统订阅通知：只有一个用户自己配的 webhook。从 store.ts 拆出以控制单文件长度，
 * 表的建表/补列仍统一由 schema.ts 的 `ensureCarpoolSchema` 负责。
 */
import type { Env } from "../../types";
import { ensureCarpoolSchema } from "./schema";

/** 拼车专属通知配置（只支持 webhook；系统 webhook 是给订阅用的，这里独立一份，字段照搬系统 webhook）。 */
export interface CarpoolNotificationConfig {
  enabled: boolean;
  webhookUrl: string;
  webhookMethod: "GET" | "POST";
  webhookHeaders: string;
  webhookPayload: string;
}

const DEFAULT_NOTIFICATION: CarpoolNotificationConfig = {
  enabled: false,
  webhookUrl: "",
  webhookMethod: "POST",
  webhookHeaders: "",
  webhookPayload: "",
};

/** 读取用户的拼车通知配置（无则返回默认）。 */
export async function getCarpoolNotification(env: Env, userId: string): Promise<CarpoolNotificationConfig> {
  await ensureCarpoolSchema(env);
  const row = await env.DB.prepare(
    `SELECT enabled, webhook_url, webhook_method, webhook_headers, webhook_payload FROM carpool_notification WHERE user_id = ? LIMIT 1`,
  )
    .bind(userId)
    .first<{ enabled: number; webhook_url: string | null; webhook_method: string | null; webhook_headers: string | null; webhook_payload: string | null }>();
  if (!row) return { ...DEFAULT_NOTIFICATION };
  return {
    enabled: row.enabled === 1,
    webhookUrl: row.webhook_url ?? "",
    webhookMethod: row.webhook_method === "GET" ? "GET" : "POST",
    webhookHeaders: row.webhook_headers ?? "",
    webhookPayload: row.webhook_payload ?? "",
  };
}

/** 覆盖保存用户的拼车通知配置。 */
export async function saveCarpoolNotification(env: Env, userId: string, config: CarpoolNotificationConfig): Promise<void> {
  await ensureCarpoolSchema(env);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO carpool_notification (user_id, enabled, webhook_url, webhook_method, webhook_headers, webhook_payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      userId,
      config.enabled ? 1 : 0,
      config.webhookUrl.trim() || null,
      config.webhookMethod === "GET" ? "GET" : "POST",
      config.webhookHeaders || null,
      config.webhookPayload || null,
      now,
      now,
    )
    .run();
}

/** 拼车通知发送日志（含失败原因）。 */
export interface CarpoolNotificationLog {
  id: string;
  createdAt: string;
  ok: boolean;
  error: string | null;
  context: string | null;
}

/** 追加一条通知发送日志，并保留每用户最近 30 条。 */
export async function appendCarpoolNotificationLog(
  env: Env,
  userId: string,
  ok: boolean,
  error: string | null,
  context: string | null,
): Promise<void> {
  await ensureCarpoolSchema(env);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO carpool_notification_log (id, user_id, created_at, ok, error, context) VALUES (?, ?, ?, ?, ?, ?)`).bind(
      crypto.randomUUID(),
      userId,
      new Date().toISOString(),
      ok ? 1 : 0,
      error ? error.slice(0, 1000) : null,
      context ? context.slice(0, 500) : null,
    ),
    // 只保留最近 30 条，避免日志无限增长。
    env.DB.prepare(
      `DELETE FROM carpool_notification_log WHERE user_id = ? AND id NOT IN (
         SELECT id FROM carpool_notification_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 30
       )`,
    ).bind(userId, userId),
  ]);
}

/** 读取用户最近的通知发送日志。 */
export async function listCarpoolNotificationLog(env: Env, userId: string): Promise<CarpoolNotificationLog[]> {
  await ensureCarpoolSchema(env);
  const rows = await env.DB.prepare(
    `SELECT id, created_at, ok, error, context FROM carpool_notification_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`,
  )
    .bind(userId)
    .all<{ id: string; created_at: string; ok: number; error: string | null; context: string | null }>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    ok: row.ok === 1,
    error: row.error ?? null,
    context: row.context ?? null,
  }));
}

/**
 * 上一次发送是否失败、失败多久了。
 *
 * 发送失败时不再记 reminded_for（否则那条到期提醒永久丢失），改为按这个冷却窗重试：
 * 只要最近一条日志是失败且在冷却窗内，就跳过本轮，避免 webhook 挂掉时每分钟重试轰炸。
 */
export async function lastNotificationFailedWithin(env: Env, userId: string, now: Date, cooldownMs: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT ok, created_at FROM carpool_notification_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(userId)
    .first<{ ok: number; created_at: string }>();
  if (!row || row.ok === 1) return false;
  const at = new Date(row.created_at).getTime();
  return Number.isFinite(at) && now.getTime() - at < cooldownMs;
}
