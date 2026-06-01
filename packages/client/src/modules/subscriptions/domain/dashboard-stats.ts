/**
 * 首页统计领域模型。
 *
 * 架构位置：
 * - 这里只计算“月支出、活跃数、7 天内续费、试用数”等首页概要。
 * - 汇率转换函数由 application hook 注入，domain 不关心汇率来源和缓存策略。
 */
import { toMonthlyAmount } from "@/lib/subscription-billing";
import { daysBetweenDateOnly, todayDateOnlyInTimeZone } from "@/lib/time/date-only";
import type { Subscription } from "@/types/subscription";
import { getEffectiveSubscriptionStatus, isEffectivelyActiveSubscription } from "./subscription-status";

interface BuildDashboardStatsInput {
  subscriptions: readonly Subscription[];
  defaultCurrency: string;
  convert: (amount: number, from: string, to: string) => number;
  now?: Date;
  timeZone?: string;
}

/** 构建首页概要统计模型。 */
export function buildDashboardStats({
  subscriptions,
  defaultCurrency,
  convert,
  now = new Date(),
  timeZone = "UTC",
}: BuildDashboardStatsInput) {
  const today = todayDateOnlyInTimeZone(now, timeZone);
  // 首页金额和数量使用有效状态，避免旧 active/trial 过期记录继续计入活跃月支出。
  const activeSubscriptions = subscriptions.filter((subscription) => isEffectivelyActiveSubscription(subscription, today));
  const totalMonthly = activeSubscriptions.reduce((sum, subscription) => {
    const amountInDefault = convert(subscription.price, subscription.currency, defaultCurrency);
    return sum + toMonthlyAmount(amountInDefault, subscription.billingCycle, subscription.customDays);
  }, 0);
  const upcomingCount = subscriptions.filter((subscription) => {
    if (!isEffectivelyActiveSubscription(subscription, today)) return false;
    if (subscription.billingCycle === "one-time") return false;
    // 注意： 这里是用户时区下的 0..7 天窗口，和 Cron 的发送时间窗口不是同一个概念。
    const days = daysBetweenDateOnly(today, subscription.nextBillingDate);
    return days <= 7 && days >= 0;
  }).length;
  // 试用数量也按有效状态统计：过期 trial 应归入 expired，而不是继续提醒用户关注转付费。
  const trialCount = subscriptions.filter((subscription) => getEffectiveSubscriptionStatus(subscription, today) === "trial").length;

  return {
    activeSubscriptions,
    totalMonthly,
    upcomingCount,
    trialCount,
  };
}
