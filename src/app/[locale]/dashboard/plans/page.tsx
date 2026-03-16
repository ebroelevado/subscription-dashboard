"use client";

import { useState } from "react";
import { usePlans } from "@/hooks/use-plans";
import { usePlatforms } from "@/hooks/use-platforms";
import { PlansTable } from "@/components/plans/plans-table";
import { PlanFormDialog } from "@/components/plans/plan-form-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSaasStatus } from "@/hooks/use-saas-status";
import { SAAS_LIMITS } from "@/lib/saas-constants";
import { Badge } from "@/components/ui/badge";
import { PremiumPopup } from "@/components/saas/premium-popup";
import { cn } from "@/lib/utils";

export default function PlansPage() {
  const [platformFilter, setPlatformFilter] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: platforms } = usePlatforms();
  const { data: plans, isLoading } = usePlans(platformFilter);
  const { data: saas } = useSaasStatus();
  const t = useTranslations("plans");
  const tc = useTranslations("common");
  const ts = useTranslations("saas");

  const plansLimitReached =
    saas?.plan === "FREE" && saas.usage.plans >= SAAS_LIMITS.FREE.PLANS;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
              {t("title")}
            </h1>
            {saas && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={cn(
                  "h-6 gap-1 px-2 font-bold border-dashed",
                  saas.plan === "PREMIUM" ? "border-gold-gradient/30 bg-gold-gradient/5 text-gold-gradient" : "text-muted-foreground"
                )}>
                  <span className={saas.plan === "FREE" && saas.usage.plans >= SAAS_LIMITS.FREE.PLANS ? "text-red-500" : ""}>
                    {saas.usage.plans}
                  </span>
                  <span className="opacity-40">/</span>
                  <span>{saas.plan === "PREMIUM" ? "∞" : SAAS_LIMITS.FREE.PLANS}</span>
                </Badge>
                {saas.plan === "FREE" && (
                  <PremiumPopup>
                    <Button variant="link" size="sm" className="h-6 px-0 text-xs text-primary gap-1">
                      <Sparkles className="size-3" />
                      {ts("upgrade")}
                    </Button>
                  </PremiumPopup>
                )}
              </div>
            )}
          </div>
          <p className="text-muted-foreground mt-1">
            {t("description")}
          </p>
        </div>
        {plansLimitReached ? (
          <PremiumPopup>
            <Button>
              <Sparkles className="size-4" />
              {ts("upgradeToPremium")}
            </Button>
          </PremiumPopup>
        ) : (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t("addPlan")}
          </Button>
        )}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {tc("filterByPlatform")}
        </span>
        <Select
          value={platformFilter ?? "all"}
          onValueChange={(v) =>
            setPlatformFilter(v === "all" ? undefined : v)
          }
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={tc("allPlatforms")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tc("allPlatforms")}</SelectItem>
            {platforms?.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <PlansTable plans={plans ?? []} isLoading={isLoading} />

      {/* Create dialog */}
      <PlanFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  );
}
