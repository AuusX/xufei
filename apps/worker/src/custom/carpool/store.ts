/**
 * 拼车 overlay + 计划存储层。
 *
 * 架构位置：
 * - 拼车与「家庭共享」共用订阅上的 `cost_sharing_json`（成员 + 付款金额）作为唯一数据源，
 *   写成员/金额即与家庭共享双向同步。
 * - 拼车独有的「上车时间 / 按成员到期时间」存 `carpool_member_meta`（按 user, subscription, member）。
 * - 「拼车计划」把多个订阅归组：`carpool_plan`（计划）+ `carpool_plan_subscription`（计划↔订阅）。
 *   每个订阅 = 一辆车；统计 = 总车数 / 进行中(有成员) / 空车 / 成员应收合计。
 *
 * 三张自定义表都用运行时 `CREATE TABLE IF NOT EXISTS` 懒建，不占用上游 D1 迁移编号。
 */
import {
  calculateCostSharingMemberAmount,
  type CostSharing,
  type CostSharingMember,
  type CostSharingSplitMode,
} from "@renewlet/shared/cost-sharing";
import type { Env } from "../../types";

const CREATE_TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS carpool_member_meta (
    user_id TEXT NOT NULL,
    subscription_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    join_date TEXT,
    expiry_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, subscription_id, member_id)
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

let schemaReady: Promise<void> | null = null;

/** 懒建自定义表；失败时清空缓存以便下次请求重试。CREATE TABLE IF NOT EXISTS 幂等，可安全跨请求缓存。 */
export function ensureCarpoolSchema(env: Env): Promise<void> {
  if (!schemaReady) {
    schemaReady = env.DB.batch(CREATE_TABLE_STATEMENTS.map((sql) => env.DB.prepare(sql)))
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

/** overlay 行：拼车独有的按成员字段。 */
export interface CarpoolMemberMeta {
  joinDate: string | null;
  expiryDate: string | null;
}

/** 提供给前端的成员视图：cost-sharing 成员 + 计算金额 + overlay 字段。 */
export interface CarpoolMemberView extends CostSharingMember {
  amount: number;
  joinDate: string | null;
  expiryDate: string | null;
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
  enabled: boolean;
  splitMode: CostSharingSplitMode;
  members: CarpoolMemberView[];
  /** 你自己承担的份额（= 订阅总价 − 各成员应收合计，下限 0）。 */
  yourShare: number;
}

/** 计划级统计。 */
export interface CarpoolPlanStats {
  /** 总车数 = 计划内订阅数。 */
  totalCars: number;
  /** 进行中的拼车 = 有成员的订阅数。 */
  activeCars: number;
  /** 空车 = 没成员的订阅数。 */
  emptyCars: number;
  /** 成员应收合计（各订阅币种未折算）。 */
  receivableTotal: number;
}

/** 计划摘要（列表页用）。 */
export interface CarpoolPlanSummary {
  id: string;
  name: string;
  stats: CarpoolPlanStats;
}

/** 计划详情（含订阅视图，详情页用）。 */
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
}

function overlayKey(subscriptionId: string, memberId: string): string {
  return `${subscriptionId} ${memberId}`;
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
    `SELECT subscription_id, member_id, join_date, expiry_date FROM carpool_member_meta WHERE user_id = ?`,
  )
    .bind(userId)
    .all<OverlayRow>();
  const map = new Map<string, CarpoolMemberMeta>();
  for (const row of overlays.results ?? []) {
    map.set(overlayKey(row.subscription_id, row.member_id), {
      joinDate: row.join_date ?? null,
      expiryDate: row.expiry_date ?? null,
    });
  }
  return map;
}

/** 把订阅行 + overlay 合并成前端视图。 */
function buildSubscriptionView(row: SubscriptionRow, overlayMap: Map<string, CarpoolMemberMeta>): CarpoolSubscriptionView {
  const costSharing = parseCostSharing(row.cost_sharing_json);
  let memberTotal = 0;
  const members: CarpoolMemberView[] = costSharing.members.map((member) => {
    const amount = calculateCostSharingMemberAmount(costSharing, member, row.price);
    memberTotal += amount;
    const meta = overlayMap.get(overlayKey(row.id, member.id));
    return { ...member, amount, joinDate: meta?.joinDate ?? null, expiryDate: meta?.expiryDate ?? null };
  });
  return {
    id: row.id,
    name: row.name,
    logo: row.logo,
    price: row.price,
    currency: row.currency,
    status: row.status,
    nextBillingDate: row.next_billing_date,
    enabled: costSharing.enabled,
    splitMode: costSharing.splitMode,
    members,
    yourShare: Math.max(roundMoney(row.price - memberTotal), 0),
  };
}

/** 从订阅视图算计划统计。 */
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
  const [subs, overlayMap] = await Promise.all([
    env.DB.prepare(
      `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY next_billing_date ASC`,
    )
      .bind(userId)
      .all<SubscriptionRow>(),
    fetchOverlayMap(env, userId),
  ]);
  return (subs.results ?? []).map((row) => buildSubscriptionView(row, overlayMap));
}

/** 列出用户的所有拼车计划及其统计。 */
export async function listCarpoolPlans(env: Env, userId: string): Promise<CarpoolPlanSummary[]> {
  await ensureCarpoolSchema(env);
  const [plans, rows, overlayMap] = await Promise.all([
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
  ]);

  const viewsByPlan = new Map<string, CarpoolSubscriptionView[]>();
  for (const row of rows.results ?? []) {
    const list = viewsByPlan.get(row.plan_id) ?? [];
    list.push(buildSubscriptionView(row, overlayMap));
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

  const [subs, overlayMap] = await Promise.all([
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
  ]);

  const subscriptions = (subs.results ?? []).map((row) => buildSubscriptionView(row, overlayMap));
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

/** PUT 入参里的单个成员（overlay 字段随行）。 */
export interface CarpoolMemberInput {
  id?: string | undefined;
  name: string;
  note?: string | undefined;
  customAmount?: number | undefined;
  joinDate?: string | undefined;
  expiryDate?: string | undefined;
}

function normalizeDate(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * 覆盖式保存一条订阅的拼车成员。
 *
 * 同一次写入两处：cost_sharing_json（与家庭共享共享，成员/金额/开关/分摊模式）+ overlay 表
 * （上车/到期时间）。全部按 user_id 隔离，并核对订阅归属。返回是否命中订阅。
 */
export async function saveCarpoolMembers(
  env: Env,
  userId: string,
  subscriptionId: string,
  input: { enabled: boolean; splitMode: CostSharingSplitMode; members: CarpoolMemberInput[] },
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
    return {
      costMember,
      joinDate: normalizeDate(member.joinDate),
      expiryDate: normalizeDate(member.expiryDate),
    };
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
    // overlay 全量重建：先清空该订阅旧行，再写入当前成员，避免残留已删除成员的日期。
    env.DB.prepare(`DELETE FROM carpool_member_meta WHERE user_id = ? AND subscription_id = ?`).bind(userId, subscriptionId),
    ...members
      .filter((m) => m.joinDate !== null || m.expiryDate !== null)
      .map((m) =>
        env.DB.prepare(
          `INSERT INTO carpool_member_meta (user_id, subscription_id, member_id, join_date, expiry_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(userId, subscriptionId, m.costMember.id, m.joinDate, m.expiryDate, now, now),
      ),
  ];

  await env.DB.batch(statements);
  return true;
}
