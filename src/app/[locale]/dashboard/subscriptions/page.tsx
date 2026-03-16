"use client";

import { useState } from "react";
import { usePlans } from "@/hooks/use-plans";
import { useSubscriptions } from "@/hooks/use-subscriptions";
import { SubscriptionsTable } from "@/components/subscriptions/subscriptions-table";
import { SubscriptionFormDialog } from "@/components/subscriptions/subscription-form-dialog";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Search, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useTranslations } from "next-intl";
import { useSaasStatus } from "@/hooks/use-saas-status";
import { SAAS_LIMITS } from "@/lib/saas-constants";
import { Badge } from "@/components/ui/badge";
import { PremiumPopup } from "@/components/saas/premium-popup";
import { cn } from "@/lib/utils";

export default function SubscriptionsPage() {
  const [planFilter, setPlanFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const { data: plans } = usePlans();
  const { data: saas } = useSaasStatus();
  const { data: subscriptions, isLoading } = useSubscriptions(
    planFilter === "all" ? undefined : planFilter
  );
  const t = useTranslations("subscriptions");
  const tc = useTranslations("common");
  const ts = useTranslations("saas");

  const subscriptionsLimitReached =
    saas?.plan === "FREE" &&
    saas.usage.subscriptions >= SAAS_LIMITS.FREE.SUBSCRIPTIONS;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
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
                  <span className={saas.plan === "FREE" && saas.usage.subscriptions >= SAAS_LIMITS.FREE.SUBSCRIPTIONS ? "text-red-500" : ""}>
                    {saas.usage.subscriptions}
                  </span>
                  <span className="opacity-40">/</span>
                  <span>{saas.plan === "PREMIUM" ? "∞" : SAAS_LIMITS.FREE.SUBSCRIPTIONS}</span>
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
        {subscriptionsLimitReached ? (
          <PremiumPopup>
            <Button>
              <Sparkles className="size-4" />
              {ts("upgradeToPremium")}
            </Button>
          </PremiumPopup>
        ) : (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t("newSubscription")}
          </Button>
        )}
      </div>

      {/* Search + Plan filter */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder={tc("searchSubscriptions")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground">
            {tc("filterByPlan")}
          </label>
          <Select value={planFilter} onValueChange={setPlanFilter}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder={tc("allPlans")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tc("allPlans")}</SelectItem>
              {plans?.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <SubscriptionsTable
        subscriptions={(subscriptions ?? []).filter((s) =>
          search.trim() === ""
            ? true
            : s.label.toLowerCase().includes(search.trim().toLowerCase())
        )}
        isLoading={isLoading}
      />

      <SubscriptionFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  );
}
