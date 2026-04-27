"use client";

import React, { useState } from "react";
import { useSession } from "@/lib/auth-client";
import { CURRENCIES, centsToAmount, type Currency } from "@/lib/currency";
import { useRenewPlatform } from "@/hooks/use-renewals";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addMonths, format } from "date-fns";
import { useTranslations } from "next-intl";

interface RenewPlatformDialogProps {
  subscription: {
    id: string;
    label: string;
    activeUntil: string;
    plan: { cost: number; name: string; platform: { name: string } };
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenewPlatformDialog({
  subscription,
  open,
  onOpenChange,
}: RenewPlatformDialogProps) {
  const renewMut = useRenewPlatform();
  const [amount, setAmount] = React.useState(0);
  const [paidOn, setPaidOn] = React.useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = React.useState("");
  const t = useTranslations("subscriptions");
  const tc = useTranslations("common");
  const { data: session } = useSession();

  const currentExpiry = subscription
    ? new Date(subscription.activeUntil)
    : new Date();
  const newExpiry = addMonths(currentExpiry, 1);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subscription) return;
    renewMut.mutate(
      {
        subscriptionId: subscription.id,
        amountPaid: amount,
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
    if (isOpen && subscription) {
      setAmount(Number(subscription.plan.cost) / 100);
      setPaidOn(format(new Date(), "yyyy-MM-dd"));
      setNotes("");
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-md max-h-[92vh] sm:max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("renewPlatformTitle", { name: subscription?.plan.platform.name ?? "" })}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("renewPlatformDescription", {
              label: subscription?.label ?? "",
              planName: subscription?.plan.name ?? "",
            })}
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="platformAmount">
              {tc("amountPaid")} ({CURRENCIES[(session?.user as { currency?: string })?.currency as Currency || "EUR"].symbol})
            </Label>
            <Input
              id="platformAmount"
              type="number"
              step="0.01"
              min={0}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="platformPaidOn">
              {tc("paymentDate")}
            </Label>
            <Input
              id="platformPaidOn"
              type="date"
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="platformNotes">
              {tc("notes")} ({tc("optional")})
            </Label>
            <Input
              id="platformNotes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={tc("notesPlaceholder")}
            />
          </div>

          {/* Preview */}
          <div className="rounded-lg border bg-muted/50 p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{tc("currentExpiry")}</span>
              <span>{format(currentExpiry, "dd/MM/yyyy")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{tc("newExpiry")}</span>
              <span className="font-semibold text-green-600 dark:text-green-400">
                {format(newExpiry, "dd/MM/yyyy")}
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={renewMut.isPending}>
              {renewMut.isPending ? tc("recording") : tc("recordPayment")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
