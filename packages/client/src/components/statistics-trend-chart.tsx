/**
 * 统计页费用走势柱状图。
 *
 * 架构位置：只渲染 statistics-model 生成的趋势 view model，不在组件内推导账单口径。
 */
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RechartsFrame } from "@/components/recharts-frame";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/I18nProvider";
import type { StatisticsTrendDatum } from "@/modules/subscriptions/domain/statistics-model";

const STATISTICS_TREND_CHART_HEIGHT = 280;

type TrendMode = "cashflow" | "amortized";

type TrendTooltipPayload = {
  value?: unknown;
  payload?: unknown;
};

type TrendTooltipProps = {
  active: boolean;
  payload: readonly TrendTooltipPayload[];
  mode: TrendMode;
};

interface StatisticsTrendChartProps {
  data: readonly StatisticsTrendDatum[];
  defaultCurrency: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrendTooltipProps(value: unknown, mode: TrendMode): TrendTooltipProps {
  if (!isRecord(value)) return { active: false, payload: [], mode };
  const payload = Array.isArray(value["payload"])
    ? value["payload"].filter(isRecord)
    : [];
  return {
    active: value["active"] === true,
    payload,
    mode,
  };
}

function trendModeValue(value: string): TrendMode {
  return value === "amortized" ? "amortized" : "cashflow";
}

export function StatisticsTrendChart({ data, defaultCurrency }: StatisticsTrendChartProps) {
  const { t, formatCurrency } = useI18n();
  const [mode, setMode] = useState<TrendMode>("cashflow");
  const chartTitle = mode === "cashflow" ? t("statistics.trendCashflow") : t("statistics.trendAmortized");
  const chartHint = mode === "cashflow" ? t("statistics.trendCashflowHint") : t("statistics.trendAmortizedHint");
  const hasTrendValue = data.some((item) => item.cashflow > 0 || item.amortized > 0);

  const CustomTooltip = ({ active, payload, mode: tooltipMode }: TrendTooltipProps) => {
    const first = payload[0];
    const source = first && isRecord(first.payload) ? first.payload : null;
    const monthLabel = typeof source?.["label"] === "string" ? source["label"] : "";
    const rawValue = first?.value;
    const value = typeof rawValue === "number" ? rawValue : 0;

    if (!active || !first) return null;

    return (
      <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-lg">
        <p className="text-sm font-medium text-foreground">{monthLabel}</p>
        <p className="text-sm text-muted-foreground">
          {tooltipMode === "cashflow" ? t("statistics.trendCashflow") : t("statistics.trendAmortized")}
        </p>
        <p className="text-sm text-foreground">{formatCurrency(value, defaultCurrency)}</p>
      </div>
    );
  };

  const renderChartContent = (contentMode: TrendMode) => (
    hasTrendValue ? (
      <div className="grid min-w-0 gap-3">
        <RechartsFrame height={STATISTICS_TREND_CHART_HEIGHT} testId="statistics-trend-chart-frame">
          <BarChart
            accessibilityLayer
            data={data}
            margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
            tabIndex={0}
            title={chartTitle}
          >
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              minTickGap={12}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              tickFormatter={(value) => formatCurrency(Number(value), defaultCurrency)}
              width={72}
              domain={[0, "dataMax"]}
            />
            <RechartsTooltip
              content={(props: unknown) => <CustomTooltip {...readTrendTooltipProps(props, contentMode)} />}
              cursor={false}
              isAnimationActive={false}
              offset={12}
              allowEscapeViewBox={{ x: true, y: true }}
              wrapperStyle={{ pointerEvents: "none" }}
            />
            <Bar
              dataKey={contentMode}
              fill="hsl(var(--chart-1))"
              radius={[4, 4, 0, 0]}
              maxBarSize={42}
              isAnimationActive={false}
              activeBar={{
                fill: "hsl(var(--chart-1))",
                fillOpacity: 0.88,
                stroke: "hsl(var(--chart-1))",
                strokeOpacity: 0.5,
                strokeWidth: 1,
              }}
            />
          </BarChart>
        </RechartsFrame>
        <div className="sr-only" role="list" aria-label={t("statistics.trendTableLabel")}>
          {data.map((item) => (
            <span key={item.monthKey} role="listitem">
              {t("statistics.trendAccessibleItem", {
                month: item.label,
                cashflow: formatCurrency(item.cashflow, defaultCurrency),
                amortized: formatCurrency(item.amortized, defaultCurrency),
              })}
            </span>
          ))}
        </div>
      </div>
    ) : (
      <div
        className="flex min-w-0 items-center justify-center text-muted-foreground"
        style={{ height: STATISTICS_TREND_CHART_HEIGHT }}
      >
        {t("statistics.trendEmpty")}
      </div>
    )
  );

  return (
    <section className="mb-8">
      <Tabs value={mode} onValueChange={(value) => setMode(trendModeValue(value))} className="min-w-0 rounded-xl border border-border bg-card p-6 shadow-card">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground">{t("statistics.trendTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{chartHint}</p>
          </div>
          <TabsList className="grid h-9 w-full grid-cols-2 rounded-md border border-border bg-background p-0.5 sm:w-auto">
            <TabsTrigger value="cashflow" className="h-8 rounded-[5px] px-2.5 text-xs shadow-none data-[state=active]:bg-secondary data-[state=active]:shadow-none sm:px-3">
              {t("statistics.trendCashflow")}
            </TabsTrigger>
            <TabsTrigger value="amortized" className="h-8 rounded-[5px] px-2.5 text-xs shadow-none data-[state=active]:bg-secondary data-[state=active]:shadow-none sm:px-3">
              {t("statistics.trendAmortized")}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="cashflow" className="mt-0">{renderChartContent("cashflow")}</TabsContent>
        <TabsContent value="amortized" className="mt-0">{renderChartContent("amortized")}</TabsContent>
      </Tabs>
    </section>
  );
}
