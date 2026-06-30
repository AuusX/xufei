/**
 * locale 基础规则。
 *
 * 架构位置：集中定义支持语言、浏览器探测、显式语言偏好和双语 label 读取，
 * Provider 与后端 locale 解析需要保持同一支持集合。
 *
 * 注意： 新增语言时必须同步 Lingui catalog、Go/Cloudflare locale 支持和 Accept-Language 解析测试。
 */
export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export type LocalizedLabels = Record<Locale, string>;

export const EXPLICIT_LOCALE_PREFERENCE_KEY = "renewlet_locale_preference";

export const DEFAULT_LOCALE: Locale = "en-US";

export function isLocale(value: unknown): value is Locale {
  return value === "zh-CN" || value === "en-US";
}

export function normalizeLocale(value: unknown): Locale {
  if (isLocale(value)) return value;
  if (typeof value !== "string") return DEFAULT_LOCALE;
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized.startsWith("en")) return "en-US";
  return DEFAULT_LOCALE;
}

export function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const language of languages) {
    if (language?.toLowerCase().startsWith("zh")) return "zh-CN";
    if (language?.toLowerCase().startsWith("en")) return "en-US";
  }
  return "en-US";
}

export function readExplicitLocalePreference(): Locale | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = localStorage.getItem(EXPLICIT_LOCALE_PREFERENCE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeExplicitLocalePreference(locale: Locale) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(EXPLICIT_LOCALE_PREFERENCE_KEY, locale);
  } catch {
    // 显式偏好只是首屏缓存；存储失败时仍以内存和远端 settings 为准。
  }
}

export function getInitialLocale(): Locale {
  return readExplicitLocalePreference() ?? detectBrowserLocale();
}

export function labels(zhCN: string, enUS: string): LocalizedLabels {
  return { "zh-CN": zhCN, "en-US": enUS };
}

export function localizedLabel(source: LocalizedLabels, locale: Locale): string {
  const value = source[locale];
  if (!value) {
    throw new Error(`Missing localized label for ${locale}`);
  }
  return value;
}
