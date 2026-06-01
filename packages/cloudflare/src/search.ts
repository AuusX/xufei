import {
  clampMediaCandidateLimit,
  createMediaResolver,
  resolveMediaCandidateItem,
  type BuiltInIcon,
} from "@renewlet/shared/media-resolver";
import { mediaResolverConfig } from "@renewlet/shared/media-resolver-config";
import {
  mediaCandidateResolveRequestSchema,
  mediaCandidateResolveResponseSchema,
} from "@renewlet/shared/schemas/media";
import builtInIconsIndex from "../../client/src/lib/built-in-icons-index.json";
import { getSettings } from "./db";
import { json, privateShortCache, readJson, requestLocale, tr } from "./http";
import { requireAuth } from "./auth";
import type { Env } from "./types";

const builtInResolver = createMediaResolver(builtInIconsIndex as BuiltInIcon[], mediaResolverConfig);
const mediaRateLimitData = new Map<string, { count: number; resetAt: number }>();

export async function mediaCandidates(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  const locale = requestLocale(request);
  const retryAfter = checkMediaCandidateRateLimit(auth.user.id, request);
  if (retryAfter > 0) {
    return json({
      code: "RATE_LIMITED",
      message: tr(locale, "请求过于频繁，请稍后再试", "Too many requests. Please try again later"),
    }, { status: 429, headers: { "retry-after": String(retryAfter) } });
  }
  const body = await readJson(request, mediaCandidateResolveRequestSchema, locale);
  const settings = await getSettings(env, auth.user.id);
  const limit = clampMediaCandidateLimit(mediaResolverConfig, body.limit);
  const items = body.items.map((item) => resolveMediaCandidateItem(
    builtInResolver,
    body.kind,
    body.mode,
    item,
    limit,
    { sources: settings.builtInIconSources },
  ));
  // Worker 只做运行面边界；候选生成和来源过滤规则在 shared resolver 中，响应再经 Zod 校验防止两端契约漂移。
  return privateShortCache(json(mediaCandidateResolveResponseSchema.parse({ items })));
}

function checkMediaCandidateRateLimit(userId: string, request: Request): number {
  const key = `${userId}:${clientIP(request)}`;
  const now = Date.now();
  const bucket = mediaRateLimitData.get(key);
  if (!bucket || now > bucket.resetAt) {
    mediaRateLimitData.set(key, {
      count: 1,
      resetAt: now + mediaResolverConfig.rateLimit.defaultWindowMs,
    });
    return 0;
  }
  if (bucket.count >= mediaResolverConfig.rateLimit.defaultMaxRequests) {
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  }
  bucket.count += 1;
  mediaRateLimitData.set(key, bucket);
  return 0;
}

function clientIP(request: Request): string {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}
