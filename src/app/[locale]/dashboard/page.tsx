"use client";

import { useDashboardStats } from "@/hooks/use-dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import {
  LayoutGrid,
  Layers,
  Users,
  CreditCard,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Clock,
  ArrowRight,
  Banknote,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { ClientDetailSheet } from "@/components/clients/client-detail-sheet";
import { useState } from "react";
import { formatCurrency } from "@/lib/currency";
import { useSession } from "@/lib/auth-client";


function StatCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
}: {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <p
          className={`text-2xl font-bold ${
            trend === "up"
              ? "text-green-600 dark:text-green-400"
              : trend === "down"
              ? "text-red-600 dark:text-red-400"
              : ""
          }`}
        >
          {value}
        </p>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const { data: stats, isLoading } = useDashboardStats();
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const [sheetClientId, setSheetClientId] = useState<string | null>(null);

  const currency = ((session?.user as { currency?: string })?.currency || "EUR");

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <Card key={i} className={`animate-fade-in delay-${i + 1}`}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="size-4 rounded" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-7 w-16 mb-1" />
                <Skeleton className="h-3 w-28" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        {t("failedToLoad")}
      </div>
    );
  }

  const profit = stats.profit;
  const profitTrend = profit >= 0 ? "up" : "down";

  // Groups are now provided pre-calculated by the backend
  const overdueGroups = stats.overdueGroups || [];
  const expiringSoonGroups = stats.expiringSoonGroups || [];
  const expiringSubscriptions = (stats as any).expiringSubscriptions || [];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="animate-fade-in delay-1">
        <StatCard
          title={t("platforms")}
          value={stats.platformCount}
          icon={LayoutGrid}
          description={tc("activePlans", { count: stats.activePlanCount })}
        />
        </div>
        <div className="animate-fade-in delay-2">
        <StatCard
          title={t("clients")}
          value={stats.clientCount}
          icon={Users}
          description={tc("activeSeats", { count: stats.activeSeatCount })}
        />
        </div>
        <div className="animate-fade-in delay-3">
        <StatCard
          title={t("subscriptions")}
          value={stats.activeSubscriptionCount}
          icon={Layers}
          description={t("activeSubscriptions")}
        />
        </div>
        <div className="animate-fade-in delay-4">
        <StatCard
          title={t("activeSeats")}
          value={stats.activeSeatCount}
          icon={CreditCard}
          description={t("acrossAllSubscriptions")}
        />
        </div>
      </div>

      {/* Financial Summary */}
          <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title={t("monthlyRevenue")}
          value={formatCurrency(stats.monthlyRevenue, currency)}
          icon={TrendingUp}
          trend="up"
          description={t("totalFromActiveSeats")}
        />
        <StatCard
          title={t("monthlyCost")}
          value={formatCurrency(stats.monthlyCost, currency)}
          icon={CreditCard}
          description={t("totalSubscriptionCosts")}
        />
        <StatCard
          title={t("netProfit")}
          value={formatCurrency(profit, currency)}
          icon={profit >= 0 ? TrendingUp : TrendingDown}
          trend={profitTrend}
          description={
            stats.monthlyRevenue > 0
              ? tc("margin", { percent: ((profit / stats.monthlyRevenue) * 100).toFixed(0) })
              : tc("noRevenueYet")
          }
        />
      </div>

      {/* Financial Health — This Month Actual */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Banknote className="size-5 text-emerald-500" />
            {t("financialHealth")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("revenue")}</p>
              <p className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">
                {formatCurrency(stats.thisMonthRevenue ?? 0, currency)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("fromClientRenewals")}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("cost")}</p>
              <p className="mt-1 text-2xl font-bold">
                {formatCurrency(stats.thisMonthCost ?? 0, currency)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("platformRenewalsPaid")}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("net")}</p>
              <p className={`mt-1 text-2xl font-bold ${(stats.thisMonthProfit ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {formatCurrency(stats.thisMonthProfit ?? 0, currency)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("actualCashFlow")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Overdue & Expiring Soon */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Overdue Seats */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-red-500" />
              {t("overdueSeats")}
            </CardTitle>
            {overdueGroups.length > 0 && (
              <Badge variant="destructive">{overdueGroups.length}</Badge>
            )}
          </CardHeader>
          <CardContent>
            {overdueGroups.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-muted-foreground">{t("noOverdueSeats")}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("allClientsUpToDate")}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {overdueGroups.map((group) => (
                  <div
                    key={group.clientId}
                    className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20 px-3 py-2"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        {group.clientName}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">
                          {group.totalCount} {group.totalCount === 1 ? tc("subscription") : tc("subscriptions")}
                        </span>
                        <div className="flex flex-wrap items-center gap-1 max-w-[120px]">
                          {Array.from({ length: group.overdueCount }).map((_, i) => (
                            <span key={`ov-${i}`} className="size-1.5 rounded-full bg-red-500 animate-pulse" title={tc("overdue")} />
                          ))}
                          {Array.from({ length: group.expiringCount }).map((_, i) => (
                            <span key={`ex-${i}`} className="size-1.5 rounded-full bg-yellow-500" title={tc("expiring")} />
                          ))}
                          {Array.from({ length: group.okayCount }).map((_, i) => (
                            <span key={`ok-${i}`} className="size-1.5 rounded-full bg-green-500" title={tc("active")} />
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="destructive" className="text-xs">
                        {tc("daysOverdue", { count: group.maxDaysOverdue })}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSheetClientId(group.clientId)}
                        className="size-8"
                      >
                        <ArrowRight className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Expiring Soon */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-5 text-yellow-500" />
              {t("expiringSoon")}
            </CardTitle>
            {expiringSoonGroups.length > 0 && (
              <Badge variant="secondary">{expiringSoonGroups.length}</Badge>
            )}
          </CardHeader>
          <CardContent>
            {expiringSoonGroups.length === 0 && expiringSubscriptions.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-muted-foreground">
                  {t("noExpiringSoon")}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Platform Subscriptions First */}
                {expiringSubscriptions.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
                      {t("platformSubscriptions")}
                    </p>
                    {expiringSubscriptions.map((sub: any) => (
                      <div
                        key={sub.id}
                        className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/20 px-3 py-2"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">
                            {sub.label} ({sub.platformName})
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {sub.planName}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {sub.autoRenewal ? (
                            <Badge variant="default" className="text-xs bg-green-600 hover:bg-green-700 text-white border-none">
                              {tc("autoRenewal")}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">
                              {sub.daysLeft === 0
                                ? tc("today")
                                : tc("daysLeft", { count: sub.daysLeft })}
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            asChild
                            className="size-8"
                          >
                            <Link href="/dashboard/subscriptions">
                              <ArrowRight className="size-3.5" />
                            </Link>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Client Seats */}
                {expiringSoonGroups.length > 0 && (
                  <div className="space-y-2">
                    {expiringSubscriptions.length > 0 && (
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mt-2">
                        {t("clientSeats")}
                      </p>
                    )}
                    {expiringSoonGroups.map((group) => (
                      <div
                        key={group.clientId}
                        className="flex items-center justify-between rounded-md border border-yellow-200 bg-yellow-50 dark:border-yellow-900/40 dark:bg-yellow-950/20 px-3 py-2"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">
                            {group.clientName}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">
                              {group.totalCount} {group.totalCount === 1 ? tc("subscription") : tc("subscriptions")}
                            </span>
                            <div className="flex flex-wrap items-center gap-1 max-w-[120px]">
                              {Array.from({ length: group.overdueCount }).map((_, i) => (
                                <span key={`ov-${i}`} className="size-1.5 rounded-full bg-red-500 animate-pulse" title={tc("overdue")} />
                              ))}
                              {Array.from({ length: group.expiringCount }).map((_, i) => (
                                <span key={`ex-${i}`} className="size-1.5 rounded-full bg-yellow-500" title={tc("expiring")} />
                              ))}
                              {Array.from({ length: group.okayCount }).map((_, i) => (
                                <span key={`ok-${i}`} className="size-1.5 rounded-full bg-green-500" title={tc("active")} />
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {group.autoRenewalCount > 0 ? (
                            <Badge variant="default" className="text-xs bg-green-600 hover:bg-green-700 text-white border-none">
                              {tc("autoRenewal")}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">
                              {group.minDaysLeft === 0
                                ? tc("today")
                                : tc("daysLeft", { count: group.minDaysLeft })}
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSheetClientId(group.clientId)}
                            className="size-8"
                          >
                            <ArrowRight className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Links */}
      <Card>
        <CardHeader>
          <CardTitle>{t("quickActions")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/platforms">{t("managePlatforms")}</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/subscriptions">{t("viewSubscriptions")}</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/plans">{t("viewPlans")}</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/clients">{t("viewClients")}</Link>
          </Button>
        </CardContent>
      </Card>

      {/* Footer note */}
      <p className="text-xs text-muted-foreground text-center">
        {tc("dataRefresh", { time: formatDistanceToNow(new Date(), { addSuffix: true }) })}
      </p>

      {/* Global Modals for Dashboard Context */}
      <ClientDetailSheet
        clientId={sheetClientId}
        open={!!sheetClientId}
        onOpenChange={(open) => {
          if (!open) setSheetClientId(null);
        }}
      />
    </div>
  );
}
