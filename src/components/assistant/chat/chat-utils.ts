import { PrimitiveCell, PythonAnalysisReadyPayload } from "./chat-types";

export function parseTextWithThinking(text: string): { type: string; content: string; isComplete?: boolean }[] {
  const parts: { type: string; content: string; isComplete?: boolean }[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Find the earliest opening tag among <think> and <tool>
    const thinkStart = remaining.indexOf('<think>');
    const toolStart = remaining.indexOf('<tool>');

    let nextTagStart = -1;
    let nextTagType: 'thinking' | 'tool' | null = null;

    if (thinkStart !== -1 && (toolStart === -1 || thinkStart <= toolStart)) {
      nextTagStart = thinkStart;
      nextTagType = 'thinking';
    } else if (toolStart !== -1) {
      nextTagStart = toolStart;
      nextTagType = 'tool';
    }

    if (nextTagStart === -1) {
      // No more tags — rest is plain text
      if (remaining.trim()) parts.push({ type: 'text', content: remaining });
      break;
    }

    // Text before the tag
    if (nextTagStart > 0) {
      const textBefore = remaining.slice(0, nextTagStart);
      if (textBefore.trim()) parts.push({ type: 'text', content: textBefore });
    }

    if (nextTagType === 'thinking') {
      const openLen = '<think>'.length;
      const closeTag = '</think>';
      const thinkEnd = remaining.indexOf(closeTag, nextTagStart);
      if (thinkEnd === -1) {
        // Unclosed — still streaming
        parts.push({ type: 'thinking', content: remaining.slice(nextTagStart + openLen), isComplete: false });
        break;
      } else {
        parts.push({ type: 'thinking', content: remaining.slice(nextTagStart + openLen, thinkEnd), isComplete: true });
        remaining = remaining.slice(thinkEnd + closeTag.length);
      }
    } else {
      // <tool> tag
      const openLen = '<tool>'.length;
      const closeTag = '</tool>';
      const toolEnd = remaining.indexOf(closeTag, nextTagStart);
      if (toolEnd === -1) {
        // Unclosed — still streaming, show as live loading phrase
        parts.push({ type: 'tool', content: remaining.slice(nextTagStart + openLen), isComplete: false });
        break;
      } else {
        parts.push({ type: 'tool', content: remaining.slice(nextTagStart + openLen, toolEnd), isComplete: true });
        remaining = remaining.slice(toolEnd + closeTag.length);
      }
    }
  }

  return parts;
}

// Recursively parse stringified JSON values for robust processing.
export function deepParseJson(val: unknown, depth = 0): unknown {
  if (depth > 6) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (typeof parsed === 'object' && parsed !== null) return deepParseJson(parsed, depth + 1);
      return parsed;
    } catch { return val; }
  }
  if (Array.isArray(val)) {
    if (val.length > 30) return val; // bail-out: treat as already-parsed
    return val.map((item) => deepParseJson(item, depth + 1));
  }
  if (typeof val === 'object' && val !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (k === 'csvData') { out[k] = v; continue; }
      out[k] = deepParseJson(v, depth + 1);
    }
    return out;
  }
  return val;
}

export function isPrimitiveCell(value: unknown): value is PrimitiveCell {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

export function findPythonAnalysisPayload(obj: unknown, depth = 0): PythonAnalysisReadyPayload | null {
  if (!obj || typeof obj !== "object" || depth > 4) return null;

  const candidate = obj as Record<string, unknown>;
  const status = candidate.status;
  const dataPayload = candidate.dataPayload;
  const pythonCode = candidate.pythonCode || candidate.code;

  if (
    (status === "requires_python_execution" || status === "python_analysis_ready") &&
    typeof pythonCode === "string"
  ) {
    const data = Array.isArray(dataPayload) ? dataPayload : [];
    
    return {
      status: "requires_python_execution",
      dataPayload: data as Array<Record<string, PrimitiveCell>>,
      pythonCode,
      message: typeof candidate.message === "string" ? candidate.message : undefined,
    };
  }

  for (const value of Object.values(candidate)) {
    const found = findPythonAnalysisPayload(value, depth + 1);
    if (found) return found;
  }

  return null;
}

export function findDownloadData(obj: any, depth = 0): any {
  if (!obj || typeof obj !== 'object' || depth > 2) return null;
  if (obj.status === "download_available" && obj.csvData) return obj;
  for (const [key, val] of Object.entries(obj)) {
    if (key === 'csvData' || Array.isArray(val)) continue; // skip arrays
    const found = findDownloadData(val, depth + 1);
    if (found) return found;
  }
  return null;
}

export function getWhatsappData(obj: any, depth = 0): any {
  if (!obj || typeof obj !== 'object' || depth > 5) return null;
  if (obj.whatsappLink) return obj;
  for (const val of Object.values(obj)) {
    const found = getWhatsappData(val, depth + 1);
    if (found) return found;
  }
  return null;
}
