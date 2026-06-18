import { z } from "zod";

/** 登录态用户安全视图；密码 hash、reset token 和 session 元数据不能进入前端。 */
export interface AuthUserResponse {
  id: string;
  email: string;
  name: string;
  role: string;
  banned: boolean;
}

export interface SessionResponse {
  // session.id 对前端是 Bearer token，不是数据库 session row id；两种运行面都遵守这个形状。
  session: { id: string };
  user: AuthUserResponse;
}

// 显式接口 + ZodType 让前端/Worker 共用契约，同时避免 type-aware ESLint 把跨包 z.infer 推成 error typed。
export const authUserSchema: z.ZodType<AuthUserResponse> = z.object({
  id: z.string().min(1),
  email: z.string(),
  name: z.string(),
  role: z.string(),
  banned: z.boolean(),
}).strict();

export const sessionResponseSchema: z.ZodType<SessionResponse> = z.object({
  session: z.object({ id: z.string().min(1) }).strict(),
  user: authUserSchema,
}).strict();

/** 首装创建管理员只能在后端再次确认 setup 可用时生效；schema 只负责请求形状和密码上限。 */
export const setupCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email().max(254),
  password: z.string().min(8).max(72),
}).strict();

/** 登录请求不接受额外字段；Cloudflare/Go 都应只按 email+password 建立会话。 */
export const loginBodySchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(72),
}).strict();
