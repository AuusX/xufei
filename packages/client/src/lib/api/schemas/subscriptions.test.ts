import { describe, expect, it } from "vitest";
import { apiSubscriptionSchema, subscriptionCreateBodySchema } from "./subscriptions";

const validSubscriptionCreateBody = {
  name: "Logo Test",
  logo: null,
  price: 0.83,
  currency: "CNY",
  billingCycle: "monthly",
  customDays: null,
  category: "productivity",
  status: "active",
  paymentMethod: null,
  startDate: "2026-05-15",
  nextBillingDate: "2026-06-15",
  autoCalculateNextBillingDate: true,
  trialEndDate: null,
  website: null,
  notes: null,
  tags: [],
  reminderDays: 3,
  repeatReminderEnabled: false,
  repeatReminderInterval: "1h",
  repeatReminderWindow: "72h",
};

const validSubscriptionResponseBody = {
  id: "sub_1",
  name: validSubscriptionCreateBody.name,
  price: validSubscriptionCreateBody.price,
  currency: validSubscriptionCreateBody.currency,
  billingCycle: validSubscriptionCreateBody.billingCycle,
  category: validSubscriptionCreateBody.category,
  status: validSubscriptionCreateBody.status,
  startDate: validSubscriptionCreateBody.startDate,
  nextBillingDate: validSubscriptionCreateBody.nextBillingDate,
  autoCalculateNextBillingDate: validSubscriptionCreateBody.autoCalculateNextBillingDate,
  tags: validSubscriptionCreateBody.tags,
  reminderDays: validSubscriptionCreateBody.reminderDays,
  repeatReminderEnabled: validSubscriptionCreateBody.repeatReminderEnabled,
  repeatReminderInterval: validSubscriptionCreateBody.repeatReminderInterval,
  repeatReminderWindow: validSubscriptionCreateBody.repeatReminderWindow,
};

describe("subscription API schemas", () => {
  it("accepts private asset paths and http(s) URLs for subscription logos", () => {
    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      logo: "/api/app/assets/2pbs0lgyypqhjoy",
    }).success).toBe(true);

    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      logo: "https://example.com/logo.png",
    }).success).toBe(true);

    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      logo: "http://example.com/logo.png",
    }).success).toBe(true);
  });

  it("keeps website URLs strict while rejecting unsupported logo references", () => {
    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      website: "/api/app/assets/2pbs0lgyypqhjoy",
    }).success).toBe(false);

    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      logo: "/other/assets/2pbs0lgyypqhjoy",
    }).success).toBe(false);

    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      logo: "data:image/png;base64,aGVsbG8=",
    }).success).toBe(false);

    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      logo: "javascript:alert(1)",
    }).success).toBe(false);

    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      logo: "https://user:pass@example.com/logo.png",
    }).success).toBe(false);
  });

  it("accepts only supported repeat reminder presets", () => {
    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      repeatReminderEnabled: true,
      repeatReminderInterval: "3h",
      repeatReminderWindow: "full",
    }).success).toBe(true);

    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      repeatReminderInterval: "2h",
    }).success).toBe(false);

    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      repeatReminderWindow: "forever",
    }).success).toBe(false);
  });

  it("accepts inherited and explicit reminder day boundaries", () => {
    for (const reminderDays of [-1, 0, 3, 3650]) {
      expect(subscriptionCreateBodySchema.safeParse({
        ...validSubscriptionCreateBody,
        reminderDays,
      }).success).toBe(true);

      expect(apiSubscriptionSchema.safeParse({
        ...validSubscriptionResponseBody,
        reminderDays,
      }).success).toBe(true);
    }

    for (const reminderDays of [-2, 3651]) {
      expect(subscriptionCreateBodySchema.safeParse({
        ...validSubscriptionCreateBody,
        reminderDays,
      }).success).toBe(false);
    }
  });

  it("accepts expired as a first-class subscription status", () => {
    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      status: "expired",
    }).success).toBe(true);
  });

  it("keeps subscription response logos on the same persistent contract", () => {
    expect(apiSubscriptionSchema.safeParse({
      ...validSubscriptionResponseBody,
      logo: "http://example.com/logo.png",
    }).success).toBe(true);

    expect(apiSubscriptionSchema.safeParse({
      ...validSubscriptionResponseBody,
      logo: "data:image/png;base64,aGVsbG8=",
    }).success).toBe(false);
  });

  it("accepts one-time as a first-class billing cycle", () => {
    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      billingCycle: "one-time",
      customDays: null,
      autoCalculateNextBillingDate: false,
    }).success).toBe(true);
  });
});
