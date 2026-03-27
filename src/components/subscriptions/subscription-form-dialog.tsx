"use client";

import { useState, useEffect, useMemo } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useSession } from "@/lib/auth-client";
import { CURRENCIES, type Currency } from "@/lib/currency";
import {
  useCreateSubscription, useUpdateSubscription, type Subscription,
} from "@/hooks/use-subscriptions";
import { usePlans } from "@/hooks/use-plans";
import { usePlatforms } from "@/hooks/use-platforms";
import { useClients } from "@/hooks/use-clients";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addMonths, format } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const schema = z.object({
  platformId: z.string().min(1, "validation.platformRequired"),
  planId: z.string().min(1, "validation.planRequired"),
  label: z.string().min(1, "validation.labelRequired").max(100),
  startDate: z.string().min(1, "validation.startDateRequired"),
  durationMonths: z.coerce.number().int().positive("validation.atLeast1Month"),
  status: z.enum(["active", "paused"]),
  masterUsername: z.string().optional(),
  masterPassword: z.string().optional(),
  ownerId: z.string().optional(),
  isAutopayable: z.boolean().default(true),
  isPaid: z.boolean().default(false),
  paymentNote: z.string().optional(),
  defaultPaymentNote: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface SubscriptionFormDialogProps {
  mode: "create" | "edit";
  subscription?: Subscription;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SubscriptionFormDialog({ mode, subscription, open, onOpenChange }: SubscriptionFormDialogProps) {
  const createMutation = useCreateSubscription();
  const updateMutation = useUpdateSubscription();
  const { data: platforms } = usePlatforms();
  const { data: clients } = useClients();
  const isPending = createMutation.isPending || updateMutation.isPending;
  const t = useTranslations("subscriptions");
  const tc = useTranslations("common");
  const tv = useTranslations("validation");
  const { data: session } = useSession();

  const today = new Date().toISOString().split("T")[0];

  const {
    register, handleSubmit, reset, control, watch, setValue, formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema) as any, // zodResolver sometimes needs this cast with react-hook-form
      defaultValues: {
      platformId: "", planId: "", label: "", startDate: today,
      durationMonths: 1, status: "active",
      masterUsername: "", masterPassword: "", ownerId: "",
      isAutopayable: true,
      isPaid: false,
      paymentNote: "",
      defaultPaymentNote: "como pago",
    },
  });

  const selectedPlatformId = watch("platformId");
  const selectedStartDate = watch("startDate");
  const selectedDuration = watch("durationMonths");

  // Fetch plans filtered by selected platform
  const { data: plans } = usePlans(selectedPlatformId || undefined);

  // Reset planId when platform changes, but ONLY if it's an interactive change 
  // (not the initial population from edit mode).
  const [prevPlatformId, setPrevPlatformId] = useState(selectedPlatformId);
  useEffect(() => {
    if (selectedPlatformId !== prevPlatformId) {
      // Only wipe if there's actually a previous platform id (meaning it's an interactive change by user)
      // or if it goes from something to empty.
      if (prevPlatformId !== "") {
        setValue("planId", "");
      }
      setPrevPlatformId(selectedPlatformId);
    }
  }, [selectedPlatformId, prevPlatformId, setValue]);

  // Compute preview date
  const previewDate = selectedStartDate && Number(selectedDuration) > 0
    ? format(addMonths(new Date(selectedStartDate), Number(selectedDuration)), "dd/MM/yyyy")
    : null;

  // Capacity warning when changing plan in edit mode
  const selectedPlanId = watch("planId");
  const capacityWarning = useMemo(() => {
    if (mode !== "edit" || !subscription || !selectedPlanId || !plans) return null;
    const newPlan = plans.find(p => p.id === selectedPlanId);
    if (!newPlan || newPlan.maxSeats == null) return null;
    const activeSeats = subscription.clientSubscriptions?.filter(
      (s: { status: string }) => s.status === "active" || s.status === "paused"
    ).length ?? 0;
    if (activeSeats > newPlan.maxSeats) {
      return t("capacityWarning", { max: newPlan.maxSeats, current: activeSeats });
    }
    return null;
  }, [mode, subscription, selectedPlanId, plans, t]);

  useEffect(() => {
    if (open) {
      if (mode === "edit" && subscription) {
        // Find platform from existing data
        const platform = platforms?.find(p =>
          p.plans.some(pl => pl.id === subscription.planId)
        );
        // Small delay to ensure platform matches and avoids getting reset
        setTimeout(() => {
          reset({
            platformId: platform?.id ?? "",
            planId: subscription.planId,
            label: subscription.label,
            startDate: subscription.startDate.split("T")[0],
            durationMonths: 1,
            status: subscription.status,
            masterUsername: subscription.masterUsername || "",
            masterPassword: subscription.masterPassword || "",
            ownerId: subscription.ownerId || "none",
            isAutopayable: subscription.isAutopayable,
            defaultPaymentNote: subscription.defaultPaymentNote || "como pago",
          });
          setPrevPlatformId(platform?.id ?? "");
        }, 0);
      } else {
        reset({
          platformId: "", planId: "", label: "", startDate: today,
          durationMonths: 1, status: "active",
          masterUsername: "", masterPassword: "", ownerId: "",
          isAutopayable: true,
          isPaid: false,
          paymentNote: "",
          defaultPaymentNote: "como pago",
        });
      }
    }
  }, [open, mode, subscription, reset, today, platforms]);

  const onSubmit = async (values: FormValues) => {
    const parsedOwnerId = values.ownerId === "none" || !values.ownerId ? null : values.ownerId;
    const parsedMasterUsername = !values.masterUsername ? null : values.masterUsername;
    const parsedMasterPassword = !values.masterPassword ? null : values.masterPassword;

    if (mode === "edit" && subscription) {
      await updateMutation.mutateAsync({
        id: subscription.id,
        planId: values.planId,
        label: values.label,
        startDate: values.startDate,
        durationMonths: values.durationMonths,
        status: values.status,
        masterUsername: parsedMasterUsername,
        masterPassword: parsedMasterPassword,
        ownerId: parsedOwnerId,
        isAutopayable: values.isAutopayable,
      });
    } else {
      await createMutation.mutateAsync({
        planId: values.planId,
        label: values.label,
        startDate: values.startDate,
        durationMonths: values.durationMonths,
        status: values.status,
        masterUsername: parsedMasterUsername,
        masterPassword: parsedMasterPassword,
        ownerId: parsedOwnerId,
        isAutopayable: values.isAutopayable,
        isPaid: values.isPaid,
        paymentNote: values.paymentNote || null,
        defaultPaymentNote: values.defaultPaymentNote || null,
      });
    }
    onOpenChange(false);
  };

  const getErrorMessage = (msg?: string) => {
    if (!msg) return undefined;
    const parts = msg.split(".");
    if (parts.length === 2 && parts[0] === "validation") {
      try {
        return tv(parts[1] as any);
      } catch {
        return msg;
      }
    }
    return msg;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? t("newTitle") : t("editTitle")}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? t("newDescription")
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
            {errors.platformId && <p className="text-sm text-destructive">{getErrorMessage(errors.platformId.message)}</p>}
          </div>

          {/* Plan (filtered by platform) */}
          <div className="space-y-2">
            <Label>{tc("plan")}</Label>
            <Controller
              control={control}
              name="planId"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={!selectedPlatformId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={selectedPlatformId ? t("selectPlan") : t("selectPlatformFirst")} />
                  </SelectTrigger>
                  <SelectContent>
                    {plans?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="text-xs text-muted-foreground mr-2 group-hover:text-primary-foreground/70 transition-colors">
                          {p.platform.name} — {p.name} ({CURRENCIES[(session?.user as { currency?: string })?.currency as Currency || "EUR"].symbol}{Number(p.cost).toFixed(2)})
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.planId && <p className="text-sm text-destructive">{getErrorMessage(errors.planId.message)}</p>}
            {capacityWarning && (
              <div className="flex items-start gap-2 rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 p-2">
                <AlertTriangle className="size-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
                <p className="text-xs text-yellow-700 dark:text-yellow-300">{capacityWarning}</p>
              </div>
            )}
          </div>

          {/* Label */}
          <div className="space-y-2">
            <Label htmlFor="sub-label">{t("labelField")}</Label>
            <Input
              id="sub-label"
              placeholder={t("labelPlaceholder")}
              {...register("label")}
            />
            {errors.label && <p className="text-sm text-destructive">{getErrorMessage(errors.label.message)}</p>}
          </div>

          {/* Start Date + Duration */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="sub-start">{t("startDate")}</Label>
              <Input id="sub-start" type="date" {...register("startDate")} />
              {errors.startDate && <p className="text-sm text-destructive">{getErrorMessage(errors.startDate.message)}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="sub-duration">{t("durationMonths")}</Label>
              <Input
                id="sub-duration"
                type="number"
                min="1"
                {...register("durationMonths")}
              />
              {errors.durationMonths && <p className="text-sm text-destructive">{getErrorMessage(errors.durationMonths.message)}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div className="space-y-2">
              <Label>{t("masterUsername")}</Label>
              <Input {...register("masterUsername")} placeholder={tc("optional")} />
            </div>
            <div className="space-y-2">
              <Label>{t("masterPassword")}</Label>
              <Input {...register("masterPassword")} placeholder={tc("optional")} />
            </div>
          </div>
          
          <div className="space-y-2">
              <Label>{t("owner")}</Label>
               <Controller
                control={control}
                name="ownerId"
                render={({ field }) => (
                  <Select
                    value={field.value || ""}
                    onValueChange={(val) => field.onChange(val === "none" ? undefined : val)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("noOwner")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{tc("none")}</SelectItem>
                      {clients?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
          </div>

          {/* Autopayable toggle */}
          <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Label className="text-sm font-medium">
                  {t("isAutopayable")}
                </Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <AlertTriangle className="size-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[200px]">
                      {t("autopayableTooltip")}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <p className="text-[12px] text-muted-foreground">
                {t("autopayableDescription")}
              </p>
            </div>
            <Controller
              control={control}
              name="isAutopayable"
              render={({ field }) => (
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="default-payment-note">Default Payment Note</Label>
            <Input
              id="default-payment-note"
              placeholder="e.g. como pago"
              {...register("defaultPaymentNote")}
            />
            {errors.defaultPaymentNote && <p className="text-sm text-destructive">{getErrorMessage(errors.defaultPaymentNote.message)}</p>}
          </div>

          {mode === "create" && (
            <>
              <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm pt-3 mt-4">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">First payment already made?</Label>
                  <p className="text-[12px] text-muted-foreground">
                    If marked, the first renewal log will be created automatically.
                  </p>
                </div>
                <Controller
                  control={control}
                  name="isPaid"
                  render={({ field }) => (
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </div>

              {watch("isPaid") && (
                <div className="space-y-2">
                  <Label htmlFor="payment-note">Payment Note (Optional)</Label>
                  <Input
                    id="payment-note"
                    placeholder={watch("defaultPaymentNote") || "como pago"}
                    {...register("paymentNote")}
                  />
                  {errors.paymentNote && <p className="text-sm text-destructive">{getErrorMessage(errors.paymentNote.message)}</p>}
                </div>
              )}
            </>
          )}

          {/* Date preview */}
          {previewDate && (
            <p className="text-xs text-muted-foreground">
              {mode === "create" && !watch("isPaid")
                 ? t("paymentDueImmediately") || "Next payment due on start date"
                 : t("activeUntil", { date: previewDate })}
            </p>
          )}

          {/* Status (edit only) */}
          {mode === "edit" && (
            <div className="space-y-2">
              <Label>{t("statusLabel")}</Label>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">{tc("active")}</SelectItem>
                      <SelectItem value="paused">{tc("paused")}</SelectItem>

                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={isPending || !!capacityWarning}>
              {isPending ? tc("saving") : mode === "create" ? tc("create") : tc("saveChanges")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
