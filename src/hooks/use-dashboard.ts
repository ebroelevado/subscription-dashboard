"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/fetch-api";
import { queryKeys } from "@/lib/query-keys";

export interface ClientGroup {
  clientId: string;
  clientName: string;
  clientPhone: string | null;
  overdueCount: number;
  expiringCount: number;
  okayCount: number;
  totalCount: number;
  maxDaysOverdue: number;
  minDaysLeft: number;
}

export interface DashboardStats {
  platformCount: number;
  activePlanCount: number;
  clientCount: number;
  activeSubscriptionCount: number;
  activeSeatCount: number;
  monthlyCost: number;
  monthlyRevenue: number;
  profit: number;
  thisMonthRevenue: number;
  thisMonthCost: number;
  thisMonthProfit: number;
  overdueGroups: ClientGroup[];
  expiringSoonGroups: ClientGroup[];
}

export function useDashboardStats() {
  return useQuery<DashboardStats>({
    queryKey: queryKeys.dashboardStats,
    queryFn: () => fetchApi<DashboardStats>("/api/dashboard/stats"),
    refetchInterval: 60_000,
  });
}
