import { z } from "zod";
import { and, desc, eq, gte, lte, count, asc } from "drizzle-orm";
import { getAuthSession } from "@/lib/auth-utils";
import { db } from "@/db";
import { agentMessages, agentRuns, agentToolCalls } from "@/db/schema";

const listRunsQuerySchema = z.object({
  status: z.enum(["running", "completed", "failed", "aborted"]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!content || typeof content !== "object") {
    return "";
  }

  const asRecord = content as Record<string, unknown>;

  if (typeof asRecord.content === "string") {
    return asRecord.content;
  }

  const parts = Array.isArray(asRecord.parts) ? asRecord.parts : [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const typedPart = part as Record<string, unknown>;
    if (typedPart.type === "text" && typeof typedPart.text === "string") {
      return typedPart.text;
    }
  }

  return "";
}

function toConversationTitle(content: unknown): string {
  const raw = extractMessageText(content)
    .replace(/\s+/g, " ")
    .trim();

  if (!raw) return "Agent run";
  if (raw.length <= 70) return raw;
  return `${raw.slice(0, 70)}...`;
}

export async function GET(req: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = listRunsQuerySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid query params", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { status, from, to, limit } = parsed.data;
  const where = [eq(agentRuns.userId, session.user.id)];
  if (status) where.push(eq(agentRuns.status, status));
  if (from) where.push(gte(agentRuns.startedAt, from));
  if (to) where.push(lte(agentRuns.startedAt, to));

  const runs = await db.query.agentRuns.findMany({
    where: and(...where),
    orderBy: [desc(agentRuns.startedAt)],
    limit,
  });

  const data = await Promise.all(
    runs.map(async (run) => {
      const [messageCountRow, toolCallCountRow, firstUserMessage] = await Promise.all([
        db
          .select({ total: count() })
          .from(agentMessages)
          .where(eq(agentMessages.runId, run.id)),
        db
          .select({ total: count() })
          .from(agentToolCalls)
          .where(eq(agentToolCalls.runId, run.id)),
        db.query.agentMessages.findFirst({
          where: and(
            eq(agentMessages.runId, run.id),
            eq(agentMessages.role, "user"),
          ),
          orderBy: [asc(agentMessages.sequence)],
          columns: { content: true },
        }),
      ]);

      return {
        id: run.id,
        title: toConversationTitle(firstUserMessage?.content),
        status: run.status,
        model: run.model,
        source: run.source,
        allowDestructive: run.allowDestructive,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        updatedAt: run.updatedAt,
        errorMessage: run.errorMessage,
        messageCount: messageCountRow[0]?.total ?? 0,
        toolCallCount: toolCallCountRow[0]?.total ?? 0,
      };
    }),
  );

  return Response.json(data);
}
