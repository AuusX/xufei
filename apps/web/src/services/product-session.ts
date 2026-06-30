import { sessionPayloadSchema, type SessionResponse } from "@renewlet/shared/schemas/auth";

/**
 * 产品 session 是浏览器唯一持久登录态；MFA ticket、Passkey challenge 和恢复码明文都不能进入这里。
 * storage 事件只同步已签发 session，避免认证前流程跨 tab 影响当前登录态。
 */
const STORAGE_KEY = "renewlet_app_session";
const CHANGE_EVENT = "renewlet:app-session-change";
const STORAGE_VERSION = 1;

export type ProductSessionData = SessionResponse;

/** 产品 session 是 Docker/Cloudflare 的统一前端缓存；真实认证仍以服务端 token hash 为准。 */
export interface ProductSessionRecord {
  value: ProductSessionData;
  verifiedAt: number;
}

function parseSessionRecord(value: string | null): ProductSessionRecord | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(value) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    if (record["version"] !== STORAGE_VERSION) return null;
    const verifiedAt = record["verifiedAt"];
    if (typeof verifiedAt !== "number" || !Number.isFinite(verifiedAt) || verifiedAt <= 0) return null;
    const parsed = sessionPayloadSchema.safeParse(record["value"]);
    return parsed.success ? { value: parsed.data, verifiedAt } : null;
  } catch {
    return null;
  }
}

export function readProductSessionRecord(): ProductSessionRecord | null {
  if (typeof localStorage === "undefined") return null;
  const record = parseSessionRecord(localStorage.getItem(STORAGE_KEY));
  if (!record) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  return record;
}

export function readProductSession(): ProductSessionData | null {
  return readProductSessionRecord()?.value ?? null;
}

export function isProductSessionFresh(record: ProductSessionRecord | null, maxAgeMs: number): boolean {
  return Boolean(record && Date.now() - record.verifiedAt < maxAgeMs);
}

export function writeProductSession(
  session: ProductSessionData | null,
  options: { verifiedAt?: number } = {},
) {
  if (typeof localStorage === "undefined") return;
  if (session) {
    // 这里只有完成 MFA 后的产品 session 会持久化；mfa_required ticket 不允许进入 localStorage。
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      value: session,
      verifiedAt: options.verifiedAt ?? Date.now(),
    }));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeProductSession(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function getProductAuthHeader(): Record<string, string> {
  const token = readProductSession()?.session.id;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function getProductCurrentUserId(): string | null {
  return readProductSession()?.user.id ?? null;
}
