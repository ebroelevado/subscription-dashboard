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

export function getExportTools(defineTool: DefineToolFn, userId: string, allowDestructive: boolean = false) {
  const tools = [];

  tools.push(
    defineTool("exportFinancialReport", {
          description: "Generate a structured financial report covering a date range. Returns totals for revenue collected from clients, platform costs paid, net profit, per-client breakdown, and per-platform breakdown. Ideal for end-of-month summaries.",
          parameters: z.object({
            fromDate: z.string().describe("Start date in ISO format (e.g. 2025-01-01)"),
            toDate: z.string().describe("End date in ISO format (e.g. 2025-01-31)"),
          }),
          handler: async ({ fromDate, toDate }: { fromDate: string; toDate: string }) => {
            // Get user's subscription IDs
            const userSubs = await db.select({ id: subscriptions.id })
              .from(subscriptions)
              .where(eq(subscriptions.userId, userId));
            const userSubIds = userSubs.map(s => s.id);
            if (userSubIds.length === 0) {
              return { period: { from: fromDate, to: toDate }, summary: { totalRevenueCollected: 0, totalPlatformCostsPaid: 0, netProfit: 0, totalMRR: 0, totalClientPayments: 0, totalPlatformPayments: 0 }, csvData: [], perClientBreakdown: [], perPlatformBreakdown: [], status: "download_available", message: "No data found.", filename: `reporte_financiero_${fromDate}_${toDate}.csv` };
            }
    
            const [clientPayments, platformPayments, activeSeats] = await Promise.all([
              // Must use clientSubscription IDs, not subscription IDs
              (async () => {
                const csForReport = await db.select({ id: clientSubscriptions.id })
                  .from(clientSubscriptions)
                  .where(inArray(clientSubscriptions.subscriptionId, userSubIds));
                const csIdsForReport = csForReport.map(cs => cs.id);
                return db.query.renewalLogs.findMany({
                  where: and(
                    gte(renewalLogs.paidOn, fromDate),
                    lte(renewalLogs.paidOn, toDate),
                    csIdsForReport.length > 0
                      ? inArray(renewalLogs.clientSubscriptionId, csIdsForReport)
                      : sql`1=0`
                  ),
                orderBy: [asc(renewalLogs.paidOn)],
                with: {
                  clientSubscription: {
                    with: {
                      client: { columns: { name: true } },
                      subscription: {
                        columns: { label: true },
                        with: {
                          plan: {
                            with: { platform: { columns: { name: true } } }
                          }
                        }
                      },
                    },
                  },
                },
                });
              })(),
              db.query.platformRenewals.findMany({
                where: and(
                  gte(platformRenewals.paidOn, fromDate),
                  lte(platformRenewals.paidOn, toDate),
                  inArray(platformRenewals.subscriptionId, userSubIds)
                ),
                with: {
                  subscription: {
                    columns: { label: true },
                    with: {
                      plan: {
                        columns: { name: true },
                        with: { platform: { columns: { name: true } } }
                      }
                    },
                  },
                },
              }),
              db.query.clientSubscriptions.findMany({
                where: and(
                  eq(clientSubscriptions.status, "active"),
                  inArray(clientSubscriptions.subscriptionId, userSubIds)
                ),
                columns: { customPrice: true },
                with: {
                  subscription: {
                    with: {
                      plan: {
                        with: { platform: { columns: { name: true } } }
                      }
                    }
                  }
                }
              }),
            ]);
    
            const totalRevenue = clientPayments.reduce((sum, p) => sum + Number(p.amountPaid), 0);
            const totalCosts = platformPayments.reduce((sum, p) => sum + Number(p.amountPaid), 0);
            const totalMRR = activeSeats.reduce((sum, s) => sum + Number(s.customPrice), 0);
    
            // Per client breakdown
            const perClient: Record<string, { name: string; totalPaid: number; payments: number }> = {};
            for (const p of clientPayments) {
              const name = p.clientSubscription?.client.name ?? "Unknown";
              if (!perClient[name]) perClient[name] = { name, totalPaid: 0, payments: 0 };
              perClient[name].totalPaid += Number(p.amountPaid);
              perClient[name].payments += 1;
            }
    
            // Per platform breakdown
            const perPlatform: Record<string, { platformName: string; revenueCollected: number; costsPaid: number }> = {};
            for (const p of clientPayments) {
              const pName = p.clientSubscription?.subscription.plan.platform.name ?? "Unknown";
              if (!perPlatform[pName]) perPlatform[pName] = { platformName: pName, revenueCollected: 0, costsPaid: 0 };
              perPlatform[pName].revenueCollected += Number(p.amountPaid);
            }
            for (const p of platformPayments) {
              const pName = p.subscription.plan.platform.name;
              if (!perPlatform[pName]) perPlatform[pName] = { platformName: pName, revenueCollected: 0, costsPaid: 0 };
              perPlatform[pName].costsPaid += Number(p.amountPaid);
            }
    
            return {
              period: { from: fromDate, to: toDate },
              summary: {
                totalRevenueCollected: totalRevenue,
                totalPlatformCostsPaid: totalCosts,
                netProfit: totalRevenue - totalCosts,
                totalMRR,
                totalClientPayments: clientPayments.length,
                totalPlatformPayments: platformPayments.length,
              },
              csvData: clientPayments.map(p => ({
                Date: p.paidOn ? new Date(p.paidOn).toLocaleDateString() : 'N/A',
                Client: p.clientSubscription?.client.name || 'Unknown',
                Platform: p.clientSubscription?.subscription.plan.platform.name || 'Unknown',
                Subscription: p.clientSubscription?.subscription.label || 'N/A',
                Amount: centsToAmount(p.amountPaid).toFixed(2),
                Period: `${p.periodStart ? new Date(p.periodStart).toLocaleDateString() : '?'} - ${p.periodEnd ? new Date(p.periodEnd).toLocaleDateString() : '?'}`,
                Notes: p.notes || ''
              })),
              status: "download_available",
              message: `Report generated for ${fromDate} to ${toDate}. Click below to download the CSV.`,
              filename: `reporte_financiero_${fromDate}_${toDate}.csv`,
              perClientBreakdown: Object.values(perClient).sort((a, b) => b.totalPaid - a.totalPaid),
              perPlatformBreakdown: Object.values(perPlatform).sort((a, b) => b.revenueCollected - a.revenueCollected),
            };
          },
        }),
    
  );

  tools.push(
    defineTool("exportClientsReport", {
          description: "Export all client data into a single CSV file, including their contact info, discipline scores, and all active/paused subscriptions (platforms, plans, and prices). This is the best way to extract the full database of clients for external use.",
          parameters: z.object({}),
          handler: async () => {
            const clientsList = await db.query.clients.findMany({
              where: eq(clients.userId, userId),
              orderBy: [asc(clients.name)],
              with: {
                clientSubscriptions: {
                  with: {
                    subscription: {
                      with: {
                        plan: { with: { platform: true } },
                      },
                    },
                    renewalLogs: {
                      orderBy: [desc(renewalLogs.paidOn)],
                      limit: 1,
                    },
                  },
                },
              },
            });
    
            const rows: any[] = [];
            for (const client of clientsList) {
              if (client.clientSubscriptions.length === 0) {
                rows.push({
                  "ID Cliente": client.id,
                  "Nombre": client.name,
                  "Teléfono": client.phone || "",
                  "Notas": client.notes || "",
                  "Score Disciplina": client.disciplineScore ? Number(client.disciplineScore).toFixed(1) : "N/A",
                  "Estado Salud": client.healthStatus || "New",
                  "Días Vencidos": client.daysOverdue,
                  "Plataforma": "N/A",
                  "Plan": "N/A",
                  "Precio/Mes": "0.00",
                  "Estado Suscripción": "N/A",
                  "Activa Hasta": "N/A",
                  "Último Pago": "N/A",
                  "Fecha Registro": new Date(client.createdAt).toLocaleDateString(),
                });
              } else {
                for (const cs of client.clientSubscriptions) {
                  const lastPayment = cs.renewalLogs[0];
                  rows.push({
                    "ID Cliente": client.id,
                    "Nombre": client.name,
                    "Teléfono": client.phone || "",
                    "Notas": client.notes || "",
                    "Score Disciplina": client.disciplineScore ? Number(client.disciplineScore).toFixed(1) : "N/A",
                    "Estado Salud": client.healthStatus || "New",
                    "Días Vencidos": client.daysOverdue,
                    "Plataforma": cs.subscription.plan.platform.name,
                    "Plan": cs.subscription.plan.name,
                    "Precio/Mes": centsToAmount(cs.customPrice).toFixed(2),
                    "Estado Suscripción": cs.status,
                    "Activa Hasta": cs.activeUntil,
                    "Último Pago": lastPayment ? lastPayment.paidOn : "Never",
                    "Fecha Registro": new Date(client.createdAt).toLocaleDateString(),
                  });
                }
              }
            }
    
            return {
              totalClients: clientsList.length,
              totalRows: rows.length,
              csvData: rows,
              status: "download_available",
              filename: `clientes_pearfect_${new Date().toISOString().split('T')[0]}.csv`,
              message: `Se han procesado ${clientsList.length} clientes con éxito. Haz clic abajo para descargar el archivo CSV.`,
            };
          },
        }),
    
  );

  tools.push(
    defineTool("generateCsvExport", {
          description: "Convert any JSON data into a downloadable CSV file. MANDATORY WORKFLOW: (1) Fetch the data using the appropriate read tool (e.g. getRevenueStats or listClients), (2) Select only the columns asked for by the user, (3) Pass that array to this tool. This is the ONLY way to export data — never format CSV text manually.",
          parameters: z.object({
            data: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))).describe("Array of objects to export. Each object's keys become column headers, values become cells. All values must be primitive (string, number, boolean, or null)."),
            filename: z.string().optional().describe("Base filename without extension (e.g. 'clientes_marzo'). Date will be appended automatically."),
            title: z.string().optional().describe("Short human-readable description shown in the chat, e.g. 'Reporte de clientes con pagos vencidos'."),
          }),
          handler: async ({ data, filename, title }: any) => {
            if (!Array.isArray(data) || data.length === 0) {
              return { error: "No data provided for export. Please fetch data first using a read tool and pass it here." };
            }
            const safeFilename = `${(filename || "export").replace(/[^a-z0-9_\-]/gi, "_")}_${new Date().toISOString().split("T")[0]}.csv`;
            return {
              status: "download_available",
              csvData: data,
              filename: safeFilename,
              message: title || `Export ready: ${data.length} row(s).`,
              rowCount: data.length,
              columnCount: Object.keys(data[0] || {}).length,
            };
          },
        }),
    
  );

  tools.push(
    defineTool("generateWhatsappMessage", {
          description: "Generate a clickable WhatsApp link to send a message to a client. Use this when the user asks to send a payment reminder, credentials update, or any custom message to a client via WhatsApp. Always fetch the client's phone number first. IMPORTANT: Never include emojis in the message — they cause rendering issues on some devices. Keep messages plain text only.",
          parameters: z.object({
            clientId: z.string().describe("The ID of the client to message."),
            messageType: z.enum(["payment_reminder", "credentials_update", "custom"]).describe("The type of message to compose."),
            customMessage: z.string().optional().describe("For 'custom' type: the exact message body to send. For other types, this will override the template."),
            amountDue: z.number().optional().describe("For payment_reminder: the amount owed."),
            platform: z.string().optional().describe("Platform name (for payment_reminder or credentials_update context)."),
            newUsername: z.string().optional().describe("For credentials_update: the new username/email."),
            newPassword: z.string().optional().describe("For credentials_update: the new password."),
            dueDate: z.string().optional().describe("For payment_reminder: the due date (ISO format)."),
          }),
          handler: async ({
            clientId, messageType, customMessage, amountDue, platform, newUsername, newPassword, dueDate,
          }: any) => {
            const client = await db.query.clients.findFirst({
              where: and(eq(clients.id, clientId), eq(clients.userId, userId)),
              columns: { name: true, phone: true },
            });
            if (!client) return { error: "Client not found or access denied." };
            if (!client.phone) return { error: `${client.name} does not have a phone number registered. Add one first.` };
    
            const me = await db.query.users.findFirst({
              where: eq(users.id, userId),
              columns: { name: true }
            });
            const senderName = me?.name || "";
            
            const introPhrase = senderName 
              ? `Hola, soy ${senderName}. ` 
              : "Hola. ";
    
            // Normalize phone: strip spaces, dashes; if not starting with +, add +34 (Spain default)
            const rawPhone = client.phone.replace(/[\s\-()]/g, "");
            const phone = rawPhone.startsWith("+") ? rawPhone.replace("+", "") : `34${rawPhone}`;
    
            const signature = senderName 
              ? `Gracias de parte de ${senderName}.` 
              : "Gracias.";
      
            let messageBody = "";
            if (customMessage) {
              messageBody = customMessage;
            } else if (messageType === "payment_reminder") {
              const amountStr = amountDue != null ? formatCurrency(amountDue, "EUR") : "la cantidad pendiente";
              const dueDateStr = dueDate ? ` antes del ${new Date(dueDate).toLocaleDateString("es-ES")}` : "";
              const platformStr = platform ? ` de ${platform}` : "";
              messageBody = `${introPhrase}${client.name}, te recordamos que tu pago de ${amountStr}${platformStr} está pendiente${dueDateStr}. Por favor, realiza el pago lo antes posible.\n\n${signature}`;
            } else if (messageType === "credentials_update") {
              const platformStr = platform ? ` para ${platform}` : "";
              const userLine = newUsername ? `Usuario: ${newUsername}` : "";
              const passLine = newPassword ? `Contraseña: ${newPassword}` : "";
              const credLines = [userLine, passLine].filter(Boolean).join("\n");
              messageBody = `${introPhrase}${client.name}, tus credenciales de acceso${platformStr} han sido actualizadas.\n${credLines}\nPor favor, actualízalas en tu dispositivo. Contáctanos si necesitas ayuda.\n\n${signature}`;
            } else {
              messageBody = `${introPhrase}${client.name}.\n\n${signature}`;
            }
    
            // Encode for URL
            const encodedMessage = encodeURIComponent(messageBody);
            const whatsappLink = `https://wa.me/${phone}?text=${encodedMessage}`;
    
            return {
              clientName: client.name,
              phone: client.phone,
              messageType,
              messageBody,
              whatsappLink,
              instructions: "Click the link above to open WhatsApp with this message pre-filled. Review and send from your device.",
            };
          },
        }),
    
  );

  return tools;
}
