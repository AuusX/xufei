/**
 * 拼车 overlay 存储层。
 *
 * 架构位置：拼车与「家庭共享」共用订阅上的 `cost_sharing_json`（成员 + 付款金额）作为唯一数据源，
 * 因此写成员/金额即与家庭共享双向同步。拼车独有的「上车时间 / 按成员到期时间」不属于 cost-sharing
 * 模型，单独存在这张自定义表里，按 (user, subscription, member) 叠加。
 *
 * 该表用运行时 `CREATE TABLE IF NOT EXISTS` 懒建，不占用上游 D1 迁移编号、不依赖
 * `wrangler d1 migrations apply` 流水线，天然规避与上游迁移撞号导致的同步冲突。
 */
import {
  calculateCostSharingMemberAmount,
  type CostSharing,
  type CostSharingMember,
  type CostSharingSplitMode,
} from "@renewlet/shared/cost-sharing";
import type { Env } from "../../types";

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS carpool_member_meta (
  user_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  join_date TEXT,
  expiry_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, subscription_id, member_id)
)`;

let schemaReady: Promise<void> | null = null;

/** 懒建 overlay 表；失败时清空缓存以便下次请求重试。CREATE TABLE IF NOT EXISTS 幂等，可安全跨请求缓存。 */
export function ensureCarpoolSchema(env: Env): Promise<void> {
  if (!schemaReady) {
    schemaReady = env.DB.prepare(CREATE_TABLE_SQL)
      .run()
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  return schemaReady;
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

/** 提供给前端的订阅视图：一条「可拼车」的订阅及其成员。 */
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

interface ActiveSubscriptionRow {
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

/** 列出用户所有 `active`（正在续费）订阅，合并 cost-sharing 成员与 overlay 字段。 */
export async function listCarpoolSubscriptions(env: Env, userId: string): Promise<CarpoolSubscriptionView[]> {
  await ensureCarpoolSchema(env);

  const [subs, overlays] = await Promise.all([
    env.DB.prepare(
      `SELECT id, name, logo, price, currency, status, next_billing_date, cost_sharing_json
       FROM subscriptions
       WHERE user_id = ? AND status = 'active'
       ORDER BY next_billing_date ASC`,
    )
      .bind(userId)
      .all<ActiveSubscriptionRow>(),
    env.DB.prepare(
      `SELECT subscription_id, member_id, join_date, expiry_date
       FROM carpool_member_meta
       WHERE user_id = ?`,
    )
      .bind(userId)
      .all<OverlayRow>(),
  ]);

  const overlayByKey = new Map<string, CarpoolMemberMeta>();
  for (const row of overlays.results ?? []) {
    overlayByKey.set(overlayKey(row.subscription_id, row.member_id), {
      joinDate: row.join_date ?? null,
      expiryDate: row.expiry_date ?? null,
    });
  }

  return (subs.results ?? []).map((row) => {
    const costSharing = parseCostSharing(row.cost_sharing_json);
    let memberTotal = 0;
    const members: CarpoolMemberView[] = costSharing.members.map((member) => {
      const amount = calculateCostSharingMemberAmount(costSharing, member, row.price);
      memberTotal += amount;
      const meta = overlayByKey.get(overlayKey(row.id, member.id));
      return {
        ...member,
        amount,
        joinDate: meta?.joinDate ?? null,
        expiryDate: meta?.expiryDate ?? null,
      };
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
      yourShare: Math.max(Math.round((row.price - memberTotal + Number.EPSILON) * 100) / 100, 0),
    };
  });
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
