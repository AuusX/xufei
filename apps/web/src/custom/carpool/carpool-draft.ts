/**
 * 拼车编辑弹窗的草稿模型与保存前校验。
 *
 * 从 carpool-page.tsx 拆出：草稿是「所有输入框的字符串状态」，这里负责把订阅视图转成草稿、把草稿转回
 * 接口负载，并在转换前把不合法的输入拦下来。
 *
 * 为什么校验必须在这一层做：
 * - 姓名为空的成员以前会被**静默丢弃**（连同他的日期/微信/金额），还提示「已保存」；
 * - 「自定义金额」模式下上游契约要求**每位**成员都有金额，漏填会写出让整个订阅接口 500 的数据；
 * - 金额/天数用 parseFloat/parseInt 解析时，"1e5" 会变成 1、"-50" 会被悄悄丢掉。
 */
import type {
  CarpoolBillingCycle,
  CarpoolMember,
  CarpoolMemberStatus,
  CarpoolSplitMode,
  CarpoolSubscription,
  SaveCarpoolMembersInput,
} from "@/custom/carpool/api";

export interface DraftMember {
  key: string;
  id?: string;
  name: string;
  amountCny: string;
  joinDate: string;
  expiryDate: string;
  status: CarpoolMemberStatus;
  billingCycle: CarpoolBillingCycle;
  customDays: string;
  autoCalcExpiry: boolean;
  reminderDays: string;
  wechat: string;
  email: string;
}

export interface Draft {
  enabled: boolean;
  splitMode: CarpoolSplitMode;
  account: string;
  cardLast4: string;
  members: DraftMember[];
}

/** 与后端 zod / 上游 costSharingSchema 对齐的输入上限。 */
export const LIMITS = {
  name: 80,
  account: 200,
  cardLast4: 50,
  wechat: 100,
  email: 200,
  members: 20,
  reminderDays: 365,
  customDays: 3660,
} as const;

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** 严格金额解析：只认「12」「12.5」「12.34」，不认负数、科学计数法和空串。 */
export function parseAmount(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** 严格整数解析：只认纯数字，避免 parseInt("1e5") === 1 这类静默截断。 */
export function parseCount(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function newDraftMember(): DraftMember {
  return {
    key: `new-${Math.random().toString(36).slice(2)}-${performance.now().toString(36)}`,
    name: "",
    amountCny: "",
    joinDate: "",
    expiryDate: "",
    status: "active",
    billingCycle: "monthly",
    customDays: "",
    autoCalcExpiry: false,
    reminderDays: "",
    wechat: "",
    email: "",
  };
}

/** 订阅视图 → 草稿。金额优先用成员实付人民币原值，没有才用订阅货币金额换算回人民币。 */
export function toDraft(subscription: CarpoolSubscription, subToCny: (amount: number) => number): Draft {
  return {
    enabled: subscription.enabled,
    splitMode: subscription.splitMode,
    account: subscription.account ?? "",
    cardLast4: subscription.cardLast4 ?? "",
    members: subscription.members.map((member) => toDraftMember(member, subToCny)),
  };
}

function toDraftMember(member: CarpoolMember, subToCny: (amount: number) => number): DraftMember {
  const cny = member.amountCny != null
    ? member.amountCny
    : member.customAmount != null
      ? round2(subToCny(member.customAmount))
      : null;
  return {
    key: member.id,
    id: member.id,
    name: member.name,
    amountCny: cny != null ? String(cny) : "",
    joinDate: member.joinDate ?? "",
    // 用生效到期日：开「自动计算到期」时 expiryDate 可能还是切换前的旧值，直接显示会和卡片对不上。
    expiryDate: member.effectiveExpiry ?? member.expiryDate ?? "",
    status: member.status,
    billingCycle: member.billingCycle,
    customDays: member.customDays != null ? String(member.customDays) : "",
    autoCalcExpiry: member.autoCalcExpiry,
    reminderDays: member.reminderDays >= 0 ? String(member.reminderDays) : "",
    wechat: member.wechat ?? "",
    email: member.email ?? "",
  };
}

export type BuildPayloadResult =
  | { ok: true; payload: SaveCarpoolMembersInput }
  | { ok: false; message: string };

/** 第几位车友（给报错文案用；没填名字时只能靠序号指认）。 */
function memberLabel(member: DraftMember, index: number): string {
  return member.name.trim() ? `「${member.name.trim()}」` : `第 ${index + 1} 位车友`;
}

/**
 * 草稿 → 接口负载，附带保存前校验。
 *
 * 金额**不分摊模式一律回传**：切到「均摊」再保存时，如果不带上金额，之前填的自定义金额会被清空，
 * 而界面上还灰显着旧数字，用户根本看不出来钱没了。
 */
export function buildMembersPayload(
  draft: Draft,
  cnyToCurrency: (cny: number) => number,
): BuildPayloadResult {
  if (draft.members.length > LIMITS.members) {
    return { ok: false, message: `一辆车最多 ${LIMITS.members} 位车友` };
  }

  const members: SaveCarpoolMembersInput["members"] = [];
  for (const [index, member] of draft.members.entries()) {
    const name = member.name.trim();
    if (!name) return { ok: false, message: `${memberLabel(member, index)}还没填姓名` };
    if (name.length > LIMITS.name) return { ok: false, message: `${memberLabel(member, index)}的姓名超过 ${LIMITS.name} 个字` };

    const amountText = member.amountCny.trim();
    const amount = amountText ? parseAmount(amountText) : null;
    if (amountText && amount === null) {
      return { ok: false, message: `${memberLabel(member, index)}的付款金额填写有误（只能填 0 或正数，最多两位小数）` };
    }
    // 上游契约：custom 模式下每位成员都必须有金额，漏填会写出让订阅接口整体 500 的数据。
    if (draft.splitMode === "custom" && amount === null) {
      return { ok: false, message: `「自定义金额」模式下，${memberLabel(member, index)}必须填写付款金额` };
    }

    let customDays: number | null = null;
    if (member.billingCycle === "custom") {
      customDays = parseCount(member.customDays);
      if (customDays === null || customDays < 1 || customDays > LIMITS.customDays) {
        return { ok: false, message: `${memberLabel(member, index)}选了「自定义天数」，请填写 1-${LIMITS.customDays} 之间的天数` };
      }
    }

    let reminderDays: number | null = null;
    if (member.reminderDays.trim()) {
      reminderDays = parseCount(member.reminderDays);
      if (reminderDays === null || reminderDays > LIMITS.reminderDays) {
        return { ok: false, message: `${memberLabel(member, index)}的到期提醒天数应填 0-${LIMITS.reminderDays}，留空表示不提醒` };
      }
    }

    members.push({
      ...(member.id ? { id: member.id } : {}),
      name,
      ...(amount !== null ? { amountCny: amount, customAmount: round2(cnyToCurrency(amount)) } : {}),
      ...(member.joinDate ? { joinDate: member.joinDate } : {}),
      ...(member.expiryDate ? { expiryDate: member.expiryDate } : {}),
      status: member.status,
      billingCycle: member.billingCycle,
      ...(customDays !== null ? { customDays } : {}),
      autoCalcExpiry: member.autoCalcExpiry,
      ...(reminderDays !== null ? { reminderDays } : {}),
      ...(member.wechat.trim() ? { wechat: member.wechat.trim().slice(0, LIMITS.wechat) } : {}),
      ...(member.email.trim() ? { email: member.email.trim().slice(0, LIMITS.email) } : {}),
    });
  }

  return {
    ok: true,
    payload: {
      enabled: draft.enabled,
      splitMode: draft.splitMode,
      ...(draft.account.trim() ? { account: draft.account.trim().slice(0, LIMITS.account) } : {}),
      ...(draft.cardLast4.trim() ? { cardLast4: draft.cardLast4.trim().slice(0, LIMITS.cardLast4) } : {}),
      members,
    },
  };
}
