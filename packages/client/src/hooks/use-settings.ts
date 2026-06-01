/**
 * 设置页 React Query 数据层。
 *
 * 架构位置：
 * - settingsService 按运行目标分流到 PocketBase SDK 或 Cloudflare Worker API。
 * - hook 负责缓存键、401 降级和前端类型归一。
 *
 * 注意： 未登录返回 DEFAULT_SETTINGS 是为了让公共页面/登录前 Provider 能安全渲染；
 * 受保护页面仍由 AuthSync 控制访问。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
} from "@/types/subscription";
import { normalizeSettings, settingsService } from "@/services/settings-service";

export { normalizeSettings };

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsService.get(),
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<AppSettings>) => {
      const current = queryClient.getQueryData<AppSettings>(["settings"]) ?? DEFAULT_SETTINGS;
      return await settingsService.update(current, patch);
    },
    onSuccess: (settings) => {
      // 设置页保存后直接写缓存，避免等待 refetch 时 UI 回跳到旧值。
      queryClient.setQueryData(["settings"], settings);
    },
  });
}
