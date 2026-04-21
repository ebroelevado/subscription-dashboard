import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Check, ChevronDown, ChevronUp, Play, Download, ExternalLink, Loader2, RefreshCcw, Terminal, BrainCircuit, Clock, X, Undo2 } from "lucide-react";
import { ExtendedUIMessagePart } from "@ai-sdk/react";
import { Button } from "@/components/ui/button";
import { jsonToCsv } from "@/lib/csv-utils";
import { PythonWorkerState, HitlPending } from "./chat-types";
import { deepParseJson, findPythonAnalysisPayload, findDownloadData, getWhatsappData } from "./chat-utils";
import { RotatingPhrase } from "./rotating-phrase";
import { findStatusInOutput } from "@/lib/find-status";

export function ToolInvocationBlock({ part, stableToolCallId, onConfirm, onUndo, onPythonResult, executedMutations, rejectedActionIds, acceptedActionIds }: {
  part: ExtendedUIMessagePart & { toolInvocation?: { toolName?: string; state: string; result?: unknown; args?: unknown; error?: string }; errorText?: string },
  stableToolCallId?: string,
  onConfirm?: (toolName: string, args: any, accepted: boolean, toolCallId?: string) => void,
  onUndo?: (toolName: string) => void,
  onPythonResult?: (resultText: string) => void,
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
  const pythonPayload = useMemo(
    () => (isFinished && !isError ? findPythonAnalysisPayload(formattedOutput) : null),
    [isFinished, isError, formattedOutput],
  );
  const [pythonWorkerState, setPythonWorkerState] = useState<PythonWorkerState>({ status: "idle" });
  const pythonWorkerRef = useRef<Worker | null>(null);
  const pythonRequestRef = useRef<string | null>(null);

  useEffect(() => {
    setPythonWorkerState({ status: "idle" });
    if (pythonWorkerRef.current) {
      pythonWorkerRef.current.terminate();
      pythonWorkerRef.current = null;
    }
    pythonRequestRef.current = null;
  }, [pythonPayload?.pythonCode, pythonPayload?.dataPayload.length]);

  useEffect(() => {
    return () => {
      if (pythonWorkerRef.current) {
        pythonWorkerRef.current.terminate();
        pythonWorkerRef.current = null;
      }
      pythonRequestRef.current = null;
    };
  }, []);

  const runPythonAnalysis = useCallback(() => {
    if (!pythonPayload || pythonWorkerState.status === "running") return;

    const requestId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const worker = new Worker("/python-analysis.worker.js");
    if (pythonWorkerRef.current) {
      pythonWorkerRef.current.terminate();
    }
    pythonWorkerRef.current = worker;
    pythonRequestRef.current = requestId;

    setPythonWorkerState({ status: "running", progress: "Preparing Python sandbox..." });

    const closeWorker = () => {
      if (pythonWorkerRef.current === worker) {
        pythonWorkerRef.current = null;
      }
      worker.terminate();
      pythonRequestRef.current = null;
    };

    const timeoutId = window.setTimeout(() => {
      closeWorker();
      setPythonWorkerState({
        status: "error",
        error: "Python analysis timed out. Try running it again.",
      });
      if (onPythonResult) onPythonResult("ERROR:\nPython analysis timed out. Try running it again.");
    }, 120000);

    worker.onmessage = (event: MessageEvent<any>) => {
      const message = event.data as
        { type: "progress"; requestId: string; message: string }
        | { type: "result"; requestId: string; imageDataUrl: string; runtimeMs: number; rowCount: number }
        | { type: "error"; requestId: string; error: string };

      if (!message || message.requestId !== requestId || pythonRequestRef.current !== requestId) return;

      if (message.type === "progress") {
        setPythonWorkerState({ status: "running", progress: message.message || "Running analysis..." });
        return;
      }

      window.clearTimeout(timeoutId);

      if (message.type === "result") {
        setPythonWorkerState({
          status: "done",
          imageDataUrl: message.imageDataUrl,
          stdout: message.stdout,
          stderr: message.stderr,
          runtimeMs: message.runtimeMs,
          rowCount: message.rowCount,
        });
        if (onPythonResult) {
          const out = [];
          if (message.stdout) out.push(`STDOUT:\n${message.stdout}`);
          if (message.stderr) out.push(`STDERR:\n${message.stderr}`);
          if (message.imageDataUrl) out.push(`IMAGE: [Plot generated successfully]`);
          out.push(`Rows processed: ${message.rowCount}. Time: ${message.runtimeMs}ms.`);
          onPythonResult(out.join("\n\n"));
        }
      } else {
        setPythonWorkerState({
          status: "error",
          error: message.error || t("chat.unknownError"),
        });
        if (onPythonResult) {
          onPythonResult(`ERROR:\n${message.error || t("chat.unknownError")}`);
        }
      }

      closeWorker();
    };

    worker.onerror = () => {
      window.clearTimeout(timeoutId);
      closeWorker();
      setPythonWorkerState({
        status: "error",
        error: "Python worker crashed during execution.",
      });
      if (onPythonResult) onPythonResult("ERROR:\nPython worker crashed during execution.");
    };

    worker.postMessage({
      requestId,
      dataPayload: pythonPayload.dataPayload,
      pythonCode: pythonPayload.pythonCode,
    });
  }, [pythonPayload, pythonWorkerState.status, t, onPythonResult]);

  // Auto-execute Python payload once ready
  useEffect(() => {
    if (pythonPayload && pythonWorkerState.status === "idle") {
      runPythonAnalysis();
    }
  }, [pythonPayload, pythonWorkerState.status, runPythonAnalysis]);

  const downloadPythonImage = useCallback(() => {
    if (pythonWorkerState.status !== "done" || !pythonWorkerState.imageDataUrl) return;
    const link = document.createElement("a");
    link.href = pythonWorkerState.imageDataUrl;
    link.download = `python-plot-${new Date().toISOString().slice(0, 10)}.png`;
    link.click();
  }, [pythonWorkerState]);

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

           if (pythonPayload) {
             return (
               <div className="px-3 pb-3 pt-1 animate-in fade-in slide-in-from-bottom-1 duration-500">
                 <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 shadow-[0_0_20px_rgba(14,165,233,0.08)] p-4 flex flex-col gap-3">
                   <div className="flex items-start gap-3">
                     <div className="size-8 rounded-xl bg-sky-500/15 flex items-center justify-center shrink-0">
                       <BrainCircuit className="size-4 text-sky-500" />
                     </div>
                     <div className="flex-1 min-w-0">
                       <p className="text-[11px] font-bold text-sky-500 uppercase tracking-widest">Python Sandbox</p>
                       <p className="text-sm text-foreground/90 mt-0.5 leading-snug">
                         {pythonPayload.message || "Run this analysis template securely in the browser sandbox."}
                       </p>
                     </div>
                   </div>

                   <div className="rounded-xl bg-muted/40 border border-border/40 p-3 text-[12px] text-muted-foreground/90">
                     <pre className="font-mono text-[10px] whitespace-pre-wrap break-words max-h-[100px] overflow-y-auto">
                       {pythonPayload.pythonCode}
                     </pre>
                     <p className="mt-2 text-[10px] opacity-70">Data injected: {pythonPayload.dataPayload.length} rows</p>
                   </div>

                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                     <Button
                       onClick={runPythonAnalysis}
                       disabled={pythonWorkerState.status === "running"}
                       className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-2.5 rounded-xl text-sm shadow-sm transition-all active:scale-[0.97]"
                     >
                       {pythonWorkerState.status === "running" ? (
                         <>
                           <Loader2 className="size-4 mr-2 animate-spin" />
                           Running...
                         </>
                       ) : (
                         <>
                           <Terminal className="size-4 mr-2" />
                           Execute Script
                         </>
                       )}
                     </Button>

                     <Button
                       variant="outline"
                       onClick={downloadPythonImage}
                       disabled={pythonWorkerState.status !== "done" || (pythonWorkerState.status === "done" && !pythonWorkerState.imageDataUrl)}
                       className="w-full border-sky-500/30 hover:bg-sky-500/10 text-sky-600 font-bold py-2.5 rounded-xl text-sm"
                     >
                       <Download className="size-4 mr-2" />
                       Download Plot
                     </Button>
                   </div>

                   {pythonWorkerState.status === "running" ? (
                     <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[12px] text-sky-700 dark:text-sky-300 flex items-center gap-2">
                       <Loader2 className="size-3.5 animate-spin" />
                       <span>{pythonWorkerState.progress}</span>
                     </div>
                   ) : null}

                   {pythonWorkerState.status === "error" ? (
                     <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[12px] text-red-500">
                       {pythonWorkerState.error}
                     </div>
                   ) : null}

                   {pythonWorkerState.status === "done" ? (
                     <div className="rounded-xl border border-border/40 bg-background/60 p-3 flex flex-col gap-3">
                       
                       {pythonWorkerState.imageDataUrl ? (
                         <img
                           src={pythonWorkerState.imageDataUrl}
                           alt={"Python analysis plot"}
                           className="w-full rounded-lg border border-border/40 bg-white"
                           loading="lazy"
                         />
                       ) : null}

                       {(pythonWorkerState.stdout || pythonWorkerState.stderr) ? (
                         <div className="flex flex-col gap-1">
                           {pythonWorkerState.stdout ? (
                             <pre className="text-[10px] p-2 bg-muted/50 rounded border font-mono whitespace-pre-wrap">
                               {pythonWorkerState.stdout}
                             </pre>
                           ) : null}
                           {pythonWorkerState.stderr ? (
                             <pre className="text-[10px] p-2 bg-red-500/10 text-red-500 rounded border border-red-500/20 font-mono whitespace-pre-wrap">
                               {pythonWorkerState.stderr}
                             </pre>
                           ) : null}
                         </div>
                       ) : null}

                       <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                         <span>{pythonWorkerState.rowCount} rows processed</span>
                         <span>{Math.max(1, Math.round(pythonWorkerState.runtimeMs / 100) / 10)}s</span>
                       </div>
                     </div>
                   ) : null}
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
