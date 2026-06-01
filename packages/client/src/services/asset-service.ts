import { apiFetch } from "@/lib/api-client";
import { uploadImageResponseSchema, type ApiUploadImageResponse, type UploadKind } from "@/lib/api/schemas/media";
import { getApiLocale } from "@/i18n/api-locale";
import { translate } from "@/i18n/messages";
import { getCurrentUserId, pb, type RecordModel } from "@/lib/pocketbase";
import { isCloudflareRuntime } from "./runtime";
import { z } from "zod";

export interface UploadedAsset {
  id: string;
  url: string;
  kind: "logo";
  originalName?: string | undefined;
  mimeType?: string | undefined;
  sizeBytes?: number | undefined;
  created?: string | undefined;
  updated?: string | undefined;
}

export interface UploadedAssetPage {
  items: UploadedAsset[];
  page: number;
  totalPages: number;
}

const UPLOADED_LOGOS_PAGE_SIZE = 48;
const UPLOADED_LOGOS_FIELDS = "id,kind,originalName,mimeType,sizeBytes,created,updated";
const uploadedAssetPageSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    url: z.string(),
    kind: z.literal("logo"),
    originalName: z.string().optional(),
    mimeType: z.string().optional(),
    sizeBytes: z.number().optional(),
    created: z.string().optional(),
    updated: z.string().optional(),
  }).strict()),
  page: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
}).strict();

function stringField(record: RecordModel, key: string): string | undefined {
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberField(record: RecordModel, key: string): number | undefined {
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeAsset(record: RecordModel): UploadedAsset | null {
  if (!record.id) return null;
  // PocketBase 文件名不直接暴露给 UI；两种运行面都统一走受控 /api/app/assets/{id} 私有读取。
  return {
    id: record.id,
    url: `/api/app/assets/${record.id}`,
    kind: "logo",
    originalName: stringField(record, "originalName"),
    mimeType: stringField(record, "mimeType"),
    sizeBytes: numberField(record, "sizeBytes"),
    created: stringField(record, "created"),
    updated: stringField(record, "updated"),
  };
}

export const assetService = {
  async create(file: Blob, kind: UploadKind, filename: string): Promise<ApiUploadImageResponse> {
    const form = new FormData();
    const userId = getCurrentUserId();
    if (!userId) throw new Error(translate(getApiLocale(), "auth.loginRequired"));
    form.append("kind", kind);
    form.append("file", file, filename);

    if (isCloudflareRuntime) {
      return await apiFetch("/api/app/assets", uploadImageResponseSchema, {
        method: "POST",
        body: form,
        // FormData 必须让浏览器写 multipart boundary；apiFetch 会因此跳过默认 JSON content-type。
        headers: {},
      });
    }

    form.append("user", userId);
    const record = await pb.collection("assets").create<RecordModel>(form);
    const storedFile = typeof record["file"] === "string" ? record["file"] : "";
    if (!storedFile) throw new Error(translate(getApiLocale(), "media.uploadFailed"));
    return { url: `/api/app/assets/${record.id}` };
  },

  async listLogos(page: number): Promise<UploadedAssetPage> {
    if (isCloudflareRuntime) {
      const params = new URLSearchParams({ kind: "logo", page: String(page), perPage: String(UPLOADED_LOGOS_PAGE_SIZE) });
      return await apiFetch(`/api/app/assets?${params.toString()}`, uploadedAssetPageSchema);
    }

    const result = await pb.collection("assets").getList<RecordModel>(page, UPLOADED_LOGOS_PAGE_SIZE, {
      filter: pb.filter("kind = {:kind}", { kind: "logo" }),
      sort: "-updated",
      fields: UPLOADED_LOGOS_FIELDS,
    });
    return {
      items: result.items.map(normalizeAsset).filter((asset): asset is UploadedAsset => asset !== null),
      page: result.page,
      totalPages: result.totalPages,
    };
  },
};
