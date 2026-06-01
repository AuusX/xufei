import { describe, expect, it } from "vitest";
import { DEFAULT_CUSTOM_CONFIG } from "@/types/config";
import type { Subscription } from "@/types/subscription";
import { assertDateOnly } from "@/lib/time/date-only";
import { buildDashboardStats } from "./dashboard-stats";
import { buildStatisticsModel } from "./statistics-model";

type FixedBillingCycle = Exclude<Subscription["billingCycle"], "custom">;
type SubscriptionBaseFixture = Omit<Subscription, "billingCycle" | "customDays">;
type SubscriptionOverrides = Partial<Omit<Subscription, "billingCycle" | "customDays">> & (
  | { billingCycle?: FixedBillingCycle; customDays?: undefined }
  | { billingCycle: "custom"; customDays?: number }
);

const convert = (amount: number, from: string, to: string) => {
  if (from === to) return amount;
  if (from === "USD" && to === "CNY") return amount * 7;
  if (from === "CNY" && to === "USD") return amount / 7;
  return amount;
};

function subscription(overrides: SubscriptionOverrides): Subscription {
  const base: SubscriptionBaseFixture = {
    id: "sub",
    name: "Service",
    logo: undefined,
    price: 10,
    currency: "USD",
    category: "productivity",
    status: "active",
    paymentMethod: undefined,
    startDate: assertDateOnly("2026-01-01"),
    nextBillingDate: assertDateOnly("2026-01-05"),
    autoCalculateNextBillingDate: true,
    trialEndDate: undefined,
    website: undefined,
    notes: undefined,
    tags: [],
    reminderDays: 3,
    repeatReminderEnabled: false,
    repeatReminderInterval: "1h",
    repeatReminderWindow: "72h",
  };

  if (overrides.billingCycle === "custom") {
    return {
      ...base,
      ...overrides,
      billingCycle: "custom",
      customDays: overrides.customDays ?? 30,
    };
  }

  return {
    ...base,
    ...overrides,
    billingCycle: overrides.billingCycle ?? "monthly",
    customDays: undefined,
  };
}

describe("subscription statistics models", () => {
  it("excludes paused/cancelled subscriptions from active spending", () => {
    const model = buildStatisticsModel({
      subscriptions: [
        subscription({ id: "active", price: 10, status: "active" }),
        subscription({ id: "trial", price: 5, status: "trial" }),
        subscription({ id: "paused", price: 100, status: "paused" }),
        subscription({ id: "cancelled", price: 100, status: "cancelled" }),
      ],
      config: DEFAULT_CUSTOM_CONFIG,
      monthlyBudget: 0,
      defaultCurrency: "USD",
      convert,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(model.totalMonthly).toBe(15);
    expect(model.activeCount).toBe(2);
    expect(model.inactiveCount).toBe(2);
    expect(model.monthlySavings).toBe(200);
    expect(model.annualSavings).toBe(2400);
    expect(model.budgetUsedPercent).toBe(0);
  });

  it("keeps one-time purchases active but excludes them from recurring spend and upcoming renewals", () => {
    const oneTime = subscription({
      id: "lifetime",
      price: 199,
      status: "active",
      billingCycle: "one-time",
      nextBillingDate: assertDateOnly("2026-01-02"),
      autoCalculateNextBillingDate: false,
    });

    const model = buildStatisticsModel({
      subscriptions: [oneTime],
      config: DEFAULT_CUSTOM_CONFIG,
      monthlyBudget: 0,
      defaultCurrency: "USD",
      convert,
      now: new Date("2026-01-10T00:00:00.000Z"),
    });
    const dashboard = buildDashboardStats({
      subscriptions: [oneTime],
      defaultCurrency: "USD",
      convert,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(model.activeCount).toBe(1);
    expect(model.totalMonthly).toBe(0);
    expect(model.inactiveCount).toBe(0);
    expect(dashboard.activeSubscriptions).toHaveLength(1);
    expect(dashboard.totalMonthly).toBe(0);
    expect(dashboard.upcomingCount).toBe(0);
  });

  it("treats effective expired subscriptions as inactive savings", () => {
    const model = buildStatisticsModel({
      subscriptions: [
        subscription({ id: "active", price: 10, status: "active", nextBillingDate: assertDateOnly("2026-01-05") }),
        subscription({ id: "legacyExpired", price: 20, status: "active", nextBillingDate: assertDateOnly("2025-12-31") }),
        subscription({ id: "storedExpired", price: 30, status: "expired", nextBillingDate: assertDateOnly("2026-01-05") }),
      ],
      config: DEFAULT_CUSTOM_CONFIG,
      monthlyBudget: 0,
      defaultCurrency: "USD",
      convert,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(model.totalMonthly).toBe(10);
    expect(model.activeCount).toBe(1);
    expect(model.inactiveCount).toBe(2);
    expect(model.monthlySavings).toBe(50);
  });

  it("normalizes inactive savings by billing cycle", () => {
    const model = buildStatisticsModel({
      subscriptions: [
        subscription({ id: "active", price: 20, status: "active" }),
        subscription({ id: "pausedAnnual", price: 120, status: "paused", billingCycle: "annual" }),
        subscription({ id: "cancelledQuarterly", price: 90, status: "cancelled", billingCycle: "quarterly" }),
      ],
      config: DEFAULT_CUSTOM_CONFIG,
      monthlyBudget: 0,
      defaultCurrency: "USD",
      convert,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(model.totalMonthly).toBe(20);
    expect(model.monthlySavings).toBe(40);
    expect(model.annualSavings).toBe(480);
  });

  it("converts currency before monthly cycle normalization", () => {
    const model = buildStatisticsModel({
      subscriptions: [
        subscription({ price: 12, currency: "USD", billingCycle: "annual" }),
        subscription({ price: 70, currency: "CNY", billingCycle: "monthly" }),
      ],
      config: DEFAULT_CUSTOM_CONFIG,
      monthlyBudget: 100,
      defaultCurrency: "CNY",
      convert,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(model.totalMonthly).toBe(77);
    expect(model.budgetRemaining).toBe(23);
  });

  it("dashboard upcoming window ignores inactive rows and counts 0..7 days", () => {
    const stats = buildDashboardStats({
      subscriptions: [
        subscription({ id: "today", nextBillingDate: assertDateOnly("2026-01-01") }),
        subscription({ id: "soon", nextBillingDate: assertDateOnly("2026-01-08") }),
        subscription({ id: "later", nextBillingDate: assertDateOnly("2026-01-09") }),
        subscription({ id: "paused", status: "paused", nextBillingDate: assertDateOnly("2026-01-02") }),
      ],
      defaultCurrency: "USD",
      convert,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(stats.upcomingCount).toBe(2);
    expect(stats.activeSubscriptions).toHaveLength(3);
  });

  it("dashboard excludes effective expired subscriptions from active counts and upcoming renewals", () => {
    const stats = buildDashboardStats({
      subscriptions: [
        subscription({ id: "active", status: "active", nextBillingDate: assertDateOnly("2026-01-05") }),
        subscription({ id: "legacyExpired", status: "active", nextBillingDate: assertDateOnly("2025-12-31") }),
        subscription({ id: "storedExpired", status: "expired", nextBillingDate: assertDateOnly("2026-01-02") }),
      ],
      defaultCurrency: "USD",
      convert,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(stats.upcomingCount).toBe(1);
    expect(stats.activeSubscriptions.map((item) => item.id)).toEqual(["active"]);
    expect(stats.totalMonthly).toBe(10);
  });
});
