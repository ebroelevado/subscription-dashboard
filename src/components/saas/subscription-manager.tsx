"use client";

import { useSaasStatus } from "@/hooks/use-saas-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { SAAS_LIMITS } from "@/lib/saas-constants";
import { cn } from "@/lib/utils";
import { CalendarClock, CreditCard, Loader2, Sparkles, Settings, ShieldCheck, Bot, ChartColumnBig } from "lucide-react";
import { format } from "date-fns";
import type { Locale } from "date-fns";
import { es, enUS, zhCN } from "date-fns/locale";

const locales: Record<string, Locale> = { es, en: enUS, zh: zhCN };

export function SubscriptionManager({ locale }: { locale: string }) {
  const t = useTranslations("saas");
  const tc = useTranslations("common");
  const { data: status, isLoading } = useSaasStatus();
  const [isActionLoading, setIsActionLoading] = useState(false);

  const handleUpgrade = async () => {
    try {
      setIsActionLoading(true);
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("Failed to get checkout URL");
      }
    } catch (_error) {
      toast.error(t("upgradeError"));
      setIsActionLoading(false);
    }
  };

  const handleManage = async () => {
    try {
      setIsActionLoading(true);
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("Failed to get portal URL");
      }
    } catch (_error) {
      toast.error(t("portalError"));
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

  return (
    <Card className={cn(
      "overflow-hidden border-2 transition-all duration-300",
      isPremium ? "border-gold-gradient/30 bg-gold-gradient/5" : "hover:border-primary/20"
    )}>
      <CardHeader className="relative">
        {isPremium && (
          <div className="absolute top-4 right-4 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            PREMIUM
          </div>
        )}
        <CardTitle>{t("subscriptionTitle")}</CardTitle>
        <CardDescription>
          {isPremium ? t("premiumActive") : t("freePlan")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border bg-background/70 p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("labels.plan")}</p>
            <p className="text-sm font-semibold mt-1">{status?.plan || "FREE"}</p>
          </div>
          <div className="rounded-xl border bg-background/70 p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("labels.platforms")}</p>
            <p className="text-sm font-semibold mt-1">
              {status?.usage.platforms ?? 0} / {isPremium ? "∞" : SAAS_LIMITS.FREE.PLATFORMS}
            </p>
          </div>
          <div className="rounded-xl border bg-background/70 p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("labels.plans")}</p>
            <p className="text-sm font-semibold mt-1">
              {status?.usage.plans ?? 0} / {isPremium ? "∞" : SAAS_LIMITS.FREE.PLANS}
            </p>
          </div>
          <div className="rounded-xl border bg-background/70 p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("labels.subscriptions")}</p>
            <p className="text-sm font-semibold mt-1">
              {status?.usage.subscriptions ?? 0} / {isPremium ? "∞" : SAAS_LIMITS.FREE.SUBSCRIPTIONS}
            </p>
          </div>
        </div>

        {isPremium && nextBillingDate && (
          <div className="rounded-xl border border-gold-gradient/20 bg-background/80 p-3 text-sm space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground">
              <CreditCard className="h-4 w-4" />
              <span>
                {t("nextBilling")}: <span className="font-medium text-foreground">
                  {format(nextBillingDate, "PPP", { locale: locales[locale] || enUS })}
                </span>
              </span>
            </div>
            {daysToBilling !== null && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <CalendarClock className="h-4 w-4" />
                <span className="font-medium">{tc("daysLeft", { count: daysToBilling })}</span>
              </div>
            )}
          </div>
        )}

        {!isPremium && (
          <div className="rounded-2xl border border-gold-gradient/30 bg-gold-gradient/5 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">{t("popupTitle")}</p>
              <Badge variant="outline" className="border-gold-gradient/40 text-gold-gradient">PREMIUM</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{t("popupDescription")}</p>
            <div className="space-y-2">
              {virtues.map((virtue) => (
                <div key={virtue.title} className="rounded-lg border bg-background/80 p-2.5">
                  <p className="text-xs font-semibold flex items-center gap-2">
                    <virtue.icon className="h-3.5 w-3.5 text-gold-gradient" />
                    {virtue.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">{virtue.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          {isPremium ? (
            <Button
              onClick={handleManage}
              disabled={isActionLoading}
              variant="outline"
              className="w-full sm:w-auto"
            >
              {isActionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Settings className="h-4 w-4 mr-2" />
              )}
              {t("manageBilling")}
            </Button>
          ) : (
            <Button
              onClick={handleUpgrade}
              disabled={isActionLoading}
              className="w-full sm:w-auto bg-gold-gradient hover:opacity-90 text-black shadow-lg font-bold"
            >
              {isActionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              {t("subscribeNow")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
