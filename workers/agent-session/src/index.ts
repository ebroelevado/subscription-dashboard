import { AgentSessionDO } from "./AgentSessionDO";
import type { Env } from "./AgentSessionDO";
import { initDb, getDb } from "@/db";
import { executeMutation } from "@/lib/mutation-executor";
import {
  rollbackConsumedMutationToken,
  validateAndConsumeMutationToken,
} from "@/lib/mutation-token";

export { AgentSessionDO };

type MutationQueueMessage = {
  token: string;
  userId: string;
};

const EXTERNAL_PROXY_PATHS = new Set<string>([
  "/chat",
  "/execute",
  "/enqueue",
  "/query",
  "/batch",
]);

const QUEUE_MAX_RETRIES = 5;
const QUEUE_BASE_RETRY_DELAY_SECONDS = 2;
const QUEUE_MAX_RETRY_DELAY_SECONDS = 60;

function getAllowedOrigin(request: Request, env: Env): string {
  const configuredOrigin = env.APP_ORIGIN?.trim();
  if (!configuredOrigin) {
    return "*";
  }

  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin) {
    return configuredOrigin;
  }

  return requestOrigin === configuredOrigin ? requestOrigin : configuredOrigin;
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  return {
    "Access-Control-Allow-Origin": getAllowedOrigin(request, env),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Agent-Secret",
  };
}

async function hashSecret(value: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return new Uint8Array(digest);
}

async function timingSafeEqualSecret(provided: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([hashSecret(provided), hashSecret(expected)]);
  let diff = left.length ^ right.length;
  const maxLength = Math.max(left.length, right.length);

  for (let i = 0; i < maxLength; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }

  return diff === 0;
}

async function authorizeProxyRequest(
  request: Request,
  env: Env,
  payload: { secret?: unknown },
): Promise<boolean> {
  if (!env.DB_PROXY_SECRET) {
    return false;
  }

  const headerSecret = request.headers.get("x-agent-secret");
  const bodySecret = typeof payload.secret === "string" ? payload.secret : null;
  const providedSecret = headerSecret || bodySecret;
  if (!providedSecret) {
    return false;
  }

  return timingSafeEqualSecret(providedSecret, env.DB_PROXY_SECRET);
}

function isPermanentQueueError(message: string) {
  return (
    message.includes("Invalid or not found token") ||
    message.includes("Token has expired") ||
    message.includes("does not belong to this user") ||
    message.includes("Unknown tool") ||
    message.includes("Missing ") ||
    message.includes("not found or access denied") ||
    message.includes("Access denied")
  );
}

function isIdempotentQueueSuccess(message: string) {
  return message.includes("already been executed");
}

function computeRetryDelaySeconds(attempt: number) {
  const safeAttempt = Math.max(1, attempt);
  const exponential = QUEUE_BASE_RETRY_DELAY_SECONDS * (2 ** (safeAttempt - 1));
  return Math.min(QUEUE_MAX_RETRY_DELAY_SECONDS, exponential);
}

async function processQueuedMutation(message: MutationQueueMessage, env: Env) {
  if (!env.DB) {
    throw new Error("Missing DB binding in queue consumer");
  }

  initDb(env.DB);

  const { token, userId } = message;
  const auditLog = await validateAndConsumeMutationToken(token, userId);

  try {
    await executeMutation(
      getDb(),
      userId,
      auditLog.toolName,
      auditLog.targetId,
      auditLog.action as "create" | "update" | "delete",
      auditLog.previousValues as Record<string, unknown>,
      auditLog.id
    );
  } catch (error) {
    await rollbackConsumedMutationToken(auditLog.id, userId);
    throw error;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    
    // Preflight handling for browser tooling.
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request, env) });
    }

    // Confirmation path (Total Control) or DB Proxy
    if (request.method === "POST" && EXTERNAL_PROXY_PATHS.has(url.pathname)) {
      try {
        const reqClone = request.clone();
        const json = await reqClone.json() as any;

        const isAuthorized = await authorizeProxyRequest(request, env, json);
        if (!isAuthorized) {
          return new Response(JSON.stringify({ error: "Unauthorized - Invalid secret" }), {
            status: 401,
            headers: { "Content-Type": "application/json", ...corsHeaders(request, env) },
          });
        }

        if (url.pathname === "/enqueue") {
          if (!env.MUTATION_EXEC_QUEUE) {
            return new Response(JSON.stringify({ error: "Queue binding not configured" }), {
              status: 503,
              headers: { "Content-Type": "application/json", ...corsHeaders(request, env) },
            });
          }

          const { token, userId } = json;
          if (!token || !userId) {
            return new Response(JSON.stringify({ error: "Missing token or userId" }), {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders(request, env) },
            });
          }

          await env.MUTATION_EXEC_QUEUE.send({ token, userId } satisfies MutationQueueMessage);
          return new Response(JSON.stringify({ success: true, queued: true }), {
            headers: { "Content-Type": "application/json", ...corsHeaders(request, env) },
          });
        }
        
        // Handle DB Proxy query requests
        if (url.pathname === "/query") {
          const { sql, params = [], method = "run", firstColumn, rawOptions } = json;
          if (!sql) return new Response("Missing sql query", { status: 400 });
          
          let result;
          const statement = env.DB.prepare(sql).bind(...params);

          if (method === "all") {
            result = await statement.all();
          } else if (method === "first") {
            result = await statement.first(firstColumn);
          } else if (method === "raw") {
            result = await statement.raw(rawOptions);
          } else {
            result = await statement.run();
          }
          
          return new Response(JSON.stringify(result), {
            headers: { "Content-Type": "application/json", ...corsHeaders(request, env) }
          });
        }

        // Handle DB Proxy batch requests
        if (url.pathname === "/batch") {
          const { queries = [] } = json;
          if (!Array.isArray(queries)) return new Response("Queries must be an array", { status: 400 });
          
          const stmts = queries.map((q: any) => env.DB.prepare(q.sql).bind(...(q.params || [])));
          const results = await env.DB.batch(stmts);
          return new Response(JSON.stringify(results), {
            headers: { "Content-Type": "application/json", ...corsHeaders(request, env) }
          });
        }

        const userId = json.userId;
        if (!userId) {
          return new Response("Unauthorized - Missing userId", { status: 401 });
        }

        const doSessionId = `chat-session-${userId}`;
        const id = env.AGENT_SESSION_DO.idFromName(doSessionId);
        const stub = env.AGENT_SESSION_DO.get(id);

        // For execute calls from external proxy, we ensure action=execute is in body
        if (url.pathname === "/execute" && !json.action) {
          json.action = "execute";
        }

        const response = await stub.fetch(new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body: JSON.stringify(json)
        }));
        
        // Add CORS to DO response
        const newHeaders = new Headers(response.headers);
        newHeaders.set("Access-Control-Allow-Origin", getAllowedOrigin(request, env));
        
        return new Response(response.body, {
          status: response.status,
          headers: newHeaders
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message || "Bad Request" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders(request, env) },
        });
      }
    }

    return new Response("Agent Session Worker ok", { status: 200 });
  },

  async queue(batch: MessageBatch<MutationQueueMessage>, env: Env) {
    for (const msg of batch.messages) {
      try {
        await processQueuedMutation(msg.body, env);
        msg.ack();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (isIdempotentQueueSuccess(message)) {
          // Treat already-consumed tokens as idempotent success in queue processing.
          msg.ack();
          continue;
        }

        if (isPermanentQueueError(message)) {
          // Permanent mutation/token errors should not be retried forever.
          msg.ack();
          continue;
        }

        const attempts = msg.attempts;
        if (attempts >= QUEUE_MAX_RETRIES) {
          console.error(`[Mutation Queue] Max retries reached for token ${msg.body.token}. Acking permanently. Error: ${message}`);
          msg.ack();
          continue;
        }

        const delaySeconds = computeRetryDelaySeconds(attempts);
        console.warn(`[Mutation Queue] Transient error (attempt ${attempts}/${QUEUE_MAX_RETRIES}) for token ${msg.body.token}. Retrying in ${delaySeconds}s. Error: ${message}`);
        msg.retry({ delaySeconds });
      }
    }
  },
};
