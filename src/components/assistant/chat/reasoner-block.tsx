import { useState } from "react";
import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { ChevronDown, Sparkles } from "lucide-react";

export function ReasonerBlock({ text, isThinking }: { text: string, isThinking?: boolean }) {
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
