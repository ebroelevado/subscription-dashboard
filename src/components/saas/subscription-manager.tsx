"use client";

import { useSaasStatus } from "@/hooks/use-saas-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { SAAS_LIMITS } from "@/lib/saas-constants";
import { Loader2, Sparkles, ShieldCheck, Bot, ChartColumnBig, Settings, CalendarClock } from "lucide-react";
import { format } from "date-fns";
import type { Locale } from "date-fns";
import { es, enUS, zhCN } from "date-fns/locale";

const locales: Record<string, Locale> = { es, en: enUS, zh: zhCN };

export function SubscriptionManager({ locale }: { locale: string }) {
  const t = useTranslations("saas");
  const { data: status, isLoading } = useSaasStatus();
  const [isActionLoading, setIsActionLoading] = useState(false);

  const handleUpgrade = async () => {
    try {
      setIsActionLoading(true);
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const payload = await res.json();
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error || "Failed to get checkout URL");
      }

      if (payload?.url) {
        window.location.href = payload.url;
        return;
      }

      toast.success(t("alreadyPremium", { fallback: "Your Premium plan is already active." }));
      window.location.reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("upgradeError");
      toast.error(message);
      setIsActionLoading(false);
    }
  };

  const handleDowngrade = async () => {
    const confirmed = window.confirm(
      t("confirmDowngrade", { fallback: "Downgrade now to Free and apply proration immediately?" }),
    );

    if (!confirmed) {
      return;
    }

    try {
      setIsActionLoading(true);
      const res = await fetch("/api/stripe/subscription", { method: "DELETE" });
      const payload = await res.json();
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error || "Failed to downgrade plan");
      }

      toast.success(t("downgradeSuccess", { fallback: "Your plan was downgraded to Free." }));
      window.location.reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("downgradeError", { fallback: "Unable to downgrade plan." });
      toast.error(message);
      setIsActionLoading(false);
    }
  };

  const handleManage = async () => {
    try {
      setIsActionLoading(true);
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const payload = await res.json();
      if (!res.ok || !payload?.ok || !payload?.url) {
        throw new Error(payload?.error || "Failed to get portal URL");
      }

      window.location.href = payload.url;
    } catch (error) {
      const message = error instanceof Error ? error.message : t("portalError");
      toast.error(message);
      setIsActionLoading(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const isPremium = status?.plan === "PREMIUM";
  const nextBillingDate = status?.stripeCurrentPeriodEnd
    ? new Date(status.stripeCurrentPeriodEnd)
    : null;
  const daysToBilling = nextBillingDate
    ? Math.max(0, Math.ceil((nextBillingDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  const usage = status?.usage || {
    platforms: 0,
    clients: 0,
    activeSeats: 0,
    plans: 0,
    subscriptions: 0,
  };

  const virtues = [
    {
      icon: ChartColumnBig,
      title: t.has("features.advancedAnalytics.title")
        ? t("features.advancedAnalytics.title")
        : "Advanced Analytics",
      description: t.has("features.advancedAnalytics.description")
        ? t("features.advancedAnalytics.description")
        : "Unlock deep analysis and trends for all your KPIs.",
    },
    {
      icon: Bot,
      title: t.has("features.aiAssistant.title")
        ? t("features.aiAssistant.title")
        : "Full AI Assistant",
      description: t.has("features.aiAssistant.description")
        ? t("features.aiAssistant.description")
        : "Get smart insights and automated help for your subscriptions.",
    },
    {
      icon: ShieldCheck,
      title: t.has("features.prioritySupport.title")
        ? t("features.prioritySupport.title")
        : "Priority Support",
      description: t.has("features.prioritySupport.description")
        ? t("features.prioritySupport.description")
        : "Direct access to our support team for any questions.",
    },
  ];

  if (!isPremium) {
    return (
      <Card className="overflow-hidden border-2 border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle>{t("subscriptionTitle")}</CardTitle>
          <CardDescription>
            {t("upgradeDescription", { fallback: "Scale without friction. Upgrade only when you need more capacity." })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border bg-background/70 p-3">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("labels.platforms")}</p>
              <p className="text-sm font-semibold mt-1">
                {usage.platforms} / {SAAS_LIMITS.FREE.PLATFORMS}
              </p>
            </div>
            <div className="rounded-xl border bg-background/70 p-3">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("labels.clients")}</p>
              <p className="text-sm font-semibold mt-1">
                {usage.clients} / {SAAS_LIMITS.FREE.CLIENTS}
              </p>
            </div>
            <div className="rounded-xl border bg-background/70 p-3">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("labels.activeSeats", { fallback: "Active seats" })}</p>
              <p className="text-sm font-semibold mt-1">
                {usage.activeSeats} / {SAAS_LIMITS.FREE.ACTIVE_SEATS}
              </p>
            </div>
          </div>

          <div className="grid gap-3">
            {virtues.map(({ icon: Icon, title, description }) => (
              <div key={title} className="rounded-xl border bg-background/80 p-3 flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end">
            <Button onClick={handleUpgrade} disabled={isActionLoading} className="gap-2">
              {isActionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {t("upgradeNow", { fallback: "Upgrade to Premium" })}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-2 border-gold-gradient/30 bg-gold-gradient/5">
      <CardHeader className="relative">
        <div className="absolute top-4 right-4 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
          <Sparkles className="h-3 w-3" />
          {t("premiumActive")}
        </div>
        <CardTitle>{t("subscriptionTitle")}</CardTitle>
        <CardDescription>
          {nextBillingDate
            ? t("nextBillingDate", { fallback: `Next billing in ${daysToBilling ?? 0} days` })
            : t("premiumActiveDescription", { fallback: "Your premium plan is active." })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border bg-background/70 p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("labels.plan")}</p>
            <p className="text-sm font-semibold mt-1">PREMIUM</p>
          </div>
          <div className="rounded-xl border bg-background/70 p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("labels.platforms")}</p>
            <p className="text-sm font-semibold mt-1">{usage.platforms}</p>
          </div>
          <div className="rounded-xl border bg-background/70 p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("labels.plans")}</p>
            <p className="text-sm font-semibold mt-1">{usage.plans}</p>
          </div>
          <div className="rounded-xl border bg-background/70 p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("labels.subscriptions")}</p>
            <p className="text-sm font-semibold mt-1">{usage.subscriptions}</p>
          </div>
        </div>

        {nextBillingDate && (
          <div className="rounded-xl border bg-background/80 p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <CalendarClock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">{t("nextBilling", { fallback: "Next billing" })}</p>
              <p className="text-xs text-muted-foreground">
                {format(nextBillingDate, "PPP", { locale: locales[locale] || enUS })}
                {typeof daysToBilling === "number" ? ` (${daysToBilling}d)` : ""}
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={handleDowngrade} disabled={isActionLoading}>
            {t("downgradeNow", { fallback: "Downgrade now" })}
          </Button>
          <Button variant="outline" onClick={handleManage} disabled={isActionLoading} className="gap-2">
            {isActionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings className="h-4 w-4" />}
            {t("manageBilling", { fallback: "Manage billing" })}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
