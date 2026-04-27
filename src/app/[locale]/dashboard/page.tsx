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
  AlertTriangle,
  Clock,
  ArrowRight,
  Banknote,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  ChevronDown,
  RefreshCw
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { ClientDetailSheet } from "@/components/clients/client-detail-sheet";
import { RenewPlatformSheet } from "@/components/subscriptions/renew-platform-sheet";
import { useState } from "react";
import { formatCurrency } from "@/lib/currency";
import { useSession } from "@/lib/auth-client";
import { useRenewPlatform } from "@/hooks/use-renewals";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel } from "@/components/ui/dropdown-menu";

export default function DashboardPage() {
  const { data: session } = useSession();
  const { data: stats, isLoading } = useDashboardStats();
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const tClients = useTranslations("clients");
  const [sheetClientId, setSheetClientId] = useState<string | null>(null);
  const [renewPlatformObj, setRenewPlatformObj] = useState<any | null>(null);
  const renewMut = useRenewPlatform();

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

  // Groups are now provided pre-calculated by the backend
  const overdueGroups = stats.overdueGroups || [];
  const expiringSoonGroups = stats.expiringSoonGroups || [];
  const expiringSubscriptions = (stats as any).expiringSubscriptions || [];

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-foreground/70">{t("subtitle")}</p>
      </div>

      {/* Operational KPIs (Single Clean Component) */}
      <Card className="overflow-hidden animate-fade-in delay-1 border-muted/60 bg-card/50 shadow-sm">
        <div className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-border">
          <div className="p-6 transition-colors hover:bg-muted/20">
            <p className="text-sm font-medium text-foreground/80 flex items-center gap-2">
              <LayoutGrid className="size-4 text-primary/70" /> {t("platforms")}
            </p>
            <p className="mt-3 text-3xl font-bold tracking-tight">{stats.platformCount}</p>
            <p className="text-xs text-foreground/60 mt-1.5">{tc("activePlans", { count: stats.activePlanCount })}</p>
          </div>
          <div className="p-6 transition-colors hover:bg-muted/20">
            <p className="text-sm font-medium text-foreground/80 flex items-center gap-2">
              <Users className="size-4 text-blue-500/70" /> {t("clients")}
            </p>
            <p className="mt-3 text-3xl font-bold tracking-tight">{stats.clientCount}</p>
            <p className="text-xs text-foreground/60 mt-1.5">{tc("activeSeats", { count: stats.activeSeatCount })}</p>
          </div>
          <div className="p-6 transition-colors hover:bg-muted/20">
            <p className="text-sm font-medium text-foreground/80 flex items-center gap-2">
              <Layers className="size-4 text-purple-500/70" /> {t("subscriptions")}
            </p>
            <p className="mt-3 text-3xl font-bold tracking-tight">{stats.activeSubscriptionCount}</p>
            <p className="text-xs text-foreground/60 mt-1.5">{t("activeSubscriptions")}</p>
          </div>
          <div className="p-6 transition-colors hover:bg-muted/20">
            <p className="text-sm font-medium text-foreground/80 flex items-center gap-2">
              <Activity className="size-4 text-amber-500/70" /> {t("activeSeats")}
            </p>
            <p className="mt-3 text-3xl font-bold tracking-tight">{stats.activeSeatCount}</p>
            <p className="text-xs text-foreground/60 mt-1.5">{t("acrossAllSubscriptions")}</p>
          </div>
        </div>
      </Card>

      {/* Consolidated Financial Overview */}
      <div className="animate-fade-in delay-2">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Banknote className="size-5 text-emerald-500" /> {t("financialHealth")}
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {/* Revenue */}
          <Card className="bg-gradient-to-br from-background to-emerald-50/30 dark:to-emerald-950/20 border-emerald-100/50 dark:border-emerald-900/30 overflow-hidden relative shadow-sm">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <ArrowUpRight className="size-16 text-emerald-500" />
            </div>
            <CardContent className="p-6 relative z-10">
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">{t("revenue")}</p>
              <div className="mt-3 flex items-baseline gap-2">
                <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(stats.thisMonthRevenue ?? 0, currency)}
                </p>
                <span className="text-xs text-muted-foreground font-medium">
                  / {formatCurrency(stats.monthlyRevenue, currency)} {t("expected")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-emerald-500"></span>
                {t("fromClientRenewals")}
              </p>
            </CardContent>
          </Card>
          
          {/* Cost */}
          <Card className="bg-gradient-to-br from-background to-rose-50/30 dark:to-rose-950/20 border-rose-100/50 dark:border-rose-900/30 overflow-hidden relative shadow-sm">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <CreditCard className="size-16 text-rose-500" />
            </div>
            <CardContent className="p-6 relative z-10">
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">{t("cost")}</p>
              <div className="mt-3 flex items-baseline gap-2">
                <p className="text-3xl font-bold">
                  {formatCurrency(stats.thisMonthCost ?? 0, currency)}
                </p>
                <span className="text-xs text-muted-foreground font-medium">
                  / {formatCurrency(stats.monthlyCost, currency)} {t("expected")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-rose-500"></span>
                {t("platformRenewalsPaid")}
              </p>
            </CardContent>
          </Card>

          {/* Net Profit */}
          <Card className={`bg-gradient-to-br overflow-hidden relative shadow-sm ${(stats.thisMonthProfit ?? 0) >= 0 ? 'from-background to-blue-50/30 dark:to-blue-950/20 border-blue-100/50 dark:border-blue-900/30' : 'from-background to-rose-50/30 dark:to-rose-950/20 border-rose-100/50 dark:border-rose-900/30'}`}>
            <div className="absolute top-0 right-0 p-4 opacity-10">
              {(stats.thisMonthProfit ?? 0) >= 0 ? <ArrowUpRight className="size-16 text-blue-500" /> : <ArrowDownRight className="size-16 text-rose-500" />}
            </div>
            <CardContent className="p-6 relative z-10">
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">{t("net")}</p>
              <div className="mt-3 flex items-baseline gap-2">
                <p className={`text-3xl font-bold ${(stats.thisMonthProfit ?? 0) >= 0 ? "text-blue-600 dark:text-blue-400" : "text-rose-600 dark:text-rose-400"}`}>
                  {formatCurrency(stats.thisMonthProfit ?? 0, currency)}
                </p>
                <span className="text-xs text-muted-foreground font-medium">
                  / {formatCurrency(profit, currency)} {t("expected")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
                <span className={`size-1.5 rounded-full ${(stats.thisMonthProfit ?? 0) >= 0 ? 'bg-blue-500' : 'bg-rose-500'}`}></span>
                {t("actualCashFlow")}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Overdue & Expiring Soon */}
      <div className="grid gap-6 lg:grid-cols-2 animate-fade-in delay-3">
        {/* Overdue Seats */}
        <Card className="border-red-100/50 dark:border-red-900/20 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3 bg-red-50/50 dark:bg-red-950/20">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-red-500" />
              {t("overdueSeats")}
            </CardTitle>
            {overdueGroups.length > 0 && (
              <Badge variant="destructive" className="bg-red-500 hover:bg-red-600">{overdueGroups.length}</Badge>
            )}
          </CardHeader>
          <CardContent className="pt-4">
            {overdueGroups.length === 0 ? (
              <div className="py-8 text-center flex flex-col items-center justify-center">
                <div className="size-12 rounded-full bg-green-50 dark:bg-green-950/30 flex items-center justify-center mb-3">
                  <span className="text-2xl">🎉</span>
                </div>
                <p className="font-medium text-green-700 dark:text-green-400">{t("noOverdueSeats")}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("allClientsUpToDate")}
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {overdueGroups.map((group) => (
                  <div
                    key={group.clientId}
                    className="flex items-center justify-between rounded-lg border border-red-100 bg-white dark:border-red-900/30 dark:bg-card px-4 py-3 shadow-sm transition-all hover:shadow-md hover:border-red-200 dark:hover:border-red-800/50 group"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold">
                        {group.clientName}
                      </span>
                      <div className="flex items-center gap-2.5">
                        <span className="text-xs text-muted-foreground">
                          {group.totalCount} {group.totalCount === 1 ? tc("subscription") : tc("subscriptions")}
                        </span>
                        <div className="flex flex-wrap items-center gap-1 max-w-[120px]">
                          {Array.from({ length: group.overdueCount }).map((_, i) => (
                            <span key={`ov-${i}`} className="size-1.5 rounded-full bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.5)] animate-pulse" title={tc("overdue")} />
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
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="text-xs text-red-600 dark:text-red-400 border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30">
                        {tc("daysOverdue", { count: group.maxDaysOverdue })}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSheetClientId(group.clientId)}
                        className="size-8 rounded-full opacity-0 group-hover:opacity-100 transition-opacity bg-muted hover:bg-muted/80"
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
        <Card className="border-yellow-100/50 dark:border-yellow-900/20 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3 bg-yellow-50/50 dark:bg-yellow-950/20">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="size-4 text-yellow-500" />
              {t("expiringSoon")}
            </CardTitle>
            {expiringSoonGroups.length > 0 && (
              <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-400 hover:bg-yellow-200">{expiringSoonGroups.length}</Badge>
            )}
          </CardHeader>
          <CardContent className="pt-4">
            {expiringSoonGroups.length === 0 && expiringSubscriptions.length === 0 ? (
              <div className="py-8 text-center flex flex-col items-center justify-center">
                <div className="size-12 rounded-full bg-muted/30 flex items-center justify-center mb-3">
                  <Clock className="size-6 text-muted-foreground/50" />
                </div>
                <p className="text-muted-foreground">
                  {t("noExpiringSoon")}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Platform Subscriptions First */}
                {expiringSubscriptions.length > 0 && (
                  <div className="space-y-2.5">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
                      {t("platformSubscriptions")}
                    </p>
                    {expiringSubscriptions.map((sub: any) => (
                      <div
                        key={sub.id}
                        onClick={() => setRenewPlatformObj(sub)}
                        className="flex items-center justify-between rounded-lg border border-blue-100 bg-white dark:border-blue-900/30 dark:bg-card px-4 py-3 shadow-sm transition-all hover:shadow-md hover:border-blue-200 dark:hover:border-blue-800/50 cursor-pointer group active:scale-[0.98]"
                      >
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-semibold">
                            {sub.label} <span className="text-foreground/50 font-normal">({sub.platformName})</span>
                          </span>
                          <span className="text-xs text-foreground/70">
                            {sub.planName}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          {sub.autoRenewal && (
                            <Badge variant="default" className="text-[10px] bg-green-500/10 text-green-700 hover:bg-green-500/20 dark:bg-green-500/20 dark:text-green-400 border-none px-1.5 py-0">
                              {tc("autoRenewal")}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30">
                            {sub.daysLeft === 0
                              ? tc("today")
                              : tc("daysLeft", { count: sub.daysLeft })}
                          </Badge>
                          <RefreshCw className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Client Seats */}
                {expiringSoonGroups.length > 0 && (
                  <div className="space-y-2.5">
                    {expiringSubscriptions.length > 0 && (
                      <p className="text-[11px] font-bold text-foreground uppercase tracking-wider px-1 mt-4">
                        {t("clientSeats")}
                      </p>
                    )}
                    {expiringSoonGroups.map((group) => (
                      <div
                        key={group.clientId}
                        className="flex items-center justify-between rounded-lg border border-yellow-100 bg-white dark:border-yellow-900/30 dark:bg-card px-4 py-3 shadow-sm transition-all hover:shadow-md hover:border-yellow-200 dark:hover:border-yellow-800/50 group"
                      >
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-semibold">
                            {group.clientName}
                          </span>
                          <div className="flex items-center gap-2.5">
                            <span className="text-xs text-foreground/70">
                              {group.totalCount} {group.totalCount === 1 ? tc("subscription") : tc("subscriptions")}
                            </span>
                            <div className="flex flex-wrap items-center gap-1 max-w-[120px]">
                              {Array.from({ length: group.overdueCount }).map((_, i) => (
                                <span key={`ov-${i}`} className="size-1.5 rounded-full bg-red-500 animate-pulse" title={tc("overdue")} />
                              ))}
                              {Array.from({ length: group.expiringCount }).map((_, i) => (
                                <span key={`ex-${i}`} className="size-1.5 rounded-full bg-yellow-500 shadow-[0_0_4px_rgba(234,179,8,0.5)]" title={tc("expiring")} />
                              ))}
                              {Array.from({ length: group.okayCount }).map((_, i) => (
                                <span key={`ok-${i}`} className="size-1.5 rounded-full bg-green-500" title={tc("active")} />
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {group.autoRenewalCount > 0 ? (
                            <Badge variant="default" className="text-[10px] bg-green-500/10 text-green-700 hover:bg-green-500/20 dark:bg-green-500/20 dark:text-green-400 border-none px-1.5 py-0">
                              {tc("autoRenewal")}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-900 bg-yellow-50 dark:bg-yellow-950/30">
                              {group.minDaysLeft === 0
                                ? tc("today")
                                : tc("daysLeft", { count: group.minDaysLeft })}
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSheetClientId(group.clientId)}
                            className="size-8 rounded-full opacity-0 group-hover:opacity-100 transition-opacity bg-muted hover:bg-muted/80"
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

      {/* Footer note */}
      <div className="pt-4 border-t border-border/40">
        <p className="text-xs text-muted-foreground/60 text-center flex items-center justify-center gap-1.5">
          <span className="relative flex size-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full size-2 bg-emerald-500"></span>
          </span>
          {tc("dataRefresh", { time: formatDistanceToNow(new Date(), { addSuffix: true }) })}
        </p>
      </div>

      {/* Global Modals for Dashboard Context */}
      <ClientDetailSheet
        clientId={sheetClientId}
        open={!!sheetClientId}
        onOpenChange={(open) => {
          if (!open) setSheetClientId(null);
        }}
      />
      <RenewPlatformSheet
        subscription={renewPlatformObj}
        open={!!renewPlatformObj}
        onOpenChange={(open) => !open && setRenewPlatformObj(null)}
      />
    </div>
  );
}
