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
      // Mock response
      return {
        plan: "PREMIUM",
        stripeCurrentPeriodEnd: null,
        usage: {
          platforms: 0,
          clients: 0,
          activeSeats: 0,
          plans: 0,
          subscriptions: 0,
        }
      };
    }
  });
}
