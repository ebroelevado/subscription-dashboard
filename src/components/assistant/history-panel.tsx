"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Trash2, MessageSquare, Clock, Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations, useLocale } from "next-intl";

interface ConversationMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  source?: "r2" | "agent-run";
}

interface HistoryPanelProps {
  open: boolean;
  onClose: () => void;
  onLoad: (conversationId: string) => void;
  onDelete?: (id: string) => void;
  currentConversationId: string | null;
}

export default function HistoryPanel({ open, onClose, onLoad, onDelete, currentConversationId }: HistoryPanelProps) {
  const t = useTranslations();
  const locale = useLocale();

  const timeAgo = useCallback((dateStr: string) => {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return t("time.now");
    if (diffMins < 60) return t("time.minsAgo", { count: diffMins });
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return t("time.hoursAgo", { count: diffHours });
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return t("time.daysAgo", { count: diffDays });
    return date.toLocaleDateString(locale, { day: "numeric", month: "short" });
  }, [t, locale]);

  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const [historyRes, runsRes] = await Promise.all([
        fetch("/api/history"),
        fetch("/api/agent/runs?limit=50"),
      ]);

      const historyData: ConversationMeta[] = historyRes.ok ? await historyRes.json() : [];
      const runsData = runsRes.ok ? await runsRes.json() : [];

      const mappedRuns: ConversationMeta[] = Array.isArray(runsData)
        ? runsData.map((run: any) => ({
            id: `run:${run.id}`,
            title: run.title || "Agent run",
            createdAt: run.startedAt || run.updatedAt,
            updatedAt: run.updatedAt || run.startedAt,
            messageCount: run.messageCount || 0,
            source: "agent-run",
          }))
        : [];

      const merged = [...historyData, ...mappedRuns]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      setConversations(merged);
    } catch (err) {
      console.error("[History] Failed to fetch:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchHistory();
  }, [open, fetchHistory]);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      const isRun = id.startsWith("run:");
      const endpoint = isRun ? `/api/agent/runs/${id.slice(4)}` : `/api/history/${id}`;
      const res = await fetch(endpoint, { method: "DELETE" });
      if (res.ok) {
        setConversations((prev) => prev.filter((c) => c.id !== id));
        onDelete?.(id);
      }
    } catch (err) {
      console.error("[History] Failed to delete:", err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleLoad = (id: string) => {
    onLoad(id);
    onClose();
  };

  const filtered = search.trim()
    ? conversations.filter((c) =>
        c.title.toLowerCase().includes(search.toLowerCase())
      )
    : conversations;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="history-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            key="history-panel"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed left-0 top-0 bottom-0 w-[340px] sm:w-[380px] z-50 flex flex-col
              bg-background/95 backdrop-blur-xl border-r border-border/30 shadow-2xl"
          >
            {/* Panel Header */}
            <div className="flex items-center justify-between px-5 h-14 shrink-0 border-b border-border/20">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center size-7 rounded-full bg-primary/10 text-primary">
                  <Clock className="size-3.5" />
                </div>
                <h3 className="text-sm font-bold tracking-tight">{t("nav.history")}</h3>
                {conversations.length > 0 && (
                  <span className="text-[10px] font-bold text-muted-foreground/60 bg-muted/40 px-1.5 py-0.5 rounded-full">
                    {conversations.length}
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="size-7 text-muted-foreground hover:text-foreground rounded-full"
              >
                <X className="size-3.5" />
              </Button>
            </div>

            {/* Search Bar */}
            <div className="px-4 py-3 border-b border-border/10">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("chat.searchConversations")}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-muted/30 border border-border/20 rounded-lg
                    placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30
                    focus:border-primary/30 transition-all"
                />
              </div>
            </div>

            {/* Conversation List */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
              {loading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="size-5 animate-spin text-primary/50" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-center px-6">
                  <div className="size-12 rounded-2xl bg-muted/30 flex items-center justify-center mb-3">
                    <MessageSquare className="size-5 text-muted-foreground/30" />
                  </div>
                  <p className="text-xs text-muted-foreground/50 font-medium">
                    {search ? t("chat.noSearchResults") : t("chat.noConversationsFound")}
                  </p>
                </div>
              ) : (
                <div className="py-2 px-2 space-y-0.5">
                  {filtered.map((conv) => (
                    <motion.div
                      key={conv.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleLoad(conv.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleLoad(conv.id);
                        }
                      }}
                      className={`w-full group flex items-center gap-4 px-4 py-3 text-left transition-all cursor-pointer border-b border-border/5 last:border-0
                        ${
                          currentConversationId === conv.id
                            ? "bg-primary/5 text-primary"
                            : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                        }`}
                    >
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-[13px] truncate leading-tight transition-colors ${
                          currentConversationId === conv.id ? "font-bold" : "font-medium"
                        }`}>
                          {conv.title}
                        </p>
                        <div className="flex items-center gap-2 mt-1 opacity-70">
                          <span className="text-[10px]">
                            {timeAgo(conv.updatedAt)}
                          </span>
                          <span className="text-[10px] opacity-30">•</span>
                          <span className="text-[10px]">
                            {conv.messageCount} msgs
                          </span>
                        </div>
                      </div>

                      {/* Delete */}
                      <button
                        type="button"
                        onClick={(e) => handleDelete(conv.id, e)}
                        disabled={deletingId === conv.id}
                        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity
                          size-7 flex items-center justify-center rounded-lg
                          text-muted-foreground/40 hover:text-red-500 hover:bg-red-500/10"
                      >
                        {deletingId === conv.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Trash2 className="size-3" />
                        )}
                      </button>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
