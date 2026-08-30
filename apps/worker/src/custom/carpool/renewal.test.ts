// 拼车手动续费的日期推进：锚点必须是原到期日（保住「几号到期」），且结果永远落在今天之后。
import { describe, expect, it } from "vitest";
import { nextRenewalExpiry } from "./store";

describe("nextRenewalExpiry", () => {
  it("keeps the day of month when renewing a still-valid member", () => {
    expect(nextRenewalExpiry("2026-09-21", "monthly", null, "2026-08-30")).toBe("2026-10-21");
    expect(nextRenewalExpiry("2026-09-21", "quarterly", null, "2026-08-30")).toBe("2026-12-21");
    expect(nextRenewalExpiry("2026-09-21", "yearly", null, "2026-08-30")).toBe("2027-09-21");
  });

  it("keeps the member's own cycle day instead of the click date when overdue", () => {
    // 上车 7/5 月付 → 到期 8/5；8/21 点续费应得 9/5，而不是从点击当天起算的 9/21。
    expect(nextRenewalExpiry("2026-08-05", "monthly", null, "2026-08-21")).toBe("2026-09-05");
  });

  it("jumps straight to the first future date when several cycles are overdue", () => {
    expect(nextRenewalExpiry("2026-05-05", "monthly", null, "2026-08-21")).toBe("2026-09-05");
    expect(nextRenewalExpiry("2024-03-10", "yearly", null, "2026-08-21")).toBe("2027-03-10");
  });

  it("always lands strictly after today, never on it", () => {
    expect(nextRenewalExpiry("2026-07-30", "monthly", null, "2026-08-30")).toBe("2026-09-30");
  });

  it("advances custom cycles by their own day count", () => {
    expect(nextRenewalExpiry("2026-09-01", "custom", 45, "2026-08-30")).toBe("2026-10-16");
    // 已过两期：直接推进到第三期（2026-06-01 + 3×45 天），仍落在未来。
    expect(nextRenewalExpiry("2026-06-01", "custom", 45, "2026-08-30")).toBe("2026-10-14");
  });

  it("clamps month-end anchors instead of overflowing", () => {
    expect(nextRenewalExpiry("2026-01-31", "monthly", null, "2026-01-15")).toBe("2026-02-28");
  });

  it("falls back to today's anchor when the member has no expiry yet", () => {
    expect(nextRenewalExpiry(null, "monthly", null, "2026-08-30")).toBe("2026-09-30");
    expect(nextRenewalExpiry("", "quarterly", null, "2026-08-30")).toBe("2026-11-30");
  });
});
