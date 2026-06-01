import { describe, expect, it } from "vitest";
import { assertDateOnly } from "@/lib/time/date-only";
import { calculateNextBillingDate, toMonthlyAmount } from "./subscription-billing";

describe("subscription-billing", () => {
  it("calculates the next billing date by adding one cycle to the start date", () => {
    const startDate = assertDateOnly("2026-05-15");

    expect(calculateNextBillingDate(startDate, "weekly")).toBe("2026-05-22");
    expect(calculateNextBillingDate(startDate, "monthly")).toBe("2026-06-15");
    expect(calculateNextBillingDate(startDate, "quarterly")).toBe("2026-08-15");
    expect(calculateNextBillingDate(startDate, "semi-annual")).toBe("2026-11-15");
    expect(calculateNextBillingDate(startDate, "annual")).toBe("2027-05-15");
    expect(calculateNextBillingDate(startDate, "custom", 45)).toBe("2026-06-29");
  });

  it("uses 30 days for custom cycle previews when custom days are empty", () => {
    expect(calculateNextBillingDate(assertDateOnly("2026-05-15"), "custom")).toBe("2026-06-14");
  });

  it("follows Temporal date-only semantics for month-end and leap-year boundaries", () => {
    expect(calculateNextBillingDate(assertDateOnly("2026-01-31"), "monthly")).toBe("2026-02-28");
    expect(calculateNextBillingDate(assertDateOnly("2024-02-29"), "annual")).toBe("2025-02-28");
  });

  it("finds the next billing occurrence on or after the reference date", () => {
    const referenceDate = assertDateOnly("2026-05-17");

    expect(calculateNextBillingDate(assertDateOnly("2025-03-20"), "annual", undefined, referenceDate)).toBe("2027-03-20");
    expect(calculateNextBillingDate(assertDateOnly("2025-03-20"), "monthly", undefined, referenceDate)).toBe("2026-05-20");
    expect(calculateNextBillingDate(assertDateOnly("2026-05-10"), "weekly", undefined, referenceDate)).toBe("2026-05-17");
  });

  it("keeps month and year recurrences anchored to the original start date", () => {
    expect(calculateNextBillingDate(
      assertDateOnly("2026-01-31"),
      "monthly",
      undefined,
      assertDateOnly("2026-03-01"),
    )).toBe("2026-03-31");
    expect(calculateNextBillingDate(
      assertDateOnly("2024-02-29"),
      "annual",
      undefined,
      assertDateOnly("2025-03-01"),
    )).toBe("2026-02-28");
  });

  it("keeps one-time purchases out of recurrence and monthly cost calculations", () => {
    const startDate = assertDateOnly("2026-05-15");

    expect(calculateNextBillingDate(startDate, "one-time", undefined, assertDateOnly("2027-01-01"))).toBe(startDate);
    expect(toMonthlyAmount(199, "one-time")).toBe(0);
  });
});
