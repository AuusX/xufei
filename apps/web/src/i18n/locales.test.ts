// locale 测试保护浏览器探测、显式偏好和 LocalizedLabels 读取，新增语言时这里应同步扩展。
import { afterEach, describe, expect, it } from "vitest";
import {
  EXPLICIT_LOCALE_PREFERENCE_KEY,
  detectBrowserLocale,
  getInitialLocale,
  normalizeLocale,
  readExplicitLocalePreference,
  writeExplicitLocalePreference,
} from "./locales";
import { pb } from "@/lib/pocketbase";
import { setApiLocale } from "./api-locale";

let restoreNavigator: (() => void) | null = null;

function stubNavigatorLanguages(languages: string[], language = languages[0] ?? "") {
  restoreNavigator?.();
  const original = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { languages, language },
  });
  restoreNavigator = () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: original,
    });
    restoreNavigator = null;
  };
}

afterEach(() => {
  restoreNavigator?.();
});

describe("locales", () => {
  it("normalizes supported language tags", () => {
    expect(normalizeLocale("zh")).toBe("zh-CN");
    expect(normalizeLocale("zh-Hant-HK")).toBe("zh-CN");
    expect(normalizeLocale("en-GB")).toBe("en-US");
    expect(normalizeLocale("fr-FR")).toBe("en-US");
  });

  it("detects Chinese browser locale before falling back to English", () => {
    localStorage.clear();
    stubNavigatorLanguages(["zh-Hant-HK", "en-US"], "en-US");

    expect(detectBrowserLocale()).toBe("zh-CN");
    expect(getInitialLocale()).toBe("zh-CN");
  });

  it("detects English browser locale from navigator languages", () => {
    localStorage.clear();
    stubNavigatorLanguages(["en-GB", "zh-CN"], "zh-CN");

    expect(detectBrowserLocale()).toBe("en-US");
  });

  it("falls back to English for unknown browser languages", () => {
    localStorage.clear();
    stubNavigatorLanguages(["fr-FR", "ja-JP"], "fr-FR");

    expect(detectBrowserLocale()).toBe("en-US");
    expect(getInitialLocale()).toBe("en-US");
  });

  it("ignores the retired renewlet_locale key", () => {
    localStorage.clear();
    localStorage.setItem("renewlet_locale", "zh-CN");
    stubNavigatorLanguages(["en-US"]);

    expect(readExplicitLocalePreference()).toBeNull();
    expect(getInitialLocale()).toBe("en-US");
  });

  it("uses and writes only the explicit locale preference key", () => {
    localStorage.clear();
    localStorage.setItem(EXPLICIT_LOCALE_PREFERENCE_KEY, "zh-CN");
    stubNavigatorLanguages(["en-US"]);

    expect(readExplicitLocalePreference()).toBe("zh-CN");
    expect(getInitialLocale()).toBe("zh-CN");

    writeExplicitLocalePreference("en-US");

    expect(localStorage.getItem(EXPLICIT_LOCALE_PREFERENCE_KEY)).toBe("en-US");
    expect(localStorage.getItem("renewlet_locale")).toBeNull();
  });
});

describe("PocketBase locale headers", () => {
  it("keeps headers as a plain object so the SDK can serialize JSON bodies", async () => {
    setApiLocale("en-US");

    const result = await pb.beforeSend?.("/api/example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { ok: true },
    });

    expect(result?.options?.["headers"]).not.toBeInstanceOf(Headers);
    expect(result?.options?.["headers"]).toMatchObject({
      "content-type": "application/json",
      "accept-language": "en-US",
      "x-renewlet-locale": "en-US",
    });

    setApiLocale("zh-CN");
  });
});
