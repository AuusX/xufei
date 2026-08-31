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
import { moneyFromNumber, moneyFromUnknown, moneyToNumber, type MoneyString } from "@renewlet/shared/money";
import type { BillingCycle, CustomCycleUnit } from "@renewlet/shared/runtime";
import { toSubscriptionMonthlyAmount } from "@renewlet/shared/subscription-billing";
import { addBillingCycles, calculateNextBillingDate } from "@renewlet/shared/subscription-renewal";
import type { Env } from "../../types";
import { costSharingContractError } from "./contract";
import { ensureCarpoolSchema } from "./schema";
import { todayForUser } from "./time";

export type CarpoolMemberStatus = "active" | "paused" | "expired";
export type CarpoolBillingCycle = "monthly" | "quarterly" | "yearly" | "custom";

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * 把成员「按其扣费周期支付的整期金额」折算成月均，与月均总价口径一致。
 * 例：车友季付 ¥240 → 每月 ¥80；年付 ¥1200 → 每月 ¥100。
 *
 * 直接复用应用自己的 `toSubscriptionMonthlyAmount`，避免拼车再维护一套「一个月算几天」的常量。
 */
function carpoolAmountToMonthly(amount: number, cycle: CarpoolBillingCycle, customDays: number | null): number {
  // 「自定义天数」但天数缺失的历史数据，上游的 requireCustomBillingCycle 会抛错；这里按整期=一个月兜底，
  // 免得一条脏 overlay 行让整个拼车页 500（新写入路径已强制要求填天数）。
  if (cycle === "custom" && (typeof customDays !== "number" || !Number.isInteger(customDays) || customDays <= 0)) {
    return amount;
  }
  return toSubscriptionMonthlyAmount(amount, {
    billingCycle: cycle === "yearly" ? "annual" : cycle,
    customDays: cycle === "custom" ? customDays : null,
    customCycleUnit: "day",
  });
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
      // 上游 requireCustomBillingCycle 现在要求显式单位，缺了会抛错（旧版默认按天）。
      "day",
    );
  } catch {
    return null;
  }
}

/** 把 YYYY-MM-DD 往后推一天；用作「必须晚于今天」的阈值。 */
function nextDay(dateStr: string): string {
  return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
}

/**
 * 续费后的新到期日：以成员**当前到期日**为锚点整期推进，直到晚于今天。
 *
 * 锚点必须是原到期日而不是「点击续费的当天」——否则每次给过期车友续费，到期日都会挪到点击那天的
 * 日子上（如上车 7/5、8/21 点续费就变成 9/21），看起来像算错了。过期多期时一次推进到最近的未来
 * 到期日；没有可用到期日时才退回以今天为锚点。
 */
export function nextRenewalExpiry(
  current: string | null,
  cycle: CarpoolBillingCycle,
  customDays: number | null,
  today: string,
): string {
  const anchor = current && /^\d{4}-\d{2}-\d{2}$/.test(current) ? current : today;
  try {
    return calculateNextBillingDate(
      anchor,
      cycle === "yearly" ? "annual" : cycle,
      cycle === "custom" ? customDays : undefined,
      nextDay(today),
      // 同上：自定义周期必须显式给单位，否则整期推进会抛错被 catch 吞掉，续费变成原地不动。
      "day",
    );
  } catch {
    return addCycle(anchor, cycle, customDays) ?? anchor;
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
  /** 成员实际支付的人民币金额（原始录入值）；cost_sharing 里的 customAmount 是换算成订阅货币后的值。 */
  amountCny: number | null;
}

/** 提供给前端的成员视图：cost-sharing 成员 + 计算金额 + overlay 字段 + 计算出的到期日。 */
export interface CarpoolMemberView extends Omit<CostSharingMember, "customAmount">, CarpoolMemberMeta {
  /** 成员自定义金额（订阅货币、整期原值）。上游内部存 MoneyString，拼车对外统一给数字。 */
  customAmount?: number | undefined;
  /** 成员的月均分摊金额（订阅货币）：自定义金额按成员扣费周期折算成月均，均摊份额按月均总价平分。 */
  amount: number;
  /** 成员实付人民币的月均值（= amountCny 按成员扣费周期折算）；用于「成员应收合计」等月度口径展示。amountCny 仍是整期原值，供编辑回填。 */
  monthlyAmountCny: number | null;
  /** 实际到期日：开启自动计算时由上车时间+周期得出，否则用手填的到期时间。 */
  effectiveExpiry: string | null;
  /** 这个月是否收得到他的钱（在车上且未过期）；暂停/已过期的不计入应收，也不抵扣「你承担」。 */
  collectible: boolean;
}

/** 提供给前端的订阅视图：一条「可拼车」的订阅（一辆车）及其成员。 */
export interface CarpoolSubscriptionView {
  id: string;
  name: string;
  logo: string | null;
  /** 月均价格：非月付订阅（年付/季付/固定服务期一次性等）按平均每月折算，而非整期总价。 */
  price: number;
  currency: string;
  status: string;
  nextBillingDate: string;
  /** 车辆信息：gpt账号（拼车独有）。 */
  account: string | null;
  /** 车辆信息：信用卡尾数（拼车独有）。 */
  cardLast4: string | null;
  enabled: boolean;
  splitMode: CostSharingSplitMode;
  members: CarpoolMemberView[];
  /** 你自己承担的月均份额（= 月均总价 − 各成员应收合计，下限 0）。 */
  yourShare: number;
}

/** 计划级统计。 */
export interface CarpoolPlanStats {
  totalCars: number;
  activeCars: number;
  emptyCars: number;
  /** 每月应收，按币种分桶（前端用实时汇率折成人民币合计）。只含「本月收得到」的车友。 */
  receivableByCurrency: Record<string, number>;
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
  billing_cycle: BillingCycle;
  custom_days: number | null;
  custom_cycle_unit: CustomCycleUnit | null;
  one_time_term_count: number | null;
  one_time_term_unit: CustomCycleUnit | null;
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
  amount_cny: number | null;
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
    amountCny: null,
  };
}

/** 把上游可能是 MoneyString / number / 脏值的金额收敛成 MoneyString。 */
function moneyFromUnknownOrUndefined(value: unknown): MoneyString | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return moneyFromUnknown(value) ?? undefined;
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
      // collectionReminder / joinedDate 是订阅页「家庭共享」侧的设置，拼车 UI 不管理它们：
      // 原样带过去，否则在拼车里保存一次就把用户在订阅页设的收款提醒清掉了。
      ...(parsed.collectionReminder ? { collectionReminder: parsed.collectionReminder } : {}),
      members: parsed.members
        .filter((member): member is CostSharingMember => Boolean(member) && typeof member === "object" && typeof (member as CostSharingMember).id === "string")
        .map((member) => ({
          id: member.id,
          name: typeof member.name === "string" ? member.name : "",
          note: typeof member.note === "string" ? member.note : undefined,
          ...(member.joinedDate ? { joinedDate: member.joinedDate } : {}),
          currency: typeof member.currency === "string" ? member.currency : undefined,
          // 上游把金额改成了 MoneyString（十进制字符串），这里统一收敛一次再用。
          customAmount: moneyFromUnknownOrUndefined(member.customAmount),
        })),
    };
  } catch {
    return fallback;
  }
}

async function fetchOverlayMap(env: Env, userId: string): Promise<Map<string, CarpoolMemberMeta>> {
  const overlays = await env.DB.prepare(
    `SELECT subscription_id, member_id, join_date, expiry_date, status, billing_cycle, custom_days, auto_calc_expiry, reminder_days, wechat, email, amount_cny
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
      amountCny: row.amount_cny ?? null,
    });
  }
  return map;
}

/**
 * 覆盖式保存前先取回 overlay 上「拼车 UI 不回传」的字段。
 *
 * reminded_for 是到期提醒的去重键：保存时如果不带回来，每次编辑（哪怕只改个微信号）都会让 cron
 * 在一分钟内把同一条到期提醒再推一遍。created_at 同理，不带回来会被刷成本次保存时间。
 */
async function fetchOverlayAuditMap(
  env: Env,
  userId: string,
  subscriptionId: string,
): Promise<Map<string, { remindedFor: string | null; createdAt: string | null }>> {
  const rows = await env.DB.prepare(
    `SELECT member_id, reminded_for, created_at FROM carpool_member_meta WHERE user_id = ? AND subscription_id = ?`,
  )
    .bind(userId, subscriptionId)
    .all<{ member_id: string; reminded_for: string | null; created_at: string | null }>();
  const map = new Map<string, { remindedFor: string | null; createdAt: string | null }>();
  for (const row of rows.results ?? []) {
    map.set(row.member_id, { remindedFor: row.reminded_for ?? null, createdAt: row.created_at ?? null });
  }
  return map;
}

interface CarMeta {
  account: string | null;
  cardLast4: string | null;
}
async function fetchCarMetaMap(env: Env, userId: string): Promise<Map<string, CarMeta>> {
  const rows = await env.DB.prepare(`SELECT subscription_id, account, card_last4 FROM carpool_subscription_meta WHERE user_id = ?`)
    .bind(userId)
    .all<{ subscription_id: string; account: string | null; card_last4: string | null }>();
  const map = new Map<string, CarMeta>();
  for (const row of rows.results ?? []) {
    map.set(row.subscription_id, { account: row.account ?? null, cardLast4: row.card_last4 ?? null });
  }
  return map;
}

function buildSubscriptionView(
  row: SubscriptionRow,
  overlayMap: Map<string, CarpoolMemberMeta>,
  carMetaMap: Map<string, CarMeta>,
  today: string,
): CarpoolSubscriptionView {
  const costSharing = parseCostSharing(row.cost_sharing_json);
  // 非月付订阅（年付/季付/固定服务期一次性等）按月均折算：拼车展示的是每月成本，而不是整期总价。
  // 复用应用统计用的 toSubscriptionMonthlyAmount，保持与「月均花费」口径一致（一次性买断无服务期折算为 0）。
  const monthlyPrice = roundMoney(
    toSubscriptionMonthlyAmount(row.price, {
      billingCycle: row.billing_cycle,
      customDays: row.custom_days,
      customCycleUnit: row.custom_cycle_unit,
      oneTimeTermCount: row.one_time_term_count,
      oneTimeTermUnit: row.one_time_term_unit,
    }),
  );
  let memberTotal = 0;
  const members: CarpoolMemberView[] = costSharing.members.map((member) => {
    const meta = overlayMap.get(overlayKey(row.id, member.id)) ?? defaultMeta();
    // 成员金额也折算成月均，与月均总价同一口径：自定义金额是「成员按其扣费周期支付的整期金额」，按成员周期折算；
    // 均摊份额由月均总价平分（calculateCostSharingMemberAmount 已用 monthlyPrice），本身已是月均。
    const rawAmount = calculateCostSharingMemberAmount(costSharing, member, monthlyPrice);
    const amount = costSharing.splitMode === "custom"
      ? roundMoney(carpoolAmountToMonthly(rawAmount, meta.billingCycle, meta.customDays))
      : rawAmount;
    const monthlyAmountCny = meta.amountCny != null ? roundMoney(carpoolAmountToMonthly(meta.amountCny, meta.billingCycle, meta.customDays)) : null;
    const effectiveExpiry = meta.autoCalcExpiry && meta.joinDate
      ? addCycle(meta.joinDate, meta.billingCycle, meta.customDays)
      : meta.expiryDate;
    // 暂停/已过期的车友这个月收不到钱：不计入应收，也不抵扣「你承担」（他那份由你先垫着）。
    const collectible = meta.status === "active" && (!effectiveExpiry || effectiveExpiry >= today);
    if (collectible) memberTotal += amount;
    // 对外仍给数字金额：拼车前端用它回填人民币输入框，不需要感知上游的 MoneyString 表示。
    const customAmount = member.customAmount === undefined ? undefined : moneyToNumber(member.customAmount);
    return { ...member, ...meta, customAmount, amount, monthlyAmountCny, effectiveExpiry, collectible };
  });
  return {
    id: row.id,
    name: row.name,
    logo: row.logo,
    price: monthlyPrice,
    currency: row.currency,
    status: row.status,
    nextBillingDate: row.next_billing_date,
    account: carMetaMap.get(row.id)?.account ?? null,
    cardLast4: carMetaMap.get(row.id)?.cardLast4 ?? null,
    enabled: costSharing.enabled,
    splitMode: costSharing.splitMode,
    members,
    yourShare: Math.max(roundMoney(monthlyPrice - memberTotal), 0),
  };
}

/**
 * 计划统计。应收按**币种**分桶返回，由前端用实时汇率折成人民币。
 *
 * Worker 侧没有汇率源，如果只累加成员手填的人民币金额，均摊模式的车（金额是订阅货币算出来的份额，
 * 没有人民币原值）就会整车漏掉，合计永远是 ¥0。
 */
function computeStats(subscriptions: CarpoolSubscriptionView[]): CarpoolPlanStats {
  let activeCars = 0;
  const receivableByCurrency: Record<string, number> = {};
  const add = (currency: string, amount: number) => {
    receivableByCurrency[currency] = roundMoney((receivableByCurrency[currency] ?? 0) + amount);
  };
  for (const sub of subscriptions) {
    if (sub.enabled && sub.members.length > 0) activeCars += 1;
    for (const member of sub.members) {
      if (!member.collectible) continue;
      if (member.monthlyAmountCny != null) add("CNY", member.monthlyAmountCny);
      else add(member.currency ?? sub.currency, member.amount);
    }
  }
  return {
    totalCars: subscriptions.length,
    activeCars,
    emptyCars: subscriptions.length - activeCars,
    receivableByCurrency,
  };
}

const SUBSCRIPTION_COLUMNS =
  "id, name, logo, price, currency, status, next_billing_date, cost_sharing_json, billing_cycle, custom_days, custom_cycle_unit, one_time_term_count, one_time_term_unit";

/** 列出用户所有 `active`（正在续费）订阅，用于把订阅加入计划的选择器。 */
export async function listActiveSubscriptions(env: Env, userId: string): Promise<CarpoolSubscriptionView[]> {
  await ensureCarpoolSchema(env);
  const [subs, overlayMap, carMetaMap, today] = await Promise.all([
    env.DB.prepare(
      `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY next_billing_date ASC`,
    )
      .bind(userId)
      .all<SubscriptionRow>(),
    fetchOverlayMap(env, userId),
    fetchCarMetaMap(env, userId),
    todayForUser(env, userId),
  ]);
  return (subs.results ?? []).map((row) => buildSubscriptionView(row, overlayMap, carMetaMap, today));
}

/**
 * 清理孤儿行：订阅在上游被删除后，拼车这三张表里的行没人删（自定义表没有外键，也不能改上游的删除逻辑）。
 *
 * 留着的不只是垃圾数据——`carpool_member_meta` 里有车友的微信和邮箱，用户以为删掉订阅就删干净了。
 * 由 cron 顺带跑，纯 DELETE，不影响任何在用数据。
 */
export async function purgeOrphanCarpoolRows(env: Env): Promise<void> {
  await ensureCarpoolSchema(env);
  const orphan = (table: string) =>
    env.DB.prepare(
      `DELETE FROM ${table} WHERE NOT EXISTS (
         SELECT 1 FROM subscriptions s WHERE s.id = ${table}.subscription_id AND s.user_id = ${table}.user_id
       )`,
    );
  await env.DB.batch([
    orphan("carpool_member_meta"),
    orphan("carpool_subscription_meta"),
    orphan("carpool_plan_subscription"),
  ]);
}

/** 已被加进某个拼车计划的订阅 id 集合；到期提醒只针对这些车（移出计划的车界面上已经看不到了）。 */export async function listPlannedSubscriptionIds(env: Env, userId: string): Promise<Set<string>> {
  await ensureCarpoolSchema(env);
  const rows = await env.DB.prepare(`SELECT DISTINCT subscription_id FROM carpool_plan_subscription WHERE user_id = ?`)
    .bind(userId)
    .all<{ subscription_id: string }>();
  return new Set((rows.results ?? []).map((row) => row.subscription_id));
}

/** 列出用户的所有拼车计划及其统计。 */
export async function listCarpoolPlans(env: Env, userId: string): Promise<CarpoolPlanSummary[]> {
  await ensureCarpoolSchema(env);
  const [plans, rows, overlayMap, carMetaMap, today] = await Promise.all([
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
    fetchCarMetaMap(env, userId),
    todayForUser(env, userId),
  ]);

  const viewsByPlan = new Map<string, CarpoolSubscriptionView[]>();
  for (const row of rows.results ?? []) {
    const list = viewsByPlan.get(row.plan_id) ?? [];
    list.push(buildSubscriptionView(row, overlayMap, carMetaMap, today));
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

  const [subs, overlayMap, carMetaMap, today] = await Promise.all([
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
    fetchCarMetaMap(env, userId),
    todayForUser(env, userId),
  ]);

  const subscriptions = (subs.results ?? []).map((row) => buildSubscriptionView(row, overlayMap, carMetaMap, today));
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
  return { id, name: name.trim(), stats: { totalCars: 0, activeCars: 0, emptyCars: 0, receivableByCurrency: {} } };
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
  amountCny?: number | undefined;
}

function normalizeText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** 保存结果：命中订阅但数据过不了上游契约时返回 invalid，由路由转成 400 而不是写坏数据。 */
export type SaveCarpoolMembersResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid"; message: string };

/**
 * 覆盖式保存一条订阅的车辆信息与拼车成员。
 *
 * 写入三处：cost_sharing_json（与家庭共享共享，成员/金额/开关/分摊模式）、carpool_subscription_meta
 * （车辆 gpt账号）、carpool_member_meta（每成员的上车/到期/状态/周期/提醒/微信/邮箱）。
 * 全部按 user_id 隔离，并核对订阅归属。
 *
 * cost_sharing_json 是**上游共享**字段，上游每次出站都用 `costSharingSchema` 重新校验
 * （db.ts `toApiSubscription`）。所以这里写入前必须自己先过一遍同一个 schema：一旦写进不合法的形状，
 * 整个订阅接口都会 500（而拼车页自己反而正常，极难排查）。
 */
export async function saveCarpoolMembers(
  env: Env,
  userId: string,
  subscriptionId: string,
  input: { enabled: boolean; splitMode: CostSharingSplitMode; account?: string | undefined; cardLast4?: string | undefined; members: CarpoolMemberInput[] },
): Promise<SaveCarpoolMembersResult> {
  await ensureCarpoolSchema(env);

  const existing = await env.DB.prepare(
    `SELECT cost_sharing_json FROM subscriptions WHERE user_id = ? AND id = ? LIMIT 1`,
  )
    .bind(userId, subscriptionId)
    .first<{ cost_sharing_json: string | null }>();
  if (!existing) return { ok: false, reason: "not_found" };

  // 保留家庭共享侧可能设置、但拼车 UI 不管理的成员字段（如 currency、note）。
  const previous = parseCostSharing(existing.cost_sharing_json);
  const previousById = new Map(previous.members.map((member) => [member.id, member]));
  // 保留 overlay 上拼车 UI 不回传的字段：提醒去重标记（否则每次保存都会重推）和建档时间。
  const priorOverlay = await fetchOverlayAuditMap(env, userId, subscriptionId);

  const now = new Date().toISOString();
  const members = input.members.map((member) => {
    const id = member.id && previousById.has(member.id) ? member.id : crypto.randomUUID();
    const prior = member.id ? previousById.get(member.id) : undefined;
    const costMember: CostSharingMember = {
      id,
      name: member.name.trim(),
      ...(member.note?.trim() ? { note: member.note.trim() } : prior?.note ? { note: prior.note } : {}),
      ...(prior?.joinedDate ? { joinedDate: prior.joinedDate } : {}),
      ...(prior?.currency ? { currency: prior.currency } : {}),
      // 上游契约要求 custom 模式下**每个**成员都带金额；留空按 0 写入，绝不能省略。金额是 MoneyString。
      ...(input.splitMode === "custom" ? { customAmount: moneyFromNumber(typeof member.customAmount === "number" ? member.customAmount : 0) } : {}),
    };
    return { costMember, input: member };
  });

  const hasMembers = members.length > 0;
  const enabled = input.enabled && hasMembers;
  // 关掉拼车开关**不能**丢成员：仍写完整成员数组，只把 enabled 置 false（上游 isCostSharingEnabled
  // 同样按 enabled && members.length 判断）。只有真的一个成员都没有时才写空对象（上游约定=未开启分摊）。
  const costSharing: CostSharing = {
    enabled,
    splitMode: input.splitMode,
    members: members.map((m) => m.costMember),
    ...(previous.collectionReminder ? { collectionReminder: previous.collectionReminder } : {}),
  };
  const invalid = hasMembers ? costSharingContractError(costSharing) : null;
  if (invalid) return { ok: false, reason: "invalid", message: invalid };
  const costSharingJson = hasMembers ? JSON.stringify(costSharing) : "{}";

  const statements = [
    env.DB.prepare(`UPDATE subscriptions SET cost_sharing_json = ?, updated_at = ? WHERE user_id = ? AND id = ?`).bind(
      costSharingJson,
      now,
      userId,
      subscriptionId,
    ),
    env.DB.prepare(
      `INSERT OR REPLACE INTO carpool_subscription_meta (user_id, subscription_id, account, card_last4, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(userId, subscriptionId, normalizeText(input.account), normalizeText(input.cardLast4), now, now),
    // overlay 全量重建：先清空该订阅旧行，再写入当前成员（reminded_for / created_at 从旧行带回）。
    env.DB.prepare(`DELETE FROM carpool_member_meta WHERE user_id = ? AND subscription_id = ?`).bind(userId, subscriptionId),
    ...members.map(({ costMember, input: m }) =>
      env.DB.prepare(
        `INSERT INTO carpool_member_meta
           (user_id, subscription_id, member_id, join_date, expiry_date, status, billing_cycle, custom_days, auto_calc_expiry, reminder_days, wechat, email, amount_cny, reminded_for, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        typeof m.amountCny === "number" ? m.amountCny : null,
        priorOverlay.get(costMember.id)?.remindedFor ?? null,
        priorOverlay.get(costMember.id)?.createdAt ?? now,
        now,
      ),
    ),
  ];

  await env.DB.batch(statements);
  return { ok: true };
}

/**
 * 手动续费一个成员：把到期日按其扣费周期往后推，清除提醒去重标记（reminded_for），并置为「使用中」。
 *
 * 有效到期日：开启自动计算时按「上车时间 + 周期」得出，否则用手填到期日；两者都没有则以今天为基准。
 * 推进以**原到期日**为锚点（见 nextRenewalExpiry），所以「几号到期」保持不变；已过期多期时一次推进
 * 到最近的未来到期日。续费后写入**显式**到期日并关闭自动计算——这样可反复续费而不改动上车时间，
 * 且新到期日能重新触发提醒。
 */
export async function renewCarpoolMember(
  env: Env,
  userId: string,
  subscriptionId: string,
  memberId: string,
): Promise<{ ok: boolean; newExpiry: string | null }> {
  await ensureCarpoolSchema(env);
  const row = await env.DB.prepare(
    `SELECT join_date, expiry_date, billing_cycle, custom_days, auto_calc_expiry
     FROM carpool_member_meta WHERE user_id = ? AND subscription_id = ? AND member_id = ? LIMIT 1`,
  )
    .bind(userId, subscriptionId, memberId)
    .first<{ join_date: string | null; expiry_date: string | null; billing_cycle: string | null; custom_days: number | null; auto_calc_expiry: number | null }>();
  // 没有 overlay 行说明这位成员是在订阅页「家庭共享」里建的，从没经过拼车保存；确认他确实属于这条
  // 订阅后按默认周期建行续费，而不是回一个用户看不懂的 404。
  if (!row && !(await subscriptionHasCostSharingMember(env, userId, subscriptionId, memberId))) {
    return { ok: false, newExpiry: null };
  }

  const cycle = toBillingCycle(row?.billing_cycle);
  const customDays = row?.custom_days ?? null;
  const todayStr = await todayForUser(env, userId);
  const current = row?.auto_calc_expiry === 1 && row.join_date ? addCycle(row.join_date, cycle, customDays) : row?.expiry_date ?? null;
  // 从当前到期日整期推进（保留「到期日是几号」），已过期则一次推进到最近的未来到期日。
  const newExpiry = nextRenewalExpiry(current, cycle, customDays, todayStr);
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO carpool_member_meta
       (user_id, subscription_id, member_id, expiry_date, status, billing_cycle, auto_calc_expiry, reminder_days, reminded_for, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, 0, ?, NULL, ?, ?)
     ON CONFLICT (user_id, subscription_id, member_id) DO UPDATE SET
       expiry_date = excluded.expiry_date, auto_calc_expiry = 0, status = 'active', reminded_for = NULL, updated_at = excluded.updated_at`,
  )
    .bind(userId, subscriptionId, memberId, newExpiry, cycle, defaultMeta().reminderDays, now, now)
    .run();
  return { ok: true, newExpiry };
}

/** 该成员是否真的在这条订阅的 cost_sharing 里（用于给家庭共享侧建的成员补 overlay 行）。 */
async function subscriptionHasCostSharingMember(
  env: Env,
  userId: string,
  subscriptionId: string,
  memberId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT cost_sharing_json FROM subscriptions WHERE user_id = ? AND id = ? LIMIT 1`)
    .bind(userId, subscriptionId)
    .first<{ cost_sharing_json: string | null }>();
  if (!row) return false;
  return parseCostSharing(row.cost_sharing_json).members.some((member) => member.id === memberId);
}
