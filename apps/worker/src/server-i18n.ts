import {
  DEFAULT_SERVER_I18N_LOCALE,
  SERVER_I18N_CATALOGS,
  SERVER_I18N_LOCALES,
  type ServerI18nCatalog,
  type ServerI18nKey,
  type ServerI18nLocale,
} from "./server-i18n-catalog";

export type AppLocale = ServerI18nLocale;
export { DEFAULT_SERVER_I18N_LOCALE };

/**
 * Worker 服务端文案使用生成 catalog，而不是复用前端 Lingui runtime。
 *
 * 这样 API 错误、Cron 和通知日志在无浏览器环境中也能稳定本地化，同时只向前端暴露稳定错误 code。
 */

const localeLookup = new Map<string, AppLocale>();
for (const locale of SERVER_I18N_LOCALES) {
  const normalized = normalizeLocaleTag(locale);
  localeLookup.set(normalized, locale);
  if (locale !== DEFAULT_SERVER_I18N_LOCALE) {
    // 只给非默认语言注册主语言别名，避免默认语言抢走未来独立 catalog。
    localeLookup.set(normalized.split("-")[0] ?? normalized, locale);
  }
}

function normalizeLocaleTag(value: string): string {
  return value.trim().replaceAll("_", "-").toLowerCase();
}

function matchServerLocale(value: string | null | undefined): AppLocale | null {
  const normalized = normalizeLocaleTag(value ?? "");
  if (!normalized) return null;
  const direct = localeLookup.get(normalized);
  if (direct) return direct;
  const language = normalized.split("-")[0] ?? normalized;
  return localeLookup.get(language) ?? null;
}

export function normalizeServerLocale(value: string | null | undefined): AppLocale {
  return matchServerLocale(value) ?? DEFAULT_SERVER_I18N_LOCALE;
}

/** requestLocale 优先读取前端随用户设置发送的显式 locale header。 */
export function requestLocale(request: Request): AppLocale {
  const explicit = request.headers.get("x-renewlet-locale");
  if (explicit?.trim()) {
    // 显式 header 来自用户设置，比浏览器语言更可信；非法值只回默认语言，不再被 Accept-Language 反向覆盖。
    return matchServerLocale(explicit) ?? DEFAULT_SERVER_I18N_LOCALE;
  }
  // Accept-Language 只是无显式设置时的兜底；用户设置页语言仍由 X-Renewlet-Locale 锁定。
  const accepted = (request.headers.get("accept-language") ?? "")
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const qValue = params.map((item) => item.trim()).find((item) => item.startsWith("q="))?.slice(2);
      return { tag: tag.trim(), q: qValue === undefined ? 1 : Number.parseFloat(qValue), index };
    })
    .filter((item) => item.tag && Number.isFinite(item.q) && item.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of accepted) {
    const matched = matchServerLocale(tag);
    if (matched) return matched;
  }
  return DEFAULT_SERVER_I18N_LOCALE;
}

/** serverText 返回服务端 catalog 文案；缺 key 时回 key，便于测试发现 catalog 漂移。 */
export function serverText(locale: AppLocale, key: ServerI18nKey): string {
  const catalogs = SERVER_I18N_CATALOGS as Record<AppLocale, ServerI18nCatalog>;
  return catalogs[locale]?.[key] ?? catalogs[DEFAULT_SERVER_I18N_LOCALE][key] ?? key;
}

/** serverFormat 只做服务端错误/通知所需的命名占位替换，不引入前端 i18n runtime。 */
export function serverFormat(locale: AppLocale, key: ServerI18nKey, params: Record<string, string | number>): string {
  return serverText(locale, key).replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
