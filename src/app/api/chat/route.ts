import { getAuthSession } from "@/lib/auth-utils";
import { createUserScopedTools } from "@/lib/assistant-tools";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { streamText, tool, stepCountIs, convertToModelMessages, wrapLanguageModel } from "ai";
import { createAiGateway } from "ai-gateway-provider";
import { createUnified } from "ai-gateway-provider/providers/unified";
import { checkRateLimit } from "@/lib/rate-limit";

export const maxDuration = 60;
const CHAT_PROXY_TIMEOUT_MS = 120_000;

class ChatProxyTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatProxyTimeoutError";
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new ChatProxyTimeoutError(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// Middleware to strip proprietary reasoning formats that crash strict Groq OpenAI endpoints
const sanitizeGroqMiddleware = {
  specificationVersion: 'v3' as const,
  transformParams: async ({ params }: any) => {
    if (params.prompt) {
      params.prompt = params.prompt.map((msg: any) => {
        const newMsg = { ...msg };
        if (newMsg.role === 'assistant') {
          // Remove from modern multi-part arrays
          if (Array.isArray(newMsg.content)) {
            newMsg.content = newMsg.content.filter((c: any) => c.type !== 'reasoning');
          }
          // Remove from legacy or experimental flat injections
          if (newMsg.reasoning_content !== undefined) {
            delete newMsg.reasoning_content;
          }
        }
        return newMsg;
      });
    }
    return params;
  }
};

const SYSTEM_PROMPT = (allowDestructive: boolean) => [
  "You are an AI assistant helping a SaaS subscription reseller analyze their business data.",
  "You have full read-only access to the user's database via tools.",
  "Use tools to fetch business data. ONCE YOU HAVE GATHERED THE DATA, STOP CALLING TOOLS AND PROVIDE A FINAL CONVERSATIONAL ANSWER. Do NOT call the same tool repeatedly.",
  "Available capabilities:",
  "- Search/list clients by name or phone",
  "- Get full client profiles with subscriptions and payment history",
  "- List all platforms with plans and seat usage",
  "- List subscriptions with revenue and profit per group",
  "- Get detailed subscription info with assigned clients",
  "- Calculate total MRR, costs, profit, and per-platform breakdown",
  "- Search payment history by client or date range",
  "- List platform renewal payments by provider or date range",
  "- **executeSql**: Execute raw SQL queries directly on the D1 database for advanced data retrieval. Use this when the predefined list tools do not provide the exact data slicing you need.",
  "- **runPython**: Execute arbitrary Python code in a secure, client-side sandbox ('just bash' style). You have access to pandas, numpy, and matplotlib. Use this to perform complex math, data analysis, or generate visualizations based on data you fetched. The sandbox will return stdout, stderr, and any matplotlib figures as base64 images.",
  "- **CSV/Data Export**: Use `generateCsvExport` to export ANY data as a downloadable CSV. Workflow: (1) fetch data, (2) shape the JSON array, (3) call `generateCsvExport`.",
  "",
  "STRICT SECURITY GUARDRAILS:",
  "1. **STRICTLY FORBIDDEN**: NEVER suggest, attempt to use, or tell the user to use local `bash`, `terminal`, `perl`, `awk`, or any local shell commands. For ANY code execution, you MUST ONLY use your `runPython` tool, which runs in a secure client-side sandbox. The user expects you to do the work autonomously.",
  "2. **CSV/EXPORTS**: For ANY export or CSV request, you MUST use `generateCsvExport`.",
  "3. **EXPORT PRIORITY**: If a user asks for 'CSV', 'report', 'excel', or 'data extraction', start with the appropriate read tool, then call `generateCsvExport` immediately.",
  "4. **NO CLI INSTRUCTIONS**: Never provide instructions for the user to run commands in their local terminal.",
  ...(allowDestructive ? [
    "*** ADVANCED CONTROL TOTAL MODE ENABLED ***",
    "- **Propose modifications using structured tools** (e.g., createClient, logPayment) when available.",
    "- **Propose raw SQL writes**: You may use `executeSql` to perform INSERT, UPDATE, or DELETE if no structured tool exists. ALL database modifications require explicit user confirmation. You just propose them.",
    "- **Propose** deleting clients completely (can be done in bulk)",
  ] : [
    "*** READ ONLY MODE ***",
    "- You CANNOT create, update, or delete users because the user has not enabled 'Control Total' mode. Tell them to turn it on if they ask.",
    "- If you try to use `executeSql` with a mutation (INSERT/UPDATE/DELETE), it will be blocked."
  ]),
  "",
  "TOOL ANNOTATION RULE (CRITICAL):",
  "ALWAYS output a <tool>Brief description of what you are about to do</tool> tag in TEXT immediately before calling any tool.",
  "The description must be in the SAME LANGUAGE the user is writing in (es/en/zh/etc).",
  "Examples:",
  "  <tool>Ejecutando script de Python para analizar los datos...</tool> → then call runPython",
  "  <tool>Consultando la base de datos con SQL...</tool> → then call executeSql",
  "Do NOT output any other text IMMEDIATELY before the <tool> tag — place it right before the tool call.",
  "NEVER skip this annotation. It eliminates the blank wait while the tool executes.",
  "",
  "LANGUAGE RULE: Always answer in the SAME language the user writes in.",
  "",
  "MONETARY UNITS — CRITICAL:",
  "ALL prices, amounts, costs, and monetary values returned by tools are stored as INTEGER CENTS (e.g. 800 = 8.00€, 1500 = 15.00€, 999 = 9.99€).",
  "ALWAYS divide any monetary integer by 100 before displaying it to the user.",
  "NEVER show raw cent values to the user (e.g. never write '800 euros', always write '8,00 €').",
  "",
  "SEARCH & AUTONOMY RULES:",
  "1. BE AUTONOMOUS: If a search for a specific name yields no results, try broader searches before reporting failure.",
  "2. PYTHON & SQL: You are an autonomous agent. If you need to visualize data, fetch it with SQL or list tools, format it, and pass it to `runPython` to generate a chart. Do not ask the user for permission to write code.",
  "",
  "MULTI-STEP WORKFLOW RULES (CRITICAL):",
  "1. **PLAN FIRST**: When the user gives you a complex task, FIRST outline the steps you will take in a numbered list.",
  "2. **ONE MUTATION PER TURN**: NEVER call more than one mutation tool in a single turn. Call ONE mutation tool, then IMMEDIATELY STOP generating.",
  "3. **WAIT FOR CONFIRMATION**: After calling a mutation tool, you MUST stop and wait for the user to click 'Aceptar'.",
  "4. **NO HALLUCINATIONS**: NEVER write text that simulates a system response or pre-emptively claims success.",
  "",
  "DATABASE MUTATION RULES (PROPOSAL-ONLY — YOU CANNOT EXECUTE):",
  "1. **PROPOSAL ONLY**: You cannot write to the database directly. You only CALL mutation tools to PROPOSE changes. The UI handles the real execution.",
  "2. **CRITICAL FORMATTING RULE**: Whenever you list multiple entities, ALWAYS use a SINGLE Markdown table.",
].join("\n");

/**
 * Get the AI model to use based on the requested mode.
 * Routes through Cloudflare AI Gateway for analytics, caching, and rate limiting.
 */
function getModel(mode?: string) {
  const aigateway = createAiGateway({
    accountId: process.env.CF_ACCOUNT_ID!,
    gateway: process.env.CF_AI_GATEWAY_NAME!,
    apiKey: process.env.CF_AIG_TOKEN!,
  });

  if (mode === "ultra-fast") {
    const unified = createUnified({ apiKey: process.env.CEREBRAS_API_KEY });
    return aigateway(unified("cerebras/qwen-3-235b-a22b-instruct-2507"));
  }

  if (mode === "fast") {
    const unified = createUnified({ apiKey: process.env.GROQ_API_KEY });
    return wrapLanguageModel({
      model: aigateway(unified("groq/openai/gpt-oss-120b")),
      middleware: sanitizeGroqMiddleware
    });
  }

  // Default: Cloudflare Workers AI (Nemotron supports native tool-calling maps, while our new prompt fixes the loop)
  const unified = createUnified();
  return aigateway(unified("workers-ai/@cf/nvidia/nemotron-3-120b-a12b"));
}

async function executeLocalChat({ messages, model, allowDestructive }: any, userId: string): Promise<Response> {
    if (!messages?.length) {
      return new Response(JSON.stringify({ error: "No messages found" }), { status: 400 });
    }

    const builtTools: Record<string, ReturnType<typeof tool>> = {};
    const adaptedDefineTool = (
      name: string,
      config: { description: string; parameters: any; handler: (...args: any[]) => any }
    ) => {
      builtTools[name] = tool({
        description: config.description,
        inputSchema: config.parameters,
        execute: config.handler as any,
      });
      return builtTools[name];
    };

    createUserScopedTools(adaptedDefineTool as any, userId, allowDestructive);
    const tools = builtTools;

    const coreMessages = await convertToModelMessages(messages);
    const sanitizedMessages = coreMessages.map((msg: any) => {
      const newMsg = { ...msg } as any;
      if (newMsg.reasoning_content !== undefined) delete newMsg.reasoning_content;
      if (newMsg.role === 'assistant' && Array.isArray(newMsg.content)) {
        newMsg.content = newMsg.content.filter((c: any) => c.type !== 'reasoning');
      }
      return newMsg;
    });

    const result = streamText({
      model: getModel(model),
      system: SYSTEM_PROMPT(!!allowDestructive),
      messages: sanitizedMessages,
      tools,
      stopWhen: stepCountIs(50),
      timeout: {
        stepMs: 30_000,
        totalMs: 240_000,
      },
      maxRetries: 2,
      onError: (error: unknown) => {
        console.error("[Chat Stream Error]:", error);
      },
      onStepFinish: (event) => {
        console.log("[Chat Step Finish] reason:", event.finishReason);
      },
    });

    return result.toUIMessageStreamResponse() as Response;
}

  export async function POST(req: Request): Promise<Response> {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return new Response("Unauthorized", { status: 401 });
    }

    const rateLimit = checkRateLimit({
      key: `chat:${session.user.id}`,
      limit: 30,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      const retryAfterSeconds = Math.ceil(rateLimit.retryAfterMs / 1000);
      return new Response(
        JSON.stringify({
          error: "Too Many Requests",
          code: "RATE_LIMITED",
          retryAfterSeconds,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(retryAfterSeconds),
          },
        },
      );
    }

    const json = await req.json();

    // The Durable Object Namespace is available in process.env when compiled with Cloudflare next-on-pages
    const doNamespace = (process.env as any).AGENT_SESSION_DO;
    const doUrl = process.env.AGENT_SESSION_URL;
    const proxySecret = process.env.DB_PROXY_SECRET;

    if (doNamespace && typeof doNamespace.idFromName === 'function') {
      console.log("[Chat Proxy] Forwarding to Durable Object AgentSessionDO (Native Binding)");
      json.userId = session.user.id;
      const doSessionId = `chat-session-${session.user.id}`;
      const id = doNamespace.idFromName(doSessionId);
      const stub = doNamespace.get(id);

      const doReq = new Request(req.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });

      return await withTimeout(
        stub.fetch(doReq),
        CHAT_PROXY_TIMEOUT_MS,
        "Durable Object chat request timed out."
      );
    } else if (doUrl) {
      console.log(`[Chat Proxy] Forwarding to External Worker DO Proxy: ${doUrl}`);
      if (!proxySecret) {
        throw new Error("AGENT_SESSION_URL is configured but DB_PROXY_SECRET is missing.");
      }

      json.userId = session.user.id;
      json.secret = proxySecret;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CHAT_PROXY_TIMEOUT_MS);
      let doReq: Response;
      try {
        doReq = await fetch(`${doUrl}/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Secret": proxySecret,
          },
          body: JSON.stringify(json),
          signal: controller.signal,
        });
      } catch (error) {
        if ((error as any)?.name === "AbortError") {
          throw new ChatProxyTimeoutError("External chat proxy request timed out.");
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }

      return new Response(doReq.body, {
        status: doReq.status,
        headers: doReq.headers
      });
    } else {
      console.log("[Chat Proxy] Using Local Dev Execution Container (No Binding/URL)");
      return await executeLocalChat(json, session.user.id);
    }
  } catch (err: unknown) {
    const error = err as Error;
    console.error("[Chat API Critical Error]:", error?.message || err);
    console.error("[Chat API Stack]:", error?.stack);
    const statusCode = error instanceof ChatProxyTimeoutError ? 504 : 500;
    return new Response(
      JSON.stringify({ error: error?.message || "Failed to connect to AI service" }),
      { status: statusCode, headers: { "Content-Type": "application/json" } }
    );
  }
}
