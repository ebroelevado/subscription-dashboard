"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchApi } from "@/lib/fetch-api";
import { queryKeys } from "@/lib/query-keys";

// ── Client Renewal: client pays me → extend their seat ──

export function useRenewClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      seatId: string;
      amountPaid?: number;
      months?: number;
      notes?: string | null;
    }) =>
      fetchApi(`/api/client-subscriptions/${data.seatId}/renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountPaid: data.amountPaid,
          months: data.months,
          notes: data.notes,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.allSubscriptions });
      qc.invalidateQueries({ queryKey: queryKeys.clients });
      qc.invalidateQueries({ queryKey: queryKeys.dashboardStats });
      toast.success("Client renewed successfully");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

// ── Bulk Client Renewal: renew multiple seats at once ──

export function useRenewBulkClients() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      items: { clientSubscriptionId: string; amountPaid?: number; months?: number; notes?: string | null }[];
      months: number; // global default
      clientName: string; // for toast only
    }) =>
      fetchApi<{ renewed: number }>(`/api/client-subscriptions/bulk-renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: data.items,
          months: data.months,
        }),
      }),
    onSuccess: (result, variables) => {
      qc.invalidateQueries({ queryKey: queryKeys.allSubscriptions });
      qc.invalidateQueries({ queryKey: queryKeys.clients });
      qc.invalidateQueries({ queryKey: queryKeys.dashboardStats });
      toast.success(
        `Successfully renewed ${result.renewed} service${result.renewed !== 1 ? "s" : ""} for ${variables.clientName}`
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

// ── Platform Renewal: I pay the platform → extend subscription ──

export function useRenewPlatform() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      subscriptionId: string;
      amountPaid?: number;
      notes?: string | null;
    }) =>
      fetchApi(`/api/subscriptions/${data.subscriptionId}/renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountPaid: data.amountPaid,
          notes: data.notes,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.allSubscriptions });
      qc.invalidateQueries({ queryKey: queryKeys.dashboardStats });
      toast.success("Platform subscription renewed");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
