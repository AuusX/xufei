import { SUPPORTED_LOCALES, type LocalizedLabels } from "@/i18n/locales";
import { staticCatalogMessage, type MessageKey } from "@/i18n/static-catalogs";

/**
 * labelsFromCatalog 将产品内置标签从 Lingui catalog 固化成 LocalizedLabels。
 *
 * 只有产品预置选项走这里；用户自定义配置和导入来源原文仍保留持久化 labels() 数据形状。
 */
export function labelsFromCatalog(key: MessageKey): LocalizedLabels {
  return Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [locale, staticCatalogMessage(locale, key)]),
  ) as LocalizedLabels;
}
