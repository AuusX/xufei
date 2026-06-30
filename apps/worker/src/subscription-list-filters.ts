import {
  SUBSCRIPTION_PAYMENT_METHOD_NONE,
  type SubscriptionsListQuery,
} from "@renewlet/shared/schemas/subscriptions";
import { DISABLED_REMINDER_DAYS, INHERIT_REMINDER_DAYS } from "@renewlet/shared/runtime";
import {
  SUBSCRIPTION_COLUMNS,
  countSubscriptions,
  listSubscriptionsPage,
  parseStringArray,
  parseSubscriptionCursor,
} from "./db";
import type { Env, SubscriptionRow } from "./types";

const subscriptionListScanPageSize = 500;

export async function listSubscriptionsForQuery(
  env: Env,
  userId: string,
  query: SubscriptionsListQuery,
  today: string,
): Promise<{ rows: SubscriptionRow[]; total: number }> {
  if (!subscriptionListQueryHasFilters(query)) {
    return {
      rows: await listSubscriptionsPage(env, userId, { limit: query.limit + 1, cursor: query.cursor }),
      total: await countSubscriptions(env, userId),
    };
  }
  // filtered total 是当前条件的全库匹配量，不能套 cursor；cursor 只影响本页起点。
  const total = await countFilteredSubscriptions(env, userId, query, today);
  const rows = await collectFilteredSubscriptionsPage(env, userId, query, today);
  return { rows, total };
}

async function countFilteredSubscriptions(env: Env, userId: string, query: SubscriptionsListQuery, today: string): Promise<number> {
  const base = subscriptionListBaseQuery(userId, query, undefined);
  let total = 0;
  for (let offset = 0;; offset += subscriptionListScanPageSize) {
    const rows = await runSubscriptionFilterScan(env, base, subscriptionListScanPageSize, offset);
    for (const row of rows) {
      if (subscriptionRowMatchesPostFilters(row, query, today)) total++;
    }
    if (rows.length < subscriptionListScanPageSize) return total;
  }
}

async function collectFilteredSubscriptionsPage(env: Env, userId: string, query: SubscriptionsListQuery, today: string): Promise<SubscriptionRow[]> {
  const cursor = parseSubscriptionCursor(query.cursor);
  const base = subscriptionListBaseQuery(userId, query, cursor ?? undefined);
  const rows: SubscriptionRow[] = [];
  for (let offset = 0; rows.length <= query.limit; offset += subscriptionListScanPageSize) {
    const candidates = await runSubscriptionFilterScan(env, base, subscriptionListScanPageSize, offset);
    for (const row of candidates) {
      if (!subscriptionRowMatchesPostFilters(row, query, today)) continue;
      rows.push(row);
      if (rows.length > query.limit) return rows;
    }
    if (candidates.length < subscriptionListScanPageSize) return rows;
  }
  return rows;
}

async function runSubscriptionFilterScan(
  env: Env,
  base: { where: string; params: unknown[] },
  limit: number,
  offset: number,
): Promise<SubscriptionRow[]> {
  const result = await env.DB.prepare(`
    SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions
    WHERE ${base.where}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).bind(...base.params, limit, offset).all<SubscriptionRow>();
  return result.results;
}

function subscriptionListBaseQuery(
  userId: string,
  query: SubscriptionsListQuery,
  cursor: { createdAt: string; id: string } | undefined,
): { where: string; params: unknown[] } {
  // SQL 下推只处理稳定标量；JSON tags、模糊搜索和有效过期状态在 owner scoped 候选集里做可移植后处理。
  const conditions = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (cursor) {
    conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  appendSqlInCondition(conditions, params, "category", query.category);
  appendSqlInCondition(conditions, params, "billing_cycle", query.billingCycle);
  appendSqlInCondition(conditions, params, "currency", query.currency);
  appendPaymentMethodCondition(conditions, params, query.paymentMethod);
  appendRenewalCondition(conditions, query.renewal);
  if (query.nextBillingFrom) {
    conditions.push("next_billing_date >= ?");
    params.push(query.nextBillingFrom);
  }
  if (query.nextBillingTo) {
    conditions.push("next_billing_date <= ?");
    params.push(query.nextBillingTo);
  }
  if (query.pinned !== undefined) {
    conditions.push("pinned = ?");
    params.push(query.pinned ? 1 : 0);
  }
  if (query.publicHidden !== undefined) {
    conditions.push("public_hidden = ?");
    params.push(query.publicHidden ? 1 : 0);
  }
  appendReminderModeCondition(conditions, params, query.reminderMode);
  if (query.repeatReminder !== undefined) {
    conditions.push("repeat_reminder_enabled = ?");
    params.push(query.repeatReminder ? 1 : 0);
  }
  return { where: conditions.join(" AND "), params };
}

function appendSqlInCondition(conditions: string[], params: unknown[], column: string, values: readonly string[] | undefined): void {
  if (!values?.length) return;
  conditions.push(`${column} IN (${values.map(() => "?").join(", ")})`);
  params.push(...values);
}

function appendPaymentMethodCondition(conditions: string[], params: unknown[], values: readonly string[] | undefined): void {
  if (!values?.length) return;
  const concrete = values.filter((value) => value !== SUBSCRIPTION_PAYMENT_METHOD_NONE);
  const parts: string[] = [];
  if (values.includes(SUBSCRIPTION_PAYMENT_METHOD_NONE)) parts.push("(payment_method IS NULL OR payment_method = '')");
  if (concrete.length > 0) {
    parts.push(`payment_method IN (${concrete.map(() => "?").join(", ")})`);
    params.push(...concrete);
  }
  conditions.push(`(${parts.join(" OR ")})`);
}

function appendRenewalCondition(conditions: string[], renewal: SubscriptionsListQuery["renewal"]): void {
  switch (renewal) {
    case "auto":
      conditions.push("billing_cycle != 'one-time' AND auto_renew = 1");
      break;
    case "manual":
      conditions.push("billing_cycle != 'one-time' AND auto_renew = 0");
      break;
    case "one-time":
      conditions.push("billing_cycle = 'one-time'");
      break;
  }
}

function appendReminderModeCondition(
  conditions: string[],
  params: unknown[],
  mode: SubscriptionsListQuery["reminderMode"],
): void {
  switch (mode) {
    case "disabled":
      conditions.push("reminder_days = ?");
      params.push(DISABLED_REMINDER_DAYS);
      break;
    case "inherit":
      conditions.push("reminder_days = ?");
      params.push(INHERIT_REMINDER_DAYS);
      break;
    case "custom":
      conditions.push("reminder_days >= 0");
      break;
  }
}

function subscriptionRowMatchesPostFilters(row: SubscriptionRow, query: SubscriptionsListQuery, today: string): boolean {
  if (query.status && effectiveSubscriptionRowStatus(row, today) !== query.status) return false;
  const tags = parseStringArray(row.tags_json);
  if (query.tag?.length && !query.tag.some((tag) => tags.includes(tag))) return false;
  if (query.q && !subscriptionSearchMatches(row, tags, query.q)) return false;
  return true;
}

function effectiveSubscriptionRowStatus(row: SubscriptionRow, today: string): string {
  if (row.status === "expired") return "expired";
  if (row.billing_cycle === "one-time" && (row.one_time_term_count ?? 0) <= 0) return row.status;
  if ((row.status === "active" || row.status === "trial") && row.next_billing_date < today) return "expired";
  return row.status;
}

function subscriptionSearchMatches(row: SubscriptionRow, tags: readonly string[], search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  for (const value of [row.name, row.website ?? "", row.notes ?? "", ...tags]) {
    if (value.toLowerCase().includes(query)) return true;
  }
  return false;
}

function subscriptionListQueryHasFilters(query: SubscriptionsListQuery): boolean {
  return Boolean(
    query.q ||
    query.category?.length ||
    query.tag?.length ||
    query.billingCycle?.length ||
    query.paymentMethod?.length ||
    query.currency?.length ||
    query.status ||
    query.renewal ||
    query.nextBillingFrom ||
    query.nextBillingTo ||
    query.pinned !== undefined ||
    query.publicHidden !== undefined ||
    query.reminderMode ||
    query.repeatReminder !== undefined,
  );
}
