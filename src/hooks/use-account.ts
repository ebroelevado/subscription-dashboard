"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/fetch-api";
import { signOut } from "@/lib/auth-client";
import type { UpdateProfileInput } from "@/lib/validations/account";
import { queryKeys } from "@/lib/query-keys";

// ── Update Profile ──
export function useUpdateProfile() {
  return useMutation({
    mutationFn: (data: UpdateProfileInput) =>
      fetchApi("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
  });
}

// ── Update Settings (Currency etc.) ──
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { 
      currency?: string; 
      disciplinePenalty?: number; 
      companyName?: string;
      whatsappSignatureMode?: string;
    }) =>
      fetchApi("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: (_, variables) => {
      // If discipline penalty changes, we must force a refetch of discipline APIs
      // so the charts and scores reflect the new mathematical formula immediately
      if (variables.disciplinePenalty !== undefined) {
        queryClient.invalidateQueries({ queryKey: queryKeys.analyticsClientsDiscipline });
        queryClient.invalidateQueries({ queryKey: ["analytics-discipline"] });
      }
      if (variables.currency !== undefined) {
        queryClient.invalidateQueries({ queryKey: queryKeys.analyticsSummary });
        queryClient.invalidateQueries({ queryKey: ["analytics-history"] });
        queryClient.invalidateQueries({ queryKey: ["analytics-trends"] });
        queryClient.invalidateQueries({ queryKey: queryKeys.analyticsPlatformContribution });
        queryClient.invalidateQueries({ queryKey: queryKeys.analyticsClients });
        queryClient.invalidateQueries({ queryKey: queryKeys.analyticsBreakEven });
        queryClient.invalidateQueries({ queryKey: queryKeys.clients });
      }
    }
  });
}

// ── Export Data ──
export function useExportData() {
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/account/export");
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `subledger-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  });
}

// ── Import Data ──
export function useImportData() {
  return useMutation({
    mutationFn: (data: unknown) =>
      fetchApi("/api/account/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
  });
}

// ── Delete Account ──
export function useDeleteAccount() {
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/account/delete", { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Deletion failed");
      }
      // Destroy session + redirect to landing
      await signOut({
        fetchOptions: {
          onSuccess: () => {
             window.location.href = "/";
          }
        }
      });
    },
  });
}
