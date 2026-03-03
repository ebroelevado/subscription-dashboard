"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchApi } from "@/lib/fetch-api";
import { queryKeys } from "@/lib/query-keys";

export interface Client {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  serviceUser: string | null;
  servicePassword: string | null;
  createdAt: string;
  clientSubscriptions: {
    id: string;
    status: string;
    customPrice: number;
    activeUntil: string;
    subscription: {
      id: string;
      label: string;
      status: string;
      activeUntil: string;
      plan: {
        name: string;
        platform: { name: string };
      };
    };
  }[];
}

export interface ClientDetail {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  serviceUser: string | null;
  servicePassword: string | null;
  createdAt: string;
  clientSubscriptions: {
    id: string;
    status: string;
    customPrice: number;
    joinedAt: string;
    leftAt: string | null;
    activeUntil: string;
    subscription: {
      id: string;
      label: string;
      status: string;
      plan: {
        id: string;
        name: string;
        platform: { id: string; name: string };
      };
    };
    renewalLogs: {
      id: string;
      amountPaid: number;
      periodStart: string;
      periodEnd: string;
      paidOn: string;
    }[];
  }[];
}

export function useClients() {
  return useQuery<Client[]>({
    queryKey: queryKeys.clients,
    queryFn: () => fetchApi<Client[]>("/api/clients"),
  });
}

export function useClient(id: string | undefined) {
  return useQuery<ClientDetail>({
    queryKey: queryKeys.client(id!),
    queryFn: () => fetchApi<ClientDetail>(`/api/clients/${id}`),
    enabled: !!id,
  });
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; phone?: string | null; notes?: string | null; serviceUser?: string | null; servicePassword?: string | null }) =>
      fetchApi<Client>("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clients });
      toast.success("Client created");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; name?: string; phone?: string | null; notes?: string | null; serviceUser?: string | null; servicePassword?: string | null }) =>
      fetchApi<Client>(`/api/clients/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clients });
      toast.success("Client updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchApi<{ deleted: boolean }>(`/api/clients/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.clients });
      toast.success("Client deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
