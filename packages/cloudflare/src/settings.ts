import { customConfigResponseSchema } from "@renewlet/shared/schemas/custom-config";
import { appSettingsSchema, settingsUpdateBodySchema } from "@renewlet/shared/schemas/settings";
import { cleanBuiltInIconSourceSettingsPatch, mergeBuiltInIconSourceSettings } from "@renewlet/shared/built-in-icons";
import { getCustomConfig, getSettings, putCustomConfig, putSettings } from "./db";
import { json, readJson, requestLocale } from "./http";
import { requireAuth } from "./auth";
import type { Env } from "./types";

export async function readSettings(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  return json({ settings: await getSettings(env, auth.user.id) });
}

export async function updateSettings(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const current = await getSettings(env, auth.user.id);
  const patch = await readJson(request, settingsUpdateBodySchema, locale);
  // PATCH 语义由“当前设置 + 局部字段”合成，最终仍过完整 schema，防止删除隐式默认项。
  const next = appSettingsSchema.parse({
    ...current,
    ...patch,
    builtInIconSources: mergeBuiltInIconSourceSettings(current.builtInIconSources, cleanBuiltInIconSourceSettingsPatch(patch.builtInIconSources)),
  });
  return json({ settings: await putSettings(env, auth.user.id, next) });
}

export async function readCustomConfig(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  const config = await getCustomConfig(env, auth.user.id);
  return json(customConfigResponseSchema.parse({ config }));
}

export async function updateCustomConfig(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const body = await readJson(request, customConfigResponseSchema, locale);
  const config = await putCustomConfig(env, auth.user.id, body.config);
  return json(customConfigResponseSchema.parse({ config }));
}
