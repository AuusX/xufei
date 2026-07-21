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
import { listCarpoolSubscriptions, saveCarpoolMembers } from "./store";

// 与上游 index.ts 的 AppBindings 保持一致，这样 registerCarpoolRoutes(app) 能直接接收上游的 app。
type AppBindings = { Bindings: Env; Variables: { locale: AppLocale } };

const memberInputSchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    name: z.string().trim().min(1).max(100),
    note: z.string().trim().max(500).optional(),
    customAmount: z.number().finite().nonnegative().optional(),
    joinDate: z.string().max(32).optional(),
    expiryDate: z.string().max(32).optional(),
  })
  .strict();

const saveMembersSchema = z
  .object({
    enabled: z.boolean(),
    splitMode: z.enum(["equal", "custom"]),
    members: z.array(memberInputSchema).max(50),
  })
  .strict();

/** 把拼车路由登记到上游 app 上；被 index.ts 的补丁调用。 */
export function registerCarpoolRoutes(app: Hono<AppBindings>): void {
  // 列出「正在续费」(active) 的订阅及其拼车成员（含金额、上车/到期时间）。
  app.get("/api/custom/carpool/subscriptions", async (c) => {
    const auth = await requireAuth(c.req.raw, c.env);
    const subscriptions = await listCarpoolSubscriptions(c.env, auth.user.id);
    return successJson({ subscriptions });
  });

  // 覆盖式保存一条订阅的拼车成员；写入即与家庭共享同步。
  app.put("/api/custom/carpool/subscriptions/:id/members", async (c) => {
    const auth = await requireAuth(c.req.raw, c.env);
    const locale = requestLocale(c.req.raw);
    const subscriptionId = c.req.param("id");
    if (!subscriptionId) return errorResponse(400, "Missing subscription id", "INVALID_PAYLOAD");
    const body = await readJson(c.req.raw, saveMembersSchema, locale);
    const found = await saveCarpoolMembers(c.env, auth.user.id, subscriptionId, body);
    if (!found) return errorResponse(404, "Subscription not found", "NOT_FOUND");
    const subscriptions = await listCarpoolSubscriptions(c.env, auth.user.id);
    return successJson({ subscription: subscriptions.find((item) => item.id === subscriptionId) ?? null });
  });
}
