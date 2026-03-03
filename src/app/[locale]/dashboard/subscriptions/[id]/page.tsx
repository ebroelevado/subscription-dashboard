"use client";

import { use, useState } from "react";
import { useSubscription } from "@/hooks/use-subscriptions";
import { usePauseSeat, useResumeSeat, useCancelSeat } from "@/hooks/use-seats";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SeatCard } from "@/components/subscriptions/seat-card";
import { AddSeatDialog } from "@/components/subscriptions/add-seat-dialog";
import { EditSeatDialog } from "@/components/subscriptions/edit-seat-dialog";
import { RenewClientDialog } from "@/components/subscriptions/renew-client-dialog";
import { RenewPlatformDialog } from "@/components/subscriptions/renew-platform-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Users,
  Calendar,
  PauseCircle,
  PlayCircle,
  Banknote,
} from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { useSession } from "next-auth/react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useTranslations } from "next-intl";



async function fetchApi<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Request failed");
  return json.data;
}

export default function SubscriptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = useTranslations("subscriptions");
  const tc = useTranslations("common");
  const th = useTranslations("history");
  const { id } = use(params);
  const { data: sub, isLoading, isError } = useSubscription(id);
  const [addSeatOpen, setAddSeatOpen] = useState(false);
  const [editSeat, setEditSeat] = useState<typeof sub extends undefined ? never : NonNullable<typeof sub>["clientSubscriptions"][number] | null>(null);
  const [renewClientSeat, setRenewClientSeat] = useState<typeof sub extends undefined ? never : NonNullable<typeof sub>["clientSubscriptions"][number] | null>(null);
  const { data: session } = useSession();
  const currency = (session?.user as { currency?: string })?.currency || "EUR";
  const [renewPlatformOpen, setRenewPlatformOpen] = useState(false);

  // Lifecycle dialogs
  const [cancelSeatId, setCancelSeatId] = useState<string | null>(null);
  const [bulkPending, setBulkPending] = useState(false);

  // Mutations
  const pauseMutation = usePauseSeat();
  const resumeMutation = useResumeSeat();
  const cancelMutation = useCancelSeat();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (isError || !sub) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <p className="text-muted-foreground">{tc("noResultsFound")}</p>
        <Button asChild variant="outline">
          <Link href="/dashboard/subscriptions">
            <ArrowLeft className="mr-2 size-4" />
            {t("title")}
          </Link>
        </Button>
      </div>
    );
  }

  // Seat analytics
  const activeSeats = sub.clientSubscriptions.filter((s) => s.status === "active");
  const pausedSeats = sub.clientSubscriptions.filter((s) => s.status === "paused");
  const actualRevenue = activeSeats.reduce((sum, s) => sum + Number(s.customPrice), 0);
  const potentialRevenue = [...activeSeats, ...pausedSeats].reduce(
    (sum, s) => sum + Number(s.customPrice), 0
  );
  const revenueDelta = potentialRevenue - actualRevenue;
  const cost = Number(sub.plan.cost);
  const profit = actualRevenue - cost;
  const profitMargin = actualRevenue > 0 ? (profit / actualRevenue) * 100 : 0;
  const maxSlots = sub.plan.maxSeats ?? 0;
  const occupiedCount = activeSeats.length + pausedSeats.length;
  const occupancy = maxSlots > 0 ? (occupiedCount / maxSlots) * 100 : 0;

  // Bulk actions
  const handleBulkPause = async () => {
    setBulkPending(true);
    try {
      await fetchApi(`/api/subscriptions/${id}/bulk-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      });
      toast.success(t("pauseAll"));
      pauseMutation.reset(); // trigger cache invalidation via window reload
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc("error"));
    } finally {
      setBulkPending(false);
    }
  };

  const handleBulkResume = async () => {
    setBulkPending(true);
    try {
      await fetchApi(`/api/subscriptions/${id}/bulk-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });
      toast.success(t("resumeAll"));
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc("error"));
    } finally {
      setBulkPending(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/dashboard/subscriptions">
              <ArrowLeft className="size-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{sub.label}</h1>
            <p className="text-sm text-muted-foreground">
              {sub.plan.platform.name} · {sub.plan.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={sub.status === "active" ? "default" : "secondary"}>
            {tc(sub.status)}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRenewPlatformOpen(true)}
          >
            <RefreshCw className="mr-2 size-4" />
            {t("renewPlatform")}
          </Button>
        </div>
      </div>

      {/* Key Metrics — responsive grid */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
        {/* Actual Revenue */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("actualRevenue")}
            </CardTitle>
            <Banknote className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(actualRevenue, currency)}</p>
            <p className="text-xs text-muted-foreground">
              {tc("activeSeats", { count: activeSeats.length })}
            </p>
          </CardContent>
        </Card>

        {/* Potential Revenue */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("potentialRevenue")}
            </CardTitle>
            <TrendingUp className="size-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(potentialRevenue, currency)}</p>
            {revenueDelta > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t("revenueDelta", { amount: formatCurrency(revenueDelta, currency) })}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Cost */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("platformCost")}
            </CardTitle>
            <Calendar className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(cost, currency)}</p>
            <p className="text-xs text-muted-foreground">
              {t("expires")} {format(new Date(sub.activeUntil), "dd/MM/yyyy")}
            </p>
          </CardContent>
        </Card>

        {/* Profit */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {tc("profitLabel", { ns: "analytics" })}
            </CardTitle>
            {profit >= 0 ? (
              <TrendingUp className="size-4 text-green-500" />
            ) : (
              <TrendingDown className="size-4 text-red-500" />
            )}
          </CardHeader>
          <CardContent>
            <p
              className={`text-2xl font-bold ${
                profit >= 0
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {formatCurrency(profit, currency)}
            </p>
            <p className="text-xs text-muted-foreground">
              {profitMargin >= 0
                ? tc("margin", { percent: profitMargin.toFixed(0) })
                : tc("negativeMargin", { ns: "analytics", defaultValue: "Negative margin" })}
            </p>
          </CardContent>
        </Card>

        {/* Occupancy */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("occupancy")}
            </CardTitle>
            <Users className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-1">
              <p className="text-2xl font-bold">{occupiedCount}</p>
              <p className="text-sm text-muted-foreground">
                / {maxSlots > 0 ? maxSlots : "∞"}
              </p>
            </div>
            {maxSlots > 0 && (
              <Progress value={occupancy} className="mt-2 h-2" />
            )}
            {pausedSeats.length > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                {pausedSeats.length} {tc("paused")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Seat Map */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4 sm:p-6">
          <CardTitle className="text-base">{t("seatMap")}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {/* Bulk actions */}
            {activeSeats.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkPause}
                disabled={bulkPending}
              >
                <PauseCircle className="mr-1.5 size-3.5" />
                {t("pauseAll")}
              </Button>
            )}
            {pausedSeats.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkResume}
                disabled={bulkPending}
              >
                <PlayCircle className="mr-1.5 size-3.5" />
                {t("resumeAll")}
              </Button>
            )}
            <Button size="sm" onClick={() => setAddSeatOpen(true)}>
              <Plus className="mr-2 size-4" />
              {t("addSeat")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
          {sub.clientSubscriptions.length === 0 ? (
            <div className="py-6 text-center">
              <Users className="mx-auto mb-3 size-10 text-muted-foreground/50" />
              <p className="text-muted-foreground">{t("noActiveSeats")}</p>
            </div>
          ) : (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {sub.clientSubscriptions.map((seat) => (
                <SeatCard
                  key={seat.id}
                  seat={seat}
                  onPause={() => pauseMutation.mutate(seat.id)}
                  onResume={() => resumeMutation.mutate(seat.id)}
                  onCancel={() => setCancelSeatId(seat.id)}
                  onRenew={() => setRenewClientSeat(seat)}
                  onEdit={() => setEditSeat(seat)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Platform Renewal History */}
      {sub.platformRenewals && sub.platformRenewals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{th("title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {sub.platformRenewals.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="text-xs">
                      {format(new Date(r.paidOn), "dd/MM/yyyy")}
                    </Badge>
                    {r.notes && (
                      <span className="text-muted-foreground">{r.notes}</span>
                    )}
                  </div>
                  <span className="font-mono font-medium">
                    {formatCurrency(Number(r.amountPaid), currency)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Modals ── */}

      {/* Add Seat */}
      <AddSeatDialog
        subscriptionId={id}
        open={addSeatOpen}
        onOpenChange={setAddSeatOpen}
      />

      {/* Edit Seat */}
      <EditSeatDialog
        key={editSeat?.id || "none"}
        seat={editSeat}
        open={!!editSeat}
        onOpenChange={(open) => {
          if (!open) setEditSeat(null);
        }}
      />

      {/* Renew Client */}
      <RenewClientDialog
        seat={renewClientSeat}
        open={!!renewClientSeat}
        onOpenChange={(open) => {
          if (!open) setRenewClientSeat(null);
        }}
      />

      {/* Renew Platform */}
      <RenewPlatformDialog
        subscription={renewPlatformOpen ? {
          id: sub.id,
          label: sub.label,
          activeUntil: sub.activeUntil,
          plan: {
            cost: Number(sub.plan.cost),
            name: sub.plan.name,
            platform: sub.plan.platform,
          },
        } : null}
        open={renewPlatformOpen}
        onOpenChange={setRenewPlatformOpen}
      />

      {/* Cancel Confirmation */}
      <AlertDialog open={!!cancelSeatId} onOpenChange={(o) => { if (!o) setCancelSeatId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("removeSeatConfirmationTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("removeSeatConfirmationDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("keepSeatAction")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (cancelSeatId) {
                  cancelMutation.mutate(cancelSeatId, {
                    onSuccess: () => setCancelSeatId(null),
                  });
                }
              }}
            >
              {cancelMutation.isPending ? t("cancelling") : t("removeSeatAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
