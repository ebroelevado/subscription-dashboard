"use client";

import React, { useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { CURRENCIES, type Currency } from "@/lib/currency";
import { useRenewPlatform } from "@/hooks/use-renewals";
import { useUpdateSubscription } from "@/hooks/use-subscriptions";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { addMonths, format } from "date-fns";
import { useTranslations } from "next-intl";
import { RefreshCw, Calendar, CreditCard, StickyNote, Activity } from "lucide-react";

interface RenewPlatformSheetProps {
  subscription: {
    id: string;
    label: string;
    activeUntil: string;
    autoRenewal: boolean;
    plan: { cost: number; name: string; platform: { name: string } };
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenewPlatformSheet({
  subscription,
  open,
  onOpenChange,
}: RenewPlatformSheetProps) {
  const renewMut = useRenewPlatform();
  const updateMut = useUpdateSubscription();
  const [amount, setAmount] = useState(0);
  const [months, setMonths] = useState(1);
  const [paidOn, setPaidOn] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [autoRenewal, setAutoRenewal] = useState(true);
  
  const t = useTranslations("subscriptions");
  const tc = useTranslations("common");
  const { data: session } = useSession();

  useEffect(() => {
    if (open && subscription) {
      const baseAmount = Number(subscription.plan.cost) / 100;
      setAmount(baseAmount);
      setMonths(1);
      setPaidOn(format(new Date(), "yyyy-MM-dd"));
      setNotes("");
      setAutoRenewal(subscription.autoRenewal);
    }
  }, [open, subscription]);

  const currentExpiry = subscription
    ? new Date(subscription.activeUntil)
    : new Date();
  
  const newExpiry = addMonths(currentExpiry, months);

  const handleMonthsChange = (m: number) => {
    const val = Math.max(1, m);
    setMonths(val);
    if (subscription) {
      setAmount(Number((Number(subscription.plan.cost) / 100) * val).toFixed(2) as any);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subscription) return;

    // If autoRenewal status changed, update it first or simultaneously
    if (autoRenewal !== subscription.autoRenewal) {
      updateMut.mutate({ id: subscription.id, autoRenewal });
    }

    renewMut.mutate(
      {
        subscriptionId: subscription.id,
        amountPaid: Number(amount),
        months: months,
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md flex flex-col gap-0 p-0 border-l border-zinc-200 dark:border-zinc-800">
        <SheetHeader className="p-6 border-b border-zinc-100 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-950/50">
          <SheetTitle className="flex items-center gap-2 text-xl">
            <RefreshCw className="size-5 text-blue-500" />
            {t("renewPlatformTitle", { name: subscription?.plan.platform.name ?? "" })}
          </SheetTitle>
          <SheetDescription>
            {t("renewPlatformDescription", {
              label: subscription?.label ?? "",
              planName: subscription?.plan.name ?? "",
            })}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Months and Amount */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="renewMonths" className="text-xs font-bold uppercase tracking-wider text-foreground/70 flex items-center gap-2">
                <Calendar className="size-3" /> {tc("months")}
              </Label>
              <Input
                id="renewMonths"
                type="number"
                min={1}
                value={months}
                onChange={(e) => handleMonthsChange(parseInt(e.target.value) || 1)}
                className="font-medium"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="platformAmount" className="text-xs font-bold uppercase tracking-wider text-foreground/70 flex items-center gap-2">
                <CreditCard className="size-3" /> {tc("amountPaid")}
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  {CURRENCIES[(session?.user as { currency?: string })?.currency as Currency || "EUR"].symbol}
                </span>
                <Input
                  id="platformAmount"
                  type="number"
                  step="0.01"
                  min={0}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="pl-7 font-medium"
                />
              </div>
            </div>
          </div>

          {/* Date */}
          <div className="space-y-2">
            <Label htmlFor="platformPaidOn" className="text-xs font-bold uppercase tracking-wider text-foreground/70 flex items-center gap-2">
              <Calendar className="size-3" /> {tc("paymentDate")}
            </Label>
            <Input
              id="platformPaidOn"
              type="date"
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="platformNotes" className="text-xs font-bold uppercase tracking-wider text-foreground/70 flex items-center gap-2">
              <StickyNote className="size-3" /> {tc("notes")}
            </Label>
            <Input
              id="platformNotes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={tc("notesPlaceholder")}
            />
          </div>

          {/* Auto-Renewal Toggle */}
          <div className="flex items-center justify-between rounded-xl border border-zinc-100 dark:border-zinc-800 p-4 bg-zinc-50/30 dark:bg-zinc-900/30">
            <div className="space-y-0.5">
              <Label htmlFor="autoRenewal" className="text-sm font-semibold flex items-center gap-2">
                <Activity className="size-3.5 text-green-500" />
                {tc("autoRenewal")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {autoRenewal ? "Activada" : "Desactivada"}
              </p>
            </div>
            <Switch
              id="autoRenewal"
              checked={autoRenewal}
              onCheckedChange={setAutoRenewal}
            />
          </div>

          {/* Preview */}
          <div className="rounded-xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/30 dark:bg-blue-950/20 p-4 space-y-2">
            <p className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest mb-1">Resumen del Vencimiento</p>
            <div className="flex justify-between items-center text-sm">
              <span className="text-foreground/60">{tc("currentExpiry")}</span>
              <span className="font-medium">{format(currentExpiry, "dd/MM/yyyy")}</span>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-blue-100/50 dark:border-blue-900/30">
              <span className="text-foreground/70 font-semibold">{tc("newExpiry")}</span>
              <span className="font-bold text-lg text-blue-600 dark:text-blue-400">
                {format(newExpiry, "dd/MM/yyyy")}
              </span>
            </div>
          </div>
        </form>

        <SheetFooter className="p-6 border-t border-zinc-100 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-950/50">
          <div className="flex w-full gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
            >
              {tc("cancel")}
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={renewMut.isPending || updateMut.isPending}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {renewMut.isPending ? tc("processing") : tc("recordPayment")}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
