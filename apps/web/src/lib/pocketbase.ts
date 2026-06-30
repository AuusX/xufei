/**
 * SDK 单例与认证 header 适配层（PocketBase）。
 *
 * 架构位置：所有前端数据层 hook 都共享同一个 `pb` 实例，确保 authStore、
 * realtime/cancel 行为和 API base URL 一致。这里不做业务 schema 解析，解析应放在
 * `lib/api/schemas/*` 或具体 hook 边界。
 *
 * 注意： `autoCancellation(false)` 是为了让 React Query/并发上传自己管理竞态；
 * 打开 SDK 自动取消会让相同 collection 的并行请求互相中断。
 */
import PocketBase, { ClientResponseError, type RecordModel } from "pocketbase";
import { getProductAuthHeader, getProductCurrentUserId } from "@/services/product-session";

const configuredBaseUrl: unknown = import.meta.env["VITE_POCKETBASE_URL"];
const baseUrl = typeof configuredBaseUrl === "string" && configuredBaseUrl
  ? configuredBaseUrl
  : window.location.origin;

export const pb = new PocketBase(baseUrl);
pb.autoCancellation(false);

export { ClientResponseError };
export type { RecordModel };

export function getCurrentUserId(): string | null {
  return getProductCurrentUserId();
}

export function getAuthHeader(): Record<string, string> {
  return getProductAuthHeader();
}
