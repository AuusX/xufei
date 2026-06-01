import { createDefaultAppSettings } from "@renewlet/shared/settings-defaults";
import { appSettingsSchema, settingsUpdateBodySchema, type ApiAppSettings } from "@renewlet/shared/schemas/settings";
import { apiSubscriptionSchema, type ApiSubscription } from "@renewlet/shared/schemas/subscriptions";
import { cleanBuiltInIconSourceSettingsPatch, mergeBuiltInIconSourceSettings } from "@renewlet/shared/built-in-icons";
import type { AdminUser } from "@renewlet/shared/schemas/admin";
import type { AssetRow, Env, NotificationJobRow, SubscriptionRow, UserRow } from "./types";

const userColumnNames = [
  "id",
  "email",
  "name",
  "role",
  "banned",
  "ban_reason",
  "password_hash",
  "reset_token_hash",
  "reset_token_expires_at",
  "created_at",
  "updated_at",
] as const;

const subscriptionColumnNames = [
  "id",
  "user_id",
  "name",
  "logo",
  "price",
  "currency",
  "billing_cycle",
  "custom_days",
  "category",
  "status",
  "payment_method",
  "start_date",
  "next_billing_date",
  "auto_calculate_next_billing_date",
  "trial_end_date",
  "website",
  "notes",
  "tags_json",
  "reminder_days",
  "repeat_reminder_enabled",
  "repeat_reminder_interval",
  "repeat_reminder_window",
  "extra_json",
  "created_at",
  "updated_at",
] as const;

const assetColumnNames = [
  "id",
  "user_id",
  "kind",
  "r2_key",
  "original_name",
  "mime_type",
  "size_bytes",
  "created_at",
  "updated_at",
] as const;

const notificationJobColumnNames = [
  "id",
  "user_id",
  "scheduled_local_date",
  "scheduled_local_time",
  "time_zone",
  "scheduled_instant_utc",
  "status",
  "attempts",
  "last_error",
  "result_json",
  "created_at",
  "updated_at",
] as const;

export const USER_COLUMNS = userColumnNames.join(", ");
export const USER_COLUMNS_FROM_USERS = userColumnNames.map((column) => `users.${column} AS ${column}`).join(", ");
export const SUBSCRIPTION_COLUMNS = subscriptionColumnNames.join(", ");
export const ASSET_COLUMNS = assetColumnNames.join(", ");
export const NOTIFICATION_JOB_COLUMNS = notificationJobColumnNames.join(", ");

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

export function intToBool(value: number | null | undefined): boolean {
  return value === 1;
}

export function toAdminUser(row: UserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    banned: intToBool(row.banned),
    banReason: row.ban_reason || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findUserByEmail(env: Env, email: string): Promise<UserRow | null> {
  return await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE lower(email) = lower(?) LIMIT 1`).bind(email).first<UserRow>();
}

export async function findUserById(env: Env, id: string): Promise<UserRow | null> {
  return await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ? LIMIT 1`).bind(id).first<UserRow>();
}

export async function listUsers(env: Env): Promise<UserRow[]> {
  const result = await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at DESC`).all<UserRow>();
  return result.results;
}

export async function hasEnabledAdmin(env: Env): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' AND banned = 0 LIMIT 1").first<{ id: string }>();
  return row !== null;
}

export async function enabledAdminCount(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND banned = 0 LIMIT 1").first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getSettings(env: Env, userId: string): Promise<ApiAppSettings> {
  const row = await env.DB.prepare("SELECT settings_json FROM settings WHERE user_id = ? LIMIT 1").bind(userId).first<{ settings_json: string }>();
  if (!row) return createDefaultAppSettings();
  return normalizeSettingsJson(row.settings_json);
}

export async function putSettings(env: Env, userId: string, settings: ApiAppSettings): Promise<ApiAppSettings> {
  const parsed = appSettingsSchema.parse(settings);
  const timestamp = nowIso();
  await env.DB.prepare(`
    INSERT INTO settings (user_id, settings_json, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at
  `).bind(userId, JSON.stringify(parsed), timestamp, timestamp).run();
  return parsed;
}

export function normalizeSettingsJson(value: string): ApiAppSettings {
  try {
    const parsed = JSON.parse(value) as unknown;
    const result = settingsUpdateBodySchema.safeParse(parsed);
    if (result.success) {
      const defaults = createDefaultAppSettings();
      // 历史 settings_json 缺字段时只在读取边界补默认值，不写回 D1，也不触碰订阅自己的显式 reminder_days。
      return appSettingsSchema.parse({
        ...defaults,
        ...result.data,
        builtInIconSources: mergeBuiltInIconSourceSettings(defaults.builtInIconSources, cleanBuiltInIconSourceSettingsPatch(result.data.builtInIconSources)),
      });
    }
  } catch {
    // D1 里 settings_json 不是可信源；坏 JSON 只能回落默认值，不能拖垮整个 Worker。
  }
  return createDefaultAppSettings();
}

export async function getCustomConfig(env: Env, userId: string): Promise<unknown> {
  const row = await env.DB.prepare("SELECT config_json FROM custom_configs WHERE user_id = ? LIMIT 1").bind(userId).first<{ config_json: string }>();
  if (!row) return { categories: [], statuses: [], paymentMethods: [], currencies: [] };
  try {
    return JSON.parse(row.config_json) as unknown;
  } catch {
    return { categories: [], statuses: [], paymentMethods: [], currencies: [] };
  }
}

export async function putCustomConfig(env: Env, userId: string, config: unknown): Promise<unknown> {
  const timestamp = nowIso();
  await env.DB.prepare(`
    INSERT INTO custom_configs (user_id, config_json, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at
  `).bind(userId, JSON.stringify(config), timestamp, timestamp).run();
  return config;
}

export function toApiSubscription(row: SubscriptionRow): ApiSubscription {
  const tags = parseStringArray(row.tags_json);
  const extra = parseJsonObject(row.extra_json);
  // D1 行使用 snake_case/整数布尔；所有出站数据都在这里重新过 shared schema，避免前端和 Worker 分叉。
  const normalized = {
    id: row.id,
    name: row.name,
    ...(row.logo ? { logo: row.logo } : {}),
    price: row.price,
    currency: row.currency,
    billingCycle: row.billing_cycle,
    ...(row.custom_days === null ? {} : { customDays: row.custom_days }),
    category: row.category,
    status: row.status,
    ...(row.payment_method ? { paymentMethod: row.payment_method } : {}),
    startDate: row.start_date,
    nextBillingDate: row.next_billing_date,
    autoCalculateNextBillingDate: intToBool(row.auto_calculate_next_billing_date),
    ...(row.trial_end_date ? { trialEndDate: row.trial_end_date } : {}),
    ...(row.website ? { website: row.website } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
    tags,
    reminderDays: row.reminder_days,
    repeatReminderEnabled: intToBool(row.repeat_reminder_enabled),
    repeatReminderInterval: row.repeat_reminder_interval,
    repeatReminderWindow: row.repeat_reminder_window,
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return apiSubscriptionSchema.parse(normalized);
}

export async function getSubscription(env: Env, userId: string, id: string): Promise<SubscriptionRow | null> {
  return await env.DB.prepare(`SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE user_id = ? AND id = ? LIMIT 1`).bind(userId, id).first<SubscriptionRow>();
}

export async function listSubscriptions(env: Env, userId: string): Promise<SubscriptionRow[]> {
  const result = await env.DB.prepare(`SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC`).bind(userId).all<SubscriptionRow>();
  return result.results;
}

export async function getAsset(env: Env, userId: string, id: string): Promise<AssetRow | null> {
  return await env.DB.prepare(`SELECT ${ASSET_COLUMNS} FROM assets WHERE user_id = ? AND id = ? LIMIT 1`).bind(userId, id).first<AssetRow>();
}

export async function listAssets(env: Env, userId: string, kind: string, page: number, perPage: number): Promise<{ items: AssetRow[]; total: number }> {
  const offset = (page - 1) * perPage;
  const totalRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM assets WHERE user_id = ? AND kind = ? LIMIT 1").bind(userId, kind).first<{ count: number }>();
  const rows = await env.DB.prepare(`SELECT ${ASSET_COLUMNS} FROM assets WHERE user_id = ? AND kind = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
    .bind(userId, kind, perPage, offset)
    .all<AssetRow>();
  return { items: rows.results, total: totalRow?.count ?? 0 };
}

export function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function parseJobResult(row: NotificationJobRow): unknown {
  try {
    return JSON.parse(row.result_json) as unknown;
  } catch {
    return {};
  }
}
