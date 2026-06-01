import { describe, expect, it } from "vitest";
import { CURRENCY_OPTIONS } from "@/types/subscription";
import {
  createCurrencyKeywords,
  createTimeZoneKeywords,
  rankSearchText,
} from "./searchable-options";

function getCurrencyKeywords(value: string): string[] {
  const option = CURRENCY_OPTIONS.find((item) => item.value === value);
  expect(option).toBeDefined();
  return createCurrencyKeywords(option!);
}

describe("searchable option keywords", () => {
  it("matches currencies by code, Chinese label, symbol and English display name", () => {
    const usd = CURRENCY_OPTIONS.find((option) => option.value === "USD");
    expect(usd).toBeDefined();

    const keywords = createCurrencyKeywords(usd!);
    expect(rankSearchText(keywords, "usd")).toBeGreaterThan(0);
    expect(rankSearchText(keywords, "美元")).toBeGreaterThan(0);
    expect(rankSearchText(keywords, "$")).toBeGreaterThan(0);
    expect(rankSearchText(keywords, "US Dollar")).toBeGreaterThan(0);
  });

  it("does not match short currency code queries as loose subsequences", () => {
    expect(rankSearchText(getCurrencyKeywords("NGN"), "ngn")).toBeGreaterThan(0);
    expect(rankSearchText(getCurrencyKeywords("HKD"), "ngn")).toBe(0);
    expect(rankSearchText(getCurrencyKeywords("AFN"), "ngn")).toBe(0);
    expect(rankSearchText(getCurrencyKeywords("NIO"), "ngn")).toBe(0);
  });

  it("matches time zones by IANA name, city and UTC offset aliases", () => {
    const keywords = createTimeZoneKeywords("Asia/Shanghai", new Date("2026-01-01T00:00:00Z"));

    expect(rankSearchText(keywords, "shanghai")).toBeGreaterThan(0);
    expect(rankSearchText(keywords, "Asia Shanghai")).toBeGreaterThan(0);
    expect(rankSearchText(keywords, "utc+8")).toBeGreaterThan(0);
    expect(rankSearchText(keywords, "utc8")).toBeGreaterThan(0);
  });
});
