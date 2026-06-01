import { apiFetch } from "@/lib/api-client";
import {
  importApplyResponseSchema,
  importPreviewResponseSchema,
  type ImportApplyResponse,
  type ImportConflictMode,
  type ImportPayload,
  type ImportPreviewItem,
  type ImportPreviewResponse,
} from "@/lib/api/schemas/import-export";
import { isCloudflareRuntime } from "./runtime";

const APPLY_CHUNK_SIZE = 200;
const APPLY_CHUNK_THRESHOLD = 400;

export const importExportService = {
  async preview(payload: ImportPayload, conflictMode: ImportConflictMode, skipIndexes: readonly number[] = []): Promise<ImportPreviewResponse> {
    return await apiFetch("/api/app/import/preview", importPreviewResponseSchema, {
      method: "POST",
      body: JSON.stringify({ payload, conflictMode, skipIndexes }),
    });
  },

  async apply(payload: ImportPayload, conflictMode: ImportConflictMode, skipIndexes: readonly number[] = []): Promise<ImportApplyResponse> {
    return await applyImportPayload(payload, conflictMode, skipIndexes);
  },

  async applyChunked(
    payload: ImportPayload,
    conflictMode: ImportConflictMode,
    skipIndexes: readonly number[] = [],
    onProgress?: (done: number, total: number) => void,
  ): Promise<ImportApplyResponse> {
    if (payload.subscriptions.length <= APPLY_CHUNK_THRESHOLD && !isCloudflareRuntime) {
      const result = await applyImportPayload(payload, conflictMode, skipIndexes);
      onProgress?.(payload.subscriptions.length, payload.subscriptions.length);
      return result;
    }

    // Cloudflare D1 batch 有单请求资源限制；大导入顺序切小包，靠 extra.import 幂等键支持失败后重试收敛。
    const chunks = chunkSubscriptions(payload.subscriptions, APPLY_CHUNK_SIZE);
    if (chunks.length === 0) {
      return await applyImportPayload(payload, conflictMode);
    }
    const items: ImportPreviewItem[] = [];
    const summary = { total: 0, creates: 0, replaces: 0, skips: 0, errors: 0, warnings: 0 };
    let done = 0;
    onProgress?.(done, payload.subscriptions.length);

    for (let index = 0; index < chunks.length; index += 1) {
      const offset = index * APPLY_CHUNK_SIZE;
      const chunk = chunks[index] ?? [];
      const chunkPayload: ImportPayload = {
        source: payload.source,
        subscriptions: chunk,
        ...(index === chunks.length - 1 && payload.settings ? { settings: payload.settings } : {}),
        ...(index === chunks.length - 1 && payload.customConfig ? { customConfig: payload.customConfig } : {}),
      };
      const chunkSkipIndexes = skipIndexes
        .filter((itemIndex) => itemIndex >= offset && itemIndex < offset + chunk.length)
        .map((itemIndex) => itemIndex - offset);
      const result = await applyImportPayload(chunkPayload, conflictMode, chunkSkipIndexes);
      summary.total += result.summary.total;
      summary.creates += result.summary.creates;
      summary.replaces += result.summary.replaces;
      summary.skips += result.summary.skips;
      summary.errors += result.summary.errors;
      summary.warnings += result.summary.warnings;
      items.push(...result.items.map((item) => ({ ...item, index: item.index + offset })));
      done += chunkPayload.subscriptions.length;
      onProgress?.(done, payload.subscriptions.length);
    }

    return importApplyResponseSchema.parse({
      ok: true,
      summary,
      items,
      includesSettings: Boolean(payload.settings),
      includesCustomConfig: Boolean(payload.customConfig),
    });
  },
};

async function applyImportPayload(payload: ImportPayload, conflictMode: ImportConflictMode, skipIndexes: readonly number[] = []): Promise<ImportApplyResponse> {
  return await apiFetch("/api/app/import/apply", importApplyResponseSchema, {
    method: "POST",
    body: JSON.stringify({ payload, conflictMode, skipIndexes }),
    timeoutMs: 60_000,
  });
}

function chunkSubscriptions<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
