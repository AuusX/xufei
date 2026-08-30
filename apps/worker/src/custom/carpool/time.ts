/**
 * 拼车的「今天 / 现在几点」一律按**用户设置的时区**取，而不是 UTC。
 *
 * 卡片上的到期徽标是浏览器本地时间算的，续费和提醒却跑在 Worker 上；如果服务端用 UTC，UTC+8 的用户
 * 在凌晨 0–8 点操作就会差一天——续费可能续到「今天」（等于没续），提醒文案也会说错天数。
 * 时区取自上游 `getSettings().timezone`（与自动续订、云备份、通知调度同一个设置）。
 *
 * 日期格式化在本文件内自己实现，**不从上游模块引入**：上游同名工具曾在 `notification-schedule.ts`
 * 与 `time.ts` 之间搬家，跨版本同步时那种 import 会断。只依赖 `getSettings` 这一个稳定入口。
 */
import { getSettings } from "../../db";
import type { Env } from "../../types";

/** 无效时区退回 UTC，避免脏设置让 Intl 抛错。 */
function safeTimeZone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
    return timezone;
  } catch {
    return "UTC";
  }
}

/** 读用户时区；设置读不到时退回 UTC（与上游 fallback 行为一致）。 */
export async function userTimezone(env: Env, userId: string): Promise<string> {
  try {
    const settings = await getSettings(env, userId);
    return safeTimeZone(settings.timezone || "UTC");
  } catch {
    return "UTC";
  }
}

/** 指定时区下的 date-only（YYYY-MM-DD）。 */
export function dateOnlyInZone(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** 用户时区下的今天（YYYY-MM-DD）。 */
export async function todayForUser(env: Env, userId: string, now: Date = new Date()): Promise<string> {
  return dateOnlyInZone(now, await userTimezone(env, userId));
}

/** 指定时区下的当前小时（0-23）；用于把提醒推送控制在白天发。 */
export function hourInZone(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timezone),
    hour: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(now);
  const parsed = Number.parseInt(parts.find((part) => part.type === "hour")?.value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
