import { z } from "zod";
import { apiSuccessResponseSchema } from "./api";
import { okResponseSchema } from "./common";

/**
 * 登录态管理接口只返回可展示的 feed URL，不返回 token 字段本身。
 *
 * 公开 ICS route 使用 URL 中的 bearer token，误分享后的失效动作是删除/重建 feed。
 */
export const calendarFeedStatusSchema = z.object({
  enabled: z.boolean(),
  createdAt: z.string().optional(),
  feedUrl: z.string().trim().url().max(4096).optional(),
  updatedAt: z.string().optional(),
}).strict();

export const calendarFeedStatusPayloadSchema = z.object({
  calendarFeed: calendarFeedStatusSchema,
}).strict();
export const calendarFeedStatusResponseSchema = apiSuccessResponseSchema(calendarFeedStatusPayloadSchema);

/** 创建 feed 不接受客户端传 token，避免前端或导入工具把低权限 bearer secret 带入请求体。 */
export const calendarFeedCreateRequestSchema = z.object({}).strict();

export const calendarFeedCreatePayloadSchema = z.object({
  calendarFeed: z.object({
    enabled: z.literal(true),
    createdAt: z.string().trim().min(1),
    updatedAt: z.string().trim().min(1),
    feedUrl: z.string().trim().url().max(4096),
  }).strict(),
}).strict();
export const calendarFeedCreateResponseSchema = apiSuccessResponseSchema(calendarFeedCreatePayloadSchema);

export const subscriptionCalendarFeedCreateResponseSchema = calendarFeedCreateResponseSchema;

export const calendarFeedDeleteResponseSchema = okResponseSchema;

export type CalendarFeedStatus = z.infer<typeof calendarFeedStatusSchema>;
export type CalendarFeedStatusResponse = z.infer<typeof calendarFeedStatusPayloadSchema>;
export type CalendarFeedCreateRequest = z.infer<typeof calendarFeedCreateRequestSchema>;
export type CalendarFeedCreateResponse = z.infer<typeof calendarFeedCreatePayloadSchema>;
export type SubscriptionCalendarFeedCreateResponse = z.infer<typeof calendarFeedCreatePayloadSchema>;
