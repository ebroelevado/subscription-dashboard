import { getAuthSession } from "@/lib/auth-utils";
import { createUserScopedTools } from "@/lib/assistant-tools";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { streamText, tool, stepCountIs, convertToModelMessages, wrapLanguageModel } from "ai";
import { createAiGateway } from "ai-gateway-provider";
import { createUnified } from "ai-gateway-provider/providers/unified";

export const maxDuration = 60;

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
  "DATABASE MUTATION RULES (PROPOSAL-ONLY — YOU CANNOT EXECUTE):",
  "1. **PROPOSAL ONLY**: You cannot write to the database. You only CALL mutation tools to PROPOSE changes. The UI handles the real execution via a separate secure path after the user clicks 'Aceptar'.",
  "2. **STRICT SINGLE-TOOL LIMIT**: NEVER call more than one mutation tool in a single turn. No chaining.",
  "3. **IMMEDIATE TURN TERMINATION**: You MUST stop generating text and tools IMMEDIATELY after calling any mutation tool (createClient, updateUserConfig, updateClient, deleteClients, assignClientToSubscription, removeClientsFromSubscription, managePlatforms, managePlans, manageSubscriptions, logPayment).",
  "4. **NO HALLUCINATIONS**: NEVER write text that simulates a system response or pre-emptively claims success. NEVER use tags like <system_message> or [SISTEMA] in your outgoing text. Those tags are ONLY for messages you RECEIVE.",
  "5. **STEP-BY-STEP FLOW**: If a task requires multiple steps (e.g., creating a client then assigning it), you MUST propose Step 1, END your turn, wait for the User to click Aceptar, and then in the NEXT turn (after receiving a [SISTEMA] result), propose Step 2.",
  "6. **NO PLACEHOLDERS**: Never call a second tool using a placeholder ID (like 'test-user-001') before you have received the actual ID from a [SISTEMA] result message.",
  "7. **DELETION SAFETY**: Before explicitly deleting or removing, ALWAYS summarize the target profile to the user in text before the tool call.",
  "8. **CRITICAL FORMATTING RULE**: Whenever you list multiple entities, ALWAYS use a SINGLE Markdown table. No individual text blocks.",
  "9. **BULK ACTIONS**: Use the bulk tools (deleteClients, managePlatforms, etc.) when handling multiple existing records at once to keep it in a single proposal.",
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

export async function POST(req: Request) {
  try {
    // 1. Authenticate
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return new Response("Unauthorized", { status: 401 });
    }

    // 2. Check premium (removed)

    // 3. Parse request
    const { messages, model, allowDestructive } = await req.json();

    if (!messages?.length) {
      return new Response(JSON.stringify({ error: "No messages found" }), { status: 400 });
    }

    // 4. Build tools for this user
    // createUserScopedTools uses a defined structure: defineTool(name, {description, parameters, handler})
    // We adapt it to AI SDK v6's tool() which uses inputSchema instead of parameters.
    const builtTools: Record<string, ReturnType<typeof tool>> = {};

    const adaptedDefineTool = (
      name: string,
      config: { description: string; parameters: any; handler: (...args: any[]) => any }
    ) => {
      builtTools[name] = tool({
        description: config.description,
        inputSchema: config.parameters, // AI SDK v6: inputSchema not parameters
        execute: config.handler as any,
      });
      return builtTools[name];
    };

    createUserScopedTools(adaptedDefineTool as any, session.user.id, allowDestructive);
    const tools = builtTools;

    // Evaluate UI messages -> Core messages
    const coreMessages = await convertToModelMessages(messages);

    // Filter unsupported AI SDK v5+ properties from history (Groq/OpenAI compatible ends)
    const sanitizedMessages = coreMessages.map((msg) => {
      const newMsg = { ...msg } as any;
      
      // 1. Remove the exact top-level property causing the 400 Bad Request on Groq
      if (newMsg.reasoning_content !== undefined) {
        delete newMsg.reasoning_content;
      }
      
      // 2. Remove 'reasoning' from the newer 'parts' array format if it sneaks in
      if (newMsg.role === 'assistant' && Array.isArray(newMsg.content)) {
        newMsg.content = newMsg.content.filter((c: any) => c.type !== 'reasoning');
      }

      return newMsg;
    });

    // 5. Stream response with AI SDK
    const result = streamText({
      model: getModel(model),
      system: SYSTEM_PROMPT(!!allowDestructive),
      messages: sanitizedMessages,
      tools,
      stopWhen: stepCountIs(10), // AI SDK v6: equivalent to maxSteps
      onError: (error: unknown) => {
        console.error("[Chat Stream Error]:", error);
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (err: unknown) {
    const error = err as Error;
    console.error("[Chat API Critical Error]:", error?.message || err);
    console.error("[Chat API Stack]:", error?.stack);
    return new Response(
      JSON.stringify({ error: error?.message || "Failed to connect to AI service" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
