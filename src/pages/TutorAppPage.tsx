import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link, useSearchParams } from "react-router-dom";
import { useT } from "@/i18n";
import { TutorControlPanel } from "@/components/tutor/app/TutorControlPanel";
import { TutorOutputTabs } from "@/components/tutor/app/TutorOutputTabs";
import {
  fetchTutorFallbackTopics,
  fetchTutorTopics,
  fetchTutorVariants,
  isTutorApiConfigured,
  runTutorRequest,
  TutorApiHttpError,
} from "@/lib/tutor/runner";
import type { TutorRunExecution, TutorRunLang, TutorRunMode, TutorVariant } from "@/lib/tutor/types";

function safeParseParams(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Params JSON must be an object");
  }
  return parsed as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function exportExecutionPdf(execution: TutorRunExecution): void {
  const win = window.open("", "_blank");
  if (!win) return;

  const html = `
    <html>
      <head>
        <title>Tutor Session Export</title>
        <style>
          body { font-family: system-ui, sans-serif; padding: 24px; }
          h1 { margin: 0 0 4px; font-size: 20px; }
          .meta { color: #555; font-size: 12px; margin-bottom: 16px; }
          h2 { margin-top: 20px; font-size: 15px; }
          pre { white-space: pre-wrap; border: 1px solid #ddd; border-radius: 8px; padding: 12px; font-size: 11px; }
        </style>
      </head>
      <body>
        <h1>Tutor Session</h1>
        <div class="meta">
          Topic: ${execution.request.topic} | Mode: ${execution.request.mode} | Language: ${execution.request.lang}
        </div>
        <h2>Result</h2>
        <pre>${JSON.stringify(execution.result, null, 2)}</pre>
        <h2>Stats</h2>
        <pre>${JSON.stringify(execution.stats, null, 2)}</pre>
        <h2>Questions</h2>
        <pre>${JSON.stringify(execution.questions, null, 2)}</pre>
        <script>window.onload = () => window.print();</script>
      </body>
    </html>
  `;

  win.document.open();
  win.document.write(html);
  win.document.close();
}

export default function TutorAppPage() {
  const { t } = useT();
  const [searchParams] = useSearchParams();
  const tutorView = (searchParams.get("view") || "").trim().toLowerCase();
  const isWisoView = tutorView === "wiso";
  const apiConfigured = useMemo(() => isTutorApiConfigured(), []);

  const [topics, setTopics] = useState<string[]>([]);
  const [topic, setTopic] = useState("exam_bank_ap2");
  const [mode, setMode] = useState<TutorRunMode>("exam");
  const [lang, setLang] = useState<TutorRunLang>("de");
  const [variants, setVariants] = useState<TutorVariant[]>([]);
  const [selectedVariant, setSelectedVariant] = useState("");
  const [paramsText, setParamsText] = useState("{}");
  const [paramsOpen, setParamsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [statusText, setStatusText] = useState("IDLE");
  const [execution, setExecution] = useState<TutorRunExecution | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [requestPreview, setRequestPreview] = useState<string>("");

  const topicHint = useMemo(() => {
    if (isWisoView) {
      return "WISO AP2 bundle (Wissensbasis + Trainingsfragen + Pruefungssimulation)";
    }
    const pretty = topic.replaceAll("_", " ");
    const topicTitle = pretty.charAt(0).toUpperCase() + pretty.slice(1);
    return `${topicTitle}: ${mode} mode (${lang.toUpperCase()})`;
  }, [isWisoView, topic, mode, lang]);

  useEffect(() => {
    let mounted = true;
    setTopicsError(null);
    fetchTutorTopics(mode, lang)
      .then((items) => {
        if (!mounted) return;
        setTopics(items);
        if (items.length > 0 && !items.includes(topic)) {
          setTopic(items[0]);
        }
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        const message = error instanceof Error ? error.message : String(error);
        if (apiConfigured) {
          setTopicsError(message);
        }
        setLogs((prev) => [...prev, `[topics] ${message}`]);
        if (isWisoView) {
          setTopicsError(null);
          setTopics((prev) => (prev.includes("wiso") ? prev : ["wiso", ...prev]));
          return;
        }
        void fetchTutorFallbackTopics()
          .then((items) => {
            if (!mounted) return;
            setTopics(items);
            if (items.length > 0 && !items.includes(topic)) {
              setTopic(items[0]);
            }
            setLogs((prev) => [...prev, "[topics] auto fallback topics loaded"]);
          })
          .catch(() => {
            // Keep original topicsError; no-op on fallback failure.
          });
      });
    return () => {
      mounted = false;
    };
  }, [topic, apiConfigured, mode, lang, isWisoView]);

  useEffect(() => {
    if (!isWisoView) return;
    setTopics((prev) => (prev.includes("wiso") ? prev : ["wiso", ...prev]));
    setTopic("wiso");
    setMode("trace");
    setLang("de");
    try {
      const parsed = safeParseParams(paramsText);
      const hasWisoShape = parsed && typeof parsed.section === "string";
      if (hasWisoShape) return;
    } catch {
      // If params are invalid JSON, overwrite with WISO defaults below.
    }
    setParamsText(
      JSON.stringify(
        {
          section: "bundle",
          topic: "arbeitsrecht",
          seed: 20260301,
          n_questions: 10,
        },
        null,
        2,
      ),
    );
  }, [isWisoView, paramsText]);

  useEffect(() => {
    let mounted = true;
    if (!apiConfigured || !topic) {
      setVariants([]);
      setSelectedVariant("");
      return () => {
        mounted = false;
      };
    }

    fetchTutorVariants(topic, lang)
      .then((items) => {
        if (!mounted) return;
        setVariants(items);
        const preferred = items.find((item) => item.is_default)?.id ?? items[0]?.id ?? "";
        setSelectedVariant((prev) => (prev && items.some((item) => item.id === prev) ? prev : preferred));
      })
      .catch(() => {
        if (!mounted) return;
        setVariants([]);
        setSelectedVariant("");
      });

    return () => {
      mounted = false;
    };
  }, [apiConfigured, topic, lang]);

  const useFallbackTopics = async () => {
    try {
      const items = await fetchTutorFallbackTopics();
      setTopics(items);
      if (items.length > 0 && !items.includes(topic)) {
        setTopic(items[0]);
      }
      setTopicsError(null);
      setLogs((prev) => [...prev, "[topics] fallback topics loaded"]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setLogs((prev) => [...prev, `[topics] fallback failed: ${message}`]);
    }
  };

  const handleExecute = async (label: "run" | "test") => {
    if (!apiConfigured) return;
    let params: Record<string, unknown>;
    try {
      params = safeParseParams(paramsText);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setLogs((prev) => [...prev, `[${label}] invalid params: ${message}`]);
      return;
    }

    setIsRunning(true);
    setStatusText("RUNNING");
    setLogs((prev) => [...prev, `[${label}] request started`]);
    try {
      const mergedParams = selectedVariant ? { ...params, variant: selectedVariant } : params;
      const output = await runTutorRequest({ topic, mode, lang, params: mergedParams });
      setExecution(output);
      setLogs((prev) => [...prev, `[${label}] request_id=${output.request.request_id}`]);
      if (import.meta.env.DEV) {
        const debugResponse = JSON.stringify(output.raw).slice(0, 500);
        const debugRequest = JSON.stringify(output.request);
        setLogs((prev) => [...prev, `[api-debug] request=${debugRequest}`, `[api-debug] status=200 body=${debugResponse}`]);
      }
      setStatusText("SUCCESS");
    } catch (error: unknown) {
      if (error instanceof TutorApiHttpError) {
        const errorBody = isRecord(error.payload) ? error.payload : { detail: error.responseText || error.message };
        setExecution({
          request: error.request,
          raw: errorBody,
          result: errorBody,
          events: [],
          stats: null,
          questions: [],
          logs: [],
        });
        const preview = JSON.stringify(errorBody).slice(0, 500);
        const requestJson = JSON.stringify(error.request);
        setLogs((prev) => [
          ...prev,
          `[${label}] failed: Tutor API error (${error.status})`,
          ...(import.meta.env.DEV ? [`[api-debug] request=${requestJson}`, `[api-debug] status=${error.status} body=${preview}`] : []),
        ]);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        setLogs((prev) => [...prev, `[${label}] failed: ${message}`]);
      }
      setStatusText("FAILED");
    } finally {
      setIsRunning(false);
    }
  };

  const handleRequestPreview = () => {
    try {
      const params = safeParseParams(paramsText);
      const preview = {
        api_version: "v1",
        request_id: "(generated at run)",
        topic,
        mode,
        lang,
        params: selectedVariant ? { ...params, variant: selectedVariant } : params,
      };
      setRequestPreview(JSON.stringify(preview, null, 2));
      setLogs((prev) => [...prev, `[request] ${JSON.stringify(preview, null, 2)}`]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setLogs((prev) => [...prev, `[request] invalid params: ${message}`]);
    }
  };

  const setDemoTopic = (preferred: string) => {
    if (topics.includes(preferred)) {
      setTopic(preferred);
    } else if (topics.length > 0) {
      setTopic(topics[0]);
    }
  };

  const applyTraceDemo = () => {
    setDemoTopic("bubblesort");
    setMode("trace");
    setParamsText(
      JSON.stringify(
        {
          variant: "int_asc",
          arr: [5, 1, 4, 2, 8],
        },
        null,
        2,
      ),
    );
  };

  const applyQuizDemo = () => {
    setDemoTopic("bubblesort");
    setMode("quiz");
    setParamsText(
      JSON.stringify(
        {
          seed: 1,
          numq: 3,
        },
        null,
        2,
      ),
    );
  };

  const applyPseudocodeDemo = () => {
    setDemoTopic("bubblesort");
    setMode("pseudocode");
    setParamsText(JSON.stringify({}, null, 2));
  };

  const applyExplainFaDemo = () => {
    setDemoTopic("bubblesort");
    setMode("explain");
    setLang("fa");
    setParamsText(JSON.stringify({}, null, 2));
  };

  return (
    <div className="p-4 lg:p-6 max-w-[1500px] mx-auto">
      <div className="mb-4 flex items-center gap-2 rounded-md border border-slate-700/60 bg-slate-950/60 px-3 py-2">
        <Link to="/tutor/app" className="rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm font-medium hover:bg-slate-800">
          Tutor
        </Link>
        <Link to="/tutor" className="rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm font-medium hover:bg-slate-800">
          Exam Bank (AP2)
        </Link>
        <Link to="/tutor/wiso" className="rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm font-medium hover:bg-slate-800">
          WISO
        </Link>
        <Link to="/tutor/ergaenzungspruefung" className="rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm font-medium hover:bg-slate-800">
          Ergänzungsprüfung
        </Link>
        <Link to="/learn-ai" className="rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm font-medium hover:bg-slate-800">
          {t('nav_learn_ai')}
        </Link>
      </div>
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-semibold font-display tracking-tight">Smart Academy</h1>
        <p className="text-muted-foreground">Execute tutor topics through the real adapter API when configured.</p>
      </motion.div>

      {!apiConfigured && (
        <div className="mb-4 rounded-md border border-exam/40 bg-exam/10 px-3 py-2 text-sm text-exam">
          Tutor API not configured. Set <code>VITE_TUTOR_API_URL</code> to enable Run/Test.
        </div>
      )}
      {apiConfigured && topicsError && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {topicsError}
          <button
            type="button"
            onClick={() => void useFallbackTopics()}
            className="ml-3 rounded border border-red-300/60 px-2 py-1 text-xs hover:bg-red-500/20"
          >
            Use fallback topics
          </button>
        </div>
      )}

      <div className="grid gap-4 2xl:grid-cols-[420px_1fr]">
        <TutorControlPanel
          topics={topics}
          topic={topic}
          mode={mode}
          lang={lang}
          variants={variants}
          selectedVariant={selectedVariant}
          statusText={statusText}
          topicHint={topicHint}
          paramsText={paramsText}
          paramsOpen={paramsOpen}
          apiConfigured={apiConfigured}
          isRunning={isRunning}
          onTopicChange={setTopic}
          onModeChange={setMode}
          onLangChange={setLang}
          onVariantChange={setSelectedVariant}
          onParamsTextChange={setParamsText}
          onToggleParamsOpen={() => setParamsOpen((prev) => !prev)}
          onRun={() => void handleExecute("run")}
          onTest={() => void handleExecute("test")}
          onExportPdf={() => execution && exportExecutionPdf(execution)}
          onRequestPreview={handleRequestPreview}
          onPresetTrace={applyTraceDemo}
          onPresetQuiz={applyQuizDemo}
          onPresetPseudocode={applyPseudocodeDemo}
          onPresetExplainFa={applyExplainFaDemo}
        />

        <div className="space-y-3 min-w-0">
          {requestPreview && (
            <div className="rounded-md border p-2.5 sm:p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Request Preview</div>
              <pre className="max-h-[180px] overflow-auto text-xs">{requestPreview}</pre>
            </div>
          )}
          <TutorOutputTabs
            execution={execution}
            logs={logs}
            variants={variants}
            selectedVariant={selectedVariant}
            onVariantChange={setSelectedVariant}
          />
        </div>
      </div>
    </div>
  );
}
