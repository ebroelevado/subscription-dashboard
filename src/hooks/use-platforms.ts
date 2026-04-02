import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchApi } from "@/lib/fetch-api";
import { queryKeys } from "@/lib/query-keys";
import { invalidateAll } from "@/lib/invalidate-helpers";

// ── Types ──────────────────────────────────────────────
export interface Platform {
  id: string;
  name: string;
  createdAt: string;
  plans: {
    id: string;
    name: string;
    cost: number;
    maxSeats: number | null;
    isActive: boolean;
  }[];
}

// ── Queries ────────────────────────────────────────────
export function usePlatforms() {
  return useQuery<Platform[]>({
    queryKey: queryKeys.platforms,
    queryFn: () => fetchApi<Platform[]>("/api/platforms"),
  });
}

// ── Mutations ──────────────────────────────────────────
export function useCreatePlatform() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string }) =>
      fetchApi<Platform>("/api/platforms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Platform created");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useUpdatePlatform() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name: string }) =>
      fetchApi<Platform>(`/api/platforms/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Platform updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDeletePlatform() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchApi<{ deleted: boolean }>(`/api/platforms/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Platform deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
