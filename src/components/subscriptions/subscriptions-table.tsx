"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import type { Subscription } from "@/hooks/use-subscriptions";
import { SubscriptionFormDialog } from "./subscription-form-dialog";
import { DeleteSubscriptionDialog } from "./delete-subscription-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Pencil, Trash2, Eye, CreditCard, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import { differenceInDays, startOfDay } from "date-fns";
import { useSession } from "@/lib/auth-client";
import { formatCurrency } from "@/lib/currency";

interface SubscriptionsTableProps {
  subscriptions: Subscription[];
  isLoading: boolean;
}

function formatDate(date: string, locale: string) {
  return new Date(date).toLocaleDateString(locale);
}

type ExpiryStatus = "ok" | "expiring" | "expired";

function getExpiryInfo(activeUntil: string) {
  const today = startOfDay(new Date());
  const expiry = startOfDay(new Date(activeUntil));
  const diff = differenceInDays(expiry, today);

  let status: ExpiryStatus = "ok";
  if (diff < 0) status = "expired";
  else if (diff <= 3) status = "expiring";

  return { diff, status };
}

export function SubscriptionsTable({ subscriptions, isLoading }: SubscriptionsTableProps) {
  const [editSub, setEditSub] = useState<Subscription | null>(null);
  const [deleteSub, setDeleteSub] = useState<Subscription | null>(null);
  const { data: session } = useSession();
  const currency = session?.user?.currency || "EUR";
  const locale = useLocale();
  const t = useTranslations("subscriptions");
  const tc = useTranslations("common");
  const router = useRouter();

  if (isLoading) {
    return (
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-center">{t("label")}</TableHead>
              <TableHead className="text-center">{tc("platform")} → {tc("plan")}</TableHead>
              <TableHead className="text-center">{t("seats")}</TableHead>
              <TableHead className="text-center">{tc("status")}</TableHead>
              <TableHead className="text-center">{t("nextRenewal")}</TableHead>
              <TableHead className="text-center">{t("cost")}</TableHead>
              <TableHead className="text-right">{tc("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell className="text-center"><Skeleton className="h-4 w-28 mx-auto" /></TableCell>
                <TableCell className="text-center"><Skeleton className="h-4 w-36 mx-auto" /></TableCell>
                <TableCell className="text-center"><Skeleton className="h-5 w-12 mx-auto rounded-full" /></TableCell>
                <TableCell className="text-center"><Skeleton className="h-5 w-14 mx-auto rounded-full" /></TableCell>
                <TableCell className="text-center"><Skeleton className="h-4 w-20 mx-auto" /></TableCell>
                <TableCell className="text-center"><Skeleton className="h-4 w-16 mx-auto" /></TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Skeleton className="size-8 rounded-md" />
                    <Skeleton className="size-8 rounded-md" />
                    <Skeleton className="size-8 rounded-md" />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (subscriptions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed">
        <EmptyState
          icon={CreditCard}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      </div>
    );
  }

  return (
    <>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-center whitespace-nowrap">{t("label")}</TableHead>
              <TableHead className="text-center whitespace-nowrap">{tc("platform")} → {tc("plan")}</TableHead>
              <TableHead className="text-center whitespace-nowrap">{t("seats")}</TableHead>
              <TableHead className="text-center whitespace-nowrap">{tc("status")}</TableHead>
              <TableHead className="text-center whitespace-nowrap">{t("nextRenewal")}</TableHead>
              <TableHead className="text-center whitespace-nowrap">{t("cost")}</TableHead>
              <TableHead className="text-right whitespace-nowrap">{tc("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscriptions.map((sub) => {
              const occupied = sub.clientSubscriptions?.length || 0;
              const max = sub.plan?.maxSeats;
              const isFull = max != null && occupied >= max;

              return (
                <TableRow 
                  key={sub.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/dashboard/subscriptions/${sub.id}`)}
                >
                  <TableCell className="text-center font-medium">{sub.label}</TableCell>
                  <TableCell className="text-center text-muted-foreground">
                    {sub.plan?.platform?.name ?? tc("deleted")} → {sub.plan?.name ?? tc("deleted")}
                  </TableCell>
                  <TableCell className="text-center">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>
                          <Badge variant={isFull ? "destructive" : "secondary"} className="whitespace-nowrap">
                            {occupied} / {max ?? "∞"}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          {max != null
                            ? t("availableSeats", { available: max - occupied, total: max })
                            : t("unlimitedSeats")}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex flex-col items-center gap-1.5">
                      {(() => {
                        const { diff, status } = getExpiryInfo(sub.activeUntil);
                        
                        // Stress coloring only for manual payments
                        let variant: "default" | "secondary" | "destructive" | "outline" | "warning" | "success" = "outline";
                        if (!sub.autoRenewal) {
                          if (status === "expired") variant = "destructive";
                          else if (status === "expiring") variant = "warning";
                          else variant = "success";
                        } else {
                          variant = "success";
                        }

                        const label = diff < 0 ? tc("daysOverdue", { count: Math.abs(diff) }) : tc("daysLeft", { count: diff });
                        
                        return (
                          <>
                            <Badge variant={variant} className="whitespace-nowrap truncate max-w-[140px]">
                              {label}
                            </Badge>
                            {sub.autoRenewal && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400 font-medium uppercase tracking-wider whitespace-nowrap">
                                      <RefreshCw className="size-2.5 text-green-600 dark:text-green-400 animate-spin-slow" />
                                      {t("autoRenewal")}
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {t("autoRenewalTooltip")}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </TableCell>
                  <TableCell className="text-center text-muted-foreground whitespace-nowrap">
                    {formatDate(sub.activeUntil, locale)}
                  </TableCell>
                  <TableCell className="text-center font-medium whitespace-nowrap">
                    {formatCurrency(sub.plan?.cost ?? 0, currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/dashboard/subscriptions/${sub.id}`);
                        }}
                      >
                        <Eye className="size-3.5" />
                        <span className="sr-only">{tc("view")}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditSub(sub);
                        }}
                      >
                        <Pencil className="size-3.5" />
                        <span className="sr-only">{tc("edit")}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteSub(sub);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                        <span className="sr-only">{tc("delete")}</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <SubscriptionFormDialog
        mode="edit"
        subscription={editSub ?? undefined}
        open={!!editSub}
        onOpenChange={(open: boolean) => {
          if (!open) setEditSub(null);
        }}
      />

      <DeleteSubscriptionDialog
        subscription={deleteSub}
        open={!!deleteSub}
        onOpenChange={(open: boolean) => {
          if (!open) setDeleteSub(null);
        }}
      />
    </>
  );
}
