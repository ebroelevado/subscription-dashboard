"use client";

import { useState, useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

import {
  RefreshCw, CheckSquare, Square, ChevronDown, ChevronUp, AlertTriangle,
} from "lucide-react";
import { addMonths, startOfDay, format, differenceInDays } from "date-fns";
import { useRenewBulkClients } from "@/hooks/use-renewals";
import { useTranslations } from "next-intl";
import { useSession } from "@/lib/auth-client";
import { formatCurrency, centsToAmount } from "@/lib/currency";

export interface BulkRenewSeat {
  id: string;
  customPrice: number;
  activeUntil: string;
  status: string;
  platformName: string;
  planName: string;
  subscriptionLabel: string;
}

interface BulkRenewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientName: string;
  seats: BulkRenewSeat[];
}

interface SeatConfig {
  months: number;
  amount: string; // string so user can type freely
  expanded: boolean;
  monthsOverridden: boolean;
  amountOverridden: boolean;
}

function makeSeatConfig(customPrice: number, globalMonths: number): SeatConfig {
  const decimalPrice = customPrice / 100;
  return {
    months: globalMonths,
    amount: (decimalPrice * globalMonths).toFixed(2),
    expanded: false,
    monthsOverridden: false,
    amountOverridden: false,
  };
}

export function BulkRenewDialog({
  open,
  onOpenChange,
  clientName,
  seats,
}: BulkRenewDialogProps) {
  const t = useTranslations("clients");
  const tc = useTranslations("common");
  const { data: session } = useSession();
  const currency = (session?.user as { currency?: string })?.currency || "EUR";
  const bulkMut = useRenewBulkClients();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [globalMonths, setGlobalMonths] = useState(1);
  const [globalPaidOn, setGlobalPaidOn] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [seatConfigs, setSeatConfigs] = useState<Record<string, SeatConfig>>({});
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState("");

  const renewableSeats = useMemo(
    () => seats.filter((s) => s.status === "active"),
    [seats]
  );

  // Initialise / reset when seat list changes
  const seatIds = renewableSeats.map((s) => s.id).join(",");
  useMemo(() => {
    setSelectedIds(new Set(renewableSeats.map((s) => s.id)));
    const configs: Record<string, SeatConfig> = {};
    for (const s of renewableSeats) configs[s.id] = makeSeatConfig(Number(s.customPrice), 1);
    setSeatConfigs(configs);
    setGlobalMonths(1);
    setGlobalPaidOn(format(new Date(), "yyyy-MM-dd"));
    setShowNotes(false);
    setNotes("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatIds]);

  const today = startOfDay(new Date());

  // When global months changes, update all non-overridden seats
  const handleGlobalMonthsChange = (val: number) => {
    const m = Math.max(1, Math.min(12, val || 1));
    setGlobalMonths(m);
    setSeatConfigs((prev) => {
      const next = { ...prev };
      for (const seat of renewableSeats) {
        const cfg = prev[seat.id];
        if (!cfg) continue;
        const newCfg = { ...cfg, months: m };
        if (!cfg.amountOverridden) {
          newCfg.amount = ((Number(seat.customPrice) / 100) * m).toFixed(2);
        }
        if (!cfg.monthsOverridden) {
          next[seat.id] = newCfg;
        }
      }
      return next;
    });
  };

  const updateSeatField = (
    seatId: string,
    field: "months" | "amount",
    value: string | number
  ) => {
    setSeatConfigs((prev) => {
      const cfg = { ...prev[seatId] };
      if (field === "months") {
        const m = Math.max(1, Math.min(12, Number(value) || 1));
        cfg.months = m;
        cfg.monthsOverridden = m !== globalMonths;
        // Recalculate amount unless user overrode it
        const seat = renewableSeats.find((s) => s.id === seatId);
        if (seat && !cfg.amountOverridden) {
          cfg.amount = ((Number(seat.customPrice) / 100) * m).toFixed(2);
        }
      } else {
        cfg.amount = String(value);
        cfg.amountOverridden = true;
      }
      return { ...prev, [seatId]: cfg };
    });
  };

  const toggleExpanded = (seatId: string) => {
    setSeatConfigs((prev) => ({
      ...prev,
      [seatId]: { ...prev[seatId], expanded: !prev[seatId]?.expanded },
    }));
  };

  const toggleSeat = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === renewableSeats.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(renewableSeats.map((s) => s.id)));
  };

  // Compute per-seat expiry preview
  const previews = useMemo(() => {
    return renewableSeats.map((seat) => {
      const cfg = seatConfigs[seat.id] ?? makeSeatConfig(Number(seat.customPrice), globalMonths);
      const currentExpiry = startOfDay(new Date(seat.activeUntil));
      const isLapsed = currentExpiry < today;
      const newExpiry = addMonths(currentExpiry, cfg.months);
      const diff = differenceInDays(currentExpiry, today);
      return { ...seat, cfg, currentExpiry, newExpiry, isLapsed, daysLeft: diff };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renewableSeats, seatConfigs, globalMonths]);

  const selectedPreviews = previews.filter((p) => selectedIds.has(p.id));

  // Check if all selected seats share the same expiry date
  const allSameExpiry =
    selectedPreviews.length > 1 &&
    selectedPreviews.every(
      (p) => p.activeUntil === selectedPreviews[0].activeUntil
    );
  const allSameNewExpiry =
    allSameExpiry &&
    selectedPreviews.every(
      (p) => p.cfg.months === selectedPreviews[0].cfg.months
    );

  const selectedTotal = selectedPreviews.reduce(
    (sum, p) => sum + (parseFloat(p.cfg.amount) || 0),
    0
  );

  const resultInPastAny = selectedPreviews.some((p) => p.newExpiry < today);

  const handleConfirm = () => {
    if (selectedIds.size === 0) return;
    const items = selectedPreviews.map((p) => ({
      clientSubscriptionId: p.id,
      amountPaid: parseFloat(p.cfg.amount) || 0,
      months: p.cfg.months,
      notes: notes || null,
    }));
    bulkMut.mutate(
      { items, months: globalMonths, paidOn: globalPaidOn, clientName },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  const allSelected = selectedIds.size === renewableSeats.length;
  const selectedCount = selectedIds.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="size-5 text-primary" />
            {t("renewAllTitle")} — {clientName}
          </DialogTitle>
          <DialogDescription>{t("renewAllDescription")}</DialogDescription>
        </DialogHeader>

        {/* Global months */}
        <div className="flex items-center gap-3">
          <Label htmlFor="bulk-months" className="shrink-0 text-sm">
            {t("monthsToRenew")}
          </Label>
          <Input
            id="bulk-months"
            type="number"
            min={1}
            max={12}
            value={globalMonths}
            onChange={(e) => handleGlobalMonthsChange(Number(e.target.value))}
            className="w-20"
          />
          <p className="text-xs text-muted-foreground">{tc("renewMonthsHint")}</p>
        </div>

        {/* Global Payment Date */}
        <div className="flex items-center gap-3">
          <Label htmlFor="bulk-paidon" className="shrink-0 text-sm">
            {tc("paymentDate")}
          </Label>
          <Input
            id="bulk-paidon"
            type="date"
            value={globalPaidOn}
            onChange={(e) => setGlobalPaidOn(e.target.value)}
            className="w-[160px]"
          />
        </div>

        {/* Shared expiry summary when all dates match */}
        {allSameExpiry && selectedPreviews.length > 0 && (
          <div className="rounded-lg border bg-muted/50 p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{tc("currentExpiry")} ({t("allExpireSameDate")})</span>
              <span className={selectedPreviews[0].isLapsed ? "text-destructive font-medium" : ""}>
                {format(selectedPreviews[0].currentExpiry, "dd/MM/yyyy")}
                {selectedPreviews[0].isLapsed && ` (${tc("lapsed")})`}
              </span>
            </div>
            {allSameNewExpiry && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{tc("newExpiry")} ({t("allExpireSameDate")})</span>
                <span className="font-semibold text-green-600 dark:text-green-400">
                  {format(selectedPreviews[0].newExpiry, "dd/MM/yyyy")}
                </span>
              </div>
            )}
          </div>
        )}

        <Separator />

        {/* Select-all toggle */}
        <button
          type="button"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={toggleAll}
        >
          {allSelected ? (
            <CheckSquare className="size-4 text-primary" />
          ) : (
            <Square className="size-4" />
          )}
          {allSelected ? tc("deselectAll") : tc("selectAll")}
        </button>

        {/* Seat list */}
        <div className="space-y-2">
          {previews.map((seat) => {
            const isSelected = selectedIds.has(seat.id);
            const cfg = seat.cfg;
            const expanded = cfg.expanded;
            const amount = parseFloat(cfg.amount) || 0;

            return (
              <div
                key={seat.id}
                className={`rounded-lg border transition-all duration-150 ${
                  isSelected
                    ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                    : "opacity-50 border-muted"
                }`}
              >
                {/* Main row — always visible */}
                <button
                  type="button"
                  onClick={() => toggleSeat(seat.id)}
                  className="w-full text-left p-3 space-y-1.5"
                >
                  {/* Row 1: checkbox + name + amount */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {isSelected ? (
                        <CheckSquare className="size-4 text-primary shrink-0" />
                      ) : (
                        <Square className="size-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="text-sm font-medium">
                        {seat.platformName} — {seat.planName}
                      </span>
                      {cfg.monthsOverridden && (
                        <Badge variant="secondary" className="text-[10px] h-4">
                          {cfg.months}m
                        </Badge>
                      )}
                    </div>
                    <span className="text-sm font-mono font-semibold">
                      {formatCurrency(amount, currency)}
                    </span>
                  </div>

                  {/* Row 2: expiry (only when dates differ across seats) */}
                  {!allSameExpiry && (
                    <div className="flex items-center justify-between pl-6 text-xs text-muted-foreground">
                      <span>{seat.subscriptionLabel}</span>
                      <div className="flex items-center gap-1.5">
                        <span className={seat.isLapsed ? "text-destructive font-medium" : ""}>
                          {format(seat.currentExpiry, "dd/MM/yy")}
                          {seat.isLapsed && ` (${tc("lapsed")})`}
                        </span>
                        <span>→</span>
                        <Badge
                          variant="default"
                          className="text-[10px] h-4 bg-green-600 hover:bg-green-600"
                        >
                          {format(seat.newExpiry, "dd/MM/yy")}
                        </Badge>
                      </div>
                    </div>
                  )}
                </button>

                {/* Expand toggle */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggleExpanded(seat.id); }}
                  className="w-full flex items-center gap-1.5 px-3 pb-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                  {t("customizeRenewal")}
                </button>

                {/* Expandable per-seat fields */}
                {expanded && (
                  <div className="px-3 pb-3 space-y-3 border-t pt-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">{tc("amountPaid")} ({currency})</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={cfg.amount}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateSeatField(seat.id, "amount", e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{tc("renewMonthsHint").split("=")[0].trim()} (m)</Label>
                        <Input
                          type="number"
                          min={1}
                          max={12}
                          value={cfg.months}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateSeatField(seat.id, "months", e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                    {/* Per-seat expiry preview when expanded */}
                    <div className="rounded-md bg-muted/60 px-2 py-1.5 text-xs flex justify-between">
                      <span className="text-muted-foreground">{tc("currentExpiry")}</span>
                      <span className={seat.isLapsed ? "text-destructive font-medium" : ""}>
                        {format(seat.currentExpiry, "dd/MM/yyyy")}
                      </span>
                    </div>
                    <div className="rounded-md bg-muted/60 px-2 py-1.5 text-xs flex justify-between">
                      <span className="text-muted-foreground">{tc("newExpiry")}</span>
                      <span className={`font-semibold ${seat.newExpiry < today ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
                        {format(seat.newExpiry, "dd/MM/yyyy")}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <Separator />

        {/* Notes toggle */}
        <div className="flex items-center gap-3">
          <Switch
            id="bulk-notes-toggle"
            checked={showNotes}
            onCheckedChange={setShowNotes}
          />
          <Label htmlFor="bulk-notes-toggle" className="text-sm cursor-pointer">
            {t("addNotes")} <span className="text-muted-foreground text-xs">({tc("optional")})</span>
          </Label>
        </div>
        {showNotes && (
          <textarea
            placeholder={tc("notesPlaceholder")}
            value={notes}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
            className="w-full resize-none text-sm rounded-md border border-input bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            rows={2}
          />
        )}

        {/* Overdue warning */}
        {resultInPastAny && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <span>{tc("resultInPastWarning")}</span>
          </div>
        )}

        {/* Total */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {tc("totalCount", { count: selectedCount })}
          </span>
          <span className="text-lg font-bold font-mono">
            {formatCurrency(selectedTotal, currency)}
          </span>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button
            type="button"
            disabled={selectedCount === 0 || bulkMut.isPending}
            onClick={handleConfirm}
          >
            {bulkMut.isPending
              ? tc("processing")
              : t("renewServicesAction", { count: selectedCount })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
