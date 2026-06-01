import { sessionResponseSchema, type SessionResponse } from "@renewlet/shared/schemas/auth";

const STORAGE_KEY = "renewlet_cloudflare_session";
const CHANGE_EVENT = "renewlet:cloudflare-session-change";
// v2 彻底切到带 verifiedAt 的结构；旧 plain session 不参与路由守卫，避免无新鲜度的缓存制造重复 /session。
const STORAGE_VERSION = 2;

export type CloudflareSessionData = SessionResponse;
export interface CloudflareSessionRecord {
  value: CloudflareSessionData;
  verifiedAt: number;
}

function parseSessionRecord(value: string | null): CloudflareSessionRecord | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(value) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    if (record["version"] !== STORAGE_VERSION) return null;
    const verifiedAt = record["verifiedAt"];
    if (typeof verifiedAt !== "number" || !Number.isFinite(verifiedAt) || verifiedAt <= 0) return null;
    // localStorage 只能当缓存；每次恢复都重跑 shared schema，避免脏 session 进入路由守卫。
    const parsed = sessionResponseSchema.safeParse(record["value"]);
    return parsed.success ? { value: parsed.data, verifiedAt } : null;
  } catch {
    return null;
  }
}

export function readCloudflareSessionRecord(): CloudflareSessionRecord | null {
  if (typeof localStorage === "undefined") return null;
  const record = parseSessionRecord(localStorage.getItem(STORAGE_KEY));
  if (!record) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  return record;
}

export function readCloudflareSession(): CloudflareSessionData | null {
  return readCloudflareSessionRecord()?.value ?? null;
}

export function isCloudflareSessionFresh(record: CloudflareSessionRecord | null, maxAgeMs: number): boolean {
  return Boolean(record && Date.now() - record.verifiedAt < maxAgeMs);
}

export function writeCloudflareSession(
  session: CloudflareSessionData | null,
  options: { verifiedAt?: number } = {},
) {
  if (typeof localStorage === "undefined") return;
  if (session) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      value: session,
      verifiedAt: options.verifiedAt ?? Date.now(),
    }));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  // Worker API 没有 PocketBase authStore 事件；自定义事件补齐同 tab 的 session 状态广播。
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeCloudflareSession(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(CHANGE_EVENT, listener);
  // storage 只覆盖其它 tab；同 tab 依赖 CHANGE_EVENT。
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function getCloudflareAuthHeader(): Record<string, string> {
  const token = readCloudflareSession()?.session.id;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function getCloudflareCurrentUserId(): string | null {
  return readCloudflareSession()?.user.id ?? null;
}
