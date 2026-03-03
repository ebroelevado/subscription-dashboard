"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchApi } from "@/lib/fetch-api";
import { queryKeys } from "@/lib/query-keys";

export interface Subscription {
  id: string;
  planId: string;
  label: string;
  startDate: string;
  activeUntil: string;
  status: "active" | "paused";
  createdAt: string;
  plan: {
    id: string;
    name: string;
    cost: number;
    maxSeats: number | null;
    platform: { id: string; name: string };
  };
  clientSubscriptions: { id: string; customPrice: number; status: string }[];
  masterUsername?: string | null;
  masterPassword?: string | null;
  ownerId?: string | null;
  isAutopayable: boolean;
}

export interface SubscriptionDetail extends Omit<Subscription, "clientSubscriptions"> {
  clientSubscriptions: {
    id: string;
    clientId: string;
    customPrice: number;
    activeUntil: string;
    joinedAt: string;
    leftAt: string | null;
    status: "active" | "paused";
    client: { id: string; name: string; phone: string | null; serviceUser: string | null; servicePassword: string | null };
  }[];
  platformRenewals: {
    id: string;
    amountPaid: number;
    periodStart: string;
    periodEnd: string;
    paidOn: string;
    notes: string | null;
  }[];
}

export function useSubscriptions(planId?: string) {
  const url = planId
    ? `/api/subscriptions?planId=${planId}`
    : "/api/subscriptions";

  return useQuery<Subscription[]>({
    queryKey: queryKeys.subscriptions(planId),
    queryFn: () => fetchApi<Subscription[]>(url),
  });
}

export function useSubscription(id: string | undefined) {
  return useQuery<SubscriptionDetail>({
    queryKey: queryKeys.subscription(id!),
    queryFn: () => fetchApi<SubscriptionDetail>(`/api/subscriptions/${id}`),
    enabled: !!id,
  });
}

export function useCreateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      planId: string;
      label: string;
      startDate: string;
      durationMonths: number;
      status?: string;
      masterUsername?: string | null;
      masterPassword?: string | null;
      ownerId?: string | null;
      isAutopayable?: boolean;
    }) =>
      fetchApi<Subscription>("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.allSubscriptions });
      toast.success("Subscription created");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useUpdateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      id: string;
      planId?: string;
      label?: string;
      status?: string;
      startDate?: string;
      durationMonths?: number;
      masterUsername?: string | null;
      masterPassword?: string | null;
      ownerId?: string | null;
      isAutopayable?: boolean;
    }) =>
      fetchApi<Subscription>(`/api/subscriptions/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.allSubscriptions });
      toast.success("Subscription updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDeleteSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchApi<{ deleted: boolean }>(`/api/subscriptions/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.allSubscriptions });
      toast.success("Subscription deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
