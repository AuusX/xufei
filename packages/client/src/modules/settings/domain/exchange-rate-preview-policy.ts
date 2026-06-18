import type { ConfigItem } from "@/types/config";
import type { ExchangeRates } from "@/lib/api/schemas/exchange-rates";
import { COMMON_CURRENCY_PRIORITY } from "@/lib/currency-data";

const EXCHANGE_RATE_PREVIEW_LIMIT = 8;
const EXCHANGE_RATE_CNY_REFERENCE_CURRENCY = "CNY";

const EXCHANGE_RATE_PRIMARY_PREVIEW_CURRENCIES = COMMON_CURRENCY_PRIORITY.filter(
  (currency) => currency !== EXCHANGE_RATE_CNY_REFERENCE_CURRENCY,
);

const EXCHANGE_RATE_FALLBACK_PREVIEW_CURRENCIES = [
  "JPY", "CAD", "CHF", "HKD", "SGD", "NZD", "SEK", "NOK", "DKK",
  "PLN", "MXN", "BRL", "INR", "IDR", "THB", "MYR", "ZAR", "AED", "SAR",
] as const;

const EXCHANGE_RATE_PREVIEW_CURRENCY_ORDER = [
  ...EXCHANGE_RATE_PRIMARY_PREVIEW_CURRENCIES,
  ...EXCHANGE_RATE_FALLBACK_PREVIEW_CURRENCIES,
] as const;

function getExchangeRatePreviewCurrencyOrder(defaultCurrency: string): readonly string[] {
  if (defaultCurrency === EXCHANGE_RATE_CNY_REFERENCE_CURRENCY) {
    return EXCHANGE_RATE_PREVIEW_CURRENCY_ORDER;
  }

  return [
    EXCHANGE_RATE_CNY_REFERENCE_CURRENCY,
    ...EXCHANGE_RATE_PREVIEW_CURRENCY_ORDER,
  ];
}

export function getExchangeRatePreviewCurrencies(
  currencies: readonly ConfigItem[],
  defaultCurrency: string,
  limit = EXCHANGE_RATE_PREVIEW_LIMIT,
): ConfigItem[] {
  const currencyByValue = new Map<string, ConfigItem>();
  for (const currency of currencies) {
    if (!currencyByValue.has(currency.value)) {
      currencyByValue.set(currency.value, currency);
    }
  }

  const previewCurrencies: ConfigItem[] = [];
  const seen = new Set<string>();
  const previewCurrencyOrder = getExchangeRatePreviewCurrencyOrder(defaultCurrency);

  // 汇率预览是产品级常用币种策略；非 CNY 统计货币下优先保留 CNY，降低中文用户跨币种预算的心算成本。
  for (const currencyValue of previewCurrencyOrder) {
    if (previewCurrencies.length >= limit) break;
    if (seen.has(currencyValue) || currencyValue === defaultCurrency) continue;

    seen.add(currencyValue);
    const currency = currencyByValue.get(currencyValue);
    if (!currency || currency.enabled === false) continue;

    previewCurrencies.push(currency);
  }

  return previewCurrencies;
}

export function getDirectExchangeRateQuote(
  rates: ExchangeRates,
  fromCurrency: string,
  toCurrency: string,
): number {
  const fromRate = rates[fromCurrency] || 1;
  const toRate = rates[toCurrency] || 1;

  // 设置页预览按用户消费视角报价：1 个订阅原币折算为多少统计货币，而不是展示汇率源内部的反向基准。
  return toRate / fromRate;
}
