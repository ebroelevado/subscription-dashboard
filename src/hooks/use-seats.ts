"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchApi } from "@/lib/fetch-api";
import { invalidateAll } from "@/lib/invalidate-helpers";

export function useCreateSeat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      clientId: string;
      subscriptionId: string;
      customPrice: number;
      durationMonths: number;
      startDate?: string | Date;
      serviceUser?: string | null;
      servicePassword?: string | null;
      isPaid?: boolean;
      paymentNote?: string | null;
    }) =>
      fetchApi("/api/client-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Seat assigned");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useUpdateSeat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      id: string;
      customPrice?: number;
      status?: "active" | "paused";
      durationMonths?: number;
      startDate?: string | Date;
      activeUntil?: string | Date;
      serviceUser?: string | null;
      servicePassword?: string | null;
    }) => {
      const { id, ...body } = data;
      return fetchApi(`/api/client-subscriptions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Seat updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function usePauseSeat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (seatId: string) =>
      fetchApi(`/api/client-subscriptions/${seatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      }),
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Seat paused");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useResumeSeat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (seatId: string) =>
      fetchApi(`/api/client-subscriptions/${seatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      }),
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Seat reactivated — remaining paid days restored");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useCancelSeat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (seatId: string) =>
      fetchApi(`/api/client-subscriptions/${seatId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Seat removed (hard delete)");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
