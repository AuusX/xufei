import { z } from "zod";
import { normalizeExchangeRateProvider } from "../runtime";

export const exchangeRateProviderSchema = z.enum(["exchange-api", "floatrates"]);

export { normalizeExchangeRateProvider };

export const exchangeRatesSchema = z.record(
  z.string().regex(/^[A-Z]{3}$/),
  z.number().finite().positive(),
);

export const exchangeApiUsdResponseSchema = z.object({
  date: z.string().min(1),
  usd: z.record(z.string(), z.number().finite().positive()),
}).passthrough();

export const floatRatesRateRowSchema = z.object({
  alphaCode: z.string().regex(/^[A-Z]{3}$/),
  rate: z.number().finite().positive(),
  date: z.string().min(1),
}).passthrough();

export const floatRatesResponseSchema = z.record(
  z.string().regex(/^[a-z]{3}$/),
  floatRatesRateRowSchema,
);

export const exchangeRateDataSchema = z.object({
  base: z.literal("USD"),
  date: z.string().min(1),
  rates: exchangeRatesSchema,
}).strict();

export const cachedExchangeRateDataSchema = exchangeRateDataSchema.extend({
  cachedAt: z.number().finite(),
  requestedProvider: exchangeRateProviderSchema,
  provider: exchangeRateProviderSchema,
}).strict();

export type ExchangeRateProvider = z.infer<typeof exchangeRateProviderSchema>;
export type ExchangeRates = z.infer<typeof exchangeRatesSchema>;
export type ExchangeRateData = z.infer<typeof exchangeRateDataSchema>;
export type CachedExchangeRateData = z.infer<typeof cachedExchangeRateDataSchema>;
