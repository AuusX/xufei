import { z } from "zod";
import { settingsUpdateBodySchema } from "./settings";
import { customConfigSchema } from "./custom-config";
import { apiSubscriptionSchema, subscriptionCreateBodySchema } from "./subscriptions";

export const importConflictModeSchema = z.enum(["replace", "skip"]);
export type ImportConflictMode = z.infer<typeof importConflictModeSchema>;

export const importSourceSchema = z.enum(["renewlet", "wallos"]);
export type ImportSource = z.infer<typeof importSourceSchema>;

export const importConfidenceSchema = z.enum(["high", "low"]);
export type ImportConfidence = z.infer<typeof importConfidenceSchema>;

export const importKeySchema = z.object({
  source: importSourceSchema,
  sourceId: z.string().trim().min(1).max(256),
  confidence: importConfidenceSchema.optional(),
}).strict();

const importExtraSchema = z.object({
  // import 是跨 Docker/PocketBase 与 Cloudflare/D1 的幂等键；导入 API 依赖它判断 replace/skip。
  import: importKeySchema,
}).catchall(z.unknown());

export const importSubscriptionSchema = subscriptionCreateBodySchema.extend({
  extra: importExtraSchema,
}).strict();
export type ImportSubscription = z.infer<typeof importSubscriptionSchema>;

export const importPayloadSchema = z.object({
  source: importSourceSchema,
  subscriptions: z.array(importSubscriptionSchema).max(5000),
  settings: settingsUpdateBodySchema.optional(),
  customConfig: customConfigSchema.optional(),
}).strict();
export type ImportPayload = z.infer<typeof importPayloadSchema>;

export const importSkipIndexesSchema = z.array(z.number().int().nonnegative()).max(5000);

export const importPreviewRequestSchema = z.object({
  payload: importPayloadSchema,
  conflictMode: importConflictModeSchema.default("skip"),
  // skipIndexes 是预览与执行共享的“单条排除”契约；服务端仍会按当前用户重新预览，不能信任前端 action。
  skipIndexes: importSkipIndexesSchema.default([]),
}).strict();
export type ImportPreviewRequest = z.infer<typeof importPreviewRequestSchema>;

export const importApplyRequestSchema = z.object({
  payload: importPayloadSchema,
  conflictMode: importConflictModeSchema,
  skipIndexes: importSkipIndexesSchema.default([]),
}).strict();
export type ImportApplyRequest = z.infer<typeof importApplyRequestSchema>;

export const importItemActionSchema = z.enum(["create", "replace", "skip", "error"]);
export type ImportItemAction = z.infer<typeof importItemActionSchema>;

export const importPreviewItemSchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string(),
  source: importSourceSchema,
  sourceId: z.string(),
  existingId: z.string().optional(),
  action: importItemActionSchema,
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
}).strict();
export type ImportPreviewItem = z.infer<typeof importPreviewItemSchema>;

export const importSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  creates: z.number().int().nonnegative(),
  replaces: z.number().int().nonnegative(),
  skips: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
}).strict();
export type ImportSummary = z.infer<typeof importSummarySchema>;

export const importPreviewResponseSchema = z.object({
  summary: importSummarySchema,
  items: z.array(importPreviewItemSchema),
  includesSettings: z.boolean(),
  includesCustomConfig: z.boolean(),
}).strict();
export type ImportPreviewResponse = z.infer<typeof importPreviewResponseSchema>;

export const importApplyResponseSchema = importPreviewResponseSchema.extend({
  ok: z.literal(true),
}).strict();
export type ImportApplyResponse = z.infer<typeof importApplyResponseSchema>;

const exportAssetSchema = z.object({
  id: z.string(),
  path: z.string(),
  originalName: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
}).strict();
export type RenewletExportAsset = z.infer<typeof exportAssetSchema>;

export const renewletExportV1Schema = z.object({
  kind: z.literal("renewlet-export"),
  schemaVersion: z.literal(1),
  exportedAt: z.string(),
  data: z.object({
    subscriptions: z.array(apiSubscriptionSchema),
    settings: settingsUpdateBodySchema.optional(),
    customConfig: customConfigSchema.optional(),
    assets: z.array(exportAssetSchema).optional(),
  }).strict(),
}).strict();
export type RenewletExportV1 = z.infer<typeof renewletExportV1Schema>;
