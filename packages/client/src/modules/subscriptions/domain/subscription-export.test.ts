import { describe, expect, it } from "vitest";
import { buildSubscriptionsCsv, escapeCsvCell } from "./subscription-export";
import type { Subscription } from "@/types/subscription";
import { assertDateOnly } from "@/lib/time/date-only";

describe("subscription-export", () => {
  it("escapes quotes and spreadsheet formula prefixes", () => {
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
    expect(escapeCsvCell("=cmd")).toBe('"\'=cmd"');
    expect(escapeCsvCell("+cmd")).toBe('"\'+cmd"');
    expect(escapeCsvCell("-cmd")).toBe('"\'-cmd"');
    expect(escapeCsvCell("@cmd")).toBe('"\'@cmd"');
    expect(escapeCsvCell("\tcmd")).toBe('"\'\tcmd"');
  });

  it("uses configured labels when building CSV rows", () => {
    const subscription: Subscription = makeSubscription();

    const csv = buildSubscriptionsCsv([subscription], {
      categoryLabelByValue: new Map([["productivity", "生产力"]]),
      statusLabelByValue: new Map([["active", "活跃"]]),
      locale: "zh-CN",
      today: assertDateOnly("2026-01-01"),
    });

    expect(csv).toContain('"\'=Formula"');
    expect(csv).toContain('"生产力"');
    expect(csv).toContain('"活跃"');
    expect(csv).toContain('"SaaS;Work"');
  });

  it("renders inherited reminder days as a user-facing CSV label", () => {
    const csv = buildSubscriptionsCsv([makeSubscription({ reminderDays: -1 })], {
      categoryLabelByValue: new Map([["productivity", "生产力"]]),
      statusLabelByValue: new Map([["active", "活跃"]]),
      locale: "zh-CN",
      today: assertDateOnly("2026-01-01"),
    });

    expect(csv).toContain('"默认值从设置中获取"');
    expect(csv).not.toContain('"-1"');
  });
});

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "=Formula",
    logo: undefined,
    price: 10,
    currency: "USD",
    billingCycle: "monthly",
    customDays: undefined,
    category: "productivity",
    status: "active",
    paymentMethod: undefined,
    startDate: assertDateOnly("2026-01-01"),
    nextBillingDate: assertDateOnly("2026-02-01"),
    autoCalculateNextBillingDate: true,
    trialEndDate: undefined,
    website: undefined,
    notes: undefined,
    reminderDays: 3,
    repeatReminderEnabled: false,
    repeatReminderInterval: "1h",
    repeatReminderWindow: "72h",
    tags: ["SaaS", "Work"],
    ...overrides,
  } as Subscription;
}
