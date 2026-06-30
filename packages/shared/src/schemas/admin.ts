import { z } from "zod";
import { authenticatorMfaMethodSchema } from "./auth";
import { okResponseSchema } from "./common";
import { apiSuccessResponseSchema } from "./api";

/**
 * 管理员角色枚举。
 *
 * 这是防自锁逻辑和 Cloudflare/Go 用户管理 API 的共同权限边界；新增角色必须同步 route 守卫。
 */
export const userRoleSchema = z.enum(["user", "admin"]);

/**
 * 管理员用户列表中的安全视图。
 *
 * 响应只暴露管理所需字段，不能把 password hash、reset token 或 session 信息扩进这个契约。
 */
export const adminUserSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  email: z.string(),
  role: userRoleSchema,
  banned: z.boolean(),
  // 管理员列表只暴露可用二因素方法和数量，不返回任何 credential、challenge 或恢复码 hash。
  mfaEnabled: z.boolean(),
  mfaMethods: z.array(authenticatorMfaMethodSchema),
  passkeysEnabled: z.boolean(),
  passkeyCount: z.number().int().min(0),
  banReason: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

export const adminUsersPayloadSchema = z.object({
  users: z.array(adminUserSchema),
}).strict();
export const adminUsersResponseSchema = apiSuccessResponseSchema(adminUsersPayloadSchema);

export const adminUserPayloadSchema = z.object({
  user: adminUserSchema,
}).strict();
export const adminUserResponseSchema = apiSuccessResponseSchema(adminUserPayloadSchema);

export const adminPatchUserResponseSchema = okResponseSchema;
export const adminDeleteUserResponseSchema = okResponseSchema;
export const adminResetUserMfaResponseSchema = okResponseSchema;
export const adminResetUserPasskeysResponseSchema = okResponseSchema;

/**
 * 管理员创建用户请求契约。
 *
 * Renewlet 不开放自助注册；账号创建始终挂在管理员 API 下，避免首装入口和用户管理入口混用。
 */
export const adminCreateUserBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email().max(254),
  password: z.string().min(8).max(72),
  role: userRoleSchema,
}).strict();

/**
 * 管理员局部更新用户请求契约。
 *
 * 空 patch 被拒绝，是为了把前端状态机误触发暴露为边界错误，而不是生成无意义审计操作。
 * newPassword 只表示管理员重置他人账号；当前用户修改自己的密码必须走 account schema。
 */
export const adminPatchUserBodySchema = z.object({
  role: userRoleSchema.optional(),
  banned: z.boolean().optional(),
  newPassword: z.string().min(8).max(72).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Empty payload");

export type UserRole = z.infer<typeof userRoleSchema>;
export type AdminUser = z.infer<typeof adminUserSchema>;
export type AdminUsersResponse = z.infer<typeof adminUsersPayloadSchema>;
