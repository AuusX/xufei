import { apiFetch, apiFetchBlob } from "@/lib/api-client";
import {
  calendarFeedCreateResponseSchema,
  calendarFeedDeleteResponseSchema,
  calendarFeedStatusResponseSchema,
  subscriptionCalendarFeedCreateResponseSchema,
  type CalendarFeedCreateResponse,
  type CalendarFeedStatusResponse,
  type SubscriptionCalendarFeedCreateResponse,
} from "@/lib/api/schemas/calendar-feed";

/**
 * 日历订阅管理服务。
 *
 * 登录态接口只创建/撤销 feed 并返回可复制 URL；公开 ICS 拉取由 `/calendar/renewals.ics?token=...`
 * 承担，前端不会持久化 token 字段本身。
 */
export const calendarFeedService = {
  async get(): Promise<CalendarFeedStatusResponse["calendarFeed"]> {
    const data = await apiFetch("/api/app/calendar-feed", calendarFeedStatusResponseSchema);
    return data.calendarFeed;
  },

  async create(): Promise<CalendarFeedCreateResponse["calendarFeed"]> {
    const data = await apiFetch("/api/app/calendar-feed", calendarFeedCreateResponseSchema, {
      method: "POST",
      body: JSON.stringify({}),
    });
    return data.calendarFeed;
  },

  async delete(): Promise<void> {
    await apiFetch("/api/app/calendar-feed", calendarFeedDeleteResponseSchema, { method: "DELETE" });
  },

  async getSubscription(subscriptionId: string): Promise<CalendarFeedStatusResponse["calendarFeed"]> {
    const data = await apiFetch(`/api/app/subscriptions/${encodeURIComponent(subscriptionId)}/calendar-feed`, calendarFeedStatusResponseSchema);
    return data.calendarFeed;
  },

  async createSubscription(subscriptionId: string): Promise<SubscriptionCalendarFeedCreateResponse["calendarFeed"]> {
    const data = await apiFetch(`/api/app/subscriptions/${encodeURIComponent(subscriptionId)}/calendar-feed`, subscriptionCalendarFeedCreateResponseSchema, {
      method: "POST",
      body: JSON.stringify({}),
    });
    return data.calendarFeed;
  },

  async deleteSubscription(subscriptionId: string): Promise<void> {
    await apiFetch(`/api/app/subscriptions/${encodeURIComponent(subscriptionId)}/calendar-feed`, calendarFeedDeleteResponseSchema, { method: "DELETE" });
  },

  async downloadSubscriptionIcs(subscriptionId: string): Promise<Blob> {
    return await apiFetchBlob(`/api/app/subscriptions/${encodeURIComponent(subscriptionId)}/calendar.ics`);
  },
};
