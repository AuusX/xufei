/**
 * 订阅相关 React Query Hooks（前端数据层）。
 *
 * 说明：
 * - 通过 subscriptionService 按运行目标读写当前用户订阅数据
 * - PocketBase SDK 或 Worker API 响应都会在 service 边界统一 normalize + Zod parse
 * - API 返回 date-only 字符串（YYYY-MM-DD），前端在这里统一转成品牌类型
 *
 * 注意： Date 转换只发生在 hook 边界。页面/组件内部应使用 `Subscription` domain 类型，
 * 不要直接消费 API row，避免日期处理散落。
 * 注意： `billingCycle=custom` 与 `customDays` 的判别关系在这里落入 domain union；
 * 修改该转换会影响统计折算、表单回填和通知提醒。
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { subscriptionService } from "@/services/subscription-service";
import type { Subscription, SubscriptionDraft } from "@/types/subscription";

export function useSubscriptions() {
  return useQuery({
    queryKey: ["subscriptions"],
    queryFn: () => subscriptionService.list(),
  });
}

export function useCreateSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sub: SubscriptionDraft) => {
      return await subscriptionService.create(sub);
    },
    onSuccess: () => {
      // 订阅数据会驱动统计、日历和通知预览；写操作后统一让订阅列表成为失效源。
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    },
  });
}

export function useUpdateSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sub: Subscription) => {
      return await subscriptionService.update(sub);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    },
  });
}

export function useDeleteSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await subscriptionService.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    },
  });
}
