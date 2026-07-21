/**
 * 拼车 API 路由（`/api/custom/carpool/*`）。
 *
 * 架构位置：通过 `registerCarpoolRoutes(app)` 挂到上游的 Hono `app` 上（由 `index.ts` 的一处两行补丁调用，
 * 见 patches/0002-mount-carpool-routes.patch）。复用上游的全局 locale middleware、`requireAuth` 鉴权、
 * `http.ts` 响应助手和 `onError` 错误 envelope。除那处补丁外不改任何上游文件。
 */
import type { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../../auth";
import { errorResponse, readJson, requestLocale, successJson, type AppLocale } from "../../http";
import type { Env } from "../../types";
import {
  addSubscriptionToPlan,
  createCarpoolPlan,
  deleteCarpoolPlan,
  getCarpoolNotification,
  getCarpoolPlanDetail,
  listActiveSubscriptions,
  listCarpoolPlans,
  removeSubscriptionFromPlan,
  renameCarpoolPlan,
  saveCarpoolMembers,
  saveCarpoolNotification,
} from "./store";
import { sendCarpoolTestNotification } from "./reminders";

// 与上游 index.ts 的 AppBindings 保持一致，这样 registerCarpoolRoutes(app) 能直接接收上游的 app。
type AppBindings = { Bindings: Env; Variables: { locale: AppLocale } };

const planNameSchema = z.object({ name: z.string().trim().min(1).max(60) }).strict();
const addSubscriptionSchema = z.object({ subscriptionId: z.string().min(1).max(64) }).strict();

const notificationConfigSchema = z
  .object({
    enabled: z.boolean(),
    webhookUrl: z.string().trim().max(2000),
    webhookMethod: z.enum(["GET", "POST"]),
    webhookHeaders: z.string().max(20_000),
    webhookPayload: z.string().max(100_000),
  })
  .strict();

const memberInputSchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(100),
    note: z.string().trim().max(500).optional(),
    customAmount: z.number().finite().nonnegative().optional(),
    joinDate: z.string().max(32).optional(),
    expiryDate: z.string().max(32).optional(),
    status: z.enum(["active", "paused", "expired"]).optional(),
    billingCycle: z.enum(["monthly", "quarterly", "yearly", "custom"]).optional(),
    customDays: z.number().int().positive().max(3660).optional(),
    autoCalcExpiry: z.boolean().optional(),
    reminderDays: z.number().int().min(-1).max(365).optional(),
    wechat: z.string().trim().max(100).optional(),
    email: z.string().trim().max(200).optional(),
    amountCny: z.number().finite().nonnegative().optional(),
  })
  .strict();

const saveMembersSchema = z
  .object({
    enabled: z.boolean(),
    splitMode: z.enum(["equal", "custom"]),
    account: z.string().trim().max(200).optional(),
    members: z.array(memberInputSchema).max(50),
  })
  .strict();

/** 把拼车路由登记到上游 app 上；被 index.ts 的补丁调用。 */
export function registerCarpoolRoutes(app: Hono<AppBindings>): void {
  // ---- 计划 ----

  // 列出用户的所有拼车计划（含统计）。
  app.get("/api/custom/carpool/plans", async (c) => {
    const auth = await requireAuth(c.req.raw, c.env);
    return successJson({ plans: await listCarpoolPlans(c.env, auth.user.id) });
  });

  // 创建拼车计划。
  app.post("/api/custom/carpool/plans", async (c) => {
    const auth = await requireAuth(c.req.raw, c.env);
    const { name } = await readJson(c.req.raw, planNameSchema, requestLocale(c.req.raw));
    return successJson({ plan: await createCarpoolPlan(c.env, auth.user.id, name) });
  });

  // 读取一个计划的详情（订阅视图 + 统计）。
  app.get("/api/custom/carpool/plans/:planId", async (c) => {
    const auth = await requireAuth(c.req.raw, c.env);
    const planId = c.req.param("planId");
    if (!planId) return errorResponse(400, "Missing plan id", "INVALID_PAYLOAD");
    const detail = await getCarpoolPlanDetail(c.env, auth.user.id, planId);
    if (!detail) return errorResponse(404, "Plan not found", "NOT_FOUND");
    return successJson({ plan: detail });
  });

  // 重命名计划。
  app.patch("/api/custom/carpool/plans/:planId", async (c) => {
    const auth = await requireAuth(c.req.raw, c.env);
    const planId = c.req.param("planId");
    if (!planId) return errorResponse(400, "Missing plan id", "INVALID_PAYLOAD");
    const { name } = await readJson(c.req.raw, planNameSchema, requestLocale(c.req.raw));
    if (!(await renameCarpoolPlan(c.env, auth.user.id, planId, name))) return errorResponse(404, "Plan not found", "NOT_FOUND");
    return successJson({ plan: await getCarpoolPlanDetail(c.env, auth.user.id, planId) });
  });

  // 删除计划。
  app.delete("/api/custom/carpool/plans/:planId", async (c) => {
    const auth = await requireAuth(c.req.raw, c.env);
    const planId = c.req.param("planId");
    if (!planId) return errorResponse(400, "Missing plan id", "INVALID_PAYLOAD");
    if (!(await deleteCarpoolPlan(c.env, auth.user.id, planId))) return errorResponse(404, "Plan not found", "NOT_FOUND");
    return successJson({ ok: true });
  });

  // 把一个订阅加入计划。
  app.post("/api/custom/carpool/plans/:planId/subscriptions", async (c) => {
    const auth = await requireAuth(c.req.raw, c.env);
    const planId = c.req.param("planId");
    if (!planId) return errorResponse(400, "Missing plan id", "INVALID_PAYLOAD");
    const { subscriptionId } = await readJson(c.req.raw, addSubscriptionSchema, requestLocale(c.req.raw));
    const result = await addSubscriptionToPlan(c.env, auth.user.id, planId, subscriptionId);
    if (!result.ok) return errorResponse(404, result.reason === "plan_not_found" ? "Plan not found" : "Subscription not found", "NOT_FOUND");
    return successJson({ plan: await getCarpoolPlanDetail(c.env, auth.user.id, planId) });
  });

  // 从计划移除一个订阅。
  app.delete("/api/custom/carpool/plans/:planId/subscriptions/:subscriptionId", async (c) => {
    const auth = await requireAuth(c.req.raw, c.env);
    const planId = c.req.param("planId");
    const subscriptionId = c.req.param("subscriptionId");
    if (!planId || !subscriptionId) return errorResponse(400, "Missing id", "INVALID_PAYLOAD");
    if (!(await removeSubscriptionFromPlan(c.env, auth.user.id, planId, subscriptionId))) return errorResponse(404, "Not found", "NOT_FOUND");
    return successJson({ plan: await getCarpoolPlanDetail(c.env, auth.user.id, planId) });
  });

  // ---- 订阅（选择器 + 成员编辑） ----

  // 列出「正在续费」(active) 的订阅，供加入计划时选择。
  app.get("/api/custom/carpool/subscriptions", async (c) => {
    const auth = await requireAuth(c.req.raw, c.env);
    return successJson({ subscriptions: await listActiveSubscriptions(c.env, auth.user.id) });
  });

  // 覆盖式保存一条订阅的拼车成员；写入即与家庭共享同步。
  app.put("/api/custom/carpool/subscriptions/:id/members", async (c) => {
    const auth = await requireAuth(c.req.raw, c.env);
    const subscriptionId = c.req.param("id");
    if (!subscriptionId) return errorResponse(400, "Missing subscription id", "INVALID_PAYLOAD");
    const body = await readJson(c.req.raw, saveMembersSchema, requestLocale(c.req.raw));
    const found = await saveCarpoolMembers(c.env, auth.user.id, subscriptionId, body);
    if (!found) return errorResponse(404, "Subscription not found", "NOT_FOUND");
    return successJson({ ok: true });
  });

  // ---- 拼车专属通知（webhook） ----

  // 读取拼车通知配置。
  app.get("/api/custom/carpool/notification", async (c) => {
    const auth = await requireAuth(c.req.raw, c.env);
    return successJson({ notification: await getCarpoolNotification(c.env, auth.user.id) });
  });

  // 保存拼车通知配置。
  app.put("/api/custom/carpool/notification", async (c) => {
    const auth = await requireAuth(c.req.raw, c.env);
    const config = await readJson(c.req.raw, notificationConfigSchema, requestLocale(c.req.raw));
    await saveCarpoolNotification(c.env, auth.user.id, config);
    return successJson({ notification: config });
  });

  // 用当前表单里的配置发一条测试通知。
  app.post("/api/custom/carpool/notification/test", async (c) => {
    await requireAuth(c.req.raw, c.env);
    const config = await readJson(c.req.raw, notificationConfigSchema, requestLocale(c.req.raw));
    if (!config.webhookUrl.trim()) return errorResponse(400, "请先填写 webhook URL", "INVALID_PAYLOAD");
    try {
      await sendCarpoolTestNotification(c.env, config);
    } catch (error) {
      return errorResponse(502, error instanceof Error ? error.message : "发送失败", "UPSTREAM_FAILED");
    }
    return successJson({ ok: true });
  });
}
