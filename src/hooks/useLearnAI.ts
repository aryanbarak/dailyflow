import { useCallback, useEffect, useRef, useState } from "react";
import { createId } from "@/lib/id";
import { useAuth } from "@/hooks/useAuth";
import {
  askLearnAI,
  fileToFileData,
  formatError,
  type AIError,
  type FileData,
} from "@/features/learn-ai/aiService";
import type {
  LearnAIMode,
  LearnAILanguage,
  LearnAIResponseLanguage,
  LearnAIMessage,
} from "@/features/learn-ai/types";
import { insertMessage, listHistory } from "@/features/learn-ai/learnAiService";
import { browserPersonalMemoryRecordService } from "@/features/personal-memory/personalMemoryRecordBrowserService";
import { getConfirmedMemoryPromptContext } from "@/features/personal-memory/personalMemoryPromptContext";
import { browserPersonalMemoryRecallLogService } from "@/features/personal-memory/personalMemoryRecallLogBrowserService";
import { useAppearance } from "@/features/settings/appearanceStore";
import {
  getAiResponseLanguageInstruction,
  getStoredAiResponseLanguage,
  resolveAiResponseLanguage,
} from "@/features/ai/responseLanguage";

const DEFAULT_MODE: LearnAIMode = "fiae_algorithms";

function getSignInError(lang: LearnAILanguage): AIError {
  if (lang === "fa") {
    return { title: "نیاز به ورود", message: "برای استفاده از AI باید وارد شوید.", canRetry: false };
  }
  if (lang === "en") {
    return { title: "Sign In Required", message: "You must be signed in to use AI.", canRetry: false };
  }
  return { title: "Anmeldung erforderlich", message: "Sie müssen angemeldet sein, um AI zu verwenden.", canRetry: false };
}

function getFallbackAnswer(lang: LearnAILanguage): string {
  if (lang === "fa") return "متأسفانه نتوانستم پاسخ تولید کنم. لطفاً دوباره تلاش کنید.";
  if (lang === "en") return "Sorry, I couldn't generate a response. Please try again.";
  return "Entschuldigung, ich konnte keine Antwort generieren. Bitte versuchen Sie es erneut.";
}

// Accepted file types
const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
];

export function useLearnAI() {
  const { user } = useAuth();
  const interfaceLanguage = useAppearance((state) => state.language);
  const [messages, setMessages] = useState<LearnAIMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<AIError | null>(null);
  const [mode, setMode] = useState<LearnAIMode>(DEFAULT_MODE);
  const [language, setLanguage] = useState<LearnAIResponseLanguage>(() => getStoredAiResponseLanguage());
  const [attachedFile, setAttachedFile] = useState<File | null>(null); // ← new
  const [isProcessingFile, setIsProcessingFile] = useState(false);    // ← new
  const messagesRef = useRef<LearnAIMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const reload = useCallback(async () => {
    if (!user) {
      setMessages([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const items = await listHistory(mode, user.id);
      setMessages(items);
    } catch (err) {
      setError(formatError(err, resolveAiResponseLanguage({
        configuredResponseLanguage: language,
        interfaceLanguage,
      })));
    } finally {
      setIsLoading(false);
    }
  }, [mode, user, language, interfaceLanguage]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const clearLocalView = useCallback(() => {
    setMessages([]);
  }, []);

  // ← new: validate and attach a file
  const attachFile = useCallback((file: File | null) => {
    if (!file) {
      setAttachedFile(null);
      return;
    }
    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      setError({
        title: "Unsupported file type",
        message: "Please attach a PDF, image (PNG/JPEG/WebP) or text file.",
        canRetry: false,
      });
      return;
    }
    if (file.size > 10 * 1024 * 1024) { // 10 MB limit
      setError({
        title: "File too large",
        message: "Maximum file size is 10 MB.",
        canRetry: false,
      });
      return;
    }
    setError(null);
    setAttachedFile(file);
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      const provisionalMessage = trimmed || `[File: ${attachedFile?.name ?? "attachment"}]`;
      const resolvedLanguage = resolveAiResponseLanguage({
        configuredResponseLanguage: language,
        latestUserMessage: provisionalMessage,
        interfaceLanguage,
      });

      if (!user) {
        setError(getSignInError(resolvedLanguage));
        return;
      }

      if (!trimmed && !attachedFile) return;

      setError(null);

      // Convert file to base64 before doing anything else
      let fileData: FileData | undefined;
      if (attachedFile) {
        setIsProcessingFile(true);
        try {
          fileData = await fileToFileData(attachedFile);
        } catch (err) {
          setError(formatError(err, resolvedLanguage));
          setIsProcessingFile(false);
          return;
        } finally {
          setIsProcessingFile(false);
        }
      }

      const messageContent = provisionalMessage;

      const history = messagesRef.current.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          role: "user",
          content: messageContent,
          createdAt: new Date().toISOString(),
          language: resolvedLanguage,
        },
      ]);

      // Clear file after attaching to the message
      setAttachedFile(null);

      try {
        await insertMessage({ userId: user.id, mode, language: resolvedLanguage, role: "user", content: messageContent });
      } catch (err) {
        setError(formatError(err, resolvedLanguage));
      }

      let answer: string;
      let aiError: AIError | null = null;
      try {
        const { text: memoryContext, recordIds: recalledRecordIds } = await getConfirmedMemoryPromptContext(browserPersonalMemoryRecordService);
        if (recalledRecordIds.length > 0) {
          // Best-effort, fire-and-forget -- ADR-0023 SS2: a logging failure
          // must never block or degrade the actual tutor reply.
          browserPersonalMemoryRecallLogService.logTutorRecall(recalledRecordIds).catch(() => {});
        }
        const result = await askLearnAI({
          message: messageContent,
          history,
          mode,
          language: resolvedLanguage,
          responseLanguage: resolvedLanguage,
          responseLanguageInstruction: getAiResponseLanguageInstruction(resolvedLanguage),
          memoryContext,
          fileData, // ← new
        });
        answer = result.answer;
      } catch (err) {
        console.error("[LearnAI] Error getting AI response:", err);
        aiError = formatError(err, resolvedLanguage);
        setError(aiError);
        answer = getFallbackAnswer(resolvedLanguage);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: createId(),
          role: "assistant",
          content: answer,
          createdAt: new Date().toISOString(),
          language: resolvedLanguage,
        },
      ]);

      try {
        await insertMessage({ userId: user.id, mode, language: resolvedLanguage, role: "assistant", content: answer });
      } catch (err) {
        console.error("[LearnAI] Failed to save assistant message:", err);
        if (!aiError) {
          setError(formatError(err, resolvedLanguage));
        }
      }
    },
    [language, mode, user, attachedFile, interfaceLanguage]
  );

  return {
    messages,
    isLoading,
    error,
    mode,
    language,
    setMode,
    setLanguage,
    sendMessage,
    clearLocalView,
    reload,
    attachedFile,   // ← new
    attachFile,     // ← new
    isProcessingFile, // ← new
  };
}
