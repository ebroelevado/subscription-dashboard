"use client";

import { useMemo, useState } from "react";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency } from "@/lib/currency";

const COLORS = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#06b6d4",
];

function PieTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; payload?: { fill?: string; amount?: number } }>;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const data = payload[0];
  const amount = Number(data.payload?.amount ?? 0);
  return (
    <div className="rounded-xl border bg-popover/95 px-3 py-2 text-sm shadow-xl min-w-[150px] backdrop-blur">
      <div className="flex items-center gap-2 mb-1">
        <div
          className="size-3 rounded-full"
          style={{ backgroundColor: data.payload?.fill }}
        />
        <span className="font-semibold">{data.name}</span>
      </div>
      <p className="text-muted-foreground text-xs">
        Weight: <span className="font-semibold text-foreground">{(data.value ?? 0).toFixed(1)}%</span>
      </p>
      <p className="text-muted-foreground text-xs">
        Amount: <span className="font-semibold text-foreground">{formatCurrency(amount, currency)}</span>
      </p>
    </div>
  );
}

export interface PieDataPoint {
  name: string;
  value: number;
  amount: number;
}

export default function ClientPieChart({ data, currency }: { data: PieDataPoint[]; currency: string }) {
  const normalizedData = useMemo(
    () =>
      data
        .filter((entry) => entry.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 8)
        .map((entry, index) => ({
          ...entry,
          fill: COLORS[index % COLORS.length],
        })),
    [data],
  );

  const [selectedSlice, setSelectedSlice] = useState<(PieDataPoint & { fill: string }) | null>(null);

  const total = normalizedData.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="flex flex-col h-full gap-3">
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={normalizedData}
            cx="50%"
            cy="50%"
            innerRadius={80}
            outerRadius={114}
            paddingAngle={2}
            cornerRadius={6}
            dataKey="value"
            stroke="hsl(var(--background))"
            strokeWidth={2}
            startAngle={90}
            endAngle={-270}
            onClick={(_, index) => setSelectedSlice(normalizedData[index] ?? null)}
          >
            {normalizedData.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} />
            ))}
          </Pie>
          <Tooltip content={<PieTooltip currency={currency} />} />
          <text x="50%" y="43%" textAnchor="middle" className="fill-muted-foreground text-[11px]">
            Top Clients
          </text>
          <text x="50%" y="52%" textAnchor="middle" className="fill-foreground text-base font-bold">
            {total.toFixed(1)}%
          </text>
          <text x="50%" y="58%" textAnchor="middle" className="fill-muted-foreground text-[11px]">
            Revenue share
          </text>
        </PieChart>
      </ResponsiveContainer>

      {selectedSlice && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: selectedSlice.fill }} />
            <span className="font-semibold">{selectedSlice.name}</span>
          </div>
          <div className="mt-1 text-muted-foreground">
            <span>{selectedSlice.value.toFixed(1)}%</span>
            <span className="mx-2">·</span>
            <span className="font-medium text-foreground">{formatCurrency(selectedSlice.amount, currency)}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {normalizedData.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-3 rounded-md px-2 py-0.5 bg-muted/20">
            <div className="flex items-center gap-2 min-w-0">
              <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.fill }} />
              <span className="truncate text-foreground">{entry.name}</span>
            </div>
            <div className="text-right leading-tight">
              <div className="font-semibold tabular-nums text-muted-foreground">{entry.value.toFixed(1)}%</div>
              <div className="font-medium tabular-nums text-foreground">{formatCurrency(entry.amount, currency)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
