/**
 * 拼车 overlay + 计划 + 车辆信息存储层。
 *
 * 架构位置：
 * - 成员的「姓名 / 付款金额」写进订阅的 `cost_sharing_json`（与「家庭共享」共用，自动同步）。
 * - 成员的拼车独有字段（上车/到期时间、状态、扣费周期、自动计算到期、到期提醒、微信、邮箱）存
 *   `carpool_member_meta`。
 * - 车辆（订阅）的拼车独有信息（gpt账号）存 `carpool_subscription_meta`。
 * - 「拼车计划」把多个订阅归组：`carpool_plan` + `carpool_plan_subscription`。每个订阅=一辆车。
 *
 * 所有自定义表都用运行时 `CREATE TABLE IF NOT EXISTS` 懒建；旧版 `carpool_member_meta` 缺列时用
 * PRAGMA + ALTER 幂等补列，不占用上游 D1 迁移编号。
 */
import {
  calculateCostSharingMemberAmount,
  type CostSharing,
  type CostSharingMember,
  type CostSharingSplitMode,
} from "@renewlet/shared/cost-sharing";
import { addBillingCycles } from "@renewlet/shared/subscription-renewal";
import type { Env } from "../../types";

export type CarpoolMemberStatus = "active" | "paused" | "expired";
export type CarpoolBillingCycle = "monthly" | "quarterly" | "yearly" | "custom";

const CREATE_TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS carpool_member_meta (
    user_id TEXT NOT NULL,
    subscription_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    join_date TEXT,
    expiry_date TEXT,
    status TEXT,
    billing_cycle TEXT,
    custom_days INTEGER,
    auto_calc_expiry INTEGER,
    reminder_days INTEGER,
    wechat TEXT,
    email TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, subscription_id, member_id)
  )`,
  `CREATE TABLE IF NOT EXISTS carpool_subscription_meta (
    user_id TEXT NOT NULL,
    subscription_id TEXT NOT NULL,
    account TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, subscription_id)
  )`,
  `CREATE TABLE IF NOT EXISTS carpool_plan (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS carpool_plan_subscription (
    user_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    subscription_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (plan_id, subscription_id)
  )`,
];

// 旧版 carpool_member_meta 只有 join_date/expiry_date；这些列在已存在的表上用 ALTER 幂等补齐。
const MEMBER_META_ADDED_COLUMNS: Array<[name: string, def: string]> = [
  ["status", "TEXT"],
  ["billing_cycle", "TEXT"],
  ["custom_days", "INTEGER"],
  ["auto_calc_expiry", "INTEGER"],
  ["reminder_days", "INTEGER"],
  ["wechat", "TEXT"],
  ["email", "TEXT"],
];

let schemaReady: Promise<void> | null = null;

/** 懒建自定义表并补齐旧表缺列；失败时清空缓存以便下次请求重试。 */
export function ensureCarpoolSchema(env: Env): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await env.DB.batch(CREATE_TABLE_STATEMENTS.map((sql) => env.DB.prepare(sql)));
      const info = await env.DB.prepare(`PRAGMA table_info(carpool_member_meta)`).all<{ name: string }>();
      const existing = new Set((info.results ?? []).map((row) => row.name));
      for (const [name, def] of MEMBER_META_ADDED_COLUMNS) {
        if (!existing.has(name)) {
          await env.DB.prepare(`ALTER TABLE carpool_member_meta ADD COLUMN ${name} ${def}`).run();
        }
      }
    })()
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  return schemaReady;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toMemberStatus(value: string | null | undefined): CarpoolMemberStatus {
  return value === "paused" || value === "expired" ? value : "active";
}

function toBillingCycle(value: string | null | undefined): CarpoolBillingCycle {
  return value === "quarterly" || value === "yearly" || value === "custom" ? value : "monthly";
}

/** 上车时间 + 扣费周期算出到期日（YYYY-MM-DD）。 */
function addCycle(dateStr: string, cycle: CarpoolBillingCycle, customDays: number | null): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  try {
    return addBillingCycles(
      dateStr,
      cycle === "yearly" ? "annual" : cycle,
      1,
      cycle === "custom" ? customDays : undefined,
    );
  } catch {
    return null;
  }
}

/** 成员的拼车独有元数据（overlay）。 */
export interface CarpoolMemberMeta {
  joinDate: string | null;
  expiryDate: string | null;
  status: CarpoolMemberStatus;
  billingCycle: CarpoolBillingCycle;
  customDays: number | null;
  autoCalcExpiry: boolean;
  reminderDays: number;
  wechat: string | null;
  email: string | null;
}

/** 提供给前端的成员视图：cost-sharing 成员 + 计算金额 + overlay 字段 + 计算出的到期日。 */
export interface CarpoolMemberView extends CostSharingMember, CarpoolMemberMeta {
  amount: number;
  /** 实际到期日：开启自动计算时由上车时间+周期得出，否则用手填的到期时间。 */
  effectiveExpiry: string | null;
}

/** 提供给前端的订阅视图：一条「可拼车」的订阅（一辆车）及其成员。 */
export interface CarpoolSubscriptionView {
  id: string;
  name: string;
  logo: string | null;
  price: number;
  currency: string;
  status: string;
  nextBillingDate: string;
  /** 车辆信息：gpt账号（拼车独有）。 */
  account: string | null;
  enabled: boolean;
  splitMode: CostSharingSplitMode;
  members: CarpoolMemberView[];
  /** 你自己承担的份额（= 订阅总价 − 各成员应收合计，下限 0）。 */
  yourShare: number;
}

/** 计划级统计。 */
export interface CarpoolPlanStats {
  totalCars: number;
  activeCars: number;
  emptyCars: number;
  receivableTotal: number;
}

export interface CarpoolPlanSummary {
  id: string;
  name: string;
  stats: CarpoolPlanStats;
}

export interface CarpoolPlanDetail extends CarpoolPlanSummary {
  subscriptions: CarpoolSubscriptionView[];
}

interface SubscriptionRow {
  id: string;
  name: string;
  logo: string | null;
  price: number;
  currency: string;
  status: string;
  next_billing_date: string;
  cost_sharing_json: string | null;
}

interface OverlayRow {
  subscription_id: string;
  member_id: string;
  join_date: string | null;
  expiry_date: string | null;
  status: string | null;
  billing_cycle: string | null;
  custom_days: number | null;
  auto_calc_expiry: number | null;
  reminder_days: number | null;
  wechat: string | null;
  email: string | null;
}

function overlayKey(subscriptionId: string, memberId: string): string {
  return `${subscriptionId} ${memberId}`;
}

function defaultMeta(): CarpoolMemberMeta {
  return {
    joinDate: null,
    expiryDate: null,
    status: "active",
    billingCycle: "monthly",
    customDays: null,
    autoCalcExpiry: false,
    reminderDays: -1,
    wechat: null,
    email: null,
  };
}

/** 把 D1 里的 cost_sharing_json 收敛成安全的 CostSharing；空对象 / 脏数据视为未开启。 */
function parseCostSharing(raw: string | null): CostSharing {
  const fallback: CostSharing = { enabled: false, splitMode: "equal", members: [] };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<CostSharing> | null;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.members)) return fallback;
    return {
      enabled: Boolean(parsed.enabled),
      splitMode: parsed.splitMode === "custom" ? "custom" : "equal",
      members: parsed.members
        .filter((member): member is CostSharingMember => Boolean(member) && typeof member === "object" && typeof (member as CostSharingMember).id === "string")
        .map((member) => ({
          id: member.id,
          name: typeof member.name === "string" ? member.name : "",
          note: typeof member.note === "string" ? member.note : undefined,
          currency: typeof member.currency === "string" ? member.currency : undefined,
          customAmount: typeof member.customAmount === "number" ? member.customAmount : undefined,
        })),
    };
  } catch {
    return fallback;
  }
}

async function fetchOverlayMap(env: Env, userId: string): Promise<Map<string, CarpoolMemberMeta>> {
  const overlays = await env.DB.prepare(
    `SELECT subscription_id, member_id, join_date, expiry_date, status, billing_cycle, custom_days, auto_calc_expiry, reminder_days, wechat, email
     FROM carpool_member_meta WHERE user_id = ?`,
  )
    .bind(userId)
    .all<OverlayRow>();
  const map = new Map<string, CarpoolMemberMeta>();
  for (const row of overlays.results ?? []) {
    map.set(overlayKey(row.subscription_id, row.member_id), {
      joinDate: row.join_date ?? null,
      expiryDate: row.expiry_date ?? null,
      status: toMemberStatus(row.status),
      billingCycle: toBillingCycle(row.billing_cycle),
      customDays: row.custom_days ?? null,
      autoCalcExpiry: row.auto_calc_expiry === 1,
      reminderDays: typeof row.reminder_days === "number" ? row.reminder_days : -1,
      wechat: row.wechat ?? null,
      email: row.email ?? null,
    });
  }
  return map;
}

async function fetchAccountMap(env: Env, userId: string): Promise<Map<string, string>> {
  const rows = await env.DB.prepare(`SELECT subscription_id, account FROM carpool_subscription_meta WHERE user_id = ?`)
    .bind(userId)
    .all<{ subscription_id: string; account: string | null }>();
  const map = new Map<string, string>();
  for (const row of rows.results ?? []) {
    if (row.account) map.set(row.subscription_id, row.account);
  }
  return map;
}

function buildSubscriptionView(
  row: SubscriptionRow,
  overlayMap: Map<string, CarpoolMemberMeta>,
  accountMap: Map<string, string>,
): CarpoolSubscriptionView {
  const costSharing = parseCostSharing(row.cost_sharing_json);
  let memberTotal = 0;
  const members: CarpoolMemberView[] = costSharing.members.map((member) => {
    const amount = calculateCostSharingMemberAmount(costSharing, member, row.price);
    memberTotal += amount;
    const meta = overlayMap.get(overlayKey(row.id, member.id)) ?? defaultMeta();
    const effectiveExpiry = meta.autoCalcExpiry && meta.joinDate
      ? addCycle(meta.joinDate, meta.billingCycle, meta.customDays)
      : meta.expiryDate;
    return { ...member, ...meta, amount, effectiveExpiry };
  });
  return {
    id: row.id,
    name: row.name,
    logo: row.logo,
    price: row.price,
    currency: row.currency,
    status: row.status,
    nextBillingDate: row.next_billing_date,
    account: accountMap.get(row.id) ?? null,
    enabled: costSharing.enabled,
    splitMode: costSharing.splitMode,
    members,
    yourShare: Math.max(roundMoney(row.price - memberTotal), 0),
  };
}

function computeStats(subscriptions: CarpoolSubscriptionView[]): CarpoolPlanStats {
  let activeCars = 0;
  let receivableTotal = 0;
  for (const sub of subscriptions) {
    if (sub.enabled && sub.members.length > 0) activeCars += 1;
    for (const member of sub.members) receivableTotal += member.amount;
  }
  return {
    totalCars: subscriptions.length,
    activeCars,
    emptyCars: subscriptions.length - activeCars,
    receivableTotal: roundMoney(receivableTotal),
  };
}

const SUBSCRIPTION_COLUMNS = "id, name, logo, price, currency, status, next_billing_date, cost_sharing_json";

/** 列出用户所有 `active`（正在续费）订阅，用于把订阅加入计划的选择器。 */
export async function listActiveSubscriptions(env: Env, userId: string): Promise<CarpoolSubscriptionView[]> {
  await ensureCarpoolSchema(env);
  const [subs, overlayMap, accountMap] = await Promise.all([
    env.DB.prepare(
      `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY next_billing_date ASC`,
    )
      .bind(userId)
      .all<SubscriptionRow>(),
    fetchOverlayMap(env, userId),
    fetchAccountMap(env, userId),
  ]);
  return (subs.results ?? []).map((row) => buildSubscriptionView(row, overlayMap, accountMap));
}

/** 列出用户的所有拼车计划及其统计。 */
export async function listCarpoolPlans(env: Env, userId: string): Promise<CarpoolPlanSummary[]> {
  await ensureCarpoolSchema(env);
  const [plans, rows, overlayMap, accountMap] = await Promise.all([
    env.DB.prepare(`SELECT id, name FROM carpool_plan WHERE user_id = ? ORDER BY created_at ASC`)
      .bind(userId)
      .all<{ id: string; name: string }>(),
    env.DB.prepare(
      `SELECT ps.plan_id AS plan_id, ${SUBSCRIPTION_COLUMNS}
       FROM carpool_plan_subscription ps
       JOIN subscriptions s ON s.id = ps.subscription_id AND s.user_id = ps.user_id
       WHERE ps.user_id = ?`,
    )
      .bind(userId)
      .all<SubscriptionRow & { plan_id: string }>(),
    fetchOverlayMap(env, userId),
    fetchAccountMap(env, userId),
  ]);

  const viewsByPlan = new Map<string, CarpoolSubscriptionView[]>();
  for (const row of rows.results ?? []) {
    const list = viewsByPlan.get(row.plan_id) ?? [];
    list.push(buildSubscriptionView(row, overlayMap, accountMap));
    viewsByPlan.set(row.plan_id, list);
  }

  return (plans.results ?? []).map((plan) => ({
    id: plan.id,
    name: plan.name,
    stats: computeStats(viewsByPlan.get(plan.id) ?? []),
  }));
}

/** 读取一个计划的详情（含订阅视图与统计）；不存在或不属于该用户返回 null。 */
export async function getCarpoolPlanDetail(env: Env, userId: string, planId: string): Promise<CarpoolPlanDetail | null> {
  await ensureCarpoolSchema(env);
  const plan = await env.DB.prepare(`SELECT id, name FROM carpool_plan WHERE user_id = ? AND id = ? LIMIT 1`)
    .bind(userId, planId)
    .first<{ id: string; name: string }>();
  if (!plan) return null;

  const [subs, overlayMap, accountMap] = await Promise.all([
    env.DB.prepare(
      `SELECT ${SUBSCRIPTION_COLUMNS}
       FROM carpool_plan_subscription ps
       JOIN subscriptions s ON s.id = ps.subscription_id AND s.user_id = ps.user_id
       WHERE ps.user_id = ? AND ps.plan_id = ?
       ORDER BY s.next_billing_date ASC`,
    )
      .bind(userId, planId)
      .all<SubscriptionRow>(),
    fetchOverlayMap(env, userId),
    fetchAccountMap(env, userId),
  ]);

  const subscriptions = (subs.results ?? []).map((row) => buildSubscriptionView(row, overlayMap, accountMap));
  return { id: plan.id, name: plan.name, stats: computeStats(subscriptions), subscriptions };
}

/** 创建拼车计划。 */
export async function createCarpoolPlan(env: Env, userId: string, name: string): Promise<CarpoolPlanSummary> {
  await ensureCarpoolSchema(env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO carpool_plan (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, userId, name.trim(), now, now)
    .run();
  return { id, name: name.trim(), stats: { totalCars: 0, activeCars: 0, emptyCars: 0, receivableTotal: 0 } };
}

/** 重命名计划；返回是否命中。 */
export async function renameCarpoolPlan(env: Env, userId: string, planId: string, name: string): Promise<boolean> {
  await ensureCarpoolSchema(env);
  const result = await env.DB.prepare(`UPDATE carpool_plan SET name = ?, updated_at = ? WHERE user_id = ? AND id = ?`)
    .bind(name.trim(), new Date().toISOString(), userId, planId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** 删除计划（连带解除其订阅映射；订阅与 cost-sharing 数据不动）。返回是否命中。 */
export async function deleteCarpoolPlan(env: Env, userId: string, planId: string): Promise<boolean> {
  await ensureCarpoolSchema(env);
  const result = await env.DB.batch([
    env.DB.prepare(`DELETE FROM carpool_plan_subscription WHERE user_id = ? AND plan_id = ?`).bind(userId, planId),
    env.DB.prepare(`DELETE FROM carpool_plan WHERE user_id = ? AND id = ?`).bind(userId, planId),
  ]);
  return (result[1]?.meta?.changes ?? 0) > 0;
}

/** 把一个订阅加入计划；校验计划与订阅都属于该用户。 */
export async function addSubscriptionToPlan(
  env: Env,
  userId: string,
  planId: string,
  subscriptionId: string,
): Promise<{ ok: boolean; reason?: "plan_not_found" | "subscription_not_found" }> {
  await ensureCarpoolSchema(env);
  const [plan, subscription] = await Promise.all([
    env.DB.prepare(`SELECT id FROM carpool_plan WHERE user_id = ? AND id = ? LIMIT 1`).bind(userId, planId).first<{ id: string }>(),
    env.DB.prepare(`SELECT id FROM subscriptions WHERE user_id = ? AND id = ? LIMIT 1`).bind(userId, subscriptionId).first<{ id: string }>(),
  ]);
  if (!plan) return { ok: false, reason: "plan_not_found" };
  if (!subscription) return { ok: false, reason: "subscription_not_found" };
  await env.DB.prepare(
    `INSERT OR IGNORE INTO carpool_plan_subscription (user_id, plan_id, subscription_id, created_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(userId, planId, subscriptionId, new Date().toISOString())
    .run();
  return { ok: true };
}

/** 从计划移除一个订阅（订阅与 cost-sharing 不动）。返回是否命中。 */
export async function removeSubscriptionFromPlan(
  env: Env,
  userId: string,
  planId: string,
  subscriptionId: string,
): Promise<boolean> {
  await ensureCarpoolSchema(env);
  const result = await env.DB.prepare(
    `DELETE FROM carpool_plan_subscription WHERE user_id = ? AND plan_id = ? AND subscription_id = ?`,
  )
    .bind(userId, planId, subscriptionId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** PUT 入参里的单个成员（cost-sharing 字段 + overlay 字段随行）。 */
export interface CarpoolMemberInput {
  id?: string | undefined;
  name: string;
  note?: string | undefined;
  customAmount?: number | undefined;
  joinDate?: string | undefined;
  expiryDate?: string | undefined;
  status?: CarpoolMemberStatus | undefined;
  billingCycle?: CarpoolBillingCycle | undefined;
  customDays?: number | undefined;
  autoCalcExpiry?: boolean | undefined;
  reminderDays?: number | undefined;
  wechat?: string | undefined;
  email?: string | undefined;
}

function normalizeText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * 覆盖式保存一条订阅的车辆信息与拼车成员。
 *
 * 写入三处：cost_sharing_json（与家庭共享共享，成员/金额/开关/分摊模式）、carpool_subscription_meta
 * （车辆 gpt账号）、carpool_member_meta（每成员的上车/到期/状态/周期/提醒/微信/邮箱）。
 * 全部按 user_id 隔离，并核对订阅归属。返回是否命中订阅。
 */
export async function saveCarpoolMembers(
  env: Env,
  userId: string,
  subscriptionId: string,
  input: { enabled: boolean; splitMode: CostSharingSplitMode; account?: string | undefined; members: CarpoolMemberInput[] },
): Promise<boolean> {
  await ensureCarpoolSchema(env);

  const existing = await env.DB.prepare(
    `SELECT cost_sharing_json FROM subscriptions WHERE user_id = ? AND id = ? LIMIT 1`,
  )
    .bind(userId, subscriptionId)
    .first<{ cost_sharing_json: string | null }>();
  if (!existing) return false;

  // 保留家庭共享侧可能设置、但拼车 UI 不管理的成员字段（如 currency）。
  const previous = parseCostSharing(existing.cost_sharing_json);
  const previousById = new Map(previous.members.map((member) => [member.id, member]));

  const now = new Date().toISOString();
  const members = input.members.map((member) => {
    const id = member.id && previousById.has(member.id) ? member.id : crypto.randomUUID();
    const prior = member.id ? previousById.get(member.id) : undefined;
    const costMember: CostSharingMember = {
      id,
      name: member.name.trim(),
      ...(member.note?.trim() ? { note: member.note.trim() } : {}),
      ...(prior?.currency ? { currency: prior.currency } : {}),
      ...(input.splitMode === "custom" && typeof member.customAmount === "number"
        ? { customAmount: member.customAmount }
        : {}),
    };
    return { costMember, input: member };
  });

  const hasMembers = members.length > 0;
  const enabled = input.enabled && hasMembers;
  // 与上游约定一致：空对象表示未开启分摊。
  const costSharingJson = enabled
    ? JSON.stringify({ enabled: true, splitMode: input.splitMode, members: members.map((m) => m.costMember) } satisfies CostSharing)
    : "{}";

  const statements = [
    env.DB.prepare(`UPDATE subscriptions SET cost_sharing_json = ?, updated_at = ? WHERE user_id = ? AND id = ?`).bind(
      costSharingJson,
      now,
      userId,
      subscriptionId,
    ),
    env.DB.prepare(
      `INSERT OR REPLACE INTO carpool_subscription_meta (user_id, subscription_id, account, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).bind(userId, subscriptionId, normalizeText(input.account), now, now),
    // overlay 全量重建：先清空该订阅旧行，再写入当前成员。
    env.DB.prepare(`DELETE FROM carpool_member_meta WHERE user_id = ? AND subscription_id = ?`).bind(userId, subscriptionId),
    ...members.map(({ costMember, input: m }) =>
      env.DB.prepare(
        `INSERT INTO carpool_member_meta
           (user_id, subscription_id, member_id, join_date, expiry_date, status, billing_cycle, custom_days, auto_calc_expiry, reminder_days, wechat, email, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        userId,
        subscriptionId,
        costMember.id,
        normalizeText(m.joinDate),
        normalizeText(m.expiryDate),
        toMemberStatus(m.status),
        toBillingCycle(m.billingCycle),
        m.billingCycle === "custom" && typeof m.customDays === "number" ? m.customDays : null,
        m.autoCalcExpiry ? 1 : 0,
        typeof m.reminderDays === "number" ? m.reminderDays : -1,
        normalizeText(m.wechat),
        normalizeText(m.email),
        now,
        now,
      ),
    ),
  ];

  await env.DB.batch(statements);
  return true;
}
