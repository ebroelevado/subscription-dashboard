import { z } from "zod";
import { eq, and, desc, asc, count, sql, sum, gte, lte, inArray, or, like, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { users, clients, clientSubscriptions, subscriptions, plans, platforms, renewalLogs, platformRenewals, mutationAuditLogs } from "@/db/schema";
import { getDisciplineAnalytics } from "@/lib/discipline-service";
import { serializeDeletedClients } from "@/lib/client-deletion-snapshot";
import { createMutationToken } from "@/lib/mutation-token";
import { jsonToCsv } from "@/lib/csv-utils";
import { formatCurrency, centsToAmount } from "@/lib/currency";
import { preparePythonAnalysis as preparePython, pythonAnalysisTemplateIds } from "@/lib/python-analysis";

type DefineToolFn = (...args: any[]) => any;

export function getSystemTools(defineTool: DefineToolFn, userId: string, allowDestructive: boolean = false) {
  const tools = [];

  tools.push(
    defineTool("preparePythonAnalysis", {
          description: "Prepare a SAFE Python analytics payload using fixed templates (no arbitrary Python). Input must include a validated JSON data array. Returns analysisTemplateId + dataPayload + template code for client-side Pyodide execution.",
          parameters: z.object({
            templateId: z.enum(pythonAnalysisTemplateIds).describe("Controlled analysis template identifier."),
            dataPayload: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))).describe("Tabular JSON rows to analyze."),
            title: z.string().optional().describe("Optional chart/report title."),
          }),
          handler: async ({ templateId, dataPayload, title }: any) => {
            const prepared = preparePythonAnalysis({ templateId, dataPayload, title });
            if (!prepared.ok) {
              return {
                status: "analysis_validation_error",
                error: prepared.error,
              };
            }
            return prepared.value;
          },
        }),
    
  );

  if (!allowDestructive) {
    tools.push(
      defineTool("undoMutation", {
              description: "This tool is informational only. Undo is handled directly by the UI via a secure backend endpoint. If the user asks to undo something, tell them to use the 'Ir Atrás' button shown after each executed mutation.",
              parameters: z.object({}),
              handler: async () => ({
                message: "Undo is handled directly by the UI. Use the 'Ir Atrás' button that appears after each confirmed change."
              })
            })
      
    );
  }

  tools.push(
    defineTool("getAccountDetails", {
          description: "Get the authenticated user's own account details, including their usage credits, discipline penalty settings, currency, email, and total counts of clients/subscriptions. Use this if the user asks about their own account, credits, or settings.",
          parameters: z.object({}),
          handler: async () => {
            const user = await db.query.users.findFirst({
              where: eq(users.id, userId),
              columns: {
                name: true,
                email: true,
                createdAt: true,
                currency: true,
                disciplinePenalty: true,
                companyName: true,
                whatsappSignatureMode: true,
                usageCredits: true,
              },
              with: {
                clients: { columns: { id: true } },
                subscriptions: { columns: { id: true } },
                platforms: { columns: { id: true } },
              },
            });
            
            if (!user) return { error: "User account not found." };
            
            return {
              profile: {
                name: user.name,
                email: user.email,
                memberSince: user.createdAt,
              },
              settings: {
                currency: user.currency,
                dailyDisciplinePenalty: Number(user.disciplinePenalty),
                companyName: user.companyName,
                whatsappSignatureMode: user.whatsappSignatureMode,
              },
              usage: {
                availableCredits: Number(user.usageCredits),
                totalClients: user.clients.length,
                totalSubscriptions: user.subscriptions.length,
                totalPlatforms: user.platforms.length,
              }
            };
          }
        }),
    
  );

  if (allowDestructive) {
    tools.push(
      defineTool("undoMutation", {
            description: "This tool is informational only. Undo is handled directly by the UI via a secure backend endpoint.",
            parameters: z.object({}),
            handler: async () => ({ message: "Undo is handled directly by the UI. Use the 'Ir Atrás' button that appears after each confirmed change." })
          })
      
    );
    tools.push(
      defineTool("updateUserConfig", {
            description: "Propose an update to the authenticated user's account settings, including currency, discipline penalty, company name, and WhatsApp signature mode.",
            parameters: z.object({
              currency: z.enum(["EUR", "USD", "GBP", "CNY"]).optional().describe("The base currency for all monetary displays."),
              disciplinePenalty: z.number().min(0).max(5).optional().describe("Daily score deduction applied for each late day."),
              companyName: z.string().max(100).optional().describe("The name of the user's company or business, used in WhatsApp messages."),
              whatsappSignatureMode: z.enum(["none", "name", "company"]).optional(),
            }),
            handler: async ({ disciplinePenalty, currency, companyName, whatsappSignatureMode }: any) => {
              const user = await db.query.users.findFirst({
                where: eq(users.id, userId),
                columns: { name: true, currency: true, disciplinePenalty: true, companyName: true, whatsappSignatureMode: true }
              });
              if (!user) return { error: "User not found." };
              const pendingChanges = { 
                ...(disciplinePenalty !== undefined ? { disciplinePenalty } : {}), 
                ...(currency ? { currency } : {}),
                ...(companyName !== undefined ? { companyName } : {}),
                ...(whatsappSignatureMode !== undefined ? { whatsappSignatureMode } : {})
              };
              const { token, expiresAt } = await createMutationToken(userId, { 
                toolName: "updateUserConfig", 
                targetId: userId, 
                action: "update", 
                changes: pendingChanges, 
                previousValues: { 
                  disciplinePenalty: user.disciplinePenalty, 
                  currency: user.currency, 
                  companyName: user.companyName, 
                  whatsappSignatureMode: user.whatsappSignatureMode 
                } 
              });
              await db.update(mutationAuditLogs).set({ newValues: pendingChanges as any }).where(eq(mutationAuditLogs.token, token));
              return { status: "requires_confirmation", __token: token, expiresAt, message: "I am ready to update your configuration.", pendingChanges };
            },
          }),
      
    );
  }
  return tools;
}
