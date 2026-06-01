import type { ApiAppSettings } from "./schemas/settings";
import { DEFAULT_BUILT_IN_ICON_SOURCES } from "./built-in-icons";
import { DEFAULT_NOTIFICATION_REMINDER_DAYS } from "./runtime";

export interface DefaultSettingsOptions {
  locale?: ApiAppSettings["locale"];
  timezone?: string;
}

export const DEFAULT_CUSTOM_THEME_COLOR = { h: 160, s: 84, l: 39 } as const;

export function createDefaultAppSettings(options: DefaultSettingsOptions = {}): ApiAppSettings {
  // 默认设置同时服务 PocketBase 首次写入和 D1 空库读取；不能依赖某一端私有字段。
  return {
    adminUsername: "admin",
    themeMode: "dark",
    themeVariant: "emerald",
    themeCustomColor: DEFAULT_CUSTOM_THEME_COLOR,
    locale: options.locale ?? "zh-CN",
    showExpired: true,
    defaultCurrency: "CNY",
    exchangeRateProvider: "floatrates",
    builtInIconSources: DEFAULT_BUILT_IN_ICON_SOURCES,
    monthlyBudget: 1500,
    timezone: options.timezone ?? "UTC",
    notificationTimeLocal: "08:00" as ApiAppSettings["notificationTimeLocal"],
    notificationReminderDays: DEFAULT_NOTIFICATION_REMINDER_DAYS,
    enabledChannels: [],
    testPhone: "",
    telegramBotToken: "",
    telegramChatId: "",
    notifyxApiKey: "",
    webhookUrl: "",
    webhookMethod: "POST",
    webhookHeaders: "",
    webhookPayload: "",
    wechatWebhookUrl: "",
    wechatMessageType: "text",
    wechatAddModeTag: false,
    wechatAtPhones: "",
    wechatAtAll: false,
    // 空 SMTP 表示走部署侧 fallback；Docker 和 Cloudflare 必须共享这套设置语义。
    smtpHost: "",
    smtpPort: "",
    smtpSecure: false,
    smtpUser: "",
    smtpPassword: "",
    smtpFrom: "",
    smtpReplyTo: "",
    notifyMultipleAddresses: false,
    recipientEmail: "",
    barkServerUrl: "https://api.day.app",
    barkDeviceKey: "",
    barkSilentPush: false,
  };
}
