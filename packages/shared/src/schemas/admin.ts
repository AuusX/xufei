import { z } from "zod";
import { okResponseSchema } from "./common";

export const userRoleSchema = z.enum(["user", "admin"]);

export const adminUserSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  email: z.string(),
  role: userRoleSchema,
  banned: z.boolean(),
  banReason: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

export const adminUsersResponseSchema = z.object({
  users: z.array(adminUserSchema),
}).strict();

export const adminUserResponseSchema = z.object({
  user: adminUserSchema,
}).strict();

export const adminPatchUserResponseSchema = okResponseSchema;
export const adminDeleteUserResponseSchema = okResponseSchema;

export const adminCreateUserBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email().max(254),
  password: z.string().min(8).max(72),
  role: userRoleSchema,
}).strict();

export const adminPatchUserBodySchema = z.object({
  role: userRoleSchema.optional(),
  banned: z.boolean().optional(),
  newPassword: z.string().min(8).max(72).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Empty payload");

export type UserRole = z.infer<typeof userRoleSchema>;
export type AdminUser = z.infer<typeof adminUserSchema>;
export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>;
