import { z } from "zod";

export const okResponseSchema = z.object({
  ok: z.literal(true),
}).strict();

export type OkResponse = z.infer<typeof okResponseSchema>;
