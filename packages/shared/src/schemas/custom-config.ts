import { z } from "zod";

export const configItemSchema = z.object({
  id: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(80),
  labels: z.object({
    "zh-CN": z.string().trim().min(1).max(80),
    "en-US": z.string().trim().min(1).max(80),
  }),
  color: z.string().trim().max(80).optional(),
  icon: z.string().trim().max(2048).optional(),
  enabled: z.boolean().optional(),
}).strict();

export const customConfigSchema = z.object({
  categories: z.array(configItemSchema).max(200),
  statuses: z.array(configItemSchema).max(50),
  paymentMethods: z.array(configItemSchema).max(200),
  currencies: z.array(configItemSchema).max(300),
}).strict();

export const customConfigResponseSchema = z.object({
  config: customConfigSchema,
}).strict();

export type ApiCustomConfig = z.infer<typeof customConfigSchema>;
