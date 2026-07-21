/**
 * 拼车 API 路由（`/api/custom/carpool/*`）。
 *
 * 架构位置：这是一个独立 Hono app，由 `../entry.ts` 在命中 `/api/custom/*` 时接管；其余请求仍走上游 worker。
 * 复用上游 `requireAuth` 鉴权、`http.ts` 响应助手与错误 envelope，不修改任何上游文件。
 */
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../../auth";
import { errorResponse, readJson, requestLocale, successJson, toResponse } from "../../http";
import type { Env } from "../../types";
import { listCarpoolSubscriptions, saveCarpoolMembers } from "./store";

type CarpoolBindings = { Bindings: Env };

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

export const carpoolApp = new Hono<CarpoolBindings>();

// 与上游 index.ts 同款：未进入业务 handler 的错误也经过统一 envelope。
carpoolApp.onError((error, c) => toResponse(error, requestLocale(c.req.raw)));

/** 列出「正在续费」(active) 的订阅及其拼车成员（含金额、上车/到期时间）。 */
carpoolApp.get("/api/custom/carpool/subscriptions", async (c) => {
  const auth = await requireAuth(c.req.raw, c.env);
  const subscriptions = await listCarpoolSubscriptions(c.env, auth.user.id);
  return successJson({ subscriptions });
});

/** 覆盖式保存一条订阅的拼车成员；写入即与家庭共享同步。 */
carpoolApp.put("/api/custom/carpool/subscriptions/:id/members", async (c) => {
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

// 命中 /api/custom/* 但无匹配拼车路由时，返回结构化 404 而不是 Hono 默认纯文本。
carpoolApp.all("/api/custom/*", (c) => errorResponse(404, "Not found", "NOT_FOUND"));

export default carpoolApp;
