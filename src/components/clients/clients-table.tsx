"use client";

import { useState } from "react";
import type { Client } from "@/hooks/use-clients";
import { useClientsDiscipline } from "@/hooks/use-analytics";
import { ClientFormDialog } from "./client-form-dialog";
import { DeleteClientDialog } from "./delete-client-dialog";
import { ClientDetailSheet } from "./client-detail-sheet";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Pencil, Trash2, Users, Eye } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { differenceInDays, startOfDay } from "date-fns";
import { useTranslations } from "next-intl";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { cn, getScoreColor, getScoreLabel } from "@/lib/utils";

type ClientStatus = "paid" | "due" | "overdue" | "expired" | "critical" | "none";

function getClientStatus(client: Client): ClientStatus {
  const activeSeats = client.clientSubscriptions.filter((cs) => cs.status === "active");
  if (activeSeats.length === 0) return "none";

  const today = startOfDay(new Date());
  let maxDaysOverdue = 0;
  let minDaysLeft = Infinity;

  for (const seat of activeSeats) {
    const diff = differenceInDays(startOfDay(new Date(seat.activeUntil)), today);
    if (diff < 0) {
      const overdue = Math.abs(diff);
      if (overdue > maxDaysOverdue) maxDaysOverdue = overdue;
    } else {
      if (diff < minDaysLeft) minDaysLeft = diff;
    }
  }

  if (maxDaysOverdue > 30) return "critical";
  if (maxDaysOverdue > 14) return "expired";
  if (maxDaysOverdue > 0) return "overdue";
  if (minDaysLeft <= 3) return "due";
  return "paid";
}

const statusConfig = (t: (key: string, values?: Record<string, string | number>) => string) => ({
  paid: { label: t("status.paid"), variant: "default" as const },
  due: { label: t("status.due"), variant: "secondary" as const },
  overdue: { label: t("status.overdue"), variant: "destructive" as const },
  expired: { label: t("status.expired"), variant: "destructive" as const },
  critical: { label: t("status.critical"), variant: "destructive" as const },
  none: { label: t("status.none"), variant: "outline" as const },
});

function getServicesSummary(client: Client): string {
  const active = client.clientSubscriptions.filter((cs) => cs.status === "active" || cs.status === "paused");
  if (active.length === 0) return "—";
  const names = [...new Set(active.map((cs) => cs.subscription.plan.platform.name))];
  return names.join(", ");
}



interface ClientsTableProps {
  clients: Client[];
  isLoading: boolean;
}

export function ClientsTable({ clients, isLoading }: ClientsTableProps) {
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [deleteClient, setDeleteClient] = useState<Client | null>(null);
  const [sheetClientId, setSheetClientId] = useState<string | null>(null);
  const t = useTranslations("clients");
  const tc = useTranslations("common");
  const config = statusConfig(t);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const { data: discipline, isLoading: isDisciplineLoading } = useClientsDiscipline();

  useEffect(() => {
    const cid = searchParams.get("clientId");
    if (cid && !isLoading && clients) {
      const clientExists = clients.some(c => c.id === cid);
      if (clientExists) {
        setTimeout(() => setSheetClientId(cid), 0);
        // Remove clientId from URL silently
        const newParams = new URLSearchParams(searchParams.toString());
        newParams.delete("clientId");
        router.replace(`${pathname}${newParams.size > 0 ? '?' + newParams.toString() : ''}`);
      }
    }
  }, [searchParams, clients, isLoading, pathname, router]);

  if (isLoading) {
    return (
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-center">{tc("name")}</TableHead>
              <TableHead className="text-center">{t("phone")}</TableHead>
              <TableHead className="text-center">{tc("platform")}</TableHead>
              <TableHead className="text-center">{t("disciplineScore")}</TableHead>
              <TableHead className="text-center">{t("activeSeats")}</TableHead>
              <TableHead className="text-center">{tc("status")}</TableHead>
              <TableHead className="text-right">{tc("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell className="text-center"><Skeleton className="h-4 w-24 mx-auto" /></TableCell>
                <TableCell className="text-center"><Skeleton className="h-4 w-24 mx-auto" /></TableCell>
                <TableCell className="text-center"><Skeleton className="h-4 w-24 mx-auto" /></TableCell>
                <TableCell className="text-center"><Skeleton className="h-5 w-12 mx-auto rounded-full" /></TableCell>
                <TableCell className="text-center"><Skeleton className="h-5 w-8 mx-auto rounded-full" /></TableCell>
                <TableCell className="text-center"><Skeleton className="h-5 w-14 mx-auto rounded-full" /></TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
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

  if (clients.length === 0) {
    return (
      <div className="rounded-lg border border-dashed">
        <EmptyState
          icon={Users}
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
              <TableHead className="text-center">{tc("name")}</TableHead>
              <TableHead className="text-center">{t("phone")}</TableHead>
              <TableHead className="text-center">{tc("platform")}</TableHead>
              <TableHead className="text-center">{t("disciplineScore")}</TableHead>
              <TableHead className="text-center">{t("activeSeats")}</TableHead>
              <TableHead className="text-center">{tc("status")}</TableHead>
              <TableHead className="text-right">{tc("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((c) => {
              const activeSeats = c.clientSubscriptions.filter(
                (cs) => cs.status === "active"
              ).length;
              const status = getClientStatus(c);
              const sc = config[status];
              const services = getServicesSummary(c);
              // Using hook-based analytics data (like the detail sheet)
              const clientDiscipline = discipline?.perClient[c.id];
              const score = clientDiscipline?.score ?? null;
              const daysOverdue = clientDiscipline?.daysOverdue ?? 0;
              const healthStatus = clientDiscipline?.healthStatus || "New";

              return (
                <TableRow
                  key={c.id}
                  className="cursor-pointer"
                  onClick={() => setSheetClientId(c.id)}
                >
                  <TableCell className="text-center font-medium">{c.name}</TableCell>
                  <TableCell className="text-center text-muted-foreground">
                    {c.phone ?? "—"}
                  </TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">
                    <div className="max-w-[180px] mx-auto whitespace-normal break-words leading-tight">
                      {services}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {score !== null ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={cn("font-mono font-bold text-sm", getScoreColor(Number(score)))}>
                              {Number(score).toFixed(1)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            <p>{getScoreLabel(Number(score), t)}</p>
                             <div className="text-muted-foreground mt-1 space-y-0.5">
                               <p>{t("healthLabel")}: <span className="font-semibold text-foreground">{t(`healthStatus${healthStatus}`)}</span></p>
                               {daysOverdue > 0 && (
                                   <p className="text-destructive font-semibold">
                                     {t("overdueLabel")}: {daysOverdue}d
                                   </p>
                               )}
                             </div>
                           </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={activeSeats > 0 ? "default" : "secondary"}>
                      {activeSeats}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={sc.variant}>
                      {sc.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={(e) => { e.stopPropagation(); setSheetClientId(c.id); }}
                        >
                          <Eye className="size-3.5" />
                          <span className="sr-only">{tc("view")}</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={(e) => { e.stopPropagation(); setEditClient(c); }}
                        >
                          <Pencil className="size-3.5" />
                          <span className="sr-only">{tc("edit")}</span>
                        </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); setDeleteClient(c); }}
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

      <ClientFormDialog
        mode="edit"
        client={editClient ?? undefined}
        open={!!editClient}
        onOpenChange={(open: boolean) => {
          if (!open) setEditClient(null);
        }}
      />

      <DeleteClientDialog
        client={deleteClient}
        open={!!deleteClient}
        onOpenChange={(open: boolean) => {
          if (!open) setDeleteClient(null);
        }}
      />

      <ClientDetailSheet
        clientId={sheetClientId}
        open={!!sheetClientId}
        onOpenChange={(open) => {
          if (!open) setSheetClientId(null);
        }}
      />
    </>
  );
}
