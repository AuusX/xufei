import { apiFetch } from "@/lib/api-client";
import { assertDateOnly } from "@/lib/time/date-only";
import { getApiLocale } from "@/i18n/api-locale";
import { translate } from "@/i18n/messages";
import { getCurrentUserId, pb, type RecordModel } from "@/lib/pocketbase";
import {
  apiSubscriptionSchema,
  subscriptionsListResponseSchema,
  subscriptionResponseSchema,
  subscriptionDeleteResponseSchema,
  type ApiSubscription,
} from "@/lib/api/schemas/subscriptions";
import { isCloudflareRuntime } from "./runtime";
import {
  REPEAT_REMINDER_INTERVALS,
  REPEAT_REMINDER_WINDOWS,
  type RepeatReminderInterval,
  type RepeatReminderWindow,
  type Subscription,
  type SubscriptionDraft,
} from "@/types/subscription";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function normalizeRepeatReminderInterval(value: unknown): RepeatReminderInterval {
  return typeof value === "string" && REPEAT_REMINDER_INTERVALS.includes(value as RepeatReminderInterval)
    ? value as RepeatReminderInterval
    : "1h";
}

function normalizeRepeatReminderWindow(value: unknown): RepeatReminderWindow {
  return typeof value === "string" && REPEAT_REMINDER_WINDOWS.includes(value as RepeatReminderWindow)
    ? value as RepeatReminderWindow
    : "72h";
}

function normalizeSubscriptionRecord(row: unknown): unknown {
  if (!isRecord(row)) return row;
  // PocketBase SDK record 与 Worker API row 不完全同形；这里先收敛字段，再交给 shared schema。
  const normalized: Record<string, unknown> = {
    id: row["id"],
    name: row["name"],
    price: row["price"],
    currency: row["currency"],
    billingCycle: row["billingCycle"],
    category: row["category"],
    status: row["status"],
    startDate: row["startDate"],
    nextBillingDate: row["nextBillingDate"],
    autoCalculateNextBillingDate: row["autoCalculateNextBillingDate"],
    reminderDays: row["reminderDays"],
    repeatReminderEnabled: row["repeatReminderEnabled"] === true,
    repeatReminderInterval: normalizeRepeatReminderInterval(row["repeatReminderInterval"]),
    repeatReminderWindow: normalizeRepeatReminderWindow(row["repeatReminderWindow"]),
  };
  if (typeof row["customDays"] === "number") normalized["customDays"] = row["customDays"];
  if (Array.isArray(row["tags"])) normalized["tags"] = row["tags"];

  for (const key of ["logo", "paymentMethod", "trialEndDate", "website", "notes"] as const) {
    const value = optionalNonEmptyString(row[key]);
    if (value !== undefined) normalized[key] = value;
  }
  const createdAt = optionalNonEmptyString(row["createdAt"]) ?? optionalNonEmptyString(row["created"]);
  if (createdAt !== undefined) normalized["createdAt"] = createdAt;
  const updatedAt = optionalNonEmptyString(row["updatedAt"]) ?? optionalNonEmptyString(row["updated"]);
  if (updatedAt !== undefined) normalized["updatedAt"] = updatedAt;

  return normalized;
}

export function fromApiSubscription(row: ApiSubscription | RecordModel): Subscription {
  const parsedRow = apiSubscriptionSchema.parse(normalizeSubscriptionRecord(row));
  const base = {
    id: parsedRow.id,
    name: parsedRow.name,
    logo: parsedRow.logo,
    price: parsedRow.price,
    currency: parsedRow.currency,
    category: parsedRow.category,
    status: parsedRow.status,
    paymentMethod: parsedRow.paymentMethod,
    startDate: assertDateOnly(parsedRow.startDate),
    nextBillingDate: assertDateOnly(parsedRow.nextBillingDate),
    autoCalculateNextBillingDate: parsedRow.autoCalculateNextBillingDate,
    trialEndDate: parsedRow.trialEndDate ? assertDateOnly(parsedRow.trialEndDate) : undefined,
    website: parsedRow.website,
    notes: parsedRow.notes,
    tags: parsedRow.tags ?? [],
    reminderDays: parsedRow.reminderDays,
    repeatReminderEnabled: parsedRow.repeatReminderEnabled,
    repeatReminderInterval: parsedRow.repeatReminderInterval,
    repeatReminderWindow: parsedRow.repeatReminderWindow,
    extra: parsedRow.extra,
  };
  if (parsedRow.billingCycle === "custom") {
    // domain union 要求 custom 一定有 customDays；缺失时按 1 天兜底，避免表单回填不可编辑。
    return { ...base, billingCycle: "custom", customDays: parsedRow.customDays ?? 1 };
  }
  return { ...base, billingCycle: parsedRow.billingCycle, customDays: undefined };
}

export function toSubscriptionWritePayload(sub: SubscriptionDraft | Subscription) {
  return {
    name: sub.name,
    logo: sub.logo ?? null,
    price: sub.price,
    currency: sub.currency,
    billingCycle: sub.billingCycle,
    // null 表示服务端应清空可选字段；undefined 会在 PocketBase/Worker 两端产生不同 patch 语义。
    customDays: sub.customDays ?? null,
    category: sub.category,
    status: sub.status,
    paymentMethod: sub.paymentMethod ?? null,
    startDate: sub.startDate,
    nextBillingDate: sub.nextBillingDate,
    autoCalculateNextBillingDate: sub.autoCalculateNextBillingDate,
    trialEndDate: sub.trialEndDate ?? null,
    website: sub.website ?? null,
    notes: sub.notes ?? null,
    tags: sub.tags ?? [],
    reminderDays: sub.reminderDays,
    repeatReminderEnabled: sub.repeatReminderEnabled,
    repeatReminderInterval: sub.repeatReminderInterval,
    repeatReminderWindow: sub.repeatReminderWindow,
    // extra 是导入/seed 的幂等通道；编辑普通字段时必须随记录保留，避免重复导入失效。
    extra: sub.extra ?? {},
  };
}

export const subscriptionService = {
  async list(): Promise<Subscription[]> {
    const userId = getCurrentUserId();
    if (!userId) return [];
    if (isCloudflareRuntime) {
      const data = await apiFetch("/api/app/subscriptions", subscriptionsListResponseSchema);
      return data.subscriptions.map(fromApiSubscription);
    }
    const rows = await pb.collection("subscriptions").getFullList<ApiSubscription>({
      filter: `user = "${userId}"`,
      sort: "-created",
    });
    return rows.map(fromApiSubscription);
  },

  async create(sub: SubscriptionDraft): Promise<Subscription> {
    const userId = getCurrentUserId();
    if (!userId) throw new Error(translate(getApiLocale(), "auth.loginRequired"));
    const payload = toSubscriptionWritePayload(sub);
    if (isCloudflareRuntime) {
      const data = await apiFetch("/api/app/subscriptions", subscriptionResponseSchema, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return fromApiSubscription(data.subscription);
    }
    const row = await pb.collection("subscriptions").create<ApiSubscription>({ ...payload, user: userId });
    return fromApiSubscription(row);
  },

  async update(sub: Subscription): Promise<Subscription> {
    const payload = toSubscriptionWritePayload(sub);
    if (isCloudflareRuntime) {
      const data = await apiFetch(`/api/app/subscriptions/${sub.id}`, subscriptionResponseSchema, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      return fromApiSubscription(data.subscription);
    }
    const row = await pb.collection("subscriptions").update<ApiSubscription>(sub.id, payload);
    return fromApiSubscription(row);
  },

  async delete(id: string): Promise<void> {
    if (isCloudflareRuntime) {
      await apiFetch(`/api/app/subscriptions/${id}`, subscriptionDeleteResponseSchema, { method: "DELETE" });
      return;
    }
    await pb.collection("subscriptions").delete(id);
  },
};
