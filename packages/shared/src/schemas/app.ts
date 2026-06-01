import { z } from "zod";
import { okResponseSchema } from "./common";

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  time: z.string().min(1),
}).strict();

export const setupStatusResponseSchema = z.object({
  setupRequired: z.boolean(),
  setupEnabled: z.boolean(),
}).strict();

export const setupCreateResponseSchema = okResponseSchema;

export const passwordResetStatusResponseSchema = z.object({
  enabled: z.boolean(),
}).strict();

export type SetupStatusResponse = z.infer<typeof setupStatusResponseSchema>;
export type PasswordResetStatusResponse = z.infer<typeof passwordResetStatusResponseSchema>;
