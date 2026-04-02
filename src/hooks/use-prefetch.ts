"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { fetchApi } from "@/lib/fetch-api";
import { queryKeys } from "@/lib/query-keys";

/**
 * Maps sidebar hrefs to their TanStack Query prefetch config.
 * On hover we fire prefetchQuery — if cache is fresh it's a no-op,
 * otherwise data starts loading before the click.
 */
const PREFETCH_MAP: Record<
  string,
  { queryKey: readonly unknown[]; url: string }
> = {
  "/dashboard": {
    queryKey: queryKeys.dashboardStats,
    url: "/api/dashboard/stats",
  },
  "/dashboard/platforms": {
    queryKey: queryKeys.platforms,
    url: "/api/platforms",
  },
  "/dashboard/plans": {
    queryKey: queryKeys.plans(),
    url: "/api/plans",
  },
  "/dashboard/subscriptions": {
    queryKey: queryKeys.subscriptions(),
    url: "/api/subscriptions",
  },
  "/dashboard/clients": {
    queryKey: queryKeys.clients,
    url: "/api/clients",
  },
  "/dashboard/analytics": {
    queryKey: queryKeys.analyticsSummary,
    url: "/api/analytics/summary",
  },
  "/dashboard/history": {
    queryKey: queryKeys.analyticsHistory({ page: 1, pageSize: 20, type: "all" }),
    url: "/api/analytics/history?page=1&pageSize=20",
  },
};

export function usePrefetch() {
  const qc = useQueryClient();

  return useCallback(
    (href: string) => {
      const config = PREFETCH_MAP[href];
      if (!config) return;

      qc.prefetchQuery({
        queryKey: config.queryKey,
        queryFn: () => fetchApi(config.url),
      });
    },
    [qc],
  );
}
