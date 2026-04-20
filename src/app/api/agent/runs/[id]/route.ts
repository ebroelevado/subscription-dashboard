import { and, asc, eq } from "drizzle-orm";
import { getAuthSession } from "@/lib/auth-utils";
import { db } from "@/db";
import { agentMessages, agentRuns, agentToolCalls } from "@/db/schema";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return Response.json({ error: "Missing run id" }, { status: 400 });
  }

  const run = await db.query.agentRuns.findFirst({
    where: and(eq(agentRuns.id, id), eq(agentRuns.userId, session.user.id)),
  });

  if (!run) {
    return Response.json({ error: "Run not found" }, { status: 404 });
  }

  const [messages, toolCalls] = await Promise.all([
    db.query.agentMessages.findMany({
      where: eq(agentMessages.runId, id),
      orderBy: [asc(agentMessages.sequence)],
    }),
    db.query.agentToolCalls.findMany({
      where: eq(agentToolCalls.runId, id),
      orderBy: [asc(agentToolCalls.stepNumber)],
    }),
  ]);

  return Response.json({
    run,
    messages,
    toolCalls,
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return Response.json({ error: "Missing run id" }, { status: 400 });
  }

  const run = await db.query.agentRuns.findFirst({
    where: and(eq(agentRuns.id, id), eq(agentRuns.userId, session.user.id)),
    columns: { id: true },
  });

  if (!run) {
    return Response.json({ error: "Run not found" }, { status: 404 });
  }

  await db.delete(agentRuns).where(and(eq(agentRuns.id, id), eq(agentRuns.userId, session.user.id)));
  return Response.json({ success: true });
}
