"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchApi } from "@/lib/fetch-api";
import { invalidateAll } from "@/lib/invalidate-helpers";

// ── Client Renewal: client pays me → extend their seat ──

export function useRenewClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      seatId: string;
      amountPaid?: number;
      months?: number;
      paidOn?: string;
      notes?: string | null;
    }) =>
      fetchApi(`/api/client-subscriptions/${data.seatId}/renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountPaid: data.amountPaid,
          months: data.months,
          paidOn: data.paidOn,
          notes: data.notes,
        }),
      }),
    onSuccess: () => {
      invalidateAll(qc);
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
      items: { clientSubscriptionId: string; amountPaid?: number; months?: number; paidOn?: string; notes?: string | null }[];
      months: number; // global default
      paidOn?: string;
      clientName: string; // for toast only
    }) =>
      fetchApi<{ renewed: number }>(`/api/client-subscriptions/bulk-renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: data.items,
          months: data.months,
          paidOn: data.paidOn,
        }),
      }),
    onSuccess: (result, variables) => {
      invalidateAll(qc);
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
      paidOn?: string;
      notes?: string | null;
    }) =>
      fetchApi(`/api/subscriptions/${data.subscriptionId}/renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountPaid: data.amountPaid,
          paidOn: data.paidOn,
          notes: data.notes,
        }),
      }),
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Platform subscription renewed");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
