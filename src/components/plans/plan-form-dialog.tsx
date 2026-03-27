"use client";

import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreatePlan, useUpdatePlan, type Plan } from "@/hooks/use-plans";
import { usePlatforms } from "@/hooks/use-platforms";
import { useSession } from "@/lib/auth-client";
import { CURRENCIES, type Currency } from "@/lib/currency";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";
import { useTranslations } from "next-intl";

const schema = z.object({
  platformId: z.string().min(1, "validation.platformRequired"),
  name: z.string().min(1, "validation.nameRequired").max(100),
  cost: z.coerce.number().min(0, "validation.costMin"),
  maxSeats: z.union([
    z.coerce.number().int().positive(),
    z.literal("").transform(() => undefined),
  ]).optional(),
  isActive: z.boolean().default(true),
});

type FormValues = {
  platformId: string;
  name: string;
  cost: number;
  maxSeats?: number;
  isActive: boolean;
};

interface PlanFormDialogProps {
  mode: "create" | "edit";
  plan?: Plan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PlanFormDialog({
  mode,
  plan,
  open,
  onOpenChange,
}: PlanFormDialogProps) {
  const { data: platforms } = usePlatforms();
  const createMutation = useCreatePlan();
  const updateMutation = useUpdatePlan();
  const isPending = createMutation.isPending || updateMutation.isPending;
  const t = useTranslations("plans");
  const tc = useTranslations("common");
  const tv = useTranslations("validation");
  const { data: session } = useSession();
  const currency = (session?.user as { currency?: string })?.currency as Currency || "EUR";
  const currencySymbol = CURRENCIES[currency].symbol;

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: {
      platformId: "",
      name: "",
      cost: 0,
      maxSeats: undefined,
      isActive: true,
    },
  });

  useEffect(() => {
    if (open) {
      if (mode === "edit" && plan) {
        reset({
          platformId: plan.platformId,
          name: plan.name,
          cost: Number(plan.cost),
          maxSeats: plan.maxSeats ?? undefined,
          isActive: plan.isActive,
        });
      } else {
        reset({
          platformId: "",
          name: "",
          cost: 0,
          maxSeats: undefined,
          isActive: true,
        });
      }
    }
  }, [open, mode, plan, reset]);

  const onSubmit = async (values: FormValues) => {
    const payload = {
      ...values,
      maxSeats: values.maxSeats ?? null,
    };

    if (mode === "edit" && plan) {
      await updateMutation.mutateAsync({ id: plan.id, ...payload });
    } else {
      await createMutation.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  const getErrorMessage = (msg?: string) => {
    if (!msg) return undefined;
    const parts = msg.split(".");
    if (parts.length === 2 && parts[0] === "validation") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return tv(parts[1] as any);
      } catch {
        return msg;
      }
    }
    return msg;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? t("addTitle") : t("editTitle")}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? t("addDescription")
              : t("editDescription")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Platform */}
          <div className="space-y-2">
            <Label>{tc("platform")}</Label>
            <Controller
              control={control}
              name="platformId"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("selectPlatform")} />
                  </SelectTrigger>
                  <SelectContent>
                    {platforms?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.platformId && (
              <p className="text-sm text-destructive">
                {getErrorMessage(errors.platformId.message)}
              </p>
            )}
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="plan-name">{tc("name")}</Label>
            <Input
              id="plan-name"
              placeholder={t("namePlaceholder")}
              {...register("name")}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{getErrorMessage(errors.name.message)}</p>
            )}
          </div>

          {/* Cost + Max Seats row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="plan-cost">{t("myCost")} ({currencySymbol})</Label>
              <Input
                id="plan-cost"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                {...register("cost")}
              />
              {errors.cost && (
                <p className="text-sm text-destructive">
                  {getErrorMessage(errors.cost.message)}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="plan-seats">{t("maxSeats")}</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="size-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("maxSeatsTooltip")}
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="plan-seats"
                type="number"
                min="1"
                placeholder="∞"
                {...register("maxSeats")}
              />
            </div>
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label className="text-sm font-medium">{t("activeToggle")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("inactivePlansHint")}
              </p>
            </div>
            <Controller
              control={control}
              name="isActive"
              render={({ field }) => (
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? tc("saving")
                : mode === "create"
                  ? tc("create")
                  : tc("saveChanges")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
