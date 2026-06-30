import { apiFetch } from "@/lib/api-client";
import {
  systemRestartResponseSchema,
  systemUpdateResponseSchema,
  systemVersionResponseSchema,
  type SystemRestartResponse,
  type SystemUpdateResponse,
  type SystemVersionResponse,
} from "@/lib/api/schemas/app";

/**
 * systemService 服务版本展示和 Docker 页面内更新。
 *
 * 版本查询允许所有登录用户只读展示；真正更新/重启仍走管理员端点，前端不自行扩大权限。
 */
export const systemService = {
  async version(force = false, signal?: AbortSignal): Promise<SystemVersionResponse> {
    // force=true 只绕过后端版本检查缓存，不能绕过服务端权限守卫或 GitHub Release 可信资产校验。
    const params = new URLSearchParams({ force: force ? "true" : "false" });
    return await apiFetch(`/api/app/system/version?${params.toString()}`, systemVersionResponseSchema, signal ? { signal } : undefined);
  },

  async update(): Promise<SystemUpdateResponse> {
    // 下载 Release、校验 checksum 和替换二进制可能跨公网，超时必须长于普通 JSON 请求。
    return await apiFetch("/api/app/admin/system/update", systemUpdateResponseSchema, {
      method: "POST",
      body: JSON.stringify({}),
      timeoutMs: 180_000,
    });
  },

  async restart(): Promise<SystemRestartResponse> {
    // restart 请求可能在旧进程退出时断开；UI 会继续轮询 health，所以这里保持短超时。
    return await apiFetch("/api/app/admin/system/restart", systemRestartResponseSchema, {
      method: "POST",
      body: JSON.stringify({}),
      timeoutMs: 10_000,
    });
  },
};
