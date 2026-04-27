"use client";

import { useState } from "react";
import { useUpdateSeat } from "@/hooks/use-seats";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, RefreshCw } from "lucide-react";
import { useSubscriptions } from "@/hooks/use-subscriptions";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { centsToAmount } from "@/lib/currency";

import { useTranslations } from "next-intl";
import { useSession } from "@/lib/auth-client";
import { CURRENCIES, type Currency } from "@/lib/currency";

interface EditSeatDialogProps {
  seat?: {
    id: string;
    customPrice: number;
    joinedAt: string;
    activeUntil: string;
    status: "active" | "paused";
    serviceUser?: string | null;
    servicePassword?: string | null;
    subscriptionId: string;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
export function EditSeatDialog({ seat, open, onOpenChange }: EditSeatDialogProps) {
  const t = useTranslations("subscriptions");
  const tc = useTranslations("common");
  const updateSeat = useUpdateSeat();
  const { data: session } = useSession();
  const { data: allSubscriptions } = useSubscriptions();
  const [customPrice, setCustomPrice] = useState(
    seat ? centsToAmount(seat.customPrice).toString() : ""
  );
  const [startDate, setStartDate] = useState(seat?.joinedAt.split("T")[0] ?? "");
  const [activeUntil, setActiveUntil] = useState(seat?.activeUntil.split("T")[0] ?? "");
  const [serviceUser, setServiceUser] = useState(seat?.serviceUser || "");
  const [servicePassword, setServicePassword] = useState(seat?.servicePassword || "");
  const [subscriptionId, setSubscriptionId] = useState(seat?.subscriptionId || "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!seat || !customPrice) return;

    await updateSeat.mutateAsync({
      id: seat.id,
      customPrice: parseFloat(customPrice),
      startDate: startDate || undefined,
      activeUntil: activeUntil || undefined,
      serviceUser: serviceUser || null,
      servicePassword: servicePassword || null,
      subscriptionId: subscriptionId || undefined,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-md max-h-[92vh] sm:max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("editSeat")}</DialogTitle>
          <DialogDescription>
            {t("editSeatDescription")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-3 bg-muted/30 p-3 rounded-lg border border-border/50 mb-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold flex items-center gap-2">
                <RefreshCw className="size-3.5 text-primary" />
                {t("transferSubscription")}
              </Label>
              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                {t("totalAvailable")}: {allSubscriptions?.length || 0}
              </span>
            </div>
            
            <Select value={subscriptionId} onValueChange={setSubscriptionId}>
              <SelectTrigger className="w-full bg-background border-border/50 shadow-sm h-10">
                <SelectValue placeholder={t("selectSubscription")} />
              </SelectTrigger>
              <SelectContent>
                {allSubscriptions?.map((sub) => (
                  <SelectItem key={sub.id} value={sub.id}>
                    <div className="flex flex-col">
                      <span className="font-medium">{sub.label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {sub.plan.platform.name} · {sub.clientSubscriptions.length} / {sub.plan.maxSeats || "∞"} seats
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-seat-price" className="text-xs">
              {t("customPrice")} ({CURRENCIES[(session?.user as { currency?: string })?.currency as Currency || "EUR"].symbol}/{tc("month")})
            </Label>
            <Input
              id="edit-seat-price"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={customPrice}
              onChange={(e) => setCustomPrice(e.target.value)}
              className="h-9"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-seat-start" className="text-xs">{t("startDate")}</Label>
            <Input
              id="edit-seat-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9"
              required
            />
          </div>

          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="edit-seat-expiry" className="text-xs">{t("activeUntilLabel")}</Label>
            <Input
              id="edit-seat-expiry"
              type="date"
              value={activeUntil}
              onChange={(e) => setActiveUntil(e.target.value)}
              className="h-9"
              required
            />
          </div>

          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="edit-seat-user" className="text-xs">{t("serviceUser")}</Label>
            <Input
              id="edit-seat-user"
              value={serviceUser}
              onChange={(e) => setServiceUser(e.target.value)}
              placeholder="Email or username"
              className="h-9"
            />
          </div>

          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="edit-seat-pass" className="text-xs">{t("servicePassword")}</Label>
            <Input
              id="edit-seat-pass"
              value={servicePassword}
              onChange={(e) => setServicePassword(e.target.value)}
              placeholder="Service password"
              className="h-9"
            />
          </div>

          <DialogFooter className="col-span-2 pt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="h-9">
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={updateSeat.isPending || !customPrice} className="h-9 px-8">
              {updateSeat.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              {tc("saveChanges")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
