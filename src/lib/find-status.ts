/**
 * Unified recursive search for confirmation/download status in tool output.
 * Used by both ToolInvocationBlock and hitlPending useMemo.
 */
export function findStatusInOutput(obj: any, depth = 0, maxDepth = 10): any {
  if (!obj || typeof obj !== 'object' || depth > maxDepth) return null;
  if (obj.status === "requires_confirmation") return obj;
  if (obj.status === "download_available") return obj;
  for (const [key, val] of Object.entries(obj)) {
    if (key === 'csvData') continue;
    if (Array.isArray(val)) {
      for (const item of val) {
        const found = findStatusInOutput(item, depth + 1, maxDepth);
        if (found) return found;
      }
    } else {
      const found = findStatusInOutput(val, depth + 1, maxDepth);
      if (found) return found;
    }
  }
  return null;
}
