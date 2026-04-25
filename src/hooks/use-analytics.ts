"use client";

import { useMutation, useQuery, keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/fetch-api";
import { queryKeys } from "@/lib/query-keys";
import { invalidateAll } from "@/lib/invalidate-helpers";

// ── Types ──

export interface AnalyticsSummary {
  totalRevenue: number;
  totalCost: number;
  netMargin: number;
  arpu: number;
  onTimeRate: number;
  totalPayments: number;
  onTimeCount: number;
  lateCount: number;
  uniqueClientCount: number;
}

export interface HistoryRow {
  id: string;
  type: "income" | "cost";
  amount: number;
  paidOn: string;
  periodStart: string;
  periodEnd: string;
  platformId: string | null;
  platform: string;
  planId: string | null;
  plan: string;
  subscriptionLabel: string;
  subscriptionId: string;
  clientSubscriptionId: string | null;
  clientId: string | null;
  clientName: string | null;
  notes: string | null;
}

export interface HistoryResponse {
  rows: HistoryRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface TrendDataPoint {
  period: string;
  revenue: number;
  cost: number;
}

export type TrendScale = "monthly" | "weekly" | "daily";

export interface ClientAnalytics {
  clientId: string;
  clientName: string;
  totalPaid: number;
  renewalCount: number;
  weight: number;
}

export interface ClientsResponse {
  clients: ClientAnalytics[];
  totalRevenue: number;
}

export interface BreakEvenEntry {
  subscriptionId: string;
  label: string;
  platform: string;
  plan: string;
  revenue: number;
  cost: number;
  net: number;
  profitable: boolean;
  activeSeats: number;
}

export type ContributionMode = "income" | "cost" | "net";

export interface PlatformContributionRow {
  platformId: string;
  platform: string;
  revenue: number;
  cost: number;
  net: number;
}

export interface PlatformContributionResponse {
  from: string;
  to: string;
  rows: PlatformContributionRow[];
}

export interface DisciplineFilters {
  planId?: string;
  subscriptionId?: string;
  clientId?: string;
}

export interface DisciplineData {
  totalPayments: number;
  onTimeCount: number;
  lateCount: number;
  onTimeRate: number;
  avgDaysLate: number;
  score: number;
}

// ── Shared config — analytics data changes rarely ──

const ANALYTICS_STALE = 30 * 1000; // 30 seconds

// ── Hooks ──

export function useAnalyticsSummary() {
  return useQuery<AnalyticsSummary>({
    queryKey: queryKeys.analyticsSummary,
    queryFn: () => fetchApi<AnalyticsSummary>("/api/analytics/summary"),
    staleTime: ANALYTICS_STALE,
  });
}

export interface HistoryFilters {
  page?: number;
  pageSize?: number;
  type?: "income" | "cost" | "all";
  platformId?: string;
  planId?: string;
  subscriptionId?: string;
  clientId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export interface UpdateHistoryEntryInput {
  id: string;
  type: "income" | "cost";
  nextType?: "income" | "cost";
  reason: string;
  amountPaid?: number;
  paidOn?: string;
  periodStart?: string;
  periodEnd?: string;
  notes?: string | null;
  subscriptionId?: string;
  clientSubscriptionId?: string;
}

export interface DeleteHistoryEntryInput {
  id: string;
  type: "income" | "cost";
  reason: string;
}

export interface HistoryMutationResponse {
  auditLogId: string;
  result: unknown;
}

export function useAnalyticsHistory(filters: HistoryFilters = {}) {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.pageSize) params.set("pageSize", String(filters.pageSize));
  if (filters.type && filters.type !== "all") params.set("type", filters.type);
  if (filters.platformId) params.set("platformId", filters.platformId);
  if (filters.planId) params.set("planId", filters.planId);
  if (filters.subscriptionId) params.set("subscriptionId", filters.subscriptionId);
  if (filters.clientId) params.set("clientId", filters.clientId);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.search) params.set("search", filters.search);

  return useQuery<HistoryResponse>({
    queryKey: queryKeys.analyticsHistory(filters),
    queryFn: () =>
      fetchApi<HistoryResponse>(`/api/analytics/history?${params.toString()}`),
    placeholderData: keepPreviousData,
    staleTime: ANALYTICS_STALE,
  });
}

export function useUpdateHistoryEntry() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...payload }: UpdateHistoryEntryInput) =>
      fetchApi<HistoryMutationResponse>(`/api/analytics/history/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      invalidateAll(qc);
      qc.invalidateQueries({ queryKey: ["analytics-history"] });
    },
  });
}

export function useDeleteHistoryEntry() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...payload }: DeleteHistoryEntryInput) =>
      fetchApi<HistoryMutationResponse>(`/api/analytics/history/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      invalidateAll(qc);
      qc.invalidateQueries({ queryKey: ["analytics-history"] });
    },
  });
}

export async function undoHistoryMutation(auditLogId: string): Promise<void> {
  const res = await fetch("/api/mutations/undo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auditLogId }),
  });

  const json = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok || !json.success) {
    throw new Error((json.error as string) ?? "Failed to undo mutation");
  }
}

export function useAnalyticsTrends(scale: TrendScale = "monthly") {
  return useQuery<TrendDataPoint[]>({
    queryKey: queryKeys.analyticsTrends(scale),
    queryFn: () =>
      fetchApi<TrendDataPoint[]>(`/api/analytics/trends?scale=${scale}`),
    placeholderData: keepPreviousData,
    staleTime: ANALYTICS_STALE,
  });
}

export function useAnalyticsClients() {
  return useQuery<ClientsResponse>({
    queryKey: queryKeys.analyticsClients,
    queryFn: () => fetchApi<ClientsResponse>("/api/analytics/clients"),
    staleTime: ANALYTICS_STALE,
  });
}

export function useAnalyticsBreakEven() {
  return useQuery<BreakEvenEntry[]>({
    queryKey: queryKeys.analyticsBreakEven,
    queryFn: () => fetchApi<BreakEvenEntry[]>("/api/analytics/break-even"),
    staleTime: ANALYTICS_STALE,
  });
}

export function useAnalyticsPlatformContribution() {
  return useQuery<PlatformContributionResponse>({
    queryKey: queryKeys.analyticsPlatformContribution,
    queryFn: () =>
      fetchApi<PlatformContributionResponse>("/api/analytics/platform-contribution"),
    staleTime: ANALYTICS_STALE,
  });
}

export function useDiscipline(filters: DisciplineFilters = {}) {
  const params = new URLSearchParams();
  if (filters.planId) params.set("planId", filters.planId);
  if (filters.subscriptionId) params.set("subscriptionId", filters.subscriptionId);
  if (filters.clientId) params.set("clientId", filters.clientId);

  const qs = params.toString();

  return useQuery<DisciplineData>({
    queryKey: queryKeys.analyticsDiscipline(filters),
    queryFn: () =>
      fetchApi<DisciplineData>(
        `/api/analytics/discipline${qs ? `?${qs}` : ""}`
      ),
    placeholderData: keepPreviousData,
    staleTime: ANALYTICS_STALE,
  });
}

// ── Per-client discipline (batch) ──

export interface ClientDisciplineEntry {
  avgDaysLate: number;
  onTimeRate: number;
  totalPayments: number;
  score: number | null;
  daysOverdue: number;
  healthStatus: string;
  isUnpaid: boolean;
}

export interface ClientsDisciplineResponse {
  perClient: Record<string, ClientDisciplineEntry>;
  global: {
    avgDaysLate: number;
    onTimeRate: number;
    score: number;
    totalPayments: number;
    onTimeCount: number;
    lateCount: number;
  };
}

export function useClientsDiscipline() {
  return useQuery<ClientsDisciplineResponse>({
    queryKey: queryKeys.analyticsClientsDiscipline,
    queryFn: () =>
      fetchApi<ClientsDisciplineResponse>("/api/analytics/clients-discipline"),
    staleTime: ANALYTICS_STALE,
  });
}
