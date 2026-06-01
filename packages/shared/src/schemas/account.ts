import { z } from "zod";

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: z.string().min(8).max(72),
}).strict();

export const requestPasswordResetBodySchema = z.object({
  email: z.email().max(254),
}).strict();

export const confirmPasswordResetBodySchema = z.object({
  token: z.string().trim().min(1).max(256),
  newPassword: z.string().min(8).max(72),
}).strict();
