/**
 * POST /api/mutations/execute
 *
 * Direct execution endpoint — bypasses the AI entirely.
 * The frontend calls this when the user clicks "Accept" on a proposed mutation.
 *
 * Body: { token: string }
 * The token is validated, the stored payload is extracted, and the mutation
 * is applied inside a Drizzle transaction.
 */

import { getAuthSession } from "@/lib/auth-utils";
import { getDb } from "@/db";
import {
  rollbackConsumedMutationToken,
  validateAndConsumeMutationToken,
} from "@/lib/mutation-token";
import { executeMutation as sharedExecuteMutation } from "@/lib/mutation-executor";
import { checkRateLimit } from "@/lib/rate-limit";

const EXTERNAL_EXECUTE_TIMEOUT_MS = 15_000;
const EXTERNAL_ENQUEUE_TIMEOUT_MS = 5000;

class MutationProxyTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MutationProxyTimeoutError";
  }
}

const TOKEN_VALIDATION_ERRORS = new Set([
  "Invalid or not found token.",
  "Token has expired. Propose the change again.",
  "This change has already been executed.",
  "Token does not belong to this user.",
]);

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new MutationProxyTimeoutError(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function executeLocally(token: string, userId: string) {
  console.log("[Mutation Execution] Processing locally");
  const auditLog = await validateAndConsumeMutationToken(token, userId);

  let result: unknown;
  try {
    result = await sharedExecuteMutation(
      getDb(),
      userId,
      auditLog.toolName,
      auditLog.targetId,
      auditLog.action as "create" | "update" | "delete",
      auditLog.previousValues as Record<string, unknown>,
      auditLog.id
    );
  } catch (error) {
    // If execution fails after token consumption, allow user retry.
    await rollbackConsumedMutationToken(auditLog.id, userId);
    throw error;
  }

  return Response.json({
    success: true,
    auditLogId: auditLog.id,
    result,
  });
}

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const rateLimit = checkRateLimit({
      key: `mutation-execute:${userId}`,
      limit: 20,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      const retryAfterSeconds = Math.ceil(rateLimit.retryAfterMs / 1000);
      return Response.json(
        {
          error: "Too Many Requests",
          code: "RATE_LIMITED",
          retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSeconds),
          },
        },
      );
    }

    const body = await req.json();
    const { token } = body;
    if (!token || typeof token !== "string") {
      return Response.json({ error: "Missing token" }, { status: 400 });
    }

    // 1. Check if we should proxy to the Durable Object Agent
    // Tokens created in the DO are only valid in the DO's database context
    const doNamespace =
      (globalThis as any).AGENT_SESSION_DO ??
      (process.env as any).AGENT_SESSION_DO;
    const doUrl = process.env.AGENT_SESSION_URL;
    const proxySecret = process.env.DB_PROXY_SECRET;

    if (doNamespace && typeof doNamespace.idFromName === 'function') {
      console.log("[Mutation Proxy] Forwarding to Durable Object (Native Binding)");
      const doSessionId = `chat-session-${userId}`;
      const id = doNamespace.idFromName(doSessionId);
      const stub = doNamespace.get(id);
      
      const doReq = new Request(`${req.url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute", token, userId }),
      });

      return await withTimeout(
        stub.fetch(doReq),
        EXTERNAL_EXECUTE_TIMEOUT_MS,
        "Durable Object execute request timed out."
      );
    } else if (doUrl) {
      console.log(`[Mutation Proxy] Forwarding to External Worker DO Proxy: ${doUrl}`);
      if (!proxySecret) {
        throw new Error("External mutation worker unavailable: DB proxy secret is missing.");
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_EXECUTE_TIMEOUT_MS);

      try {
        const response = await fetch(`${doUrl}/execute`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Secret": proxySecret,
          },
          body: JSON.stringify({ token, userId, secret: proxySecret }),
          signal: controller.signal,
        });

        // Never fall back to local execution after a remote execute response.
        // This prevents accidental double writes after ambiguous upstream state.
        return response;
      } catch (error) {
        // If external /execute cannot be reached at all, enqueue as backup.
        if (proxySecret) {
          const enqueueController = new AbortController();
          const enqueueTimeoutId = setTimeout(() => enqueueController.abort(), EXTERNAL_ENQUEUE_TIMEOUT_MS);
          try {
            const enqueueRes = await fetch(`${doUrl}/enqueue`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Agent-Secret": proxySecret,
              },
              body: JSON.stringify({ token, userId, secret: proxySecret }),
              signal: enqueueController.signal,
            });

            const enqueueBody = await enqueueRes.json().catch(() => ({}));
            if (enqueueRes.ok && enqueueBody?.success) {
              return Response.json({
                success: true,
                queued: true,
                token,
                message: "Mutation queued for execution",
              });
            }

            const enqueueError = `Queue fallback failed (${enqueueRes.status}).`;
            throw new Error(`External mutation worker unavailable: ${enqueueError}`);
          } finally {
            clearTimeout(enqueueTimeoutId);
          }
        }

        if ((error as any)?.name === "AbortError") {
          throw new MutationProxyTimeoutError("External mutation execute request timed out.");
        }

        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`External mutation worker unavailable: ${message}`);
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // 2. Fallback: Execute locally (for non-agent sessions or local dev without DO)
    return await executeLocally(token, userId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error executing mutation";
    console.error("[Mutations/Execute]", message);
    if (err instanceof MutationProxyTimeoutError) {
      return Response.json({ error: message, retryable: true }, { status: 504 });
    }

    if (TOKEN_VALIDATION_ERRORS.has(message)) {
      return Response.json({ error: message, retryable: false }, { status: 400 });
    }

    if (message.startsWith("External mutation worker unavailable:")) {
      return Response.json({ error: message, retryable: true }, { status: 502 });
    }

    return Response.json({ error: message }, { status: 400 });
  }
}
