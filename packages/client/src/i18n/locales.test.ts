import { describe, expect, it, vi } from "vitest";
import { detectBrowserLocale, normalizeLocale } from "./locales";
import { pb } from "@/lib/pocketbase";
import { setApiLocale } from "./api-locale";

describe("locales", () => {
  it("normalizes supported language tags", () => {
    expect(normalizeLocale("zh")).toBe("zh-CN");
    expect(normalizeLocale("zh-Hant-HK")).toBe("zh-CN");
    expect(normalizeLocale("en-GB")).toBe("en-US");
    expect(normalizeLocale("fr-FR")).toBe("zh-CN");
  });

  it("detects browser locale from navigator languages", () => {
    vi.stubGlobal("navigator", { languages: ["en-GB", "zh-CN"], language: "zh-CN" });

    expect(detectBrowserLocale()).toBe("en-US");

    vi.unstubAllGlobals();
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
