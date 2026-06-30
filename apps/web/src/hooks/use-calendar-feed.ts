import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { calendarFeedService } from "@/services/calendar-feed-service";

const CALENDAR_FEED_QUERY_KEY = ["calendar-feed"] as const;
const subscriptionCalendarFeedQueryKey = (subscriptionId: string) => ["subscription-calendar-feed", subscriptionId] as const;

/**
 * 查询全局日历订阅 Feed 状态。
 *
 * 该 URL 是可复制的 bearer secret，React Query 缓存只保存当前登录用户可见状态，退出登录时由上层会话清理负责失效。
 */
export function useCalendarFeedStatus() {
  return useQuery({
    queryKey: CALENDAR_FEED_QUERY_KEY,
    queryFn: () => calendarFeedService.get(),
  });
}

/**
 * 创建或恢复全局续费日历 Feed。
 *
 * 成功后直接写入 query cache，让复制 URL 的弹窗立即使用服务端返回的新 token，避免等待重新拉取时展示旧状态。
 */
export function useCreateCalendarFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => calendarFeedService.create(),
    onSuccess: (calendarFeed) => {
      queryClient.setQueryData(CALENDAR_FEED_QUERY_KEY, calendarFeed);
    },
  });
}

/**
 * 撤销全局日历 Feed。
 *
 * 服务端会让旧 token 失效；前端缓存同步标记 disabled，避免用户在撤销后继续复制已废弃 URL。
 */
export function useDeleteCalendarFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => calendarFeedService.delete(),
    onSuccess: () => {
      queryClient.setQueryData(CALENDAR_FEED_QUERY_KEY, { enabled: false });
    },
  });
}

/**
 * 为单个订阅创建独立日历 Feed。
 *
 * 单订阅 Feed 与全局 Feed 分开缓存，避免订阅卡片弹窗互相覆盖对方的 token 状态。
 */
export function useCreateSubscriptionCalendarFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (subscriptionId: string) => calendarFeedService.createSubscription(subscriptionId),
    onSuccess: (calendarFeed, subscriptionId) => {
      queryClient.setQueryData(subscriptionCalendarFeedQueryKey(subscriptionId), calendarFeed);
    },
  });
}

/**
 * 查询单订阅日历 Feed 状态。
 *
 * @param subscriptionId 订阅 ID，参与 query key 以隔离不同卡片弹窗。
 * @param enabled 弹窗未打开或订阅 ID 不可用时关闭请求，减少公开 token 接口的无意义访问。
 */
export function useSubscriptionCalendarFeedStatus(subscriptionId: string, enabled: boolean) {
  return useQuery({
    queryKey: subscriptionCalendarFeedQueryKey(subscriptionId),
    queryFn: () => calendarFeedService.getSubscription(subscriptionId),
    enabled,
  });
}

/**
 * 撤销单订阅日历 Feed。
 *
 * 只更新对应 subscriptionId 的缓存，避免误清全局 Feed 或其它订阅弹窗中的可复制 URL。
 */
export function useDeleteSubscriptionCalendarFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (subscriptionId: string) => calendarFeedService.deleteSubscription(subscriptionId),
    onSuccess: (_, subscriptionId) => {
      queryClient.setQueryData(subscriptionCalendarFeedQueryKey(subscriptionId), { enabled: false });
    },
  });
}
