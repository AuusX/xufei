import { pb } from "@/lib/pocketbase";
import { readCloudflareSession, writeCloudflareSession } from "@/services/cloudflare-session";
import { isCloudflareRuntime } from "@/services/runtime";

function currentSessionToken(): string {
  return isCloudflareRuntime ? (readCloudflareSession()?.session.id ?? "") : pb.authStore.token;
}

function isUnauthorizedError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "status" in error && error.status === 401);
}

export function clearAuthSession(token?: string | null) {
  const currentToken = currentSessionToken();
  // 401 可能来自旧请求；如果期间已经登录成新 token，不能让旧响应清掉新的会话。
  if (token && currentToken && currentToken !== token) return;

  if (isCloudflareRuntime) {
    writeCloudflareSession(null);
    return;
  }
  pb.authStore.clear();
}

/** PocketBase SDK 不经过 apiFetch；这里补上同一套 401 清会话语义，避免运行面之间登录态漂移。 */
export async function withPocketBaseAuthGuard<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (isUnauthorizedError(error)) {
      clearAuthSession();
    }
    throw error;
  }
}
