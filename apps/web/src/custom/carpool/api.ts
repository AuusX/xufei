/**
 * 拼车 API 客户端（前端）。
 *
 * 复用应用既有的产品会话头 `getProductAuthHeader()` 与 locale 头；成功响应统一是 `{ data: ... }` 信封。
 * 类型在此本地声明，与后端 `apps/worker/src/custom/carpool/store.ts` 的返回结构对应。
 */
import { getLocaleHeaders } from "@/i18n/api-locale";
import { getProductAuthHeader } from "@/services/product-session";

export type CarpoolSplitMode = "equal" | "custom";

export interface CarpoolMember {
  id: string;
  name: string;
  note?: string;
  currency?: string;
  customAmount?: number;
  amount: number;
  joinDate: string | null;
  expiryDate: string | null;
}

export interface CarpoolSubscription {
  id: string;
  name: string;
  logo: string | null;
  price: number;
  currency: string;
  status: string;
  nextBillingDate: string;
  enabled: boolean;
  splitMode: CarpoolSplitMode;
  members: CarpoolMember[];
  yourShare: number;
}

export interface CarpoolMemberDraft {
  id?: string;
  name: string;
  note?: string;
  customAmount?: number;
  joinDate?: string;
  expiryDate?: string;
}

export interface SaveCarpoolMembersInput {
  enabled: boolean;
  splitMode: CarpoolSplitMode;
  members: CarpoolMemberDraft[];
}

function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return typeof record.message === "string" ? record.message : null;
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

export async function fetchCarpoolSubscriptions(): Promise<CarpoolSubscription[]> {
  const data = await apiFetch<{ subscriptions: CarpoolSubscription[] } | null>("/api/custom/carpool/subscriptions");
  return data?.subscriptions ?? [];
}

export async function saveCarpoolMembers(
  subscriptionId: string,
  input: SaveCarpoolMembersInput,
): Promise<CarpoolSubscription | null> {
  const data = await apiFetch<{ subscription: CarpoolSubscription | null } | null>(
    `/api/custom/carpool/subscriptions/${encodeURIComponent(subscriptionId)}/members`,
    { method: "PUT", body: JSON.stringify(input) },
  );
  return data?.subscription ?? null;
}
