import { describe, expect, it } from "vitest";
import { DEFAULT_CUSTOM_CONFIG } from "@/types/config";
import { DEFAULT_SETTINGS } from "@/types/subscription";
import { assertDateOnly } from "@/lib/time/date-only";
import { translate } from "@/i18n/messages";
import { parseJsonText } from "./wallos-import";
import { formatImportMessage } from "./import-message-format";

const context = {
  config: DEFAULT_CUSTOM_CONFIG,
  settings: DEFAULT_SETTINGS,
  today: assertDateOnly("2026-05-21"),
};

describe("wallos import", () => {
  it("maps Wallos API subscriptions with source ids and custom cycles", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      success: true,
      subscriptions: [{
        id: 12,
        user_id: 7,
        name: "GitHub",
        price: 4,
        currency_id: 1,
        start_date: "2026-01-01",
        next_payment: "2026-06-01",
        cycle: 2,
        frequency: 2,
        auto_renew: 1,
        inactive: 0,
        notify: 1,
        notify_days_before: -1,
        category_name: "Developer",
        payment_method_name: "Visa",
      }],
    }), context);

    expect(prepared.payload.source).toBe("wallos");
    expect(prepared.payload.subscriptions[0]?.billingCycle).toBe("custom");
    expect(prepared.payload.subscriptions[0]?.customDays).toBe(14);
    expect(prepared.payload.subscriptions[0]?.reminderDays).toBe(-1);
    expect(prepared.payload.subscriptions[0]?.extra.import.sourceId).toBe("7:12");
    expect(prepared.payload.subscriptions[0]?.logo).toBeNull();
    expect(prepared.payload.customConfig?.categories.some((item) => item.labels["en-US"] === "Developer")).toBe(true);
  });

  it("keeps explicit Wallos reminder days while mapping only -1 to inherited reminders", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      success: true,
      subscriptions: [
        {
          id: 31,
          user_id: 7,
          name: "Inherited",
          price: 4,
          currency_id: 1,
          next_payment: "2026-06-01",
          cycle: 3,
          frequency: 1,
          inactive: 0,
          notify: 1,
          notify_days_before: -1,
        },
        {
          id: 32,
          user_id: 7,
          name: "Explicit",
          price: 8,
          currency_id: 1,
          next_payment: "2026-06-01",
          cycle: 3,
          frequency: 1,
          inactive: 0,
          notify: 1,
          notify_days_before: 7,
        },
      ],
    }), context);

    expect(prepared.payload.subscriptions.map((subscription) => subscription.reminderDays)).toEqual([-1, 7]);
  });

  it("imports Wallos categories with localized labels without rewriting Renewlet built-ins", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      success: true,
      subscriptions: [{
        id: 13,
        user_id: 7,
        name: "Spotify",
        price: 10,
        next_payment: "2026-06-01",
        cycle: 3,
        frequency: 1,
        inactive: 0,
        category_name: "Music",
      }],
    }), context);

    const subscription = prepared.payload.subscriptions[0];
    const builtInMusic = prepared.payload.customConfig?.categories.find((item) => item.value === "music");
    const wallosMusic = prepared.payload.customConfig?.categories.find((item) => item.value === "wallos_category_music");

    expect(subscription?.category).toBe("wallos_category_music");
    expect(builtInMusic?.labels).toEqual({ "zh-CN": "音乐", "en-US": "Music" });
    expect(wallosMusic?.labels).toEqual({ "zh-CN": "音乐", "en-US": "Music" });
  });

  it("keeps unknown Wallos category labels as source text instead of guessing translations", async () => {
    const prepared = await parseJsonText(JSON.stringify([{
      Name: "Team SaaS",
      "Payment Cycle": "Monthly",
      "Next Payment": "2026-07-01",
      Price: "$19.99",
      Category: "Internal Ops",
      "Payment Method": "Card",
    }]), context);

    const category = prepared.payload.customConfig?.categories.find((item) => item.value === "wallos_category_internal_ops");

    expect(prepared.payload.subscriptions[0]?.category).toBe("wallos_category_internal_ops");
    expect(category?.labels).toEqual({ "zh-CN": "Internal Ops", "en-US": "Internal Ops" });
  });

  it("resolves Wallos yen symbol to CNY when display exports omit ISO code", async () => {
    const prepared = await parseJsonText(JSON.stringify([{
      Name: "Apple",
      "Payment Cycle": "Monthly",
      "Next Payment": "2026-07-01",
      Price: "¥68",
      Category: "Software",
      "Payment Method": "Card",
    }]), context);

    expect(prepared.payload.subscriptions[0]?.currency).toBe("CNY");
    expect(prepared.warnings.join("\n")).not.toContain("IMPORT_WARNING_CURRENCY_SYMBOL_AMBIGUOUS");
  });

  it("does not fall back to USD for Wallos yen symbols when USD is the current default currency", async () => {
    const prepared = await parseJsonText(JSON.stringify([{
      Name: "Apple",
      "Payment Cycle": "Monthly",
      "Next Payment": "2026-07-01",
      Price: "¥10",
      Category: "Utilities",
      "Payment Method": "PayPal",
    }]), {
      ...context,
      settings: { ...DEFAULT_SETTINGS, defaultCurrency: "USD" },
      config: {
        ...DEFAULT_CUSTOM_CONFIG,
        currencies: DEFAULT_CUSTOM_CONFIG.currencies.filter((currency) => currency.value === "USD"),
      },
    });

    expect(prepared.payload.subscriptions[0]?.currency).toBe("CNY");
    expect(prepared.payload.subscriptions[0]?.currency).not.toBe("USD");
    expect(prepared.payload.customConfig?.currencies.some((currency) => currency.value === "CNY" && currency.enabled)).toBe(true);
    expect(prepared.warnings.join("\n")).not.toContain("IMPORT_WARNING_CURRENCY_SYMBOL_AMBIGUOUS");
  });

  it("keeps the current default JPY when Wallos yen symbols are imported from a JPY workspace", async () => {
    const prepared = await parseJsonText(JSON.stringify([{
      Name: "Apple Japan",
      "Payment Cycle": "Monthly",
      "Next Payment": "2026-07-01",
      Price: "￥980",
      Category: "Utilities",
      "Payment Method": "PayPal",
    }]), {
      ...context,
      settings: { ...DEFAULT_SETTINGS, defaultCurrency: "JPY" },
    });

    expect(prepared.payload.subscriptions[0]?.currency).toBe("JPY");
  });

  it("uses Wallos default currency ids when API payloads do not include a currencies table", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      success: true,
      subscriptions: [{
        id: 20,
        user_id: 1,
        name: "RMB Service",
        price: 12,
        currency_id: 20,
        next_payment: "2026-07-01",
        cycle: 3,
        frequency: 1,
        inactive: 0,
      }],
    }), context);

    expect(prepared.payload.subscriptions[0]?.currency).toBe("CNY");
  });

  it("uses merged Wallos API lookup tables when subscriptions include only ids", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      success: true,
      users: [{ id: 2, username: "ethan" }],
      currencies: [{ id: 54, code: "JPY", symbol: "¥" }],
      categories: [{ id: 77, name: "Utilities" }],
      payment_methods: [{ id: 88, name: "PayPal" }],
      household: [{ id: 99, name: "Alex" }],
      subscriptions: [{
        id: 21,
        user_id: 2,
        name: "Apple",
        price: 10,
        currency_id: 54,
        category_id: 77,
        payment_method_id: 88,
        payer_user_id: 99,
        next_payment: "2026-07-01",
        cycle: 3,
        frequency: 1,
        inactive: 0,
      }],
    }), context);

    const subscription = prepared.payload.subscriptions[0];

    expect(subscription?.currency).toBe("JPY");
    expect(subscription?.category).toBe("wallos_category_utilities");
    expect(subscription?.paymentMethod).toBe("paypal");
    expect(subscription?.notes).toContain("Wallos paid by: Alex");
  });

  it("maps Wallos default payment methods to Renewlet built-ins", async () => {
    const wallosDefaults = [
      ["Direct Debit", "direct_debit"],
      ["Money", "money"],
      ["Samsung Pay", "samsung_pay"],
      ["Klarna", "klarna"],
      ["Amazon Pay", "amazon_pay"],
      ["SEPA", "sepa"],
      ["Skrill", "skrill"],
      ["Sofort", "sofort"],
      ["Stripe", "stripe"],
      ["Affirm", "affirm"],
      ["Elo", "elo"],
      ["Facebook Pay", "facebook_pay"],
      ["GiroPay", "giropay"],
      ["iDeal", "ideal"],
      ["Union Pay", "union_pay"],
      ["Interac", "interac"],
      ["Paysafe", "paysafe"],
      ["Poli", "poli"],
      ["Qiwi", "qiwi"],
      ["ShopPay", "shop_pay"],
      ["Venmo", "venmo"],
      ["VeriFone", "verifone"],
      ["WebMoney", "webmoney"],
    ] as const;
    const prepared = await parseJsonText(JSON.stringify(wallosDefaults.map(([name], index) => ({
      Name: `Payment ${index}`,
      "Payment Cycle": "Monthly",
      "Next Payment": "2026-07-01",
      Price: "$10",
      Category: "Software",
      "Payment Method": name,
    }))), context);

    expect(prepared.payload.subscriptions.map((subscription) => subscription.paymentMethod)).toEqual(wallosDefaults.map(([, value]) => value));
    expect(prepared.payload.customConfig?.paymentMethods.some((item) => item.value.startsWith("wallos_payment_"))).toBe(false);
  });

  it("maps Wallos one-time purchases to native one-time billing without cancelling them", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      success: true,
      subscriptions: [{
        id: 21,
        user_id: 1,
        name: "Lifetime Tool",
        price: 199,
        currency_id: 2,
        next_payment: "2026-07-01",
        cycle: 5,
        frequency: 1,
        inactive: 0,
      }],
    }), context);
    const subscription = prepared.payload.subscriptions[0];

    expect(subscription?.billingCycle).toBe("one-time");
    expect(subscription?.customDays).toBeNull();
    expect(subscription?.status).toBe("active");
    expect(subscription?.autoCalculateNextBillingDate).toBe(false);
    expect(subscription?.extra["wallos"]).toMatchObject({ oneTime: true });
  });

  it("formats Wallos API and database warnings instead of showing raw warning codes", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      success: true,
      subscriptions: [{
        id: 22,
        user_id: 1,
        name: "Lifetime Tool",
        price: 199,
        currency_id: 2,
        next_payment: "2026-07-01",
        cycle: 5,
        frequency: 1,
        inactive: 0,
        notify: 0,
      }],
    }), context);
    const formatted = prepared.warnings.map((warning) => formatImportMessage(warning, (key, params) => translate("zh-CN", key, params)));

    expect(prepared.warnings).toContain("IMPORT_WARNING_FOR_SUBSCRIPTION|Lifetime Tool|IMPORT_WARNING_WALLOS_ONE_TIME");
    expect(prepared.warnings).toContain("IMPORT_WARNING_FOR_SUBSCRIPTION|Lifetime Tool|IMPORT_WARNING_WALLOS_NOTIFY_DISABLED");
    expect(formatted).toContain("Lifetime Tool：一次性购买已按买断记录导入，不参与自动续费。");
    expect(formatted).toContain("Lifetime Tool：Wallos 这条订阅关闭了通知；Renewlet 没有单条通知开关，已保留默认提前 3 天提醒。");
    expect(formatted.join("\n")).not.toContain("IMPORT_WARNING_WALLOS");
  });

  it("maps Wallos empty category names to Renewlet other without adding a custom category", async () => {
    const prepared = await parseJsonText(JSON.stringify([{
      Name: "Unsorted",
      "Payment Cycle": "Monthly",
      "Next Payment": "2026-07-01",
      Price: "$1.99",
      Category: "无分类",
      "Payment Method": "Card",
    }]), context);

    expect(prepared.payload.subscriptions[0]?.category).toBe("other");
    expect(prepared.payload.customConfig?.categories.some((item) => item.value.startsWith("wallos_category_"))).toBe(false);
  });

  it("marks Wallos display export as low confidence", async () => {
    const prepared = await parseJsonText(JSON.stringify([
      {
        Name: "Netflix",
        "Payment Cycle": "Every 3 Months",
        "Next Payment": "2026-07-01",
        Price: "$15.99",
        Category: "Streaming",
        "Payment Method": "PayPal",
        "Paid By": "Alex",
        Active: "Yes",
      },
    ]), context);

    const subscription = prepared.payload.subscriptions[0];
    expect(subscription?.billingCycle).toBe("quarterly");
    expect(subscription?.paymentMethod).toBe("paypal");
    expect(subscription?.notes).toContain("Wallos paid by: Alex");
    expect(subscription?.extra.import.confidence).toBe("low");
    expect(prepared.warnings).toContain("IMPORT_WARNING_WALLOS_DISPLAY_LOW_CONFIDENCE");
  });

  it("keeps Wallos display source ids stable when payment values change", async () => {
    const first = await parseJsonText(JSON.stringify([{
      Name: "Apple",
      "Payment Cycle": "Monthly",
      "Next Payment": "2026-07-01",
      Price: "$9.99",
      Category: "Software",
      "Payment Method": "Card",
    }]), context);
    const second = await parseJsonText(JSON.stringify([{
      Name: "Apple",
      "Payment Cycle": "Monthly",
      "Next Payment": "2026-08-01",
      Price: "$12.99",
      Category: "Software",
      "Payment Method": "Card",
    }]), context);

    expect(first.payload.subscriptions[0]?.extra.import.sourceId).toBe(second.payload.subscriptions[0]?.extra.import.sourceId);
  });

  it("keeps Wallos URL without assigning guessed logo candidates", async () => {
    const prepared = await parseJsonText(JSON.stringify({
      success: true,
      subscriptions: [{
        id: 9,
        name: "Custom Service",
        price: 8,
        next_payment: "2026-06-01",
        cycle: 3,
        frequency: 1,
        inactive: 0,
        notify: 1,
        url: "https://billing.example.app/account",
      }],
    }), context);

    expect(prepared.payload.subscriptions[0]?.website).toBe("https://billing.example.app/account");
    expect(prepared.payload.subscriptions[0]?.logo).toBeNull();
  });
});
