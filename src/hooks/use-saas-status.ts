"use client";

import { useQuery } from "@tanstack/react-query";

export type SaasStatus = {
  plan: "FREE" | "PREMIUM";
  stripeCurrentPeriodEnd?: string | null;
  usage: {
    platforms: number;
    clients: number;
    activeSeats: number;
    plans: number;
    subscriptions: number;
  };
};

export function useSaasStatus() {
  return useQuery<SaasStatus>({
    queryKey: ["saas-status"],
    queryFn: async () => {
      const response = await fetch("/api/saas/status", { method: "GET" });
      const payload = await response.json();

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to load SaaS status");
      }

      return payload.data as SaasStatus;
    },
  });
}
