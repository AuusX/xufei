import {
  type CloudBackupPolicy,
  type CloudBackupScheduleWeekday,
} from "@renewlet/shared/schemas/cloud-backup";
import type { ApiAppSettings } from "@renewlet/shared/schemas/settings";
import { createDefaultAppSettings } from "@renewlet/shared/settings-defaults";

type CloudBackupScheduleTarget = {
  policy: CloudBackupPolicy;
  lastBackupAt: string | null;
};

export function cloudBackupTargetDue(target: CloudBackupScheduleTarget, timezone: string, now: Date): boolean {
  if (!target.policy.scheduleEnabled) return false;
  const scheduledAt = latestCloudBackupScheduledInstant(now, timezone, target.policy);
  if (!scheduledAt || scheduledAt.getTime() > now.getTime()) return false;
  // 到期判断用“最近一次应执行时间”补跑停机窗口；lastBackupAt 只按当前 provider 自己的状态比较。
  if (!target.lastBackupAt) return true;
  const last = new Date(target.lastBackupAt);
  if (Number.isNaN(last.getTime())) return true;
  return last.getTime() < scheduledAt.getTime();
}

export function createDefaultFallbackSettings(): ApiAppSettings {
  return createDefaultAppSettings();
}

function latestCloudBackupScheduledInstant(now: Date, timezone: string, policy: CloudBackupPolicy): Date | null {
  const safeTimezone = validTimeZone(timezone) ? timezone : "UTC";
  // 云备份定时使用用户 IANA timezone；非法设置回退 UTC，避免 scheduled 任务永久跳过。
  const localDate = dateOnlyInZone(now, safeTimezone);
  let scheduledDate = localDate;
  if (policy.scheduleFrequency === "weekly") {
    scheduledDate = dateMinusDays(localDate, weekdayDistanceBack(weekdayNameInZone(now, safeTimezone), policy.scheduleWeekday));
  }
  let scheduled = new Date(zonedWallTimeToUtc(scheduledDate, policy.scheduleTime, safeTimezone));
  if (scheduled.getTime() > now.getTime()) {
    scheduledDate = dateMinusDays(scheduledDate, policy.scheduleFrequency === "weekly" ? 7 : 1);
    scheduled = new Date(zonedWallTimeToUtc(scheduledDate, policy.scheduleTime, safeTimezone));
  }
  return Number.isNaN(scheduled.getTime()) ? null : scheduled;
}

function validTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function dateOnlyInZone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

function weekdayNameInZone(date: Date, timezone: string): CloudBackupScheduleWeekday {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(date).toLowerCase();
  return cloudBackupWeekdayFromName(name);
}

function cloudBackupWeekdayFromName(name: string): CloudBackupScheduleWeekday {
  if (name === "sunday") return "sunday";
  if (name === "tuesday") return "tuesday";
  if (name === "wednesday") return "wednesday";
  if (name === "thursday") return "thursday";
  if (name === "friday") return "friday";
  if (name === "saturday") return "saturday";
  return "monday";
}

function weekdayDistanceBack(current: CloudBackupScheduleWeekday, target: CloudBackupScheduleWeekday): number {
  const order: CloudBackupScheduleWeekday[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return (order.indexOf(current) - order.indexOf(target) + 7) % 7;
}

function dateMinusDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

function zonedWallTimeToUtc(date: string, time: string, timezone: string): string {
  const [hour = "0", minute = "0"] = time.split(":");
  const guess = new Date(`${date}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:00.000Z`);
  for (let offset = -26; offset <= 26; offset += 1) {
    const utc = new Date(guess.getTime() + offset * 60 * 60 * 1000).toISOString();
    const shownDate = dateOnlyInZone(new Date(utc), timezone);
    const shownTime = localTimeInZone(new Date(utc), timezone);
    if (shownDate === date && shownTime === time) return utc;
  }
  return guess.toISOString();
}

function localTimeInZone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false, hourCycle: "h23" }).formatToParts(date);
  return `${parts.find((part) => part.type === "hour")?.value}:${parts.find((part) => part.type === "minute")?.value}`;
}
