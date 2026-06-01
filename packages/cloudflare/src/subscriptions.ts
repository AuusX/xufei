import { subscriptionCreateBodySchema, subscriptionUpdateBodySchema } from "@renewlet/shared/schemas/subscriptions";
import { boolToInt, getSubscription, listSubscriptions, newId, nowIso, parseJsonObject, toApiSubscription } from "./db";
import { HttpError, json, ok, readJson, requestLocale, tr } from "./http";
import { requireAuth } from "./auth";
import type { Env, SubscriptionRow } from "./types";

export async function readSubscriptions(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  const rows = await listSubscriptions(env, auth.user.id);
  return json({ subscriptions: rows.map(toApiSubscription) });
}

export async function createSubscription(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const body = await readJson(request, subscriptionCreateBodySchema, locale);
  const timestamp = nowIso();
  const row = toSubscriptionRow(newId("sub"), auth.user.id, body, timestamp, timestamp);
  await env.DB.prepare(`
    INSERT INTO subscriptions (
      id, user_id, name, logo, price, currency, billing_cycle, custom_days, category, status, payment_method,
      start_date, next_billing_date, auto_calculate_next_billing_date, trial_end_date, website, notes, tags_json,
      reminder_days, repeat_reminder_enabled, repeat_reminder_interval, repeat_reminder_window, extra_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(...subscriptionRowValues(row)).run();
  return json({ subscription: toApiSubscription(row) }, { status: 201 });
}

export async function updateSubscription(request: Request, env: Env, id: string): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const existing = await getSubscription(env, auth.user.id, id);
  if (!existing) throw new HttpError(404, tr(locale, "订阅不存在", "Subscription not found"));
  const patch = await readJson(request, subscriptionUpdateBodySchema, locale);
  const timestamp = nowIso();
  // Worker 没有 PocketBase hook 可二次归一；更新必须先回 API body，再合并 patch 走同一套 create schema。
  const mergedBody = subscriptionCreateBodySchema.parse({ ...toBody(existing), ...stripUndefined(patch) });
  const merged = toSubscriptionRow(existing.id, auth.user.id, mergedBody, existing.created_at, timestamp);
  await env.DB.prepare(`
    UPDATE subscriptions SET
      name = ?, logo = ?, price = ?, currency = ?, billing_cycle = ?, custom_days = ?, category = ?, status = ?,
      payment_method = ?, start_date = ?, next_billing_date = ?, auto_calculate_next_billing_date = ?,
      trial_end_date = ?, website = ?, notes = ?, tags_json = ?, reminder_days = ?, repeat_reminder_enabled = ?,
      repeat_reminder_interval = ?, repeat_reminder_window = ?, extra_json = ?, updated_at = ?
    WHERE user_id = ? AND id = ?
  `).bind(
    merged.name,
    merged.logo,
    merged.price,
    merged.currency,
    merged.billing_cycle,
    merged.custom_days,
    merged.category,
    merged.status,
    merged.payment_method,
    merged.start_date,
    merged.next_billing_date,
    merged.auto_calculate_next_billing_date,
    merged.trial_end_date,
    merged.website,
    merged.notes,
    merged.tags_json,
    merged.reminder_days,
    merged.repeat_reminder_enabled,
    merged.repeat_reminder_interval,
    merged.repeat_reminder_window,
    merged.extra_json,
    timestamp,
    auth.user.id,
    id,
  ).run();
  return json({ subscription: toApiSubscription(merged) });
}

export async function deleteSubscription(request: Request, env: Env, id: string): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const result = await env.DB.prepare("DELETE FROM subscriptions WHERE user_id = ? AND id = ?").bind(auth.user.id, id).run();
  if ((result.meta.changes ?? 0) === 0) throw new HttpError(404, tr(locale, "订阅不存在", "Subscription not found"));
  return ok();
}

export type SubscriptionBody = ReturnType<typeof subscriptionCreateBodySchema.parse>;

function toBody(row: SubscriptionRow): SubscriptionBody {
  return {
    name: row.name,
    logo: row.logo,
    price: row.price,
    currency: row.currency,
    billingCycle: row.billing_cycle as SubscriptionBody["billingCycle"],
    customDays: row.custom_days,
    category: row.category,
    status: row.status as SubscriptionBody["status"],
    paymentMethod: row.payment_method,
    startDate: row.start_date,
    nextBillingDate: row.next_billing_date,
    autoCalculateNextBillingDate: row.auto_calculate_next_billing_date === 1,
    trialEndDate: row.trial_end_date,
    website: row.website,
    notes: row.notes,
    tags: JSON.parse(row.tags_json) as string[],
    reminderDays: row.reminder_days,
    repeatReminderEnabled: row.repeat_reminder_enabled === 1,
    repeatReminderInterval: row.repeat_reminder_interval as SubscriptionBody["repeatReminderInterval"],
    repeatReminderWindow: row.repeat_reminder_window as SubscriptionBody["repeatReminderWindow"],
    extra: parseJsonObject(row.extra_json),
  };
}

export function toSubscriptionRow(
  id: string,
  userId: string,
  body: SubscriptionBody,
  createdAt: string,
  updatedAt: string,
): SubscriptionRow {
  return {
    id,
    user_id: userId,
    name: body.name,
    logo: body.logo ?? null,
    price: body.price,
    currency: body.currency,
    billing_cycle: body.billingCycle,
    // 非 custom 周期必须把 custom_days 清空，否则后续编辑会把旧自定义天数“复活”。
    custom_days: body.billingCycle === "custom" ? body.customDays ?? 1 : null,
    category: body.category,
    status: body.status,
    payment_method: body.paymentMethod ?? null,
    start_date: body.startDate,
    next_billing_date: body.nextBillingDate,
    // Worker 没有 PocketBase hook；one-time 的跨运行面约束必须在 D1 写入边界兜底。
    auto_calculate_next_billing_date: boolToInt(body.billingCycle === "one-time" ? false : body.autoCalculateNextBillingDate),
    trial_end_date: body.trialEndDate ?? null,
    website: body.website ?? null,
    notes: body.notes ?? null,
    tags_json: JSON.stringify(body.tags ?? []),
    reminder_days: body.reminderDays,
    repeat_reminder_enabled: boolToInt(body.repeatReminderEnabled),
    repeat_reminder_interval: body.repeatReminderInterval,
    repeat_reminder_window: body.repeatReminderWindow,
    // extra 不走 UI 展示；它给 seed/import 留稳定幂等键，编辑订阅时必须随原记录保留。
    extra_json: JSON.stringify(body.extra ?? {}),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function subscriptionRowValues(row: SubscriptionRow): unknown[] {
  return [
    row.id, row.user_id, row.name, row.logo, row.price, row.currency, row.billing_cycle, row.custom_days,
    row.category, row.status, row.payment_method, row.start_date, row.next_billing_date,
    row.auto_calculate_next_billing_date, row.trial_end_date, row.website, row.notes, row.tags_json,
    row.reminder_days, row.repeat_reminder_enabled, row.repeat_reminder_interval, row.repeat_reminder_window,
    row.extra_json, row.created_at, row.updated_at,
  ];
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}
