"use client";

import { useState } from "react";
import { useRenewClient } from "@/hooks/use-renewals";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addMonths, subMonths, startOfDay, format } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { CURRENCIES, centsToAmount, formatCurrency } from "@/lib/currency";
import { useTranslations } from "next-intl";

interface RenewClientDialogProps {
  seat: {
    id: string;
    customPrice: number;
    activeUntil: string;
    client: { name: string };
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenewClientDialog({ seat, open, onOpenChange }: RenewClientDialogProps) {
  const renewMut = useRenewClient();
  const tc = useTranslations("common");
  const [amount, setAmount] = useState(0);
  const [months, setMonths] = useState(1);
  const [paidOn, setPaidOn] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");

  const price = seat ? centsToAmount(seat.customPrice) : 0;

  // Compute the new expiry preview
  const currentExpiry = seat ? startOfDay(new Date(seat.activeUntil)) : new Date();
  const today = startOfDay(new Date());

  let newExpiry: Date;
  const isCorrection = months < 0;
  if (isCorrection) {
    newExpiry = subMonths(currentExpiry, Math.abs(months));
  } else {
    newExpiry = addMonths(currentExpiry, months);
  }

  const isLapsed = currentExpiry < today;
  const resultInPast = newExpiry < today;

  const handleMonthsChange = (newMonths: number) => {
    // Clamp between -12 and 12, skip 0
    let clamped = Math.max(-12, Math.min(12, newMonths));
    if (clamped === 0) clamped = newMonths > 0 ? 1 : -1;
    setMonths(clamped);

    // Auto-multiplier: price × |months| (user can override)
    if (clamped > 0) {
      setAmount(Number((price * clamped).toFixed(2)));
    } else {
      // Corrections default to 0 payment
      setAmount(0);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!seat) return;
    renewMut.mutate(
      {
        seatId: seat.id,
        amountPaid: amount,
        months,
        paidOn,
        notes: notes || null,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      }
    );
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && seat) {
      setAmount(Number(seat.customPrice) / 100);
      setMonths(1);
      setPaidOn(format(new Date(), "yyyy-MM-dd"));
      setNotes("");
    }
    onOpenChange(isOpen);
  };

  const { data: session } = useSession();
  const currency = (session?.user as { currency?: string })?.currency || "EUR";
  const symbol = (CURRENCIES[currency as keyof typeof CURRENCIES] || CURRENCIES.EUR).symbol;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-md max-h-[92vh] sm:max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isCorrection ? "Correction" : "Renew"} — {seat?.client.name ?? "Client"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="amountPaid">Amount Received ({symbol})</Label>
            <Input
              id="amountPaid"
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
            {months > 1 && (
              <p className="text-xs text-muted-foreground">
                Auto-calculated: {formatCurrency(price * months, currency)}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="months">Months</Label>
            <Input
              id="months"
              type="number"
              min={-12}
              max={12}
              value={months}
              onChange={(e) => handleMonthsChange(Number(e.target.value) || 1)}
            />
            <p className="text-xs text-muted-foreground">
              Positive = extend, negative = correction
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="paidOn">{tc("paymentDate")}</Label>
            <Input
              id="paidOn"
              type="date"
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={isCorrection ? "e.g. Overbilling fix" : "e.g. Paid via Bizum"}
            />
          </div>

          {/* Preview */}
          <div className="rounded-lg border bg-muted/50 p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current expiry</span>
              <span className={isLapsed ? "text-destructive font-medium" : ""}>
                {format(currentExpiry, "dd/MM/yyyy")}
                {isLapsed && " (lapsed)"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">New expiry</span>
              <span className={`font-semibold ${
                resultInPast
                  ? "text-destructive"
                  : "text-green-600 dark:text-green-400"
              }`}>
                {format(newExpiry, "dd/MM/yyyy")}
              </span>
            </div>
          </div>
          {/* Warning for corrections that push into past */}
          {resultInPast && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              <span>
                This will set the expiry to a past date. The seat will show as <strong>expired</strong>.
              </span>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={renewMut.isPending}
              variant={isCorrection ? "destructive" : "default"}
            >
              {renewMut.isPending
                ? "Processing…"
                : isCorrection
                  ? "Apply Correction"
                  : "Confirm Renewal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
