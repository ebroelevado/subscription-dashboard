import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

/**
 * Invalidates all data-related queries after any mutation.
 * Ensures every mounted (and future-mounted) query refetches fresh data.
 */
export function invalidateAll(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: queryKeys.dashboardStats });
  qc.invalidateQueries({ queryKey: queryKeys.allSubscriptions });
  qc.invalidateQueries({ queryKey: queryKeys.clients });
  qc.invalidateQueries({ queryKey: queryKeys.allPlans });
  qc.invalidateQueries({ queryKey: queryKeys.platforms });
  qc.invalidateQueries({ queryKey: queryKeys.analyticsSummary });
  qc.invalidateQueries({ queryKey: queryKeys.analyticsClientsDiscipline });
  qc.invalidateQueries({ queryKey: queryKeys.analyticsPlatformContribution });
  qc.invalidateQueries({ queryKey: queryKeys.analyticsClients });
  qc.invalidateQueries({ queryKey: queryKeys.analyticsBreakEven });
  qc.invalidateQueries({ queryKey: queryKeys.analyticsDiscipline({}) });
}
