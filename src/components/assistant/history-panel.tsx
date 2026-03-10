"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Trash2, MessageSquare, Clock, Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConversationMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface HistoryPanelProps {
  open: boolean;
  onClose: () => void;
  onLoad: (conversationId: string) => void;
  onDelete?: (id: string) => void;
  currentConversationId: string | null;
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "ahora";
  if (diffMins < 60) return `hace ${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `hace ${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `hace ${diffDays}d`;
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

export default function HistoryPanel({ open, onClose, onLoad, onDelete, currentConversationId }: HistoryPanelProps) {
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/history");
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
      }
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
      const res = await fetch(`/api/history/${id}`, { method: "DELETE" });
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
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
                <h3 className="text-sm font-bold tracking-tight">Historial</h3>
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
                  placeholder="Buscar conversación..."
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
                    {search ? "Sin resultados" : "Aún no hay conversaciones guardadas"}
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
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      className={`w-full group flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all cursor-pointer
                        ${
                          currentConversationId === conv.id
                            ? "bg-primary/10 border border-primary/20"
                            : "hover:bg-muted/40 border border-transparent"
                        }`}
                    >
                      {/* Icon */}
                      <div
                        className={`shrink-0 size-8 rounded-lg flex items-center justify-center text-xs font-bold
                          ${
                            currentConversationId === conv.id
                              ? "bg-primary/20 text-primary"
                              : "bg-muted/40 text-muted-foreground/50 group-hover:bg-muted/60"
                          }`}
                      >
                        <MessageSquare className="size-3.5" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold truncate leading-tight">
                          {conv.title}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-muted-foreground/50">
                            {timeAgo(conv.updatedAt)}
                          </span>
                          <span className="text-[10px] text-muted-foreground/30">•</span>
                          <span className="text-[10px] text-muted-foreground/50">
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

            {/* Footer */}
            <div className="px-5 py-3 border-t border-border/10">
              <p className="text-[10px] text-muted-foreground/30 text-center font-medium">
                Almacenado en Cloudflare R2
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
