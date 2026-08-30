/**
 * 拼车的「今天 / 现在几点」一律按**用户设置的时区**取，而不是 UTC。
 *
 * 卡片上的到期徽标是浏览器本地时间算的，续费和提醒却跑在 Worker 上；如果服务端用 UTC，UTC+8 的用户
 * 在凌晨 0–8 点操作就会差一天——续费可能续到「今天」（等于没续），提醒文案也会说错天数。
 * 复用上游的 `getSettings().timezone`（与自动续订、云备份、通知调度同一个设置）。
 */
import { getSettings } from "../../db";
import { dateOnlyInZone, localTimeInZone } from "../../notification-schedule";
import type { Env } from "../../types";

/** 读用户时区；设置读不到时退回 UTC（与上游 fallback 行为一致）。 */
export async function userTimezone(env: Env, userId: string): Promise<string> {
  try {
    const settings = await getSettings(env, userId);
    return settings.timezone || "UTC";
  } catch {
    return "UTC";
  }
}

/** 用户时区下的今天（YYYY-MM-DD）。 */
export async function todayForUser(env: Env, userId: string, now: Date = new Date()): Promise<string> {
  return dateOnlyInZone(now, await userTimezone(env, userId));
}

/** 用户时区下的当前小时（0-23）；用于把提醒推送控制在白天发。 */
export function hourInZone(now: Date, timezone: string): number {
  const [hour] = localTimeInZone(now, timezone).split(":");
  const parsed = Number.parseInt(hour ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
