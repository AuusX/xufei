/**
 * 货币展示工具（前端 UI 用）。
 *
 * 背景：
 * - 多个组件里都有 `new Intl.NumberFormat(...).format(...)` 的重复实现
 * - 集中到这里方便统一展示规则与异常兜底
 */

/**
 * 格式化金额为带货币符号的字符串。
 *
 * 注意：
 * - `Intl.NumberFormat` 会在 currency 非法时抛错；这里做兜底避免页面崩溃
 */
export function formatCurrency(amount: number, currency: string, locale = "zh-CN"): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2)}`;
  }
}
