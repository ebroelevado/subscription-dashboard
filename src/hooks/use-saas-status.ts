"use client";

import { useQuery } from "@tanstack/react-query";

export type SaasStatus = {
  hasToken: boolean;
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
      const res = await fetch("/api/copilot/status");
      if (!res.ok) throw new Error("Failed to fetch SaaS status");
      return res.json();
    }
  });
}
