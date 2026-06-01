import { apiFetch } from "@/lib/api-client";
import { settingsResponseSchema, settingsUpdateBodySchema, type ApiAppSettings } from "@/lib/api/schemas/settings";
import { getApiLocale } from "@/i18n/api-locale";
import { translate } from "@/i18n/messages";
import { getSystemTimeZone } from "@/lib/time/time-zone";
import { getCurrentUserId, pb, type RecordModel } from "@/lib/pocketbase";
import { cleanBuiltInIconSourceSettingsPatch, mergeBuiltInIconSourceSettings } from "@renewlet/shared/built-in-icons";
import {
  DEFAULT_SETTINGS,
  WEBHOOK_HEADERS_PLACEHOLDER,
  WEBHOOK_PAYLOAD_PLACEHOLDER,
  type AppSettings,
} from "@/types/subscription";
import { isCloudflareRuntime } from "./runtime";

function clearLegacyWebhookExample(value: string, legacyExample: string) {
  return value.trim() === legacyExample ? "" : value;
}

export function normalizeSettings(value: unknown): AppSettings {
  const parsed = settingsUpdateBodySchema.safeParse(value);
  const defaults = { ...DEFAULT_SETTINGS, timezone: getSystemTimeZone("UTC") };
  if (!parsed.success) return defaults;
  // settingsUpdateBodySchema 是 partial；历史设置缺 notificationReminderDays 等字段时只补默认值，不改订阅显式提醒天数。
  const patch = Object.fromEntries(
    Object.entries(parsed.data).filter(([, item]) => item !== undefined),
  ) as Partial<AppSettings>;
  const settings: AppSettings = {
    ...defaults,
    ...patch,
    builtInIconSources: mergeBuiltInIconSourceSettings(defaults.builtInIconSources, cleanBuiltInIconSourceSettingsPatch(patch.builtInIconSources)),
  };
  return {
    ...settings,
    webhookHeaders: clearLegacyWebhookExample(settings.webhookHeaders, WEBHOOK_HEADERS_PLACEHOLDER),
    webhookPayload: clearLegacyWebhookExample(settings.webhookPayload, WEBHOOK_PAYLOAD_PLACEHOLDER),
  };
}

export const settingsService = {
  async get(): Promise<AppSettings> {
    const userId = getCurrentUserId();
    if (!userId) return DEFAULT_SETTINGS;
    if (isCloudflareRuntime) {
      const data = await apiFetch("/api/app/settings", settingsResponseSchema);
      return normalizeSettings(data.settings);
    }
    const rows = await pb.collection("settings").getFullList<RecordModel>({
      filter: `user = "${userId}"`,
      perPage: 1,
    });
    return normalizeSettings(rows[0]?.["settings"]);
  },

  async update(current: AppSettings, patch: Partial<AppSettings>): Promise<AppSettings> {
    const userId = getCurrentUserId();
    if (!userId) throw new Error(translate(getApiLocale(), "auth.loginRequired"));
    const next = normalizeSettings({ ...current, ...patch });
    if (isCloudflareRuntime) {
      // Worker 只接受 shared ApiAppSettings；前端 AppSettings 的历史占位符先在 normalize 阶段被剥掉。
      const data = await apiFetch("/api/app/settings", settingsResponseSchema, {
        method: "PUT",
        body: JSON.stringify(next satisfies ApiAppSettings),
      });
      return normalizeSettings(data.settings);
    }
    const rows = await pb.collection("settings").getFullList<RecordModel>({
      filter: `user = "${userId}"`,
      perPage: 1,
    });
    if (rows[0]) {
      await pb.collection("settings").update(rows[0].id, { settings: next });
    } else {
      await pb.collection("settings").create({ user: userId, settings: next });
    }
    return next;
  },
};
