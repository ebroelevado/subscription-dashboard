type DefineToolFn = (...args: any[]) => any;

import { getClientTools } from "./assistant/tools/client-tools";
import { getSubscriptionTools } from "./assistant/tools/subscription-tools";
import { getPlatformTools } from "./assistant/tools/platform-tools";
import { getFinancialTools } from "./assistant/tools/financial-tools";
import { getExportTools } from "./assistant/tools/export-tools";
import { getSystemTools } from "./assistant/tools/system-tools";

export function createUserScopedTools(
  defineTool: DefineToolFn,
  userId: string,
  allowDestructive: boolean = false
) {
  return [
    ...getClientTools(defineTool, userId, allowDestructive),
    ...getSubscriptionTools(defineTool, userId, allowDestructive),
    ...getPlatformTools(defineTool, userId, allowDestructive),
    ...getFinancialTools(defineTool, userId, allowDestructive),
    ...getExportTools(defineTool, userId, allowDestructive),
    ...getSystemTools(defineTool, userId, allowDestructive),
  ];
}
