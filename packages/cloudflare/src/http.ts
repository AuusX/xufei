import { z } from "zod";

export type AppLocale = "zh-CN" | "en-US";

const JSON_LIMIT_BYTES = 1 << 20;

export function requestLocale(request: Request): AppLocale {
  const explicit = request.headers.get("x-renewlet-locale") ?? request.headers.get("accept-language") ?? "";
  return explicit.toLowerCase().includes("en") ? "en-US" : "zh-CN";
}

export function tr(locale: AppLocale, zh: string, en: string): string {
  return locale === "en-US" ? en : zh;
}

export function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(value), { ...init, headers });
}

export function ok(status = 200): Response {
  return json({ ok: true }, { status });
}

export function errorResponse(status: number, message: string, code?: string, details?: unknown): Response {
  return json({ message, ...(code ? { code } : {}), ...(details === undefined ? {} : { details }) }, { status });
}

export function methodNotAllowed(): Response {
  return errorResponse(405, "Method not allowed", "METHOD_NOT_ALLOWED");
}

export function privateShortCache(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, max-age=300");
  headers.set("vary", "Authorization");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

export function pathSegments(url: URL, prefix = "/api/app"): string[] {
  const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname;
  return path.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
}

export async function readJson<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
  locale: AppLocale,
): Promise<z.infer<Schema>> {
  return readJsonWithLimit(request, schema, locale, JSON_LIMIT_BYTES);
}

export async function readJsonWithLimit<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
  locale: AppLocale,
  limitBytes: number,
): Promise<z.infer<Schema>> {
  const text = await readLimitedTextWithLimit(request, locale, false, limitBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, tr(locale, "请求体无效", "Invalid request body"), "INVALID_JSON");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    // Worker API 与 Go API 一样拒绝脏 payload；前端表单错误需要 details.flatten 定位字段。
    throw new HttpError(400, tr(locale, "请求参数无效", "Invalid request parameters"), "INVALID_PAYLOAD", result.error.flatten());
  }
  return result.data;
}

export async function readOptionalJson<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
  locale: AppLocale,
): Promise<z.infer<Schema>> {
  const text = await readLimitedText(request, locale, true);
  if (!text) return schema.parse({});
  return readJson(new Request(request.url, { method: request.method, body: text }), schema, locale);
}

async function readLimitedText(request: Request, locale: AppLocale, allowEmpty: boolean): Promise<string> {
  return readLimitedTextWithLimit(request, locale, allowEmpty, JSON_LIMIT_BYTES);
}

async function readLimitedTextWithLimit(request: Request, locale: AppLocale, allowEmpty: boolean, limitBytes: number): Promise<string> {
  const text = await request.text();
  if (!allowEmpty && text.trim() === "") {
    throw new HttpError(400, tr(locale, "请求体无效", "Invalid request body"), "EMPTY_BODY");
  }
  if (new TextEncoder().encode(text).byteLength > limitBytes) {
    // Workers 会先把 body 读进内存；这里给 JSON API 一道固定上限，避免配置导入类请求撑爆运行时。
    throw new HttpError(413, tr(locale, "请求体过大", "Request body is too large"), "BODY_TOO_LARGE");
  }
  return text;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function toResponse(error: unknown): Response {
  if (error instanceof HttpError) return errorResponse(error.status, error.message, error.code, error.details);
  const message = error instanceof Error ? error.message : "Internal server error";
  return errorResponse(500, message || "Internal server error", "INTERNAL_ERROR");
}
