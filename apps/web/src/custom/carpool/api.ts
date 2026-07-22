/**
 * 拼车 API 客户端（前端）。
 *
 * 复用应用既有的产品会话头 `getProductAuthHeader()` 与 locale 头；成功响应统一是 `{ data: ... }` 信封。
 * 类型在此本地声明，与后端 `apps/worker/src/custom/carpool/store.ts` 的返回结构对应。
 */
import { getLocaleHeaders } from "@/i18n/api-locale";
import { getProductAuthHeader } from "@/services/product-session";

export type CarpoolSplitMode = "equal" | "custom";
export type CarpoolMemberStatus = "active" | "paused" | "expired";
export type CarpoolBillingCycle = "monthly" | "quarterly" | "yearly" | "custom";

export interface CarpoolMember {
  id: string;
  name: string;
  note?: string;
  currency?: string;
  customAmount?: number;
  amount: number;
  joinDate: string | null;
  expiryDate: string | null;
  status: CarpoolMemberStatus;
  billingCycle: CarpoolBillingCycle;
  customDays: number | null;
  autoCalcExpiry: boolean;
  effectiveExpiry: string | null;
  reminderDays: number;
  wechat: string | null;
  email: string | null;
  amountCny: number | null;
  /** 成员实付人民币的月均值（按成员扣费周期折算）；用于卡片/合计的按月展示。amountCny 仍是整期原值，供编辑回填。 */
  monthlyAmountCny: number | null;
}

export interface CarpoolSubscription {
  id: string;
  name: string;
  logo: string | null;
  /** 月均价格（非月付订阅已按平均每月折算，而非整期总价）。 */
  price: number;
  currency: string;
  status: string;
  nextBillingDate: string;
  account: string | null;
  cardLast4: string | null;
  enabled: boolean;
  splitMode: CarpoolSplitMode;
  members: CarpoolMember[];
  /** 你自己承担的月均份额。 */
  yourShare: number;
}

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
  subscriptions: CarpoolSubscription[];
}

export interface CarpoolMemberDraft {
  id?: string;
  name: string;
  note?: string;
  customAmount?: number;
  joinDate?: string;
  expiryDate?: string;
  status?: CarpoolMemberStatus;
  billingCycle?: CarpoolBillingCycle;
  customDays?: number;
  autoCalcExpiry?: boolean;
  reminderDays?: number;
  wechat?: string;
  email?: string;
  amountCny?: number;
}

export interface SaveCarpoolMembersInput {
  enabled: boolean;
  splitMode: CarpoolSplitMode;
  account?: string;
  cardLast4?: string;
  members: CarpoolMemberDraft[];
}

function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const error = record["error"];
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as Record<string, unknown>)["message"];
    if (typeof message === "string") return message;
  }
  return typeof record["message"] === "string" ? record["message"] : null;
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("content-type", "application/json");
  for (const [key, value] of Object.entries(getProductAuthHeader())) headers.set(key, value);
  for (const [key, value] of Object.entries(getLocaleHeaders())) {
    if (!headers.has(key)) headers.set(key, value);
  }
  const response = await fetch(url, { ...init, headers, credentials: "include" });
  const payload = (await response.json().catch(() => null)) as { data?: unknown } | null;
  if (!response.ok) throw new Error(extractErrorMessage(payload) ?? response.statusText);
  return (payload?.data ?? null) as T;
}

const PLANS_URL = "/api/custom/carpool/plans";

/** 列出「正在续费」(active) 的订阅，供加入计划时选择。 */
export async function fetchCarpoolSubscriptions(): Promise<CarpoolSubscription[]> {
  const data = await apiFetch<{ subscriptions: CarpoolSubscription[] } | null>("/api/custom/carpool/subscriptions");
  return data?.subscriptions ?? [];
}

/** 列出用户的所有拼车计划（含统计）。 */
export async function fetchCarpoolPlans(): Promise<CarpoolPlanSummary[]> {
  const data = await apiFetch<{ plans: CarpoolPlanSummary[] } | null>(PLANS_URL);
  return data?.plans ?? [];
}

/** 创建拼车计划。 */
export async function createCarpoolPlan(name: string): Promise<CarpoolPlanSummary | null> {
  const data = await apiFetch<{ plan: CarpoolPlanSummary } | null>(PLANS_URL, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return data?.plan ?? null;
}

/** 读取一个计划的详情（订阅视图 + 统计）。 */
export async function fetchCarpoolPlanDetail(planId: string): Promise<CarpoolPlanDetail | null> {
  const data = await apiFetch<{ plan: CarpoolPlanDetail } | null>(`${PLANS_URL}/${encodeURIComponent(planId)}`);
  return data?.plan ?? null;
}

/** 重命名计划。 */
export async function renameCarpoolPlan(planId: string, name: string): Promise<CarpoolPlanDetail | null> {
  const data = await apiFetch<{ plan: CarpoolPlanDetail } | null>(`${PLANS_URL}/${encodeURIComponent(planId)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  return data?.plan ?? null;
}

/** 删除计划。 */
export async function deleteCarpoolPlan(planId: string): Promise<void> {
  await apiFetch<{ ok: boolean } | null>(`${PLANS_URL}/${encodeURIComponent(planId)}`, { method: "DELETE" });
}

/** 把一个订阅加入计划。 */
export async function addSubscriptionToPlan(planId: string, subscriptionId: string): Promise<CarpoolPlanDetail | null> {
  const data = await apiFetch<{ plan: CarpoolPlanDetail } | null>(
    `${PLANS_URL}/${encodeURIComponent(planId)}/subscriptions`,
    { method: "POST", body: JSON.stringify({ subscriptionId }) },
  );
  return data?.plan ?? null;
}

/** 从计划移除一个订阅。 */
export async function removeSubscriptionFromPlan(planId: string, subscriptionId: string): Promise<CarpoolPlanDetail | null> {
  const data = await apiFetch<{ plan: CarpoolPlanDetail } | null>(
    `${PLANS_URL}/${encodeURIComponent(planId)}/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { method: "DELETE" },
  );
  return data?.plan ?? null;
}

/** 覆盖式保存一条订阅的拼车成员。 */
export async function saveCarpoolMembers(subscriptionId: string, input: SaveCarpoolMembersInput): Promise<void> {
  await apiFetch<{ ok: boolean } | null>(
    `/api/custom/carpool/subscriptions/${encodeURIComponent(subscriptionId)}/members`,
    { method: "PUT", body: JSON.stringify(input) },
  );
}

/** 手动续费一个成员：到期日 +1 个扣费周期、重置提醒；返回新的到期日。 */
export async function renewCarpoolMember(subscriptionId: string, memberId: string): Promise<{ newExpiry: string | null }> {
  const data = await apiFetch<{ ok: boolean; newExpiry: string | null } | null>(
    `/api/custom/carpool/subscriptions/${encodeURIComponent(subscriptionId)}/members/${encodeURIComponent(memberId)}/renew`,
    { method: "POST" },
  );
  return { newExpiry: data?.newExpiry ?? null };
}

export interface CarpoolNotification {
  enabled: boolean;
  webhookUrl: string;
  webhookMethod: "GET" | "POST";
  webhookHeaders: string;
  webhookPayload: string;
}

/** 读取拼车通知配置。 */
export async function fetchCarpoolNotification(): Promise<CarpoolNotification | null> {
  const data = await apiFetch<{ notification: CarpoolNotification } | null>("/api/custom/carpool/notification");
  return data?.notification ?? null;
}

/** 保存拼车通知配置。 */
export async function saveCarpoolNotification(config: CarpoolNotification): Promise<void> {
  await apiFetch<{ notification: CarpoolNotification } | null>("/api/custom/carpool/notification", {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

/** 用给定配置发一条测试通知。 */
export async function testCarpoolNotification(config: CarpoolNotification): Promise<void> {
  await apiFetch<{ ok: boolean } | null>("/api/custom/carpool/notification/test", {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export interface CarpoolNotificationLog {
  id: string;
  createdAt: string;
  ok: boolean;
  error: string | null;
  context: string | null;
}

/** 读取拼车通知发送历史（含失败原因）。 */
export async function fetchCarpoolNotificationLog(): Promise<CarpoolNotificationLog[]> {
  const data = await apiFetch<{ log: CarpoolNotificationLog[] } | null>("/api/custom/carpool/notification/log");
  return data?.log ?? [];
}
