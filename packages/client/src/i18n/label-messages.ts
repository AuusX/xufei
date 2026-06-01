import { SUPPORTED_LOCALES, type LocalizedLabels } from "@/i18n/locales";
import { staticCatalogMessage, type MessageKey } from "@/i18n/static-catalogs";

export function labelsFromCatalog(key: MessageKey): LocalizedLabels {
  return Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [locale, staticCatalogMessage(locale, key)]),
  ) as LocalizedLabels;
}
