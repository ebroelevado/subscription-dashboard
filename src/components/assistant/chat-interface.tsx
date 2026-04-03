"use client";

import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { useChat } from "@ai-sdk/react";
import { useTranslations } from "next-intl";
import type { UIMessage } from "ai";
import { SendHorizontal, Bot, Loader2, Copy, Check, Terminal, ChevronDown, ChevronUp, BrainCircuit, AlertCircle, MessageSquarePlus, Sparkles, Square, X, Undo2, Clock, Download, RefreshCcw, GitBranch } from "lucide-react";
import HistoryPanel from "@/components/assistant/history-panel";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css"; // Required for LaTeX math to render nicely
import { jsonToCsv } from "@/lib/csv-utils";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ExtendedUIMessagePart = {
  type: string;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  result?: unknown;
  output?: unknown;
  state?: string;
  toolInvocation?: { state: string; result?: unknown; args?: unknown; toolName?: string; toolCallId?: string; error?: string };
  toolCall?: { toolName: string; args?: unknown };
  input?: unknown;
};

import { findStatusInOutput } from "@/lib/find-status";

const FULL_CONTROL_WARNING_KEY = "assistant-full-control-warning-dismissed";
const STREAM_STOP_WAIT_MS = 2000;
const STALLED_STREAM_TIMEOUT_MS = 90000;
const QUEUE_POLL_MAX_ATTEMPTS = 30;
const QUEUE_POLL_DELAY_MS = 1000;
const MUTATION_TOOL_NAMES = new Set([
  "createClient", "updateClient", "deleteClients",
  "assignClientToSubscription", "removeClientsFromSubscription",
  "logPayment", "managePayments",
  "managePlatforms", "managePlans", "manageSubscriptions",
  "createSeat", "updateSeat", "pauseSeat", "resumeSeat", "cancelSeat",
]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function Spinner({ className }: { className?: string }) {
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <Loader2 className="size-full animate-spin text-primary/70" />
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = () => {
    const cleanText = text
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/<tool>[\s\S]*?<\/tool>/g, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .trim();
    navigator.clipboard.writeText(cleanText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-full"
      onClick={handleCopy}
      title="Copiar mensaje"
    >
      {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

function ReasonerBlock({ text, isThinking }: { text: string, isThinking?: boolean }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  if (!text && !isThinking) return null;

  return (
    <div className="my-2 transition-all duration-300">
      <button 
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-primary hover:text-primary/70 font-medium text-[13px] transition-colors group"
      >
        <div className="flex items-center justify-center size-5 rounded-full transition-transform group-hover:scale-110">
          {isThinking ? (
            <div className="relative size-5 shrink-0">
              <span className="absolute inset-0 rounded-full bg-gradient-to-tr from-primary/60 via-violet-500/50 to-sky-400/60 animate-spin" style={{ animationDuration: '2s' }} />
              <span className="absolute inset-[3px] rounded-full bg-background" />
              <span className="absolute inset-[5px] rounded-full bg-primary/30" />
            </div>
          ) : (
            <div className="flex items-center justify-center size-full rounded-full bg-primary/10">
              <Sparkles className="size-3" />
            </div>
          )}
        </div>
        <span>{isThinking ? t("chat.viewingData") : t("chat.viewReasoning")}</span>
        <ChevronDown className={`size-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      
      {open && (
        <div className="mt-3 ml-2.5 pl-4 border-l-2 border-primary/20 text-muted-foreground/80 text-[13px] leading-relaxed animate-in fade-in slide-in-from-top-1 duration-300">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            className="prose prose-sm dark:prose-invert prose-p:my-2"
          >
            {text}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function parseTextWithThinking(text: string): { type: string; content: string; isComplete?: boolean }[] {
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
// IMPORTANT: bail out for large arrays (e.g. csvData with hundreds of rows) to avoid
// blocking the main thread, which can strand backdrop animations mid-exit.
function deepParseJson(val: unknown, depth = 0): unknown {
  if (depth > 6) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (typeof parsed === 'object' && parsed !== null) return deepParseJson(parsed, depth + 1);
      return parsed;
    } catch { return val; }
  }
  // Skip deep recursion into large arrays — CSV csvData can have 1000s of rows.
  // Rows are plain objects already, no need to JSON.parse their string fields.
  if (Array.isArray(val)) {
    if (val.length > 30) return val; // bail-out: treat as already-parsed
    return val.map((item) => deepParseJson(item, depth + 1));
  }
  if (typeof val === 'object' && val !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      // Never recurse into csvData — it's always a plain array of row objects
      if (k === 'csvData') { out[k] = v; continue; }
      out[k] = deepParseJson(v, depth + 1);
    }
    return out;
  }
  return val;
}

// ── Rotating phrase component — cycles through an array of phrases with a
//    smooth slide-up-fade-out / slide-up-fade-in transition, like Gemini does.
function RotatingPhrase({ phrases, intervalMs = 2500 }: { phrases: string[]; intervalMs?: number }) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (phrases.length <= 1) return;
    let current = 0;
    const tick = setInterval(() => {
      // Fade out
      setVisible(false);
      setTimeout(() => {
        current = (current + 1) % phrases.length;
        setIdx(current);
        // Fade in
        setVisible(true);
      }, 280);
    }, intervalMs);
    return () => clearInterval(tick);
  }, [phrases, intervalMs]);

  return (
    <span
      style={{
        display: 'inline-block',
        transition: 'opacity 0.25s ease, transform 0.25s ease',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(-6px)',
      }}
    >
      {phrases[idx]}
    </span>
  );
}


function ToolInvocationBlock({ part, stableToolCallId, onConfirm, onUndo, executedMutations, rejectedActionIds, acceptedActionIds }: {
  part: ExtendedUIMessagePart & { toolInvocation?: { toolName?: string; state: string; result?: unknown; args?: unknown; error?: string }; errorText?: string },
  stableToolCallId?: string,
  onConfirm?: (toolName: string, args: any, accepted: boolean, toolCallId?: string) => void,
  onUndo?: (toolName: string) => void,
  executedMutations?: Map<string, { auditLogId: string; toolName: string; undone?: boolean }>,
  rejectedActionIds?: Set<string>,
  acceptedActionIds?: Set<string>
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'args' | 'output'>('output');
  const toolName = part.toolName || part.toolInvocation?.toolName || part.toolCall?.toolName || part.type.replace('tool-', '') || 'tool';
  
  const state = part.state || part.toolInvocation?.state;
  const isFinished = 
    state === 'result' || 
    state === 'error' || 
    state === 'output-available' || 
    state === 'output-error' || 
    'result' in part || 
    'output' in part || 
    'errorText' in part ||
    part.type === 'tool-result' || 
    part.type === 'tool-error' || 
    part.type === 'tool-output-available' || 
    part.type === 'tool-output-error';

  // Find the args and output
  const args = part.input || part.toolInvocation?.args || part.toolCall?.args || {};
  const hasArgs = args && Object.keys(args).length > 0;
  
  const output = part.output || part.result || part.toolInvocation?.result;
  const hasOutput = output !== undefined && output !== null;
  const errorText = part.errorText || part.toolInvocation?.error;
  const isError = !!errorText || state === 'error' || state === 'output-error' || part.type === 'tool-output-error';

  // Memoize expensive JSON parsing so it doesn't run on every parent re-render.
  // deepParseJson can be slow if output contains large metadata objects.
  const formattedArgs = useMemo(() => deepParseJson(args), [args]);
  const formattedOutput = useMemo(() => deepParseJson(output), [output]);

  // ── Loading state: tool call in-flight ──────────────────────────────────
  if (!isFinished) {
    // Pick per-tool descriptive phrases; fall back to generic thinking phrases
    const rawPhrases = (t.raw('chat.toolLoading') as Record<string, string[]> | undefined)?.[toolName];
    const fallback = t.raw('chat.thinkingPhrases') as string[];
    const phrases: string[] = Array.isArray(rawPhrases) && rawPhrases.length > 0 ? rawPhrases : fallback;

    return (
      <div className="my-3 flex items-center gap-3 animate-in fade-in slide-in-from-left-1 duration-300">
        {/* Animated gradient orb */}
        <div className="relative size-5 shrink-0">
          <span className="absolute inset-0 rounded-full bg-gradient-to-tr from-primary/60 via-violet-500/50 to-sky-400/60 animate-spin" style={{ animationDuration: '2s' }} />
          <span className="absolute inset-[3px] rounded-full bg-background" />
          <span className="absolute inset-[5px] rounded-full bg-primary/30" />
        </div>
        {/* Rotating phrase */}
        <span className="text-[12px] text-muted-foreground font-medium">
          <RotatingPhrase phrases={phrases} />
        </span>
      </div>
    );
  }

  if (isFinished) {
    return (
      <div className="my-4 flex flex-col gap-0 text-xs bg-muted/20 dark:bg-muted/5 rounded-xl border border-border/60 shadow-sm overflow-hidden w-full sm:max-w-[400px] transition-all hover:border-primary/20">
        <button 
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center justify-between p-2.5 sm:p-3 text-muted-foreground hover:bg-muted/40 transition-colors w-full text-left gap-3"
        >
          <div className="flex items-center gap-2.5 font-medium min-w-0 flex-1">
            <div className={`size-5 rounded-lg flex items-center justify-center shrink-0 border ${isError ? 'bg-red-500/10 border-red-500/20' : 'bg-green-500/10 border-green-500/20'}`}>
              {isError ? <AlertCircle className="size-3 text-red-500" /> : <Check className="size-3 text-green-500" />}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[13px] text-foreground font-semibold truncate leading-tight uppercase tracking-tight opacity-90">{toolName}</span>
              <span className="text-[10px] text-muted-foreground/60 font-normal">{t("chat.database")} • {isError ? t("chat.failed") : t("chat.ready")}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 bg-background/50 border px-2 py-1 rounded-md text-[10px] font-bold text-primary/80 uppercase shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            <span>{open ? t("chat.close") : t("chat.logs")}</span>
            {open ? <ChevronUp className="size-3 opacity-60" /> : <ChevronDown className="size-3 opacity-60" />}
          </div>
        </button>
        {open && (
          <div className="border-t border-border/40 bg-background/30 backdrop-blur-sm">
            {/* Tab buttons */}
            <div className="flex border-b border-border/20">
              <button
                type="button"
                onClick={() => setActiveTab('args')}
                className={`flex-1 py-2 px-3 text-[10px] font-bold tracking-wider uppercase transition-all ${
                  activeTab === 'args'
                    ? 'text-primary border-b-2 border-primary bg-primary/5'
                    : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted/30'
                }`}
              >
                {t("chat.parameters")} {hasArgs && <span className="ml-1 opacity-40">[]</span>}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('output')}
                className={`flex-1 py-2 px-3 text-[10px] font-bold tracking-wider uppercase transition-all ${
                  activeTab === 'output'
                    ? `border-b-2 bg-primary/5 ${isError ? 'text-red-500 border-red-500' : 'text-primary border-primary'}`
                    : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted/30'
                }`}
              >
                {t("chat.response")} {isError && <span className="ml-1 text-red-500">✕</span>}
              </button>
            </div>
            {/* Tab content */}
            <div className="p-4 overflow-x-auto">
              {activeTab === 'args' && (
                hasArgs ? (
                  <pre className="text-[11px] font-mono text-muted-foreground bg-muted/40 p-3 rounded-lg border border-border/40 overflow-x-auto whitespace-pre-wrap break-words">
                    {JSON.stringify(formattedArgs, null, 2)}
                  </pre>
                ) : (
                  <div className="text-[11px] text-muted-foreground/60 font-medium italic py-2">{t("chat.noParameters")}</div>
                )
              )}
              {activeTab === 'output' && (
                isError ? (
                  <div className="text-[11px] font-mono text-red-400 bg-red-500/5 p-3 rounded-lg border border-red-500/20 overflow-x-auto whitespace-pre-wrap break-words">
                    {errorText || t("chat.unknownError")}
                  </div>
                ) : hasOutput ? (
                  <pre className="text-[11px] font-mono text-muted-foreground/80 bg-muted/40 p-3 rounded-lg border border-border/40 overflow-x-auto whitespace-pre-wrap break-words max-h-[250px] overflow-y-auto custom-scrollbar">
                    {typeof formattedOutput === 'string' ? formattedOutput : JSON.stringify(formattedOutput, null, 2)}
                  </pre>
                ) : (
                  <div className="text-[11px] text-muted-foreground/60 font-medium italic py-2">{t("chat.noResult")}</div>
                )
              )}
            </div>
          </div>
        )}
        {(() => {
           const confirmData = isFinished && !isError ? findStatusInOutput(formattedOutput) : null;
           
           // === DOWNLOAD BLOCK (Non-blocking) ===
           // Recursively find { status: "download_available" } at any depth.
           // When found, return immediately — do NOT recurse into csvData.
           const findDownloadData = (obj: any, depth = 0): any => {
             if (!obj || typeof obj !== 'object' || depth > 2) return null;
             if (obj.status === "download_available" && obj.csvData) return obj;
             for (const [key, val] of Object.entries(obj)) {
               if (key === 'csvData' || Array.isArray(val)) continue; // skip arrays
               const found = findDownloadData(val, depth + 1);
               if (found) return found;
             }
             return null;
           };

           const downloadData = isFinished && !isError ? findDownloadData(formattedOutput) : null;
           if (downloadData) {
             return (
               <div className="px-3 pb-3 pt-1 animate-in fade-in slide-in-from-bottom-1 duration-500">
                 <div className="rounded-xl border border-primary/30 bg-primary/5 shadow-sm p-4 flex flex-col gap-3">
                   <div className="flex items-start gap-3">
                     <div className="size-8 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                       <Terminal className="size-4 text-primary" />
                     </div>
                     <div className="flex-1 min-w-0">
                       <p className="text-[11px] font-bold text-primary uppercase tracking-widest">{t("chat.ready")}</p>
                       <p className="text-sm text-foreground/90 mt-0.5 leading-snug">
                         {downloadData.message || "Report generated successfully."}
                       </p>
                     </div>
                   </div>
                   <Button
                     onClick={() => {
                        if (!downloadData.csvData) return;
                        const csvContent = jsonToCsv(downloadData.csvData);
                        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                        const link = document.createElement("a");
                        const url = URL.createObjectURL(blob);
                        link.setAttribute("href", url);
                        link.setAttribute("download", downloadData.filename || "export.csv");
                        link.style.visibility = 'hidden';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                     }}
                     className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-2.5 rounded-xl text-sm shadow-sm transition-all active:scale-[0.97]"
                   >
                     <Download className="size-4 mr-2" />
                     {t("common.download")} CSV
                   </Button>
                 </div>
               </div>
             );
           }

           // === WHATSAPP BLOCK (Non-blocking) ===
           const getWhatsappData = (obj: any, depth = 0): any => {
             if (!obj || typeof obj !== 'object' || depth > 5) return null;
             if (obj.whatsappLink) return obj;
             for (const val of Object.values(obj)) {
               const found = getWhatsappData(val, depth + 1);
               if (found) return found;
             }
             return null;
           };

           const whatsappData = isFinished && !isError ? getWhatsappData(formattedOutput) : null;
           if (whatsappData) {
             return (
               <div className="px-3 pb-3 pt-1 animate-in fade-in slide-in-from-bottom-1 duration-500">
                 <div className="rounded-xl border border-[#25D366]/30 bg-[#25D366]/5 shadow-[0_0_20px_rgba(37,211,102,0.08)] p-4 flex flex-col gap-3">
                   <div className="flex items-start gap-3">
                     <div className="size-8 rounded-xl bg-[#25D366]/15 flex items-center justify-center shrink-0">
                       <Terminal className="size-4 text-[#25D366]" />
                     </div>
                     <div className="flex-1 min-w-0">
                       <p className="text-[11px] font-bold text-[#25D366] uppercase tracking-widest">{t("chat.whatsappReady", { fallback: "WhatsApp Ready" })}</p>
                       <p className="text-sm text-foreground/90 mt-0.5 leading-snug">
                         {t("chat.whatsappDesc", { fallback: "Message generated securely. Review it before sending." })}
                       </p>
                     </div>
                   </div>

                   <div className="rounded-xl bg-muted/40 border border-border/40 p-3 text-[12px] text-muted-foreground/90 space-y-2 relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-8 h-full bg-gradient-to-l from-muted/40 to-transparent pointer-events-none" />
                      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border/50">
                        <span className="font-semibold text-foreground">{whatsappData.clientName}</span>
                        <span className="text-[10px] font-mono opacity-60">+{whatsappData.phone}</span>
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed max-h-[150px] overflow-y-auto custom-scrollbar pr-2">
                        {whatsappData.messageBody}
                      </p>
                   </div>

                   <Button
                     onClick={() => window.open(whatsappData.whatsappLink, "_blank")}
                     className="w-full bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold py-2.5 rounded-xl text-sm shadow-sm transition-all active:scale-[0.97]"
                   >
                     <Check className="size-4 mr-2" />
                     {t("chat.sendWhatsapp", { fallback: "Enviar WhatsApp" })}
                   </Button>
                 </div>
               </div>
             );
           }

            if (!confirmData) return null;

            // Use __token as the stable callId — it survives reloads unlike generated IDs
            const tokenId = confirmData?.__token as string | undefined;
            const callId = tokenId || part.toolCallId || (part.toolInvocation as any)?.toolCallId || stableToolCallId;
           
           // If we've dismissed (rejected) this action, show a collapsed view
           if (callId && rejectedActionIds?.has(callId)) {
             return (
                 <div className="px-4 pb-4 animate-in fade-in slide-in-from-bottom-1 duration-500">
                   <div className="w-full bg-red-500/10 border border-red-500/20 text-red-500 font-bold py-1.5 rounded-xl text-[10px] uppercase tracking-wider text-center">
                     ✕ {t("chat.actionRejected")}
                   </div>
                 </div>
             );
           }

           const token = confirmData?.__token as string | undefined;
           const executionResult = token ? executedMutations?.get(token) : undefined;
           const expiresAt = confirmData?.expiresAt ? new Date(confirmData.expiresAt as string) : null;
           const isExpired = !!(expiresAt && expiresAt.getTime() < Date.now() && !executionResult && !acceptedActionIds?.has(callId));

           // If this token has been executed, show the Undo button
           if (executionResult) {
             if (executionResult.undone) {
               return (
                 <div className="px-4 pb-4 animate-in fade-in slide-in-from-bottom-1 duration-500">
                   <div className="w-full bg-muted/30 text-muted-foreground font-bold py-1.5 rounded-xl text-[10px] uppercase tracking-wider text-center">
                     ✓ {t("chat.actionUndone")}
                   </div>
                 </div>
               );
             }
             return (
               <div className="px-4 pb-4 animate-in fade-in slide-in-from-bottom-1 duration-500">
                 <Button 
                   variant="secondary"
                   onClick={async () => {
                     try {
                       const res = await fetch("/api/mutations/undo", {
                         method: "POST",
                         headers: { "Content-Type": "application/json" },
                         body: JSON.stringify({ auditLogId: executionResult.auditLogId }),
                       });
                       const rawBody = await res.text();
                       let data: any = null;
                       if (rawBody) {
                         try {
                           data = JSON.parse(rawBody);
                         } catch {
                           data = null;
                         }
                       }
                       if (data?.success) {
                         // Mark as undone in local state
                         executedMutations?.set(token!, { ...executionResult, undone: true });
                         // Force a re-render by notifying the AI
                         onUndo?.(toolName);
                       } else {
                         console.error("[Undo] Error:", data?.error || rawBody || `HTTP ${res.status}`);
                       }
                     } catch (err) {
                       console.error("[Undo] Network error:", err);
                     }
                   }}
                   className="w-full bg-muted/50 hover:bg-muted text-muted-foreground font-bold py-1.5 rounded-xl text-[10px] uppercase tracking-wider transition-all active:scale-[0.95] group"
                 >
                   <Undo2 className="size-3 mr-2 group-hover:-rotate-45 transition-transform" />
                   {t("chat.undo")}
                 </Button>
               </div>
             );
           }
           
           // If accepted but not yet executed (in flight)
           if (callId && acceptedActionIds?.has(callId)) {
             return (
                 <div className="px-4 pb-4 animate-in fade-in slide-in-from-bottom-1 duration-500">
                   <div className="w-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 font-bold py-1.5 rounded-xl text-[10px] uppercase tracking-wider text-center flex items-center justify-center gap-2">
                     <Loader2 className="size-3 animate-spin" /> {t("chat.executing")}
                   </div>
                 </div>
             );
           }
           
           // Not yet executed — show Accept/Reject buttons inline (Replacing the floating panel)
           return (
             <div className="px-3 pb-3 pt-1 animate-in fade-in slide-in-from-bottom-1 duration-500">
               <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 shadow-[0_0_20px_rgba(245,158,11,0.08)] p-4 flex flex-col gap-3">
                 {/* Header */}
                 <div className="flex items-start gap-3">
                   <div className="size-8 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
                     <Terminal className="size-4 text-amber-500" />
                   </div>
                   <div className="flex-1 min-w-0">
                     <p className="text-[11px] font-bold text-amber-500 uppercase tracking-widest">{t("chat.actionRequired")}</p>
                     <p className="text-sm text-foreground/90 mt-0.5 leading-snug">
                       {confirmData.message as string || t("chat.querying")}
                     </p>
                   </div>
                 </div>

                 {/* Pending changes diff */}
                 {confirmData.pendingChanges && Object.keys(confirmData.pendingChanges).length > 0 && (
                   <div className="rounded-xl bg-muted/40 border border-border/40 px-3 py-2 font-mono text-[11px] text-muted-foreground/80 space-y-0.5 overflow-x-auto">
                     {Object.entries(confirmData.pendingChanges).map(([k, v]) => v !== undefined && (
                       <div key={k} className="flex gap-2">
                         <span className="text-primary/50">+</span>
                         <span className="text-primary/70 font-semibold">{k}:</span>
                         <span className="truncate whitespace-pre-wrap">{String(v)}</span>
                       </div>
                     ))}
                   </div>
                 )}

                 {/* Buttons or Expiry msg */}
                 <div className="grid grid-cols-2 gap-2 mt-1">
                   {isExpired ? (
                     <div className="col-span-2 w-full bg-red-500/10 border border-red-500/20 text-red-500 font-bold py-2 rounded-xl text-[10px] uppercase tracking-wider text-center flex items-center justify-center gap-2">
                       <Clock className="size-3" /> {t("chat.expired")}
                     </div>
                   ) : (
                      <>
                        <Button
                          onClick={() => {
                            const tokenId = confirmData?.__token as string | undefined;
                            const callId = tokenId || part.toolCallId || (part.toolInvocation as any)?.toolCallId || stableToolCallId;
                             onConfirm?.(toolName, { ...(confirmData.pendingChanges as Record<string, unknown> || {}), __token: confirmData?.__token }, true, callId);
                          }}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-sm shadow-sm transition-all active:scale-[0.97]"
                        >
                          <Check className="size-4 mr-2" />
                           {t("chat.accept")}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            const tokenId = confirmData?.__token as string | undefined;
                            const callId = tokenId || part.toolCallId || (part.toolInvocation as any)?.toolCallId || stableToolCallId;
                             onConfirm?.(toolName, confirmData.pendingChanges || formattedArgs, false, callId);
                          }}
                          className="flex-1 border-red-500/30 hover:bg-red-500/10 text-red-400 font-bold py-2.5 rounded-xl text-sm transition-all active:scale-[0.97]"
                        >
                          <X className="size-4 mr-2" />
                           {t("chat.reject")}
                        </Button>
                      </>
                   )}
                 </div>
               </div>
             </div>
           );
         })()}
      </div>
    );
  }

  // Still loading (Initial dispatch/queue state)
  return (
    <div className="my-4 flex items-center gap-3 animate-in fade-in slide-in-from-left-1 duration-300">
      <div className="relative size-5 shrink-0">
        <span className="absolute inset-0 rounded-full bg-gradient-to-tr from-primary/60 via-violet-500/50 to-sky-400/60 animate-spin" style={{ animationDuration: '2s' }} />
        <span className="absolute inset-[3px] rounded-full bg-background" />
        <span className="absolute inset-[5px] rounded-full bg-primary/30" />
      </div>
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-foreground font-bold tracking-tight uppercase text-[11px]">{toolName}</span>
          <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
            <span className="animate-pulse">{t("chat.querying")}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { PremiumPopup } from "@/components/saas/premium-popup";
import { useSaasStatus } from "@/hooks/use-saas-status";

export function ChatInterface() {
  const t = useTranslations();

  // AI Model Selection — 3 static modes routed through Cloudflare AI Gateway
  const AI_MODELS = [
    { id: "ultra-fast", name: "⚡ Ultra Fast", description: "Cerebras" },
    { id: "fast",       name: "🚀 Fast",       description: "Groq" },
    { id: "default",   name: "🧠 Default",    description: "Workers AI" },
  ];
  const [selectedModel, setSelectedModel] = useState<string>("ultra-fast");

  const { data: saasStatus, isLoading: saasLoading } = useSaasStatus();
  const isPremium = saasStatus?.plan === "PREMIUM";
  
  // ── Conversation History ──
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationCreatedAt, setConversationCreatedAt] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const savingRef = useRef(false);

  const handleNewChat = () => {
    setMessages([]);
    stop();
    setExecutedMutations(new Map());
    setRejectedActionIds(new Set());
    setAcceptedActionIds(new Set());
    setConversationId(null);
    setConversationCreatedAt(null);
  };


  const [input, setInput] = useState("");
  const [allowDestructive, setAllowDestructive] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Vercel AI SDK — useChat
  const { messages, sendMessage, status, setMessages, stop, error: chatError, regenerate } = useChat({
    onError: (err) => {
      console.error("AI SDK Chat Error:", err);
    },
    onFinish: (options) => {
      if (options.isAbort) {
        console.warn("[Chat] Stream was aborted");
      }
      if (options.isDisconnect) {
        console.warn("[Chat] Stream disconnected unexpectedly");
      }
      if (options.isError) {
        console.error("[Chat] Stream finished with error");
      }
    },
  });
  const statusRef = useRef(status);
  const activePollControllerRef = useRef<AbortController | null>(null);
  const confirmingTokensRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    return () => {
      activePollControllerRef.current?.abort();
      activePollControllerRef.current = null;
    };
  }, []);

  const isPremiumRequired = chatError?.message?.includes("PREMIUM_REQUIRED") || (chatError as any)?.data?.code === "PREMIUM_REQUIRED";

  const waitForStreamToStop = useCallback(async () => {
    if (statusRef.current !== "streaming" && statusRef.current !== "submitted") {
      return;
    }

    stop();
    const deadline = Date.now() + STREAM_STOP_WAIT_MS;
    while ((statusRef.current === "streaming" || statusRef.current === "submitted") && Date.now() < deadline) {
      await sleep(25);
    }
  }, [stop]);

  const clearAcceptedAction = useCallback((callId?: string | null) => {
    if (!callId) return;
    setAcceptedActionIds((prev) => {
      const next = new Set(prev);
      next.delete(callId);
      return next;
    });
  }, []);

  const waitForMutationExecuted = useCallback(async (token: string, signal?: AbortSignal) => {
    for (let attempt = 0; attempt < QUEUE_POLL_MAX_ATTEMPTS; attempt++) {
      if (signal?.aborted) {
        throw new Error("Execution status polling was cancelled.");
      }

      await sleep(QUEUE_POLL_DELAY_MS);

      let statusRes: Response;
      try {
        statusRes = await fetch("/api/mutations/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          signal,
        });
      } catch (statusError) {
        if ((statusError as any)?.name === "AbortError") {
          throw new Error("Execution status polling was cancelled.");
        }
        if (attempt === QUEUE_POLL_MAX_ATTEMPTS - 1) {
          throw new Error("Unable to check mutation status. Please retry.");
        }
        continue;
      }

      let statusData: any = null;
      try {
        statusData = await statusRes.json();
      } catch {
        if (attempt === QUEUE_POLL_MAX_ATTEMPTS - 1) {
          throw new Error("Unable to parse mutation status response.");
        }
        continue;
      }

      if (!statusRes.ok) {
        const statusErrorMessage = statusData?.error || `Status check failed (HTTP ${statusRes.status}).`;
        if (statusRes.status === 401 || statusRes.status === 403 || statusRes.status === 404) {
          throw new Error(statusErrorMessage);
        }
        if (statusData?.status === "expired") {
          throw new Error(statusData?.error || "Token has expired. Propose the change again.");
        }
        if (attempt === QUEUE_POLL_MAX_ATTEMPTS - 1) {
          throw new Error(statusErrorMessage);
        }
        continue;
      }

      if (statusData?.status === "executed") {
        if (!statusData?.auditLogId || typeof statusData.auditLogId !== "string") {
          throw new Error("Mutation was executed but audit log details are invalid.");
        }
        return { auditLogId: statusData.auditLogId as string };
      }

      if (statusData?.status === "expired" || statusData?.status === "invalid" || statusData?.status === "forbidden") {
        throw new Error(statusData?.error || "Token has expired. Propose the change again.");
      }

      if (statusData?.status === "failed_permanent") {
        throw new Error(statusData?.error || "Mutation failed permanently.");
      }
    }

    throw new Error("Queued execution is taking too long. Please retry in a few seconds.");
  }, []);

  // HITL (Human-in-the-Loop) state — moved before auto-save hook to avoid ordering issues
  type HitlPending = {
    toolName: string;
    toolCallId: string;
    message: string;
    pendingChanges: Record<string, unknown> | null;
    __token?: string;
  };
  // Track executed mutations: token → { auditLogId, toolName, undone? }
  const [executedMutations, setExecutedMutations] = useState<Map<string, { auditLogId: string; toolName: string; undone?: boolean }>>(new Map());
  const [rejectedActionIds, setRejectedActionIds] = useState<Set<string>>(new Set());
  const [acceptedActionIds, setAcceptedActionIds] = useState<Set<string>>(new Set());

  // Auto-save: save conversation to R2 after each AI response completes
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const wasActive = prevStatusRef.current === "streaming" || prevStatusRef.current === "submitted";
    const nowReady = status === "ready";
    prevStatusRef.current = status;

    if (!wasActive || !nowReady || messages.length === 0 || savingRef.current) return;

    savingRef.current = true;
    const id = conversationId || crypto.randomUUID();
    if (!conversationId) {
      setConversationId(id);
      setConversationCreatedAt(new Date().toISOString());
    }

    // Generate title from first user message
    const firstUserMsg = messages.find((m) => m.role === "user");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const titleRaw = (firstUserMsg?.parts?.find((p: any) => p.type === "text") as any)?.text
      || (firstUserMsg as any)?.content || "Untitled";
    const title = titleRaw.slice(0, 60) + (titleRaw.length > 60 ? "..." : "");

    fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        title,
        messages,
        createdAt: conversationCreatedAt || new Date().toISOString(),
        executedMutations: Array.from(executedMutations.entries()),
        acceptedActionIds: Array.from(acceptedActionIds),
        rejectedActionIds: Array.from(rejectedActionIds),
        hitlPending: hitlPending ? {
          toolName: hitlPending.toolName,
          toolCallId: hitlPending.toolCallId,
          __token: hitlPending.__token,
        } : null,
      }),
    })
      .catch((err) => console.error("[AutoSave] Failed:", err))
      .finally(() => { savingRef.current = false; });
  }, [status, messages, conversationId, conversationCreatedAt, executedMutations]);

  // Load a conversation from history
  const handleLoadConversation = async (loadId: string) => {
    try {
      const res = await fetch(`/api/history/${loadId}`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages || []);
      setConversationId(data.id);
      setConversationCreatedAt(data.createdAt);

      // Restore mutation execution state so confirmed actions show "IR ATRÁS" not "Aceptar"
      if (data.executedMutations && Array.isArray(data.executedMutations)) {
        setExecutedMutations(new Map(data.executedMutations));
      } else {
        setExecutedMutations(new Map());
      }
      // Restore accepted/rejected action states to prevent showing already-handled confirmations
      if (data.acceptedActionIds && Array.isArray(data.acceptedActionIds)) {
        setAcceptedActionIds(new Set(data.acceptedActionIds));
      } else {
        setAcceptedActionIds(new Set());
      }
      if (data.rejectedActionIds && Array.isArray(data.rejectedActionIds)) {
        setRejectedActionIds(new Set(data.rejectedActionIds));
      } else {
        setRejectedActionIds(new Set());
      }
    } catch (err) {
      console.error("[History] Failed to load conversation:", err);
    }
  };


  const findConfirmation = useCallback((rawObj: unknown): Record<string, unknown> | null => {
    const obj = deepParseJson(rawObj);
    const result = findStatusInOutput(obj);
    if (result?.status === "download_available") return null;
    return result;
  }, []);
  // 🪝 HITL HOOK: Deterministically compute pending active confirmations
  const hitlPending = useMemo(() => {
    // We no longer block on `status === "streaming"` or `"submitted"`.
    // The user explicitly requested the UI to lock IMMEDIATELY as soon as the tool result
    // arrives in the array, even if the AI is still streaming its text explanation afterwards.
    if (messages.length === 0) return null;

    // Iterate backwards through messages until we hit a user message
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "user") break; // Stop looking past the latest user prompt

      if (msg.role === "assistant") {
        const parts = (msg.parts ?? []) as ExtendedUIMessagePart[];
        // Scan parts backwards to get the latest tool call in the message block
        for (let j = parts.length - 1; j >= 0; j--) {
          const part = parts[j];
          const candidates = [
            (part as any).output,
            (part as any).result,
            (part as any).toolInvocation?.result,
            (part as any).toolInvocation?.output,
          ].filter(Boolean);

          for (const candidate of candidates) {
            const res = findConfirmation(candidate);
            if (!res) continue;

            // Use __token as the stable callId — it survives reloads
            const tokenId = res.__token as string | undefined;
            const toolCallId = tokenId ?? (part as any).toolCallId ?? (part as any).toolInvocation?.toolCallId ?? `msg-${i}-part-${j}`;

            // Optimistically hide if the user just clicked Aceptar/Rechazar 
            if (rejectedActionIds.has(toolCallId) || acceptedActionIds.has(toolCallId)) continue;

            // Hide if it's already executed successfully on the backend
            const token = res.__token as string | undefined;
            const isExecuted = token ? executedMutations.has(token) : false;
            
            if (isExecuted) continue;

            const toolName =
              (part as any).toolName ??
              (part as any).toolInvocation?.toolName ??
              (part as any).toolCall?.toolName ??
              "tool";

            return {
              toolName,
              toolCallId,
              message: (res.message as string) ?? `Confirm ${toolName}`,
              pendingChanges: (res.pendingChanges as Record<string, unknown>) ?? null,
              __token: token,
            };
          }
        }
      }
    }
    return null;
  }, [messages, executedMutations, findConfirmation, rejectedActionIds, acceptedActionIds]);

  // ── Stop AI stream immediately when a confirmation appears ──
  // This prevents the AI from executing additional tools while waiting for user confirmation.
  useEffect(() => {
    if (hitlPending && (status === "streaming" || status === "submitted")) {
      stop();
    }
  }, [hitlPending, status, stop]);

  // ── Step Indicator: count mutation tool calls in the current conversation ──
  const currentStep = useMemo(() => {
    let count = 0;
    for (const msg of messages) {
      const parts = (msg.parts ?? []) as ExtendedUIMessagePart[];
      for (const part of parts) {
        if (part.type === "tool-invocation" && MUTATION_TOOL_NAMES.has(part.toolName || "")) {
          count++;
        }
      }
    }
    return count;
  }, [messages]);

  // Parsing markdown/thinking tags for every text part is expensive and was
  // being recomputed on every render (including input typing). Cache per
  // message-part and recompute only when `messages` changes.
  const parsedTextParts = useMemo(() => {
    const parsed = new Map<string, { type: string; content: string; isComplete?: boolean }[]>();
    messages.forEach((msg, messageIndex) => {
      const parts = (msg.parts ?? []) as ExtendedUIMessagePart[];
      parts.forEach((part, partIndex) => {
        if (part.type !== "text") return;
        const rawText = typeof part.text === "string" ? part.text : String(part.text ?? "");
        parsed.set(`${messageIndex}-${partIndex}`, parseTextWithThinking(rawText));
      });
    });
    return parsed;
  }, [messages]);


  const [showScrollBottom, setShowScrollBottom] = useState(false);

  // Auto-resize textarea
  const adjustTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const maxH = 120;
    const newH = Math.min(ta.scrollHeight, maxH);
    ta.style.height = `${newH}px`;
    // Only allow scroll when content exceeds max height
    ta.style.overflowY = ta.scrollHeight > maxH ? "auto" : "hidden";
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    adjustTextarea();
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || !sendMessage) return;

    // SaaS Usage Tracking: Increment points (ultra-fast costs 0.2, fast 0.3, default 0.5)
    const cost = selectedModel === "ultra-fast" ? 0.2 : selectedModel === "fast" ? 0.3 : 0.5;
    fetch("/api/user/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ increment: cost })
    }).catch(err => console.error("Failed to update usage:", err));

    sendMessage(
      { text: input },
      { body: { model: selectedModel || undefined, allowDestructive } }
    );
    setInput("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const appendLocalAssistantNote = useCallback((text: string) => {
    setMessages((prev) => {
      const note = {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "text", text }],
      } as unknown as UIMessage;
      return [...prev, note];
    });
  }, [setMessages]);

  const notifyAgentMutationOutcome = useCallback(async (toolName: string, auditLogId: string) => {
    if (!sendMessage) return;

    const sendNotification = async (retries = 3, delay = 1000): Promise<boolean> => {
      try {
        sendMessage(
          { text: `${t("chat.accept")} <!-- [SYSTEM] Mutation ${toolName} executed successfully. AuditLogId: ${auditLogId}. Continue with the next required step if any. -->` },
          { body: { model: selectedModel || undefined, allowDestructive } }
        );
        return true;
      } catch (err) {
        console.error(`[NotifyAgent] Failed (attempt ${4 - retries}/3):`, err);
        if (retries > 0) {
          await sleep(delay);
          return sendNotification(retries - 1, delay * 2);
        }
        return false;
      }
    };

    const success = await sendNotification();
    if (!success) {
      appendLocalAssistantNote(
        `⚠️ La mutación se ejecutó correctamente pero no pude continuar automáticamente. ` +
        `Escribe "continúa" para reanudar.`
      );
    }
  }, [sendMessage, t, selectedModel, allowDestructive, appendLocalAssistantNote]);

  const handleUndoTool = async (toolName: string) => {
    // Stop active stream before injecting the local confirmation message.
    await waitForStreamToStop();
    appendLocalAssistantNote(`${t("chat.undo")} ✅ ${toolName}`);
  };

  const handleConfirmTool = async (toolName: string, args: any, accepted: boolean, toolCallId?: string) => {
    await waitForStreamToStop();
    
    const targetCallId = toolCallId || (hitlPending && hitlPending.toolName === toolName ? hitlPending.toolCallId : null);
    
    if (!accepted) {
      if (targetCallId) setRejectedActionIds(prev => new Set(prev).add(targetCallId));
      appendLocalAssistantNote(`${t("chat.reject")} ❌ ${toolName}`);
      return;
    } else {
      if (targetCallId) setAcceptedActionIds(prev => new Set(prev).add(targetCallId));
    }

    // Extract the crypto token from the tool output
    const token = args?.__token || hitlPending?.__token;
    if (!token) {
      clearAcceptedAction(targetCallId);
      appendLocalAssistantNote(`${t("chat.accept")} ⚠️ ${toolName}: token no disponible para ejecutar.`);
      return;
    }

    if (confirmingTokensRef.current.has(token)) {
      return;
    }
    confirmingTokensRef.current.add(token);

    // === DIRECT BACKEND EXECUTION — bypasses AI entirely ===
    let pollController: AbortController | null = null;
    try {
      const res = await fetch("/api/mutations/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      let rawBody = "";
      let data: any = null;
      try {
        rawBody = await res.text();
        if (rawBody) {
          try {
            data = JSON.parse(rawBody);
          } catch {
            data = null;
          }
        }
      } catch (decodeError) {
        // Some proxy paths can return HTTP 200 but fail body decoding.
        // Verify execution via status endpoint before surfacing an error.
        if (res.ok) {
          const executed = await waitForMutationExecuted(token);
          setExecutedMutations(prev => {
            const next = new Map(prev);
            next.set(token, { auditLogId: executed.auditLogId, toolName });
            return next;
          });
          clearAcceptedAction(targetCallId);
          appendLocalAssistantNote(`${t("chat.accept")} ✅ ${toolName}`);
          return;
        }
        throw decodeError;
      }

      if (!res.ok) {
        throw new Error(data?.error || rawBody || `HTTP ${res.status}`);
      }

      if (data?.queued) {
        pollController = new AbortController();
        activePollControllerRef.current?.abort();
        activePollControllerRef.current = pollController;
        const executed = await waitForMutationExecuted(token, pollController.signal);

        setExecutedMutations(prev => {
          const next = new Map(prev);
          next.set(token, { auditLogId: executed.auditLogId, toolName });
          return next;
        });
        clearAcceptedAction(targetCallId);
        appendLocalAssistantNote(`${t("chat.accept")} ✅ ${toolName} (${t("chat.executing")}: queue OK)`);
        notifyAgentMutationOutcome(toolName, executed.auditLogId);
        return;
      }

      if (data?.success) {
        // Track this token as executed so the ToolInvocationBlock can show Undo
        setExecutedMutations(prev => {
          const next = new Map(prev);
          next.set(token, { auditLogId: data.auditLogId, toolName });
          return next;
        });
        clearAcceptedAction(targetCallId);
        appendLocalAssistantNote(`${t("chat.accept")} ✅ ${toolName}`);
        notifyAgentMutationOutcome(toolName, data.auditLogId);
      } else {
        throw new Error(data?.error || rawBody || "Invalid empty response from mutation execute endpoint");
      }
    } catch (err) {
      console.error("[Execute] Network error:", err);
      clearAcceptedAction(targetCallId);
      const message = err instanceof Error ? err.message : "Unknown network error";
      appendLocalAssistantNote(`${t("chat.accept")} ❌ ${toolName}: ${message}`);
    } finally {
      confirmingTokensRef.current.delete(token);
      if (pollController && activePollControllerRef.current === pollController) {
        activePollControllerRef.current = null;
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const atBottom = scrollHeight - scrollTop <= clientHeight + 100;
      setShowScrollBottom(!atBottom && messages.length > 0);
    }
  };

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const isLoading = (status === "submitted" || status === "streaming") && !chatError;

  // Recover automatically when a streaming request gets stuck and blocks the input.
  useEffect(() => {
    if (status !== "submitted" && status !== "streaming") return;

    const timeoutId = setTimeout(() => {
      if (statusRef.current === "submitted" || statusRef.current === "streaming") {
        console.warn("[Chat] Stream watchdog triggered. Stopping stalled request.");
        stop();

        // After a brief delay, try to regenerate the last response
        setTimeout(() => {
          if (statusRef.current === "ready" && messages.length > 0) {
            const hasAssistantMessage = messages.some(m => m.role === "assistant");
            if (hasAssistantMessage) {
              console.log("[Chat] Attempting auto-recovery via regenerate...");
              regenerate();
            } else {
              console.warn("[Chat] No assistant message to regenerate from.");
            }
          }
        }, 1500);
      }
    }, STALLED_STREAM_TIMEOUT_MS);

    return () => clearTimeout(timeoutId);
  }, [status, messages, stop, regenerate]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  if (saasLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isPremium === false) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-4 relative overflow-hidden bg-background/50">
        <div className="absolute inset-0 z-0 opacity-20 pointer-events-none filter blur-[8px] flex flex-col pt-20 px-10 gap-8">
          <div className="h-12 w-2/3 bg-muted rounded-xl animate-pulse" />
          <div className="h-32 w-full bg-muted rounded-2xl animate-pulse" />
          <div className="h-12 w-1/2 bg-muted rounded-xl self-end animate-pulse" />
          <div className="h-24 w-4/5 bg-muted rounded-2xl animate-pulse" />
        </div>

        <div className="relative z-10 w-full max-w-md animate-fade-in">
          <Card className="border-border/60 shadow-2xl overflow-hidden backdrop-blur-md bg-background/80 outline outline-1 outline-gold-gradient/20">
            <CardHeader className="text-center pb-2">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-gold-gradient flex items-center justify-center mb-4 shadow-lg animate-sparkle">
                <BrainCircuit className="size-8 text-black" />
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight">
                {t("nav.assistant") || "AI Assistant"}
              </CardTitle>
              <CardDescription className="text-base mt-2">
                {t("saas.features.aiAssistant.description") || "Unlock the full power of our AI to automate your business management."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-4">
              <div className="space-y-3">
                {[
                  "Intelligent automated responses",
                  "Deep business analytics insights",
                  "Automated platform management",
                  "Priority support & higher limits"
                ].map((feature) => (
                  <div key={feature} className="flex items-center gap-3 text-sm font-medium">
                    <div className="size-5 rounded-full bg-gold-gradient flex items-center justify-center shrink-0">
                      <Check className="size-3 text-black" />
                    </div>
                    <span>{feature}</span>
                  </div>
                ))}
              </div>

              <PremiumPopup>
                <Button className="w-full h-12 bg-gold-gradient hover:opacity-90 text-black font-bold text-base border-none shadow-lg transition-all active:scale-[0.98]">
                  <Sparkles className="size-5 mr-2" />
                  {t("saas.upgradeNow") || "Upgrade to Premium"}
                </Button>
              </PremiumPopup>
            </CardContent>
            <CardFooter className="bg-muted/30 border-t py-3 justify-center">
              <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-widest text-gold-gradient">
                ★ {t("saas.cancelAnytime") || "Premium Exclusive Feature"} ★
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }




  // Determine if we should show the bottom generic analyzing orb
  // We show it if we are loading and waiting for the first assistant token,
  // OR if the assistant is streaming but currently visually "silent" (e.g. between tools).
  let showBottomOrb = isLoading && messages[messages.length - 1]?.role === "user";
  
  if (status === 'streaming' && messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === 'assistant') {
      let isVisiblyActive = false;
      if (lastMsg.parts && lastMsg.parts.length > 0) {
        const lastPart = lastMsg.parts[lastMsg.parts.length - 1];
        if (lastPart.type === 'tool-invocation' || lastPart.type?.startsWith('tool-')) {
          const tState = (lastPart as any).toolInvocation?.state || (lastPart as any).state;
          if (tState !== 'result' && tState !== 'error') isVisiblyActive = true;
        } else if (lastPart.type === 'text') {
          const rawText = typeof lastPart.text === "string" ? lastPart.text : String(lastPart.text ?? "");
          const parsed = parseTextWithThinking(rawText);
          const lastP = parsed[parsed.length - 1];
          if (lastP) {
            if (lastP.type === 'thinking' && !lastP.isComplete) isVisiblyActive = true;
            if (lastP.type === 'tool') isVisiblyActive = true; // Still streaming the tool tag, no tool block after it yet
          }
        }
      }
      if (!isVisiblyActive) {
        showBottomOrb = true;
      }
    }
  }

  const chatContent = (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* ── Header ── simplified (No border) */}
      <div className="flex items-center justify-between px-4 sm:px-6 h-14 shrink-0 bg-background/50 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center size-8 rounded-full bg-primary/10 text-primary shrink-0">
            <Bot className="size-4.5" />
          </div>
          <div className="min-w-0 flex items-center gap-2">
            <h2 className="text-sm sm:text-base font-bold tracking-tight truncate">Pearfect AI</h2>
            <span className="bg-primary/10 text-primary text-[10px] font-black px-2 py-0.5 rounded-full border border-primary/20">
              {t("chat.premiumBadge")}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* History Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setHistoryOpen(true)}
            className="text-muted-foreground hover:text-foreground size-8 sm:size-9 shrink-0"
            title={t("nav.history")}
          >
            <Clock className="size-4" />
          </Button>
          {/* New Chat Button */}
          {messages.length > 0 && (
            <Button 
              variant="ghost" 
              size="icon"
              onClick={handleNewChat}
              className="text-muted-foreground hover:text-foreground size-8 sm:size-9 shrink-0"
              disabled={isLoading}
              title={t("common.newChat")}
            >
              <MessageSquarePlus className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* ── Chat Area ── */}
      <div 
        ref={scrollRef} 
        onScroll={handleScroll}
        className="flex-1 px-3 sm:px-6 py-4 sm:py-6 overflow-y-auto overscroll-contain w-full scroll-smooth"
      >
        <div className="flex flex-col gap-6 sm:gap-8 max-w-4xl mx-auto pb-4 pt-4 sm:pt-8 text-foreground/95">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center flex-1 min-h-[50vh] space-y-6">
              <div className="size-16 sm:size-20 rounded-3xl bg-primary/10 flex items-center justify-center animate-in zoom-in-50 duration-500">
                <Bot className="size-8 sm:size-10 text-primary" />
              </div>
              <div className="space-y-2 px-6">
                <h3 className="text-xl sm:text-2xl font-bold tracking-tight bg-gradient-to-br from-foreground to-foreground/60 bg-clip-text text-transparent">{t("chat.emptyTitle")}</h3>
                <p className="text-sm sm:text-base text-muted-foreground max-w-sm mx-auto leading-relaxed">
                  {t("chat.emptyDescription")}
                </p>
              </div>
            </div>
          ) : (
            <>
            {messages.map((m: UIMessage, index: number) => (
              <div
                key={`${m.id}-${index}`}
                className={`flex gap-3 sm:gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300 ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {/* Message Content Container */}
                <div
                  className={`flex flex-col gap-1 min-w-0 ${
                    m.role === "user" 
                      ? "items-end max-w-[90%] sm:max-w-[75%]" 
                      : "items-start w-full sm:max-w-none"
                  }`}
                >
                  <div
                    className={`rounded-2xl relative transition-all duration-300 ${
                      m.role === "user"
                        ? "px-4 py-2 bg-muted/40 dark:bg-muted/15 border border-border/30 w-fit text-foreground"
                        : "w-full py-1 text-foreground/90"
                    }`}
                  >
                    {m.parts && m.parts.length > 0 && m.parts.map((part: ExtendedUIMessagePart, i: number) => {
                      if (part.type === 'text') {
                        const parsed = parsedTextParts.get(`${index}-${i}`) || [];
                        return parsed.map((p: { type: string; content: string; isComplete?: boolean }, j: number) => {
                          if (p.type === "thinking") {
                            return <ReasonerBlock key={`${i}-${j}`} text={p.content.trim()} isThinking={!p.isComplete} />;
                          }
                          if (p.type === "tool") {
                            // <tool> stream annotation — immediately visible loading orb.
                            // isComplete=false → tag still open in stream (rare, fast LLMs skip this)
                            // isComplete=true  → tag closed but tool call may not have dispatched yet.
                            //
                            // FIX: The AI emits the COMPLETE <tool>text</tool> in one stream batch
                            // so the first React render sees isComplete=true.
                            // We should keep it visible ONLY until the actual tool call part
                            // arrives in the message AFTER this text part. Once a tool block is in
                            // m.parts after this text block (index > i), we hide this text annotation.
                            const hasToolCallAfterThis = m.parts.slice(i + 1).some(p => p.type === 'tool-invocation' || p.type.startsWith('tool-'));
                            const isActiveMessage = index === messages.length - 1 && (status === 'streaming' || status === 'submitted');
                            
                            // If the tag is closed AND we already have a tool call part after it,
                            // or it's not the active message anymore, hide it.
                            if (p.isComplete && (!isActiveMessage || hasToolCallAfterThis)) return null;
                            const thinkingPhrases = t.raw('chat.thinkingPhrases') as string[] | undefined;
                            const toolLabel = p.content.trim() || (Array.isArray(thinkingPhrases) && thinkingPhrases.length > 0 ? thinkingPhrases[0] : t("chat.querying"));
                            return (
                              <div key={`${i}-${j}`} className="my-3 flex items-center gap-3 animate-in fade-in slide-in-from-left-1 duration-300">
                                <div className="relative size-5 shrink-0">
                                  <span className="absolute inset-0 rounded-full bg-gradient-to-tr from-primary/60 via-violet-500/50 to-sky-400/60 animate-spin" style={{ animationDuration: '2s' }} />
                                  <span className="absolute inset-[3px] rounded-full bg-background" />
                                  <span className="absolute inset-[5px] rounded-full bg-primary/30" />
                                </div>
                                <span className="text-[12px] text-muted-foreground font-medium">{toolLabel}</span>
                              </div>
                            );
                          }

                          return (
                            <div key={`${i}-${j}`} className="prose prose-sm sm:prose-base dark:prose-invert max-w-none break-words leading-relaxed last:mb-0 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_code]:bg-muted/40 [&_code]:p-1 [&_code]:rounded-md [&_p]:mb-4 last:[&_p]:mb-0">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm, remarkMath]}
                                rehypePlugins={[rehypeKatex]}
                                components={{
                                  table: ({node: _node, ...props}) => {
                                    void _node;
                                    return (
                                      <div className="my-8 w-full overflow-x-auto rounded-3xl border border-border/40 bg-muted/5 shadow-2xl dark:shadow-none backdrop-blur-[1px] custom-scrollbar">
                                        <table className="w-full text-sm sm:text-[15px] text-left border-collapse min-w-[600px] sm:min-w-full" {...props} />
                                      </div>
                                    );
                                  },
                                  thead: ({node: _node, ...props}) => {
                                    void _node;
                                    return <thead className="border-b bg-muted/40 font-bold" {...props} />;
                                  },
                                  tbody: ({node: _node, ...props}) => {
                                    void _node;
                                    return <tbody className="divide-y divide-border/20" {...props} />;
                                  },
                                  tr: ({node: _node, ...props}) => {
                                    void _node;
                                    return <tr className="transition-all hover:bg-primary/[0.015] group/row" {...props} />;
                                  },
                                  th: ({node: _node, ...props}) => {
                                    void _node;
                                    return <th className="h-14 px-6 py-4 align-middle font-bold text-muted-foreground active:text-foreground text-[11px] uppercase tracking-widest bg-muted/10" {...props} />;
                                  },
                                  td: ({node: _node, ...props}) => {
                                    void _node;
                                    return <td className="px-6 py-5 align-middle leading-snug whitespace-normal sm:whitespace-nowrap" {...props} />;
                                  },
                                }}
                              >
                                {p.content.replace(/<!--[\s\S]*?-->/g, "").trim() || "\u200B"}
                              </ReactMarkdown>
                            </div>
                          );
                        });
                      }
                      
                      if (part.type === 'tool-invocation' || part.type?.startsWith('tool-') || part.type === 'dynamic-tool' || part.type === 'tool-call') {
                        return <ToolInvocationBlock key={i} part={part} stableToolCallId={`msg-${index}-part-${i}`} onConfirm={handleConfirmTool} onUndo={handleUndoTool} executedMutations={executedMutations} rejectedActionIds={rejectedActionIds} acceptedActionIds={acceptedActionIds} />;
                      }
                      return null;
                    })}
                  </div>
                  
                  {/* Action Bar — only show if not currently loading/streaming this message */}
                  {m.role !== "user" && (status !== "streaming" || messages.indexOf(m) < messages.length - 1) && (
                    <div className="flex items-center gap-1 mt-2 px-1.5 opacity-40 hover:opacity-100 transition-opacity">
                      <CopyButton 
                        text={m.parts?.map((p, partIndex) => {
                          if (p.type !== 'text') return "";
                          const parsed = parsedTextParts.get(`${index}-${partIndex}`) || [];
                          return parsed.filter(t => t.type === 'text').map(t => t.content).join("").trim();
                        }).filter(Boolean).join("\n") || ""} 
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
            </>
          )}
          
          {showBottomOrb && (
            <div className="flex animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center gap-3 bg-muted/5 rounded-2xl px-4 py-2.5 border border-border/20">
                {/* Animated gradient orb — same as tool loader */}
                <div className="relative size-4 shrink-0">
                  <span className="absolute inset-0 rounded-full bg-gradient-to-tr from-primary/60 via-violet-500/50 to-sky-400/60 animate-spin" style={{ animationDuration: '2s' }} />
                  <span className="absolute inset-[2px] rounded-full bg-background" />
                  <span className="absolute inset-[4px] rounded-full bg-primary/30" />
                </div>
                <span className="text-[12px] text-muted-foreground font-medium">
                  <RotatingPhrase phrases={t.raw('chat.thinkingPhrases') as string[]} />
                </span>
              </div>
            </div>
          )}


        {/* AI Error Alert Display */}
        {chatError && !isPremiumRequired && (
          <div className="flex animate-in fade-in slide-in-from-bottom-2 duration-300 my-4 px-4 sm:px-6">
            <div className="w-full flex items-start gap-3 bg-red-500/10 rounded-2xl px-4 py-3 border border-red-500/20 text-red-500">
              <AlertCircle className="size-5 shrink-0 mt-0.5" />
              <div className="flex flex-col">
                <span className="font-bold text-sm tracking-tight">{t("chat.errorTitle") || "Error de conexión"}</span>
                <span className="text-sm opacity-90 leading-snug">
                  {chatError.message.includes("quota") || chatError.message.includes("429") || chatError.message.includes("Too Many Requests")
                    ? "El proveedor de Inteligencia Artificial seleccionado ha alcazando el límite de peticiones permitidas por minuto (429 Rate Limit). Por favor, cambia a un modelo distinto o inténtalo de nuevo en unos momentos."
                    : chatError.message || "La Inteligencia Artificial ha encontrado un problema al procesar tu solicitud."}
                </span>
                <button 
                  onClick={() => stop()} 
                  className="text-xs font-semibold bg-red-500/10 hover:bg-red-500/20 px-3 py-1.5 rounded-lg w-fit mt-2 transition-colors border border-red-500/20 flex items-center gap-2"
                >
                  <RefreshCcw className="size-3" />
                  {t("chat.retry") || "Detener ejecución e intentar de nuevo"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} className="h-4" />
        </div>

        {/* Premium Required Overlay */}
        {isPremiumRequired && (
          <div className="absolute inset-x-0 bottom-0 z-30 p-4 sm:p-20 flex items-center justify-center bg-background/40 backdrop-blur-[2px]">
            <div className="bg-background border-2 border-primary/30 rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl animate-in fade-in zoom-in-95 duration-500">
              <div className="size-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
                <Sparkles className="size-8 text-primary animate-pulse" />
              </div>
              <h3 className="text-xl font-bold tracking-tight mb-2">{t("chat.premiumRequiredTitle")}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-8">
                {t("chat.premiumRequiredDesc")}
              </p>
              <PremiumPopup>
                <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-6 rounded-2xl text-lg shadow-lg transition-all active:scale-95">
                  <BrainCircuit className="size-5 mr-3" />
                  {t("chat.upgradeNow")}
                </Button>
              </PremiumPopup>
            </div>
          </div>
        )}
      </div>

      {/* ── Input Area ── sticky bottom dock (No border/footer) */}
      <div className="shrink-0 px-4 pt-2 pb-6 sm:pb-8 bg-background relative z-20 flex justify-center w-full">
        <div className="w-full max-w-4xl group relative">
          {/* Step Indicator */}
          {currentStep > 0 && (
            <div className="flex items-center justify-center mb-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-[11px] font-bold text-primary">
                <GitBranch className="size-3" />
                Paso {currentStep}
              </div>
            </div>
          )}
          {/* Scroll to Bottom Button — repositioned above dock */}
          {showScrollBottom && (
            <Button
              size="icon"
              variant="secondary"
              className="absolute -top-12 right-0 rounded-full shadow-lg z-30 size-9 bg-background/80 backdrop-blur-md border border-border/40 hover:bg-background transition-all hover:-translate-y-0.5"
              onClick={scrollToBottom}
            >
              <ChevronDown className="size-4.5" />
            </Button>
          )}
          <form
            onSubmit={handleSubmit}
            className="relative flex flex-col bg-muted/20 dark:bg-muted/10 border border-muted-foreground/10 rounded-[20px] shadow-[0_2px_15px_rgba(0,0,0,0.05)] dark:shadow-none transition-all duration-300 px-4 sm:px-5 py-2"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={t("chat.placeholder")}
              rows={1}
              className={`w-full resize-none text-[15px] sm:text-[16px] bg-transparent border-none focus:ring-0 p-0 placeholder:text-muted-foreground/50 leading-snug min-h-[32px] py-1 select-none outline-none`}
              style={{ maxHeight: "200px" }}
            />
            
            <div className="flex items-center justify-between mt-1 pt-1">
                <div className="flex items-center gap-1.5">
                  {/* Model Selector within dock */}
                  <Select value={selectedModel} onValueChange={setSelectedModel} disabled={isLoading}>
                    <SelectTrigger className="w-auto h-8 bg-muted/40 border-none px-3 rounded-full text-[11px] sm:text-xs font-bold hover:bg-muted/60 transition-colors shadow-none focus:ring-0 min-w-[130px] flex items-center justify-between">
                      <SelectValue placeholder="Ultra Fast" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-border/40">
                      {AI_MODELS.map(m => {
                        const cost = m.id === "ultra-fast" ? 0.2 : m.id === "fast" ? 0.3 : 0.5;
                        return (
                          <SelectItem key={m.id} value={m.id} className="text-xs font-medium rounded-lg">
                            {m.name} <span className="text-muted-foreground ml-1">({m.description})</span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                {isLoading ? (
                  <Button 
                    type="button"
                    size="icon"
                    onClick={() => {
                      if (isLoading) stop();
                    }}
                    className="size-9 rounded-full shrink-0 shadow-lg transition-all active:scale-95 bg-foreground hover:bg-foreground/90"
                  >
                    <Square className="size-3.5 fill-current" />
                  </Button>
                ) : (
                  <Button 
                    type="submit" 
                    size="icon" 
                    disabled={!input.trim()}
                    className="size-9 rounded-full shrink-0 shadow-lg bg-primary hover:bg-primary/90 disabled:opacity-50 transition-all active:scale-95"
                  >
                    <SendHorizontal className="size-4 ml-0.5" />
                  </Button>
                )}
              </div>
            </div>
          </form>
          

        </div>
      </div>
    </div>
  );

  return (
    <>
      {chatContent}
      <HistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onLoad={handleLoadConversation}
        onDelete={(id) => {
          if (id === conversationId) handleNewChat();
        }}
        currentConversationId={conversationId}
      />
    </>
  );
}
