import { defineConfig } from "@lingui/conf";

const catalogDomains = [
  "common",
  "legal",
  "custom-config",
  "subscription",
  "auth",
  "settings",
  "notification",
  "labels",
  "admin",
  "error",
] as const;

export default defineConfig({
  locales: ["zh-CN", "en-US"],
  sourceLocale: "zh-CN",
  catalogs: catalogDomains.map((domain) => ({
    path: `src/i18n/catalogs/{locale}/${domain}`,
    include: [`src/i18n/descriptors/${domain}.ts`],
  })),
});
