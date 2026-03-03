import { auth } from "@/lib/auth";
import { createUserScopedTools } from "@/lib/copilot-tools";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

export async function POST(req: Request) {

  try {
    // 1. Authenticate Request
    const session = await auth();
    if (!session?.user?.id) {
      return new Response("Unauthorized", { status: 401 });
    }

    // 2. Fetch User's Copilot Token
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { copilotToken: true }
    });

    if (!user?.copilotToken) {
      return new Response(
        JSON.stringify({ error: "No GitHub Copilot token found. Please connect your account first." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. Parse Incoming Chat Messages & Model Selection
    const { messages, model } = await req.json();

    if (!messages?.length) {
      return new Response(JSON.stringify({ error: "No messages found" }), { status: 400 });
    }

    // Build full conversation history as context for the Copilot session.
    // Since we create a fresh session per request, we need to include all
    // previous messages so the AI can maintain conversational context.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extractText = (msg: any): string => {
      if (msg.parts) {
        return msg.parts
          .filter((p: { type: string }) => p.type === "text")
          .map((p: { text: string }) => p.text)
          .join("\n");
      }
      return msg.content || "";
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conversationHistory = messages.map((m: any) => {
      const role = m.role === "user" ? "User" : "Assistant";
      return `${role}: ${extractText(m)}`;
    });

    // The last message is the new user prompt
    const lastMsg = messages[messages.length - 1];
    const lastUserText = extractText(lastMsg);

    // Build prompt: if there's history, include it; otherwise just the message
    let promptText: string;
    if (messages.length > 1) {
      promptText = [
        "Here is the conversation so far:",
        "---",
        ...conversationHistory.slice(0, -1), // all except the last (current) message
        "---",
        `Now the user says: ${lastUserText}`,
        "Continue the conversation naturally, keeping context from previous messages.",
      ].join("\n");
    } else {
      promptText = lastUserText;
    }

    const selectedModel = model || "gpt-4o";

    const { CopilotClient, defineTool } = await import("@github/copilot-sdk");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ai = await import("ai") as any;
    const { createUIMessageStream, createUIMessageStreamResponse } = ai;

    // 5. Resolve the Copilot CLI path manually.
    // We search known filesystem locations because:
    // - The SDK's getBundledCliPath() uses import.meta.resolve which webpack breaks
    // - The railpack build copies @github/copilot to .next/standalone/copilot-cli/
    const { existsSync } = await import("fs");
    const { dirname, join } = await import("path");

    let cliPath = process.env.COPILOT_CLI_PATH || "";

    if (!cliPath || !existsSync(cliPath)) {
      // Derive the server root from process.argv[1] (e.g. /app/.next/standalone/server.js)
      const serverDir = process.argv[1] ? dirname(process.argv[1]) : "";
      const projectRoot = process.cwd();

      const candidates = [
        // Production: railpack copies @github/copilot here during build
        join(serverDir, "copilot-cli", "index.js"),
        join(projectRoot, ".next", "standalone", "copilot-cli", "index.js"),
        // Development: standard node_modules
        join(projectRoot, "node_modules", "@github", "copilot", "index.js"),
      ];

      const found = candidates.find(c => c && existsSync(c));
      if (found) cliPath = found;
    }

    if (!cliPath || !existsSync(cliPath)) {
      console.error("❌ Could not resolve @github/copilot/index.js");
      return new Response(
        JSON.stringify({ error: "Copilot CLI not found. Please check deployment configuration." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 6. Create CopilotClient with manually resolved cliPath
    const client = new CopilotClient({
      githubToken: user.copilotToken,
      useLoggedInUser: false,
      autoStart: false,
      cliPath,
    });

    await client.start();

    // 7. Create a streaming session with user-scoped read-only tools
    const copilotSession = await client.createSession({
      model: selectedModel,
      streaming: true,
      systemMessage: {
        mode: "replace" as const,
        content: [
          "You are an AI assistant helping a SaaS subscription reseller analyze their business data.",
          "You have full read-only access to the user's database via tools.",
          "ALWAYS use tools to answer questions about clients, platforms, subscriptions, revenue, and payments.",
          "Available capabilities:",
          "- Search/list clients by name or phone",
          "- Get full client profiles with subscriptions and payment history",
          "- List all platforms with plans and seat usage",
          "- List subscriptions with revenue and profit per group",
          "- Get detailed subscription info with assigned clients",
          "- Calculate total MRR, costs, profit, and per-platform breakdown",
          "- Search payment history by client or date range",
          "- List platform renewal payments by provider or date range",
          "Keep responses concise, use tables or lists for data, and always show currency values.",
          "Answer in the same language the user writes in.",
        ].join("\n"),
      },
      tools: createUserScopedTools(defineTool, session.user.id),
    });

    // 7. Stream the response using Vercel AI SDK UI Message Stream format
    const stream = createUIMessageStream({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async ({ writer }: { writer: any }) => {
        let partId = crypto.randomUUID();

        writer.write({ type: "text-start", id: partId });

        await new Promise<void>((resolve, reject) => {
          let isThinking = false;
          let resolved = false;
          let insideTextPart = true; // We start with a text-start
          let pendingToolCalls = 0;  // Track parallel tool calls

          const safeResolve = () => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          };

          const closeThinkingIfOpen = () => {
            if (isThinking) {
              writer.write({ type: "text-delta", delta: "\n</think>\n", id: partId });
              isThinking = false;
            }
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          copilotSession.on("assistant.reasoning_delta", (event: any) => {
            if (!isThinking) {
              writer.write({ type: "text-delta", delta: "\n<think>\n", id: partId });
              isThinking = true;
            }
            writer.write({
              type: "text-delta",
              delta: event.data.deltaContent,
              id: partId,
            });
          });

          copilotSession.on("assistant.message_delta", (event: { data: { deltaContent: string } }) => {
            closeThinkingIfOpen();
            writer.write({
              type: "text-delta",
              delta: event.data.deltaContent,
              id: partId,
            });
          });


          // Forward tool execution to Vercel UI SDK
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          copilotSession.on("tool.execution_start", (event: any) => {
            closeThinkingIfOpen();
            
            // Only end the text part ONCE when the first tool of a parallel batch starts
            if (insideTextPart) {
              writer.write({ type: "text-end", id: partId });
              insideTextPart = false;
            }

            pendingToolCalls++;

            // Ensure arguments is always a parsed object, not a string
            let parsedArgs = event.data.arguments || {};
            if (typeof parsedArgs === "string") {
              try {
                parsedArgs = JSON.parse(parsedArgs);
              } catch {
                parsedArgs = {};
              }
            }

            writer.write({
              type: "tool-input-start",
              toolCallId: event.data.toolCallId,
              toolName: event.data.toolName,
              providerExecuted: true,
            });
            writer.write({
              type: "tool-input-available",
              toolCallId: event.data.toolCallId,
              toolName: event.data.toolName,
              input: parsedArgs,
              providerExecuted: true,
            });
          });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          copilotSession.on("tool.execution_complete", (event: any) => {
            closeThinkingIfOpen();
            
            // Ensure result is always a parsed object, not a string
            let parsedResult = event.data.result || { status: "success" };
            if (typeof parsedResult === "string") {
              try {
                parsedResult = JSON.parse(parsedResult);
              } catch {
                parsedResult = { raw: parsedResult };
              }
            }

            if (event.data.success) {
              writer.write({
                type: "tool-output-available",
                toolCallId: event.data.toolCallId,
                output: parsedResult,
                providerExecuted: true,
              });
            } else {
              writer.write({
                type: "tool-output-error",
                toolCallId: event.data.toolCallId,
                errorText: event.data.error?.message || "Error executing tool",
                providerExecuted: true,
              });
            }

            pendingToolCalls--;

            // Only start a new text part when ALL parallel tool calls have completed
            if (pendingToolCalls <= 0) {
              pendingToolCalls = 0;
              partId = crypto.randomUUID();
              writer.write({ type: "text-start", id: partId });
              insideTextPart = true;
            }
          });

          // Handle Copilot SDK session errors (single combined handler)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          copilotSession.on("session.error", (event: any) => {
             closeThinkingIfOpen();
             try {
               writer.write({ type: "text-end", id: partId });
               writer.write({ type: "error", error: event.data?.message || event?.message || "A Copilot session error occurred." });
             } catch {
               // stream may already be closed
             }
             safeResolve();
          });

          copilotSession.on("session.idle", async () => {
            closeThinkingIfOpen();
            writer.write({ type: "text-end", id: partId });
            try {
              await copilotSession.destroy();
              await client.stop();
            } catch {
              // Ignore cleanup errors
            }
            safeResolve();
          });

          copilotSession.send({ prompt: promptText }).catch((err) => {
            console.error("[Route] send error:", err);
            reject(err);
          });
        });
      },
      onError: (error: unknown) => {
        console.error("[Chat Stream Error]:", error);
        return error instanceof Error ? error.message : "Internal error";
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (apiError: unknown) {
    const err = apiError as Error & { cause?: unknown };
    console.error("[Chat API Critical Error]:", err?.message || err);
    console.error("[Chat API Critical Error Stack]:", err?.stack);
    return new Response(
      JSON.stringify({ error: err?.message || "Failed to connect to Copilot" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
