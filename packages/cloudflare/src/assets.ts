import { uploadKindSchema } from "@renewlet/shared/schemas/media";
import { getAsset, listAssets, newId, nowIso } from "./db";
import { HttpError, json, requestLocale, tr } from "./http";
import { requireAuth } from "./auth";
import type { AssetRow, Env } from "./types";

const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon"]);

export async function uploadAsset(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const form = await request.formData();
  const kind = uploadKindSchema.parse(form.get("kind"));
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, tr(locale, "请选择要上传的图片", "Choose an image to upload"));
  if (file.size <= 0 || file.size > MAX_ASSET_BYTES) {
    throw new HttpError(400, tr(locale, "图片大小无效", "Invalid image size"));
  }
  const contentType = normalizeContentType(file.type, file.name);
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new HttpError(400, tr(locale, "图片类型无效", "Invalid image type"));
  }

  // R2 key 带 userId，不靠文件名隔离；D1 元数据仍是权限判断的真相来源。
  const timestamp = nowIso();
  const id = newId("ast");
  const key = `${auth.user.id}/${kind}/${id}/${sanitizeFilename(file.name)}`;
  await env.ASSETS_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType },
    customMetadata: { userId: auth.user.id, kind },
  });
  await env.DB.prepare(`
    INSERT INTO assets (id, user_id, kind, r2_key, original_name, mime_type, size_bytes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, auth.user.id, kind, key, file.name, contentType, file.size, timestamp, timestamp).run();

  return json({ url: `/api/app/assets/${id}` }, { status: 201 });
}

export async function readAsset(request: Request, env: Env, id: string): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  // 先按 owner 查 D1，再取 R2；不能让可猜测的 R2 key 绕过私有资产语义。
  const row = await getAsset(env, auth.user.id, id);
  if (!row) throw new HttpError(404, tr(locale, "资产不存在", "Asset not found"));
  const object = await env.ASSETS_BUCKET.get(row.r2_key);
  if (!object) throw new HttpError(404, tr(locale, "资产文件不存在", "Asset file not found"));

  const contentType = row.mime_type || object.httpMetadata?.contentType || "application/octet-stream";
  const headers = new Headers();
  headers.set("content-type", contentType);
  headers.set("cache-control", "private, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  if (contentType.split(";")[0]?.trim().toLowerCase() === "image/svg+xml") {
    // 用户上传 SVG 允许保留矢量展示，但必须压成无脚本沙箱，避免 Logo 变成 XSS 入口。
    headers.set("content-security-policy", "default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; style-src 'unsafe-inline'; sandbox");
  }
  if (row.size_bytes !== null) headers.set("content-length", String(row.size_bytes));
  return new Response(object.body, { headers });
}

export async function listUploadedAssets(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "icon" ? "icon" : "logo";
  const page = positiveInt(url.searchParams.get("page"), 1);
  const perPage = clamp(positiveInt(url.searchParams.get("perPage"), 48), 1, 96);
  const result = await listAssets(env, auth.user.id, kind, page, perPage);
  return json({
    items: result.items.map(toAssetItem),
    page,
    totalPages: Math.ceil(result.total / perPage),
  });
}

function toAssetItem(row: AssetRow) {
  return {
    id: row.id,
    url: `/api/app/assets/${row.id}`,
    kind: row.kind,
    ...(row.original_name ? { originalName: row.original_name } : {}),
    ...(row.mime_type ? { mimeType: row.mime_type } : {}),
    ...(row.size_bytes === null ? {} : { sizeBytes: row.size_bytes }),
    created: row.created_at,
    updated: row.updated_at,
  };
}

function normalizeContentType(type: string, name: string): string {
  const lower = type.toLowerCase().trim();
  if (lower) return lower === "image/vnd.microsoft.icon" ? "image/x-icon" : lower;
  // 部分浏览器/移动端相册不给 File.type；这里按扩展名只做体验兜底，安全白名单仍在上层执行。
  const filename = name.toLowerCase();
  if (filename.endsWith(".svg")) return "image/svg+xml";
  if (filename.endsWith(".ico")) return "image/x-icon";
  if (filename.endsWith(".webp")) return "image/webp";
  if (filename.endsWith(".gif")) return "image/gif";
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "image/jpeg";
  return "image/png";
}

function sanitizeFilename(name: string): string {
  const cleaned = name.trim().replaceAll(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  return cleaned || "upload.bin";
}

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
