import { DurableObject } from "cloudflare:workers";
import { streamText, tool, stepCountIs, convertToModelMessages, wrapLanguageModel } from "ai";
import { createAiGateway } from "ai-gateway-provider";
import { createUnified } from "ai-gateway-provider/providers/unified";
import { createUserScopedTools } from "@/lib/assistant-tools";
import { initDb, getDb } from "@/db";
import { rollbackConsumedMutationToken, validateAndConsumeMutationToken } from "@/lib/mutation-token";
import { executeMutation } from "@/lib/mutation-executor";
import {
  appendAgentMessage,
  finalizeAgentRun,
  recordStepToolCalls,
  startAgentRun,
} from "@/lib/agent-run-tracking";

export interface Env {
  DB: any;
  AGENT_SESSION_DO: DurableObjectNamespace;
  MUTATION_EXEC_QUEUE?: Queue;
  CF_ACCOUNT_ID?: string;
  CF_AI_GATEWAY_NAME?: string;
  CF_AIG_TOKEN?: string;
  CEREBRAS_API_KEY?: string;
  GROQ_API_KEY?: string;
  DB_PROXY_SECRET?: string;
}

// Middleware to strip proprietary reasoning formats that crash strict endpoints
const sanitizeGroqMiddleware = {
  specificationVersion: 'v3' as const,
  transformParams: async ({ params }: any) => {
    if (params.prompt) {
      params.prompt = params.prompt.map((msg: any) => {
        const newMsg = { ...msg };
        if (newMsg.role === 'assistant') {
          if (Array.isArray(newMsg.content)) {
            newMsg.content = newMsg.content.filter((c: any) => c.type !== 'reasoning');
          }
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
  "- **CSV/Data Export**: Use `generateCsvExport` to export ANY data as a downloadable CSV. Workflow: (1) fetch data with the appropriate read tool, (2) shape the JSON array with only the columns the user wants, (3) call `generateCsvExport` with that array. This works for clients, subscriptions, platforms, payments, or any custom combination.",
  "",
  "STRICT SECURITY GUARDRAILS:",
  "1. **STRICTLY FORBIDDEN**: NEVER suggest, attempt to use, or tell the user to use `bash`, `python`, `terminal`, `perl`, `awk`, or any shell/terminal commands. You do NOT have permission to run commands in the terminal.",
  "2. **CSV/EXPORTS**: For ANY export or CSV request, you MUST use `generateCsvExport`. First fetch the data, then pass the shaped array to `generateCsvExport`. Never try to manually format CSV text in your response.",
  "3. **EXPORT PRIORITY**: If a user asks for 'CSV', 'report', 'excel', or 'data extraction', start with the appropriate read tool, then call `generateCsvExport` immediately.",
  "4. **NO CLI INSTRUCTIONS**: Never provide instructions for the user to run commands in their local terminal.",
  ...(allowDestructive ? [
    "*** ADVANCED CONTROL TOTAL MODE ENABLED ***",
    "- **Propose** creating new clients and assigning them to seats (the UI executes after approval)",
    "- **Propose** removing clients from specific seats (can be done in bulk)",
    "- **Propose** deleting clients completely (can be done in bulk)",
    "- **Propose** modifications to any data (the UI handles execution and undo)"
  ] : [
    "*** READ ONLY MODE ***",
    "- You CANNOT create, update, or delete users because the user has not enabled 'Control Total' mode. Tell them to turn it on if they ask."
  ]),
  "",
  "TOOL ANNOTATION RULE (CRITICAL):",
  "ALWAYS output a <tool>Brief description of what you are about to do</tool> tag in TEXT immediately before calling any tool.",
  "The description must be in the SAME LANGUAGE the user is writing in (es/en/zh/etc).",
  "Examples:",
  "  <tool>Buscando clientes en la base de datos...</tool> → then call listClients",
  "  <tool>Generando el archivo CSV de exportación...</tool> → then call generateCsvExport",
  "  <tool>Calculando los ingresos totales...</tool> → then call getRevenueStats",
  "  <tool>Searching your client database...</tool> → then call listClients",
  "Do NOT output any other text IMMEDIATELY before the <tool> tag — place it right before the tool call.",
  "NEVER skip this annotation. It eliminates the blank wait while the tool executes.",
  "",
  "LANGUAGE RULE: Always answer in the SAME language the user writes in.",
  "",
  "MONETARY UNITS — CRITICAL:",
  "ALL prices, amounts, costs, and monetary values returned by tools are stored as INTEGER CENTS (e.g. 800 = 8.00€, 1500 = 15.00€, 999 = 9.99€).",
  "ALWAYS divide any monetary integer by 100 before displaying it to the user.",
  "NEVER show raw cent values to the user (e.g. never write '800 euros', always write '8,00 €').",
  "The user's configured currency is available via getAccountDetails. Format amounts in that currency.",
  "Examples: 500 → 5,00€ | 1200 → 12,00€ | 9900 → 99,00€ | 150 → 1,50€",
  "",
  "SEARCH & AUTONOMY RULES:",
  "1. BE AUTONOMOUS: If a search for a specific name (e.g. 'Angel') yields no results, DO NOT give up immediately. Try broader searches (e.g. use just 'Ang') before reporting failure.",
  "2. FUZZY MATCHING: Favor partial or similar matches.",
  "3. EXPORT PRIORITY: If a user asks for a 'report', 'CSV', or 'excel', use the corresponding export tool immediately.",
  "",
  "MULTI-STEP WORKFLOW RULES (CRITICAL):",
  "1. **PLAN FIRST**: When the user gives you a complex task that requires multiple steps (e.g., 'create a user and assign them to a Spotify plan'), FIRST outline the steps you will take in a numbered list. Then ask the user if they want to proceed with Step 1.",
  "2. **ONE MUTATION PER TURN**: NEVER call more than one mutation tool (createClient, assignClientToSubscription, logPayment, etc.) in a single turn. Call ONE mutation tool, then IMMEDIATELY STOP generating. Do NOT write any more text after the mutation tool call.",
  "3. **WAIT FOR CONFIRMATION**: After calling a mutation tool, you MUST stop and wait for the user to click 'Aceptar'. Only after you receive a [SYSTEM] message confirming execution can you proceed to the next step.",
  "4. **NO PLACEHOLDER IDs**: Never call a mutation tool using a placeholder or assumed ID. Always wait for the actual ID from a [SYSTEM] result message before using it in subsequent steps.",
  "5. **ADAPTIVE PLANNING**: If you discover new steps are needed during execution, add them to the plan and inform the user. The plan can grow as needed.",
  "6. **NO HALLUCINATIONS**: NEVER write text that simulates a system response or pre-emptively claims success. NEVER use tags like <system_message> or [SISTEMA] in your outgoing text. Those tags are ONLY for messages you RECEIVE.",
  "",
  "DATABASE MUTATION RULES (PROPOSAL-ONLY — YOU CANNOT EXECUTE):",
  "1. **PROPOSAL ONLY**: You cannot write to the database. You only CALL mutation tools to PROPOSE changes. The UI handles the real execution via a separate secure path after the user clicks 'Aceptar'.",
  "2. **DELETION SAFETY**: Before explicitly deleting or removing, ALWAYS summarize the target profile to the user in text before the tool call.",
  "3. **CRITICAL FORMATTING RULE**: Whenever you list multiple entities, ALWAYS use a SINGLE Markdown table. No individual text blocks.",
  "4. **BULK ACTIONS**: Use the bulk tools (deleteClients, managePlatforms, etc.) when handling multiple existing records at once to keep it in a single proposal.",
].join("\n");


export class AgentSessionDO extends DurableObject {
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.env = env;
    
    // Initialize DB binding if available
    if (this.env.DB) {
      initDb(this.env.DB);
    }
    
    // Inject Process.env to mimic node behavior for AI routers
    if (typeof process === 'undefined') {
      (globalThis as any).process = { env: {} };
    }
    Object.assign((globalThis as any).process.env, this.env);
  }

  getModel(mode?: string) {
    const aigateway = createAiGateway({
      accountId: this.env.CF_ACCOUNT_ID!,
      gateway: this.env.CF_AI_GATEWAY_NAME || 'pearfect',
      apiKey: this.env.CF_AIG_TOKEN!,
    });

    if (mode === "ultra-fast") {
      const unified = createUnified({ apiKey: this.env.CEREBRAS_API_KEY });
      return aigateway(unified("cerebras/qwen-3-235b-a22b-instruct-2507"));
    }

    if (mode === "fast") {
      const unified = createUnified({ apiKey: this.env.GROQ_API_KEY });
      return wrapLanguageModel({
        model: aigateway(unified("groq/openai/gpt-oss-120b")),
        middleware: sanitizeGroqMiddleware
      });
    }

    const unified = createUnified();
    return aigateway(unified("workers-ai/@cf/nvidia/nemotron-3-120b-a12b"));
  }

  async fetch(request: Request) {
    let activeRunId: string | null = null;
    let runFinalized = false;
    const toolCallMetrics = new Map<string, {
      startedAt?: string;
      finishedAt?: string;
      durationMs?: number;
      errorMessage?: string | null;
    }>();

    try {
      const url = new URL(request.url);
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      const body = await request.json() as any;
      const { messages, model, allowDestructive, userId, action, token } = body;

      if (!userId) {
        return new Response(JSON.stringify({ error: "No userId provided" }), { status: 400 });
      }

      // Handle direct mutation execution (Total Control confirmation)
      if (action === "execute") {
        if (!token) return new Response(JSON.stringify({ error: "Missing token" }), { status: 400 });
        
        console.log(`[DO Mutation] Executing mutation for user ${userId} with token ${token.substring(0, 8)}...`);
        const auditLog = await validateAndConsumeMutationToken(token, userId);
        let result;
        try {
          result = await executeMutation(
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

        return new Response(JSON.stringify({
          success: true,
          auditLogId: auditLog.id,
          result,
        }), { 
          status: 200, 
          headers: { "Content-Type": "application/json" } 
        });
      }

      if (!messages?.length) {
        return new Response(JSON.stringify({ error: "No messages found" }), { status: 400 });
      }

      const activeModel = typeof model === "string" && model.length ? model : "default";
      const run = await startAgentRun(getDb(), {
        userId,
        model: activeModel,
        source: "durable_object",
        allowDestructive: !!allowDestructive,
      });
      activeRunId = run.id;

      const latestUserMessage = [...messages].reverse().find((message: any) => message?.role === "user");
      if (latestUserMessage) {
        await appendAgentMessage(getDb(), {
          runId: activeRunId,
          role: "user",
          content: latestUserMessage,
        });
      }

      // Build tools
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

      // Execute Agent Loop (safely isolated within this DO instance)
      let stepNumber = 0;
      const result = streamText({
        model: this.getModel(model),
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
          console.error("[DO Chat Stream Error]:", error);
        },
        experimental_onToolCallStart: (event) => {
          const toolCallId = event?.toolCall?.toolCallId;
          if (!toolCallId) return;

          const startedAt = new Date().toISOString();
          toolCallMetrics.set(toolCallId, {
            ...(toolCallMetrics.get(toolCallId) ?? {}),
            startedAt,
          });

          console.log(JSON.stringify({
            event: "tool_call_start",
            runId: activeRunId,
            stepNumber: event.stepNumber ?? null,
            toolName: event?.toolCall?.toolName ?? "unknown_tool",
            toolCallId,
            startedAt,
          }));
        },
        experimental_onToolCallFinish: (event) => {
          const toolCallId = event?.toolCall?.toolCallId;
          if (!toolCallId) return;

          const metric = toolCallMetrics.get(toolCallId) ?? {};
          const finishedAt = new Date().toISOString();
          const errorMessage = event.success ? null : (event.error instanceof Error
            ? event.error.message
            : typeof event.error === "string"
              ? event.error
              : "Tool call failed");

          toolCallMetrics.set(toolCallId, {
            ...metric,
            finishedAt,
            durationMs: event.durationMs,
            errorMessage,
          });

          console.log(JSON.stringify({
            event: "tool_call_finish",
            runId: activeRunId,
            stepNumber: event.stepNumber ?? null,
            toolName: event?.toolCall?.toolName ?? "unknown_tool",
            toolCallId,
            durationMs: event.durationMs,
            success: event.success,
            finishedAt,
            errorMessage,
          }));
        },
        onStepFinish: async (event) => {
          stepNumber += 1;
          if (activeRunId) {
            try {
              await recordStepToolCalls(getDb(), {
                runId: activeRunId,
                stepNumber,
                toolCalls: (event as any).toolCalls,
                toolResults: (event as any).toolResults,
                toolMetrics: toolCallMetrics,
              });
            } catch (trackingError) {
              console.error("[DO Tracking Error: tool calls]", trackingError);
            }
          }
          console.log("[DO Step Finish] reason:", event.finishReason);
        },
      });

      // Stream the raw stream to the requesting frontend
      return result.toUIMessageStreamResponse({
        originalMessages: messages,
        onFinish: async ({ responseMessage, isAborted }) => {
          if (!activeRunId || runFinalized) return;

          try {
            if (responseMessage) {
              await appendAgentMessage(getDb(), {
                runId: activeRunId,
                role: "assistant",
                content: responseMessage,
              });
            }

            await finalizeAgentRun(getDb(), {
              runId: activeRunId,
              status: isAborted ? "aborted" : "completed",
            });
            runFinalized = true;
          } catch (trackingError) {
            console.error("[DO Tracking Error: finish]", trackingError);
          }
        },
        onError: (error: unknown) => {
          console.error("[DO UI Stream Error]:", error);
          return "An error occurred while streaming the response.";
        },
      });

    } catch (err: unknown) {
      const error = err as Error;
      console.error("[DO Session Error]:", error?.message || err);

      if (activeRunId && !runFinalized) {
        try {
          await finalizeAgentRun(getDb(), {
            runId: activeRunId,
            status: "failed",
            errorMessage: error?.message || "DO session error",
          });
          runFinalized = true;
        } catch (trackingError) {
          console.error("[DO Tracking Error: finalize failed run]", trackingError);
        }
      }

      return new Response(
        JSON.stringify({ error: error?.message || "DO Error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }
}
