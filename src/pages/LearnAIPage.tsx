import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Brain, Sparkles, Send, Paperclip, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatePanel } from "@/components/common/StatePanel";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { cn } from "@/lib/utils";
import { useLearnAI } from "@/hooks/useLearnAI";
import type { LearnAIResponseLanguage, LearnAIMode } from "@/features/learn-ai/types";

// Conversation Quality v1 (task 9): these four are suggestions, not the
// only legal topics -- LearnAIMode is a free-form string. Typing any other
// topic into the input below works identically; see the design note.
const MODE_OPTIONS: { value: LearnAIMode; label: string }[] = [
  { value: "fiae_algorithms", label: "Algorithms" },
  { value: "general_it", label: "General IT" },
  { value: "wiso", label: "WISO" },
  { value: "planner", label: "Planner" },
];

const LANGUAGE_OPTIONS: { value: LearnAIResponseLanguage; label: string }[] = [
  { value: "auto", label: "AUTO" },
  { value: "de", label: "DE" },
  { value: "fa", label: "FA" },
  { value: "en", label: "EN" },
];

const ACCEPTED_EXTENSIONS = ".pdf,.png,.jpg,.jpeg,.webp,.txt";

export default function LearnAIPage() {
  const {
    messages,
    isLoading,
    error,
    mode,
    language,
    setMode,
    setLanguage,
    sendMessage,
    attachedFile,
    attachFile,
    isProcessingFile,
  } = useLearnAI();

  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Conversation Quality v1 (task 9): a free-typed topic that isn't one of
  // the four suggestions. Seeded from `mode` on first render so the input
  // reflects a custom topic already in effect (e.g. restored from a prior
  // session), rather than always starting blank.
  const isSuggestedTopic = MODE_OPTIONS.some((option) => option.value === mode);
  const [customTopicDraft, setCustomTopicDraft] = useState(isSuggestedTopic ? "" : mode);

  const applyCustomTopic = () => {
    const topic = customTopicDraft.trim();
    if (topic) setMode(topic);
  };

  const historyItems = useMemo(
    () => messages.filter((item) => item.role === "user").slice(-20).reverse(),
    [messages]
  );

  const handleSend = async () => {
    if (!draft.trim() && !attachedFile) return;
    setIsSending(true);
    try {
      await sendMessage(draft);
      setDraft("");
    } catch (err) {
      console.error("[LearnAI] Unexpected error in handleSend:", err);
    } finally {
      setIsSending(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    attachFile(file);
    // Reset input so the same file can be re-attached if removed
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemoveFile = () => {
    attachFile(null);
  };

  const handleHistoryClick = (id: string) => {
    setHighlightedId(id);
    if (highlightTimerRef.current) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedId(null);
    }, 1500);
    const target = document.getElementById(`learnai-msg-${id}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  const canSend = (draft.trim().length > 0 || attachedFile !== null) && !isSending && !isProcessingFile;

  return (
    <ErrorBoundary>
      <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start justify-between gap-4 flex-wrap"
        >
          <div>
            <h1 className="text-2xl lg:text-3xl font-semibold mb-1">
              Learn with AI
            </h1>
            <p className="text-muted-foreground">
              Learn algorithms and IT concepts with your personal AI tutor
            </p>
          </div>
        </motion.div>

        <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <Card className="min-h-[360px]">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                Chat
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 flex flex-col gap-4">
              {isLoading && messages.length === 0 ? (
                <StatePanel
                  variant="loading"
                  title="Loading learning history..."
                  description="Fetching your recent questions."
                />
              ) : error && messages.length === 0 ? (
                <StatePanel
                  variant="error"
                  title="Learning history failed to load"
                  description={typeof error === "string" ? error : error.message}
                />
              ) : messages.length === 0 ? (
                <StatePanel
                  variant="empty"
                  title="Ask your first question to start learning."
                  description="Your AI tutor is ready when you are."
                />
              ) : (
                <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                  {messages.map((message) => {
                    const messageLanguage =
                      "language" in message && message.language
                        ? message.language
                        : language;
                    const isRtl = messageLanguage === "fa";

                    return (
                      <div
                        key={message.id}
                        className={cn(
                          "flex",
                          message.role === "user" ? "justify-end" : "justify-start"
                        )}
                      >
                        <div
                          id={`learnai-msg-${message.id}`}
                          dir={isRtl ? "rtl" : "ltr"}
                          lang={isRtl ? "fa" : messageLanguage || "de"}
                          className={cn(
                            "max-w-[85%] rounded-lg px-3 py-2 text-sm transition-shadow",
                            message.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-secondary text-foreground",
                            isRtl
                              ? "text-right font-fa leading-7 whitespace-pre-wrap break-words"
                              : "text-left leading-7 whitespace-pre-wrap break-words",
                            highlightedId === message.id
                              ? "ring-2 ring-primary/60 ring-offset-2 ring-offset-background"
                              : "ring-0"
                          )}
                        >
                          {message.content}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {error && messages.length > 0 && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3">
                  <p className="text-xs text-destructive font-medium">
                    {typeof error === "string" ? error : error.message || "خطایی رخ داده است"}
                  </p>
                </div>
              )}

              {(isSending || isProcessingFile) && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  <span>
                    {isProcessingFile ? "Processing file..." : "در حال ارسال پیام..."}
                  </span>
                </div>
              )}

              {/* Input area */}
              <div className="space-y-2">
                {/* File preview badge */}
                {attachedFile && (
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs">
                    <FileText className="w-3.5 h-3.5 shrink-0 text-primary" />
                    <span className="truncate flex-1 text-foreground">{attachedFile.name}</span>
                    <span className="text-muted-foreground shrink-0">
                      ({(attachedFile.size / 1024).toFixed(0)} KB)
                    </span>
                    <button
                      type="button"
                      onClick={handleRemoveFile}
                      className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                      aria-label="Remove file"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder="Ask about data structures, networks, or anything else..."
                  rows={3}
                  disabled={isSending || isProcessingFile}
                />

                <div className="flex items-center justify-between">
                  {/* File attach button */}
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ACCEPTED_EXTENSIONS}
                      className="hidden"
                      onChange={handleFileChange}
                      disabled={isSending || isProcessingFile}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isSending || isProcessingFile}
                    >
                      <Paperclip className="w-4 h-4" />
                      {attachedFile ? "Change file" : "Attach file"}
                    </Button>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      PDF, PNG, JPEG, WebP, TXT — max 10 MB
                    </p>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    className="gap-2"
                    onClick={() => void handleSend()}
                    disabled={!canSend}
                  >
                    <Send className="w-4 h-4" />
                    {isSending ? "Sending..." : "Send"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Brain className="w-4 h-4 text-primary" />
                  Learning mode
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {MODE_OPTIONS.map((option) => (
                    <Button
                      key={option.value}
                      size="sm"
                      variant={mode === option.value ? "secondary" : "outline"}
                      onClick={() => setMode(option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={customTopicDraft}
                    onChange={(e) => setCustomTopicDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyCustomTopic();
                      }
                    }}
                    placeholder="Or type any topic to study"
                    className="h-8 text-xs"
                    aria-label="Custom study topic"
                  />
                  <Button size="sm" variant="outline" onClick={applyCustomTopic}>
                    Use topic
                  </Button>
                </div>
                {!isSuggestedTopic && (
                  <p className="text-xs text-muted-foreground">Current topic: {mode}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {LANGUAGE_OPTIONS.map((option) => (
                    <Button
                      key={option.value}
                      size="sm"
                      variant={language === option.value ? "secondary" : "outline"}
                      onClick={() => setLanguage(option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="min-h-[180px]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">History</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {isLoading && messages.length === 0 ? (
                  <StatePanel
                    variant="loading"
                    title="Loading learning history..."
                    description="Fetching your recent prompts."
                  />
                ) : error && messages.length === 0 ? (
                  <StatePanel
                    variant="error"
                    title="History failed to load"
                    description={typeof error === "string" ? error : error.message}
                  />
                ) : historyItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Your learning history will appear here.
                  </p>
                ) : (
                  <div className="max-h-[320px] overflow-y-auto pr-1">
                    <ul className="space-y-2">
                      {historyItems.map((item) => {
                        const itemLanguage =
                          "language" in item && item.language
                            ? item.language
                            : language;
                        const isRtl = itemLanguage === "fa";

                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              dir={isRtl ? "rtl" : "ltr"}
                              lang={isRtl ? "fa" : itemLanguage || "de"}
                              aria-label={`Go to message: ${item.content}`}
                              onClick={() => handleHistoryClick(item.id)}
                              className={cn(
                                "w-full rounded-lg border border-border/60 bg-secondary/40 px-3 py-2 text-xs transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                                isRtl
                                  ? "text-right font-fa leading-7 whitespace-pre-wrap break-words"
                                  : "text-left leading-7 whitespace-pre-wrap break-words"
                              )}
                            >
                              {item.content}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
