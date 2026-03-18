"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { formatCurrency } from "@/lib/currency";
import { useTranslations } from "next-intl";

export type ContributionMode = "income" | "cost" | "net";

export interface PlatformContributionRow {
  platformId: string;
  platform: string;
  revenue: number;
  cost: number;
  net: number;
}

interface PlatformContributionChartProps {
  data: PlatformContributionRow[];
  mode: ContributionMode;
  currency: string;
}

function getValue(row: PlatformContributionRow, mode: ContributionMode) {
  if (mode === "income") return row.revenue;
  if (mode === "cost") return row.cost;
  return row.net;
}

function ContributionTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  currency: string;
}) {
  const t = useTranslations("analytics");
  if (!active || !payload?.length) return null;

  const value = Number(payload[0]?.value ?? 0);
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-lg">
      <p className="font-medium">{label}</p>
      <p className="text-muted-foreground">
        {t("valueLabel", { fallback: "Value" })}: {formatCurrency(value, currency)}
      </p>
    </div>
  );
}

export default function PlatformContributionChart({
  data,
  mode,
  currency,
}: PlatformContributionChartProps) {
  const chartData = data
    .map((row) => ({
      ...row,
      value: getValue(row, mode),
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  const barColor = mode === "income" ? "#10b981" : mode === "cost" ? "#ef4444" : "#3b82f6";

  return (
    <div className="h-full">
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} layout="vertical" barSize={32} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          type="number"
          tick={{ fontSize: 12 }}
          className="fill-muted-foreground"
          tickFormatter={(value) => formatCurrency(Number(value), currency)}
        />
        <YAxis
          type="category"
          dataKey="platform"
          width={70}
          tick={{ fontSize: 12 }}
          className="fill-muted-foreground"
        />
        <Tooltip cursor={false} content={<ContributionTooltip currency={currency} />} />
        <Bar dataKey="value" radius={[0, 6, 6, 0]}>
          {chartData.map((entry) => {
            const fill = mode === "net" ? (entry.value >= 0 ? "#10b981" : "#ef4444") : barColor;
            return <Cell key={entry.platformId} fill={fill} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    </div>
  );
}
