"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { useTranslations } from "next-intl";
import type { UIMessage } from "ai";
import { Send, Bot, Loader2, Github, Copy, Check, Terminal, ChevronDown, ChevronUp, BrainCircuit, AlertCircle, MessageSquarePlus, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css"; // Required for LaTeX math to render nicely

type ExtendedUIMessagePart = {
  type: string;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  result?: unknown;
  output?: unknown;
  state?: string;
  toolInvocation?: { state: string; result?: unknown; args?: unknown };
  toolCall?: { toolName: string; args?: unknown };
  input?: unknown;
};

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
    // Strip <think> tags and their content
    const cleanText = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
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
  const [open, setOpen] = useState(false);
  if (!text && !isThinking) return null;

  return (
    <div className="my-2 transition-all duration-300">
      <button 
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-primary hover:text-primary/70 font-medium text-[13px] transition-colors group"
      >
        <div className="flex items-center justify-center size-5 rounded-full bg-primary/10 transition-transform group-hover:scale-110">
          {isThinking ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Sparkles className="size-3" />
          )}
        </div>
        <span>{isThinking ? "Viendo datos..." : "Ver razonamiento"}</span>
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
    const thinkStart = remaining.indexOf("<think>");
    if (thinkStart === -1) {
      if (remaining.trim()) parts.push({ type: "text", content: remaining });
      break;
    }
    
    if (thinkStart > 0) {
      const textBefore = remaining.slice(0, thinkStart);
      if (textBefore.trim()) parts.push({ type: "text", content: textBefore });
    }
    
    const thinkEnd = remaining.indexOf("</think>", thinkStart);
    if (thinkEnd === -1) {
      parts.push({ type: "thinking", content: remaining.slice(thinkStart + 7), isComplete: false });
      break;
    } else {
      parts.push({ type: "thinking", content: remaining.slice(thinkStart + 7, thinkEnd), isComplete: true });
      remaining = remaining.slice(thinkEnd + 8);
    }
  }
  
  return parts;
}

function ToolInvocationBlock({ part }: { part: ExtendedUIMessagePart & { toolInvocation?: { toolName?: string; state: string; result?: unknown; args?: unknown; error?: string }; errorText?: string } }) {
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

  // Recursively parse stringified JSON values for readable display
  const deepParseJson = (val: unknown): unknown => {
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        if (typeof parsed === 'object' && parsed !== null) return deepParseJson(parsed);
        return parsed;
      } catch { return val; }
    }
    if (Array.isArray(val)) return val.map(deepParseJson);
    if (typeof val === 'object' && val !== null) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) out[k] = deepParseJson(v);
      return out;
    }
    return val;
  };

  const formattedArgs = deepParseJson(args);
  const formattedOutput = deepParseJson(output);

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
              <span className="text-[10px] text-muted-foreground/60 font-normal">Base de datos • {isError ? 'Fallido' : 'Listo'}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 bg-background/50 border px-2 py-1 rounded-md text-[10px] font-bold text-primary/80 uppercase shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            <span>{open ? "Cerrar" : "Logs"}</span>
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
                Parámetros {hasArgs && <span className="ml-1 opacity-40">[]</span>}
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
                Respuesta {isError && <span className="ml-1 text-red-500">✕</span>}
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
                  <div className="text-[11px] text-muted-foreground/60 font-medium italic py-2">Sin parámetros de entrada.</div>
                )
              )}
              {activeTab === 'output' && (
                isError ? (
                  <div className="text-[11px] font-mono text-red-400 bg-red-500/5 p-3 rounded-lg border border-red-500/20 overflow-x-auto whitespace-pre-wrap break-words">
                    {errorText || 'Error desconocido'}
                  </div>
                ) : hasOutput ? (
                  <pre className="text-[11px] font-mono text-muted-foreground/80 bg-muted/40 p-3 rounded-lg border border-border/40 overflow-x-auto whitespace-pre-wrap break-words max-h-[250px] overflow-y-auto custom-scrollbar">
                    {typeof formattedOutput === 'string' ? formattedOutput : JSON.stringify(formattedOutput, null, 2)}
                  </pre>
                ) : (
                  <div className="text-[11px] text-muted-foreground/60 font-medium italic py-2">Sin resultado disponible.</div>
                )
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Still loading
  return (
    <div className="my-4 flex items-center gap-3 text-xs bg-muted/20 p-3 rounded-xl border border-primary/20 shadow-sm text-muted-foreground font-medium w-full sm:max-w-[400px] border-l-2 border-l-primary/50">
      <div className="size-5 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Loader2 className="size-3 animate-spin text-primary" />
      </div>
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-foreground animate-pulse font-bold tracking-tight uppercase text-[11px]">{toolName}</span>
          <span className="text-[10px] opacity-70">Consultando...</span>
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

export function ChatInterface() {
  const t = useTranslations();
  // Copilot Auth State
  const [hasCopilot, setHasCopilot] = useState<boolean | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  
  // Model Selection State
  const [models, setModels] = useState<{id: string, name?: string}[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");

  useEffect(() => {
    fetch("/api/copilot/status")
      .then(res => res.json())
      .then(data => setHasCopilot(data.hasToken))
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (hasCopilot) {
      fetch("/api/copilot/models")
        .then(res => res.json())
        .then(data => {
          if (data && data.data && Array.isArray(data.data)) {
             const allowed = [
               { id: "claude-haiku-4.5", name: "🧠 Expert" },
               { id: "grok-code-fast-1", name: "⚡ Fast" }
             ];
             
             // Filter down to the models we specifically want that the API returned
             const availableAllowed = allowed.filter(a => data.data.some((m: {id: string}) => m.id === a.id));
             
             if (availableAllowed.length > 0) {
               setModels(availableAllowed);
               setSelectedModel(availableAllowed[0].id);
             } else {
               // Fallback deduplication just in case the Github models change IDs abruptly
               const seen = new Set<string>();
               const unique = data.data.filter((m: {id: string, capabilities?: {type?: string}}) => {
                 if (seen.has(m.id)) return false;
                 if (m.capabilities?.type && m.capabilities.type !== "chat") return false;
                 if (m.id.includes("embedding")) return false;
                 seen.add(m.id);
                 return true;
               });
               setModels(unique);
               if (unique.length > 0) {
                 const defaultModel = unique.find((m: {id: string}) => m.id === "claude-haiku-4.5") || unique[0];
                 setSelectedModel(defaultModel.id);
               }
             }
          }
        })
        .catch(console.error);
    }
  }, [hasCopilot]);
  
  const handleNewChat = () => {
    setMessages([]);
  };

  const initiateCopilotAuth = async () => {
    try {
      setUserCode(null);
      const res = await fetch("/api/copilot/device-code", { method: "POST" });
      const data = await res.json();
      
      setUserCode(data.user_code);
      setVerificationUri(data.verification_uri);
      
      pollForToken(data.device_code, data.interval || 5);
    } catch (err) {
      console.error(err);
    }
  };

  const pollForToken = async (deviceCodeStr: string, intervalSeconds: number) => {
    let polling = true;
    while (polling) {
      await new Promise(r => setTimeout(r, intervalSeconds * 1000));
      try {
        const res = await fetch("/api/copilot/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_code: deviceCodeStr })
        });
        const data = await res.json();
        
        if (data.success) {
          setHasCopilot(true);
          polling = false;
        } else if (data.pending) {
          // keep polling
        } else {
          console.error("Polling error:", data.error);
          polling = false;
        }
      } catch (err) {
        console.error(err);
        polling = false;
      }
    }
  };

  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Vercel AI SDK v4 — useChat with sendMessage API
  const { messages, sendMessage, status, setMessages, stop } = useChat({});

  // Auto-resize textarea
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
    sendMessage(
      { text: input },
      { body: { model: selectedModel || undefined } }
    );
    setInput("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
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

  const isLoading = status === "submitted" || status === "streaming";

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  if (hasCopilot === null) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (hasCopilot === false) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background p-6">
        <div className="max-w-md w-full flex flex-col items-center text-center space-y-6">
          <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Github className="size-8 text-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Connect GitHub Copilot</h2>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              Pearfect AI uses your existing GitHub Copilot subscription to answer questions and analyze your revenue securely.
            </p>
          </div>
          
          {!userCode ? (
            <Button onClick={initiateCopilotAuth} size="lg" className="w-full sm:w-auto">
              Connect via Device Flow
            </Button>
          ) : (
            <div className="flex flex-col items-center space-y-4 w-full p-6 bg-muted/30 border rounded-xl">
              <p className="text-sm font-medium">1. Open the verification link:</p>
              <a href={verificationUri || "#"} target="_blank" rel="noreferrer" className="text-primary hover:underline text-sm font-medium">
                {verificationUri}
              </a>
              <p className="text-sm font-medium mt-4">2. Enter this code:</p>
              <div className="text-3xl font-mono font-bold tracking-widest text-primary p-4 bg-background border rounded-lg shadow-inner w-full text-center">
                {userCode}
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-4">
                <Loader2 className="size-4 animate-spin" />
                Waiting for authorization...
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }


  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* ── Header ── simplified (No border) */}
      <div className="flex items-center justify-between px-4 sm:px-6 h-14 shrink-0 bg-background/50 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center size-8 rounded-full bg-primary/10 text-primary shrink-0">
            <Bot className="size-4.5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold tracking-tight truncate">Pearfect AI</h2>
          </div>
        </div>        {/* Restore New Chat button in Header */}
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
            {messages.map((m: UIMessage) => (
              <div
                key={m.id}
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
                        const parsed = parseTextWithThinking(part.text || "");
                        return parsed.map((p: { type: string; content: string; isComplete?: boolean }, j: number) => {
                          if (p.type === "thinking") {
                            return <ReasonerBlock key={`${i}-${j}`} text={p.content.trim()} isThinking={!p.isComplete} />;
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
                                {p.content}
                              </ReactMarkdown>
                            </div>
                          );
                        });
                      }
                      
                      if (part.type === 'tool-invocation' || part.type?.startsWith('tool-') || part.type === 'dynamic-tool' || part.type === 'tool-call') {
                        return <ToolInvocationBlock key={i} part={part} />;
                      }
                      return null;
                    })}
                  </div>
                  
                  {/* Action Bar — only show if not currently loading/streaming this message */}
                  {m.role !== "user" && (status !== "streaming" || messages.indexOf(m) < messages.length - 1) && (
                    <div className="flex items-center gap-1 mt-2 px-1.5 opacity-40 hover:opacity-100 transition-opacity">
                      <CopyButton text={m.parts?.filter((p) => p.type === 'text').map((p) => p.text).join("") || ""} />
                    </div>
                  )}
                </div>
              </div>
            ))}
            </>
          )}
          
          {isLoading && messages[messages.length - 1]?.role === "user" && (
            <div className="flex animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center gap-2 bg-muted/5 rounded-2xl px-4 py-2 border border-border/20">
                <Loader2 className="size-3.5 animate-spin text-primary/70" />
                <span className="text-[12px] text-muted-foreground font-bold tracking-wider uppercase">
                  {t("chat.analyzing")}
                </span>
              </div>
            </div>
          )}

          {/* Scroll anchor */}
          <div ref={bottomRef} className="h-4" />
        </div>

        {/* Scroll to Bottom Button */}
        {showScrollBottom && (
          <Button
            size="icon"
            variant="secondary"
            className="fixed bottom-24 right-5 sm:right-10 rounded-full shadow-2xl z-30 size-10 bg-background/80 backdrop-blur-md border border-border/40 hover:bg-background transition-all hover:-translate-y-1"
            onClick={scrollToBottom}
          >
            <ChevronDown className="size-5" />
          </Button>
        )}
      </div>

      {/* ── Input Area ── sticky bottom dock (No border/footer) */}
      <div className="shrink-0 px-4 pt-2 pb-6 sm:pb-8 bg-background relative z-20">
        <div className="max-w-4xl mx-auto group">
          <form
            onSubmit={handleSubmit}
            className="relative flex flex-col bg-muted/20 dark:bg-muted/10 border border-muted-foreground/10 rounded-[28px] shadow-[0_2px_20px_rgba(0,0,0,0.05)] dark:shadow-none transition-all duration-300 px-4 sm:px-5 py-3"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={t("chat.placeholder")}
              rows={1}
              className="w-full resize-none text-[16px] sm:text-[17px] bg-transparent border-none focus:ring-0 p-0 placeholder:text-muted-foreground/50 leading-relaxed min-h-[44px] py-1 select-none outline-none"
              style={{ maxHeight: "200px" }}
            />
            
            <div className="flex items-center justify-between mt-2 pt-2">
              <div className="flex items-center gap-1.5">
                {/* Model Selector within dock */}
                {hasCopilot && models.length > 0 && (
                  <Select value={selectedModel} onValueChange={setSelectedModel} disabled={isLoading}>
                    <SelectTrigger className="w-auto h-8 bg-muted/40 border-none px-3 rounded-full text-[11px] sm:text-xs font-bold hover:bg-muted/60 transition-colors shadow-none focus:ring-0">
                      <SelectValue placeholder="Model" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-border/40">
                      {models.map(m => (
                        <SelectItem key={m.id} value={m.id} className="text-xs font-medium rounded-lg">
                          {m.name || m.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="flex items-center gap-2">
                {isLoading ? (
                  <Button 
                    type="button"
                    size="icon"
                    onClick={() => stop()}
                    className="size-9 rounded-full shrink-0 shadow-lg bg-foreground hover:bg-foreground/90 transition-all active:scale-95"
                  >
                    <Square className="size-3.5 fill-current" />
                  </Button>
                ) : (
                  <Button 
                    type="submit" 
                    size="icon" 
                    disabled={!input.trim()}
                    className="size-9 rounded-full shrink-0 shadow-lg bg-primary hover:bg-primary/90 transition-all active:scale-95"
                  >
                    <Send className="size-4 ml-0.5" />
                  </Button>
                )}
              </div>
            </div>
          </form>
          

        </div>
      </div>
    </div>
  );
}
