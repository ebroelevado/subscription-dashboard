"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useClient } from "@/hooks/use-clients";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft, UserCircle, Plus, Trash2 } from "lucide-react";
import { AssignSubscriptionDialog } from "@/components/clients/assign-subscription-dialog";
import { useCancelSeat } from "@/hooks/use-seats";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { formatCurrency } from "@/lib/currency";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";


const statusVariant: Record<string, "default" | "secondary" | "destructive"> = {
  active: "default",
  paused: "secondary",
};

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: client, isLoading } = useClient(id);
  const [assignOpen, setAssignOpen] = useState(false);
  const [cancelSeatId, setCancelSeatId] = useState<string | null>(null);
  const cancelMutation = useCancelSeat();
  const { data: session } = useSession();
  const currency = (session?.user as { currency?: string })?.currency || "EUR";

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <h2 className="text-xl font-semibold">Client not found</h2>
        <Button variant="link" asChild>
          <Link href="/dashboard/clients">← Back to clients</Link>
        </Button>
      </div>
    );
  }

  const activeSeats = client.clientSubscriptions.filter((s) => s.status === "active");
  const totalMonthly = activeSeats.reduce((sum, s) => sum + Number(s.customPrice), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="size-8" asChild>
          <Link href="/dashboard/clients">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div className="flex items-center gap-3 flex-1">
          <div className="flex items-center justify-center size-10 rounded-full bg-muted">
            <UserCircle className="size-6 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{client.name}</h1>
            <p className="text-muted-foreground text-sm">
              {client.phone ?? "No phone"} · {client.notes ?? "No notes"}
            </p>
          </div>
        </div>
        <Button onClick={() => setAssignOpen(true)}>
          <Plus className="mr-2 size-4" />
          Assign Subscription
        </Button>
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Active Seats</p>
          <p className="text-2xl font-bold">{activeSeats.length}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Total Monthly Cost</p>
          <p className="text-2xl font-bold">{formatCurrency(totalMonthly, currency)}</p>
        </div>
      </div>

      {/* Seats Table */}
      {client.clientSubscriptions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
          <h3 className="text-lg font-semibold">No services</h3>
          <p className="text-muted-foreground text-sm mt-1">
            This client hasn&apos;t been assigned to any subscriptions yet.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Platform</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Subscription</TableHead>
                <TableHead className="text-right">Custom Price</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {client.clientSubscriptions.map((cs) => (
                <TableRow key={cs.id}>
                  <TableCell className="font-medium">
                    {cs.subscription.plan.platform.name}
                  </TableCell>
                  <TableCell>{cs.subscription.plan.name}</TableCell>
                  <TableCell>
                    <Link
                      href={`/dashboard/subscriptions/${cs.subscription.id}`}
                      className="text-primary hover:underline"
                    >
                      {cs.subscription.label}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(Number(cs.customPrice), currency)}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={statusVariant[cs.status] ?? "secondary"}>
                      {cs.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(cs.joinedAt).toLocaleDateString("es-ES")}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      onClick={() => setCancelSeatId(cs.id)}
                    >
                      <Trash2 className="size-3.5" />
                      <span className="sr-only">Remove</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Dialogs */}
      {client && (
        <AssignSubscriptionDialog
          clientId={client.id}
          clientName={client.name}
          previousServiceUser={client.serviceUser}
          previousServicePassword={client.servicePassword}
          open={assignOpen}
          onOpenChange={setAssignOpen}
        />
      )}

      <AlertDialog open={!!cancelSeatId} onOpenChange={(o) => { if (!o) setCancelSeatId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the client from this subscription.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (cancelSeatId) {
                  cancelMutation.mutate(cancelSeatId, {
                    onSuccess: () => setCancelSeatId(null),
                  });
                }
              }}
            >
              {cancelMutation.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
