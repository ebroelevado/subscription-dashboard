"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/currency";
import { useState } from "react";

interface ClientData {
  name: string;
  value: number; // Represents the displayed value (monthly or total)
  weight: number; // Represents the progress bar width (monthlyWeight or weight)
}

export default function TopClientsList({
  data,
  currency,
}: {
  data: ClientData[];
  currency: string;
}) {
  const t = useTranslations("analytics");

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground text-sm text-center">
          {t("noDataAvailable")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 h-full overflow-y-auto pr-2 custom-scrollbar">
      {data.map((client, index) => (
        <div key={index} className="flex flex-col justify-center gap-1.5 p-3 rounded-lg hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 overflow-hidden">
              <span className="text-xs font-bold text-muted-foreground w-4 text-right">
                {index + 1}.
              </span>
              <p className="text-sm font-semibold truncate max-w-[140px] sm:max-w-[200px]">
                {client.name}
              </p>
            </div>
            
            <div className="flex flex-col items-end whitespace-nowrap">
              <p className="text-sm font-bold tabular-nums">
                {formatCurrency(client.value, currency)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 pl-7">
            <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-1000 ease-out"
                style={{ width: `${Math.max(client.weight, 1)}%` }}
              />
            </div>
            <span className="text-[10px] font-bold text-muted-foreground w-9 text-right tabular-nums">
              {client.weight.toFixed(1)}%
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
