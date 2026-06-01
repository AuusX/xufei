/**
 * Lingui catalog 入口。
 *
 * 架构位置：本文件是前端唯一翻译引擎边界，业务代码继续通过 `t/translate`
 * 读取文案，但底层不再维护自研函数 map。
 */
import { setupI18n, type I18n, type Messages } from "@lingui/core";
import type { Locale } from "@/i18n/locales";
import { DEFAULT_LOCALE } from "@/i18n/locales";
import {
  getStaticCatalog,
  STATIC_CATALOGS,
  translateStaticMessage,
  type MessageKey,
  type MessageParams,
} from "@/i18n/static-catalogs";

export type { MessageKey, MessageParams } from "@/i18n/static-catalogs";

type CatalogModule = {
  messages: Messages;
};

type DomainCatalogModules = Record<string, CatalogModule>;

function mergeDomainCatalogs(modules: DomainCatalogModules): Messages {
  const messages: Messages = {};
  for (const module of Object.values(modules)) {
    for (const [key, value] of Object.entries(module.messages)) {
      messages[key] = value;
    }
  }
  return messages;
}

const zhCNCatalogs = import.meta.glob<CatalogModule>("./catalogs/zh-CN/*.po", {
  eager: true,
});
const enUSCatalogs = import.meta.glob<CatalogModule>("./catalogs/en-US/*.po", {
  eager: true,
});

const catalogLoaders = {
  "zh-CN": async () => ({ messages: mergeDomainCatalogs(zhCNCatalogs) }),
  "en-US": async () => ({ messages: mergeDomainCatalogs(enUSCatalogs) }),
} satisfies Record<Locale, () => Promise<CatalogModule>>;

const defaultMessages = getStaticCatalog(DEFAULT_LOCALE);
const loadedCatalogs = new Map<Locale, Messages>([[DEFAULT_LOCALE, defaultMessages]]);
const localeI18nCache = new Map<Locale, I18n>();

function createMissingHandler(locale: string, id: string) {
  if (import.meta.env.DEV) {
    console.warn(`[i18n] missing message "${id}" for ${locale}`);
  }
  return id;
}

function createLocaleI18n(locale: Locale, messages: Messages) {
  return setupI18n({
    locale,
    messages: { [locale]: messages },
    missing: createMissingHandler,
  });
}

localeI18nCache.set(DEFAULT_LOCALE, createLocaleI18n(DEFAULT_LOCALE, defaultMessages));

export const linguiI18n = setupI18n({
  locale: DEFAULT_LOCALE,
  messages: { [DEFAULT_LOCALE]: defaultMessages },
  missing: createMissingHandler,
});

export function isLocaleCatalogLoaded(locale: Locale) {
  return loadedCatalogs.has(locale);
}

export async function loadLocaleCatalog(locale: Locale): Promise<Messages> {
  const loaded = loadedCatalogs.get(locale);
  if (loaded) return loaded;
  // 生产构建必须消费 Vite Lingui 插件预编译后的 `.po` catalog；不要恢复 raw TS catalog 或 runtime compiler。
  const module = await catalogLoaders[locale]();
  loadedCatalogs.set(locale, module.messages);
  localeI18nCache.set(locale, createLocaleI18n(locale, module.messages));
  return module.messages;
}

export async function activateLinguiLocale(locale: Locale) {
  const messages = await loadLocaleCatalog(locale);
  // 只激活当前 UI locale；同步 translate 使用独立实例，避免后台格式化偷偷切换全局 React 语言。
  linguiI18n.loadAndActivate({ locale, messages });
}

export function translate(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  const instance = localeI18nCache.get(locale);
  return instance ? instance._(key, params) : translateStaticMessage(locale, key, params);
}
