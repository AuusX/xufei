export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const THEME_VARIANTS = ["emerald", "ocean", "sunset", "lavender", "rose", "custom"] as const;
export type ThemeVariant = (typeof THEME_VARIANTS)[number];

export const SUBSCRIPTION_STATUSES = ["trial", "active", "expired", "paused", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_CYCLES = ["weekly", "monthly", "quarterly", "semi-annual", "annual", "custom", "one-time"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const NOTIFICATION_CHANNELS = ["telegram", "notifyx", "webhook", "wechat", "email", "bark"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const REPEAT_REMINDER_INTERVALS = ["1h", "3h", "6h", "12h", "24h"] as const;
export type RepeatReminderInterval = (typeof REPEAT_REMINDER_INTERVALS)[number];

export const REPEAT_REMINDER_WINDOWS = ["24h", "48h", "72h", "full"] as const;
export type RepeatReminderWindow = (typeof REPEAT_REMINDER_WINDOWS)[number];

export const EXCHANGE_RATE_PROVIDERS = ["exchange-api", "floatrates"] as const;
export type ExchangeRateProvider = (typeof EXCHANGE_RATE_PROVIDERS)[number];

export type DateOnly = string & { readonly __brand: "DateOnly" };
export type LocalTime = string & { readonly __brand: "LocalTime" };

export const INHERIT_REMINDER_DAYS = -1;
export const DEFAULT_NOTIFICATION_REMINDER_DAYS = 3;
export const MAX_REMINDER_DAYS = 3650;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidDateOnly(value: string): boolean {
  // date-only 是跨 Go/PocketBase、D1 和前端的契约；禁止带时区的 ISO datetime 混入。
  if (!DATE_ONLY_RE.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(timestamp)) return false;
  return new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function isValidLocalTime(value: string): boolean {
  return LOCAL_TIME_RE.test(value);
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeExchangeRateProvider(value: unknown): ExchangeRateProvider {
  // frankfurter 是旧 UI 文案/缓存里的历史值；彻底切到 exchange-api 前先在边界归一。
  if (value === "exchange-api" || value === "frankfurter") return "exchange-api";
  if (value === "floatrates") return "floatrates";
  return "floatrates";
}

export function isValidReminderDays(value: number): boolean {
  return Number.isInteger(value) && value >= INHERIT_REMINDER_DAYS && value <= MAX_REMINDER_DAYS;
}

export function isInheritReminderDays(value: number): boolean {
  return value === INHERIT_REMINDER_DAYS;
}

export function effectiveReminderDays(reminderDays: number, notificationReminderDays: number): number {
  return isInheritReminderDays(reminderDays) ? notificationReminderDays : reminderDays;
}
