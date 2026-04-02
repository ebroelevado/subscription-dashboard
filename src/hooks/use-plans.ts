import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchApi } from "@/lib/fetch-api";
import { queryKeys } from "@/lib/query-keys";
import { invalidateAll } from "@/lib/invalidate-helpers";

// ── Types ──────────────────────────────────────────────
export interface Plan {
  id: string;
  platformId: string;
  name: string;
  cost: number;
  maxSeats: number | null;
  isActive: boolean;
  createdAt: string;
  platform: { id: string; name: string };
}

// ── Queries ────────────────────────────────────────────
export function usePlans(platformId?: string) {
  const url = platformId
    ? `/api/plans?platformId=${platformId}`
    : "/api/plans";

  return useQuery<Plan[]>({
    queryKey: queryKeys.plans(platformId),
    queryFn: () => fetchApi<Plan[]>(url),
  });
}

// ── Mutations ──────────────────────────────────────────
export interface CreatePlanInput {
  platformId: string;
  name: string;
  cost: number;
  maxSeats?: number | null;
  isActive?: boolean;
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreatePlanInput) =>
      fetchApi<Plan>("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Plan created");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: Partial<CreatePlanInput> & { id: string }) =>
      fetchApi<Plan>(`/api/plans/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Plan updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDeletePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchApi<{ deleted: boolean }>(`/api/plans/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      invalidateAll(qc);
      toast.success("Plan deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
