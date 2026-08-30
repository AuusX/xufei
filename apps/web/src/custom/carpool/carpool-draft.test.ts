// 保存前校验是数据丢失的最后一道闸：以前姓名为空的车友会被静默丢弃、切「均摊」会清空金额、
// "1e5" 会被 parseInt 截成 1。这些都在这里锁住。
import { describe, expect, it } from "vitest";
import { buildMembersPayload, parseAmount, parseCount, toDraft, type Draft, type DraftMember } from "./carpool-draft";
import type { CarpoolSubscription } from "./api";

const identity = (cny: number) => cny;

function draftMember(patch: Partial<DraftMember> = {}): DraftMember {
  return {
    key: "k1",
    id: "m1",
    name: "张三",
    amountCny: "50",
    joinDate: "2026-07-05",
    expiryDate: "2026-09-05",
    status: "active",
    billingCycle: "monthly",
    customDays: "",
    autoCalcExpiry: false,
    reminderDays: "7",
    wechat: "zhangsan",
    email: "",
    ...patch,
  };
}

function draft(patch: Partial<Draft> = {}): Draft {
  return { enabled: true, splitMode: "custom", account: "", cardLast4: "", members: [draftMember()], ...patch };
}

describe("parseAmount / parseCount", () => {
  it("rejects the inputs that used to be silently mangled", () => {
    expect(parseAmount("-50")).toBeNull();
    expect(parseAmount("1e5")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("12.34")).toBe(12.34);
    expect(parseCount("1e5")).toBeNull();
    expect(parseCount("1.5")).toBeNull();
    expect(parseCount("30")).toBe(30);
  });
});

describe("buildMembersPayload", () => {
  it("refuses to save a member with a blank name instead of dropping them", () => {
    const result = buildMembersPayload(draft({ members: [draftMember({ name: "  " })] }), identity);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("姓名");
  });

  it("requires an amount for every member in custom split mode (upstream contract)", () => {
    const result = buildMembersPayload(draft({ members: [draftMember({ amountCny: "" })] }), identity);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("付款金额");
  });

  it("keeps amounts when the split mode is equal, so switching modes does not wipe them", () => {
    const result = buildMembersPayload(draft({ splitMode: "equal" }), identity);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.members[0]?.amountCny).toBe(50);
      expect(result.payload.members[0]?.customAmount).toBe(50);
    }
  });

  it("rejects a negative amount instead of silently dropping it", () => {
    const result = buildMembersPayload(draft({ members: [draftMember({ amountCny: "-50" })] }), identity);
    expect(result.ok).toBe(false);
  });

  it("requires the day count when the cycle is 自定义天数", () => {
    const result = buildMembersPayload(draft({ members: [draftMember({ billingCycle: "custom", customDays: "" })] }), identity);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("自定义天数");
  });

  it("treats a blank reminder as 不提醒 and keeps 0 as a real value", () => {
    const blank = buildMembersPayload(draft({ members: [draftMember({ reminderDays: "" })] }), identity);
    expect(blank.ok).toBe(true);
    if (blank.ok) expect(blank.payload.members[0]?.reminderDays).toBeUndefined();

    const zero = buildMembersPayload(draft({ members: [draftMember({ reminderDays: "0" })] }), identity);
    expect(zero.ok).toBe(true);
    if (zero.ok) expect(zero.payload.members[0]?.reminderDays).toBe(0);
  });

  it("keeps members when 启用拼车 is switched off", () => {
    const result = buildMembersPayload(draft({ enabled: false }), identity);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.enabled).toBe(false);
      expect(result.payload.members).toHaveLength(1);
    }
  });

  it("caps the roster at the upstream limit", () => {
    const members = Array.from({ length: 21 }, (_, i) => draftMember({ key: `k${i}`, id: `m${i}` }));
    const result = buildMembersPayload(draft({ members }), identity);
    expect(result.ok).toBe(false);
  });
});

describe("toDraft", () => {
  it("shows the effective expiry, not the stale raw one, when 自动计算到期 is on", () => {
    const subscription = {
      id: "s1",
      name: "ChatGPT",
      logo: null,
      price: 20,
      currency: "USD",
      status: "active",
      nextBillingDate: "2026-09-01",
      account: null,
      cardLast4: null,
      enabled: true,
      splitMode: "custom",
      yourShare: 10,
      members: [
        {
          id: "m1",
          name: "张三",
          amount: 10,
          joinDate: "2026-07-05",
          expiryDate: "2026-01-01",
          status: "active",
          billingCycle: "monthly",
          customDays: null,
          autoCalcExpiry: true,
          effectiveExpiry: "2026-08-05",
          reminderDays: 7,
          wechat: null,
          email: null,
          amountCny: 50,
          monthlyAmountCny: 50,
          collectible: true,
        },
      ],
    } satisfies CarpoolSubscription;

    expect(toDraft(subscription, identity).members[0]?.expiryDate).toBe("2026-08-05");
  });
});
