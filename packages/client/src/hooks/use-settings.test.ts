import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  WEBHOOK_HEADERS_PLACEHOLDER,
  WEBHOOK_PAYLOAD_PLACEHOLDER,
} from "@/types/subscription";
import { normalizeSettings } from "./use-settings";

describe("normalizeSettings", () => {
  it("clears legacy Webhook example defaults so they stay placeholders only", () => {
    const settings = normalizeSettings({
      webhookHeaders: WEBHOOK_HEADERS_PLACEHOLDER,
      webhookPayload: WEBHOOK_PAYLOAD_PLACEHOLDER,
    });

    expect(settings.webhookHeaders).toBe("");
    expect(settings.webhookPayload).toBe("");
  });

  it("defaults historical settings to FloatRates as the exchange-rate provider", () => {
    const settings = normalizeSettings({
      defaultCurrency: "USD",
    });

    expect(settings.defaultCurrency).toBe("USD");
    expect(settings.exchangeRateProvider).toBe("floatrates");
  });

  it("fills missing global notification reminder days from defaults", () => {
    const settings = normalizeSettings({
      defaultCurrency: "USD",
    });

    expect(settings.notificationReminderDays).toBe(3);
  });

  it("rejects invalid exchange-rate providers and falls back to defaults", () => {
    const settings = normalizeSettings({
      exchangeRateProvider: "unknown",
    });

    expect(settings.exchangeRateProvider).toBe("floatrates");
  });

  it("maps the legacy Frankfurter provider to Exchange API", () => {
    const settings = normalizeSettings({
      exchangeRateProvider: "frankfurter",
    });

    expect(settings.exchangeRateProvider).toBe("exchange-api");
  });

  it("fills missing built-in icon source settings from defaults", () => {
    const settings = normalizeSettings({
      defaultCurrency: "USD",
      builtInIconSources: {
        thesvg: { enabled: false, variantsEnabled: false },
      },
    });

    expect(settings.defaultCurrency).toBe("USD");
    expect(settings.builtInIconSources).toEqual({
      ...DEFAULT_SETTINGS.builtInIconSources,
      thesvg: { enabled: false, variantsEnabled: false },
    });
  });
});
