/**
 * 拼车到期推送提醒（定时任务）。
 *
 * 由 index.ts 的补丁在 Cron 阶段调用 `runCarpoolReminders(env)`。对每个配置了到期提醒的用户，
 * 找出「实际到期日在提醒窗口内、且尚未针对该到期日提醒过」的车友，汇总成一条消息，复用上游
 * `sendChannels` 走用户在设置里启用的通知渠道（Telegram/邮件/webhook…）发送。
 *
 * Cron 每分钟触发，因此用 `carpool_member_meta.reminded_for` 记录「已针对哪个到期日提醒过」来去重：
 * 每个到期日只发一次（发送成功与否都记，避免渠道抖动时每分钟轰炸）。成员被重新保存（到期日可能变）
 * 时 overlay 行重建，reminded_for 归空，于是会对新的到期日重新提醒。
 */
import type { NotificationEmailMessage } from "@renewlet/shared/email-template";
import { getSettings } from "../../db";
import { sendChannels } from "../../notification-channel-send";
import { DEFAULT_SERVER_I18N_LOCALE } from "../../server-i18n";
import type { Env } from "../../types";
import { listActiveSubscriptions } from "./store";

function overlayKey(subscriptionId: string, memberId: string): string {
  return `${subscriptionId} ${memberId}`;
}

/** 到期日与「今天」相差的天数（UTC，date-only）；负数=已过期。 */
function daysBetween(now: Date, expiry: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;
  const target = new Date(`${expiry}T00:00:00Z`).getTime();
  if (Number.isNaN(target)) return null;
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round((target - today) / 86_400_000);
}

interface DueMember {
  subId: string;
  subName: string;
  memberId: string;
  memberName: string;
  expiry: string;
  days: number;
}

async function fetchRemindedMap(env: Env, userId: string): Promise<Map<string, string>> {
  const rows = await env.DB.prepare(
    `SELECT subscription_id, member_id, reminded_for FROM carpool_member_meta WHERE user_id = ? AND reminded_for IS NOT NULL`,
  )
    .bind(userId)
    .all<{ subscription_id: string; member_id: string; reminded_for: string | null }>();
  const map = new Map<string, string>();
  for (const row of rows.results ?? []) {
    if (row.reminded_for) map.set(overlayKey(row.subscription_id, row.member_id), row.reminded_for);
  }
  return map;
}

function buildMessage(due: DueMember[], now: Date): NotificationEmailMessage {
  const lines = due.map((d) => {
    const when = d.days < 0 ? `已过期 ${-d.days} 天` : d.days === 0 ? "今天到期" : `${d.days} 天后到期`;
    return `· ${d.subName} — ${d.memberName}：${when}（${d.expiry}）`;
  });
  return {
    title: "拼车到期提醒",
    content: `以下拼车车友即将到期或已过期：\n${lines.join("\n")}`,
    timestamp: now.toISOString(),
    hasPayload: false,
    items: [],
  };
}

async function remindUser(env: Env, userId: string, now: Date): Promise<void> {
  const [subs, remindedMap] = await Promise.all([listActiveSubscriptions(env, userId), fetchRemindedMap(env, userId)]);

  const due: DueMember[] = [];
  for (const sub of subs) {
    for (const member of sub.members) {
      if (member.reminderDays < 0 || !member.effectiveExpiry) continue;
      const days = daysBetween(now, member.effectiveExpiry);
      if (days === null || days > member.reminderDays) continue; // 还没进入提醒窗口
      if (remindedMap.get(overlayKey(sub.id, member.id)) === member.effectiveExpiry) continue; // 已提醒过该到期日
      due.push({ subId: sub.id, subName: sub.name, memberId: member.id, memberName: member.name, expiry: member.effectiveExpiry, days });
    }
  }
  if (due.length === 0) return;

  const settings = await getSettings(env, userId);
  if (settings.enabledChannels.length > 0) {
    // sendChannels 是「尽力发送」，不抛异常；返回的 summary 这里不需要。
    await sendChannels(env, settings.enabledChannels, settings, buildMessage(due, now), DEFAULT_SERVER_I18N_LOCALE);
  }

  // 记下已提醒的到期日（发送成败都记，防止每分钟重复轰炸）。
  await env.DB.batch(
    due.map((d) =>
      env.DB.prepare(`UPDATE carpool_member_meta SET reminded_for = ? WHERE user_id = ? AND subscription_id = ? AND member_id = ?`).bind(
        d.expiry,
        userId,
        d.subId,
        d.memberId,
      ),
    ),
  );
}

/** Cron 入口：为所有配置了到期提醒的用户发送到期推送。 */
export async function runCarpoolReminders(env: Env): Promise<void> {
  const now = new Date();
  // Cron 每分钟触发；先廉价筛出「配置了提醒」的用户，没有就直接返回。
  const flagged = await env.DB.prepare(
    `SELECT DISTINCT user_id FROM carpool_member_meta WHERE reminder_days IS NOT NULL AND reminder_days >= 0`,
  ).all<{ user_id: string }>();

  for (const { user_id: userId } of flagged.results ?? []) {
    try {
      await remindUser(env, userId, now);
    } catch (error) {
      console.error("carpool_reminder_failed", {
        event: "carpool_reminder_failed",
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
