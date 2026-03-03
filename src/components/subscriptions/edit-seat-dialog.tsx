"use client";

import { useState } from "react";
import { useUpdateSeat } from "@/hooks/use-seats";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { CURRENCIES, type Currency } from "@/lib/currency";

interface EditSeatDialogProps {
  seat?: {
    id: string;
    customPrice: number;
    joinedAt: string;
    activeUntil: string;
    status: "active" | "paused";
    client: {
      serviceUser?: string | null;
      servicePassword?: string | null;
    };
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
export function EditSeatDialog({ seat, open, onOpenChange }: EditSeatDialogProps) {
  const t = useTranslations("subscriptions");
  const tc = useTranslations("common");
  const updateSeat = useUpdateSeat();
  const { data: session } = useSession();
  const [customPrice, setCustomPrice] = useState(seat?.customPrice.toString() ?? "");
  const [startDate, setStartDate] = useState(seat?.joinedAt.split("T")[0] ?? "");
  const [activeUntil, setActiveUntil] = useState(seat?.activeUntil.split("T")[0] ?? "");
  const [serviceUser, setServiceUser] = useState(seat?.client.serviceUser || "");
  const [servicePassword, setServicePassword] = useState(seat?.client.servicePassword || "");

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
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("editSeat")}</DialogTitle>
          <DialogDescription>
            {t("editSeatDescription")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-seat-price">
              Price ({CURRENCIES[(session?.user as { currency?: string })?.currency as Currency || "EUR"].symbol}/month)
            </Label>
            <Input
              id="edit-seat-price"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={customPrice}
              onChange={(e) => setCustomPrice(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-seat-start">{t("startDate")}</Label>
            <Input
              id="edit-seat-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-seat-expiry">Expires On</Label>
            <Input
              id="edit-seat-expiry"
              type="date"
              value={activeUntil}
              onChange={(e) => setActiveUntil(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2 col-span-2">
            <Label htmlFor="edit-seat-user">{t("serviceUser")}</Label>
            <Input
              id="edit-seat-user"
              value={serviceUser}
              onChange={(e) => setServiceUser(e.target.value)}
              placeholder="Email or username"
            />
          </div>

          <div className="space-y-2 col-span-2">
            <Label htmlFor="edit-seat-pass">{t("servicePassword")}</Label>
            <Input
              id="edit-seat-pass"
              value={servicePassword}
              onChange={(e) => setServicePassword(e.target.value)}
              placeholder="Service password"
            />
          </div>

          <DialogFooter className="col-span-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={updateSeat.isPending || !customPrice}>
              {updateSeat.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              {tc("saveChanges")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
