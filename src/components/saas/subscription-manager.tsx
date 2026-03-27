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
    <Card className="overflow-hidden border-2 border-gold-gradient/30 bg-gold-gradient/5">
      <CardHeader className="relative">
        <div className="absolute top-4 right-4 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
          <Sparkles className="h-3 w-3" />
          {t("premiumActive")}
        </div>
        <CardTitle>{t("subscriptionTitle")}</CardTitle>
        <CardDescription>
          {t("premiumActiveDescription", { fallback: "Your account has permanent unlimited access to all features." })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border bg-background/70 p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("labels.plan")}</p>
            <p className="text-sm font-semibold mt-1">LIFETIME PREMIUM</p>
          </div>
          <div className="rounded-xl border bg-background/70 p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("labels.platforms")}</p>
            <p className="text-sm font-semibold mt-1">∞ / ∞</p>
          </div>
          <div className="rounded-xl border bg-background/70 p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("labels.plans")}</p>
            <p className="text-sm font-semibold mt-1">∞ / ∞</p>
          </div>
          <div className="rounded-xl border bg-background/70 p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t("labels.subscriptions")}</p>
            <p className="text-sm font-semibold mt-1">∞ / ∞</p>
          </div>
        </div>

        <div className="rounded-xl border border-gold-gradient/20 bg-background/80 p-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium">{t("unlimitedAccess", { fallback: "Unlimited Access" })}</p>
            <p className="text-xs text-muted-foreground">{t("foreverPearfect", { fallback: "Your subscription is managed directly by Pearfect S.L." })}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
