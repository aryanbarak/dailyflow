import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TutorRunExecution, TutorVariant } from "@/lib/tutor/types";

interface TutorOutputTabsProps {
  execution: TutorRunExecution | null;
  logs: string[];
  variants?: TutorVariant[];
  selectedVariant?: string;
  onVariantChange?: (value: string) => void;
}

interface DisplayVariant {
  id: string;
  label: string;
}

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const codeParts = text.split(/(`[^`]+`)/g).filter((part) => part.length > 0);
  const nodes: ReactNode[] = [];

  codeParts.forEach((part, partIndex) => {
    const codeMatch = part.match(/^`([^`]+)`$/);
    if (codeMatch) {
      nodes.push(
        <code key={`code-${partIndex}`} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">
          {codeMatch[1]}
        </code>,
      );
      return;
    }

    const boldParts = part.split(/(\*\*[^*]+\*\*)/g).filter((token) => token.length > 0);
    boldParts.forEach((token, tokenIndex) => {
      const boldMatch = token.match(/^\*\*([^*]+)\*\*$/);
      if (boldMatch) {
        nodes.push(
          <strong key={`bold-${partIndex}-${tokenIndex}`} className="font-semibold text-foreground">
            {boldMatch[1]}
          </strong>,
        );
      } else {
        nodes.push(<span key={`txt-${partIndex}-${tokenIndex}`}>{token}</span>);
      }
    });
  });

  return nodes;
}

function renderMultilineText(text: string, rtl = false) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const blocks: ReactNode[] = [];
  let currentList: string[] = [];

  const flushList = () => {
    if (currentList.length === 0) return;
    blocks.push(
      <ul key={`list-${blocks.length}`} className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
        {currentList.map((item, i) => (
          <li key={`${item}-${i}`}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>,
    );
    currentList = [];
  };

  lines.forEach((line) => {
    const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
    const numberedMatch = line.match(/^\d+[.)]\s+(.+)$/);
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);

    if (bulletMatch || numberedMatch) {
      currentList.push((bulletMatch?.[1] ?? numberedMatch?.[1] ?? "").trim());
      return;
    }

    flushList();

    if (headingMatch) {
      blocks.push(
        <h4 key={`h-${blocks.length}`} className="text-sm font-semibold text-foreground">
          {renderInlineMarkdown(headingMatch[1])}
        </h4>,
      );
      return;
    }

    blocks.push(
      <p key={`p-${blocks.length}`} className="text-sm leading-6 text-muted-foreground">
        {renderInlineMarkdown(line)}
      </p>,
    );
  });

  flushList();

  return <div className={rtl ? "space-y-2 text-right" : "space-y-2"} dir={rtl ? "rtl" : "ltr"}>{blocks}</div>;
}

function pickFirstText(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalizeGlossaryEntries(rawGlossary: unknown): Array<{ term: string; definition: string }> {
  if (Array.isArray(rawGlossary)) {
    return rawGlossary
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .map((item) => {
        const term = pickFirstText(item, ["term", "title", "key"]);
        const definition = pickFirstText(item, ["de", "fa", "definition", "text", "value"]);
        return { term, definition };
      })
      .filter((item) => item.term.length > 0 || item.definition.length > 0);
  }

  if (isRecord(rawGlossary)) {
    return Object.entries(rawGlossary).map(([term, definition]) => ({
      term,
      definition: typeof definition === "string" ? definition : stringify(definition),
    }));
  }

  return [];
}

function renderPseudocodeResult(result: unknown, lang: string, selectedVariantFromUi?: string) {
  if (!isRecord(result) || result.mode !== "pseudocode") return null;

  const topic = typeof result.topic === "string" ? result.topic : "";
  const variants = Array.isArray(result.variants) ? result.variants : [];
  const selectedVariantFromResult = typeof result.selected_variant === "string" ? result.selected_variant : "";
  const selectedVariant = selectedVariantFromUi && variants.some((item) => isRecord(item) && item.id === selectedVariantFromUi)
    ? selectedVariantFromUi
    : selectedVariantFromResult;
  const selectedVariantItem = variants.find((item) => isRecord(item) && item.id === selectedVariant);
  const pseudocodeFromVariant = isRecord(selectedVariantItem) && typeof selectedVariantItem.pseudocode === "string"
    ? selectedVariantItem.pseudocode
    : "";
  const pseudocode = pseudocodeFromVariant || (typeof result.pseudocode === "string" ? result.pseudocode : "");
  const variantLabels = isRecord(selectedVariantItem) && isRecord(selectedVariantItem.labels)
    ? selectedVariantItem.labels
    : null;
  const selectedVariantLabel = variantLabels
    ? (
      typeof variantLabels[lang.toLowerCase()] === "string"
        ? String(variantLabels[lang.toLowerCase()])
        : (typeof variantLabels.de === "string"
          ? variantLabels.de
          : (typeof variantLabels.fa === "string" ? variantLabels.fa : selectedVariant))
    )
    : (isRecord(selectedVariantItem) && typeof selectedVariantItem.title === "string"
      ? selectedVariantItem.title
      : selectedVariant);
  const explainVariant = isRecord(selectedVariantItem) && isRecord(selectedVariantItem.explain_variant)
    ? selectedVariantItem.explain_variant
    : null;
  const normalizedLang = lang.toLowerCase();
  const explainText = explainVariant
    ? (
      normalizedLang === "fa"
        ? (typeof explainVariant.fa === "string"
          ? explainVariant.fa
          : (typeof explainVariant.de === "string" ? explainVariant.de : ""))
        : (typeof explainVariant.de === "string"
          ? explainVariant.de
          : "")
    )
    : "";
  const explainTextFa = explainVariant && typeof explainVariant.fa === "string" ? explainVariant.fa : "";

  if (!pseudocode && variants.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 space-y-1">
        <div className="font-medium text-emerald-600 dark:text-emerald-300">📄 {topic || "unknown"} {selectedVariantLabel ? `- ${selectedVariantLabel}` : ""}</div>
      </div>

      <div className="rounded-md border p-3 space-y-1">
        <div className="font-medium">Algorithm</div>
        <div className="text-sm text-muted-foreground">
          {topic || "unknown"} {selectedVariantLabel ? `- ${selectedVariantLabel}` : ""}
        </div>
      </div>

      {pseudocode && (
        <div className="rounded-md border border-emerald-500/50 bg-emerald-500/10 dark:bg-[#0b2a13] p-2.5 sm:p-3 space-y-2">
          <div className="font-medium text-emerald-600 dark:text-emerald-300">Pseudocode</div>
          <pre className="text-[11px] sm:text-xs leading-6 overflow-auto whitespace-pre-wrap text-emerald-900 dark:text-emerald-100">{pseudocode}</pre>
        </div>
      )}

      {explainText && (
        <div className="rounded-md border p-3 space-y-2">
          <div className="font-medium">{normalizedLang === "fa" ? "توضیح نسخه" : "Variant Explanation"}</div>
          {renderMultilineText(explainText, normalizedLang === "fa")}
        </div>
      )}

      {explainTextFa && normalizedLang !== "fa" && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 space-y-2">
          <div className="font-medium text-right text-emerald-700 dark:text-emerald-200" dir="rtl">توضیح فارسی این Variant</div>
          {renderMultilineText(explainTextFa, true)}
        </div>
      )}
    </div>
  );
}

function pickEventMessage(event: Record<string, unknown>, lang: string): string {
  const localizedByLang = lang.toLowerCase() === "fa"
    ? ["message_fa", "messageFa", "text_fa", "textFa"]
    : ["message_de", "messageDe", "text_de", "textDe"];

  const generic = ["message", "text", "detail", "description", "title"];
  for (const key of [...localizedByLang, ...generic]) {
    const value = event[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function renderEvents(events: unknown[], lang: string) {
  if (!Array.isArray(events) || events.length === 0) {
    return <div className="text-sm text-muted-foreground">No events.</div>;
  }

  return (
    <div className="space-y-2">
      {events.map((item, index) => {
        if (!isRecord(item)) {
          return (
            <pre key={`event-raw-${index}`} className="rounded-md border p-3 text-xs overflow-auto">
              {stringify(item)}
            </pre>
          );
        }

        const type = typeof item.type === "string" ? item.type : (typeof item.level === "string" ? item.level : "event");
        const message = pickEventMessage(item, lang);

        return (
          <div key={`event-${index}`} className="rounded-md border p-3 space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{type}</div>
            {message ? <div className="text-sm leading-6">{message}</div> : <pre className="text-xs overflow-auto">{stringify(item)}</pre>}
          </div>
        );
      })}
    </div>
  );
}

function renderQuestions(questions: unknown[]) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return <div className="text-sm text-muted-foreground">No questions.</div>;
  }

  return (
    <div className="space-y-3">
      {questions.map((item, index) => {
        if (!isRecord(item)) {
          return (
            <pre key={`q-raw-${index}`} className="rounded-md border p-3 text-xs overflow-auto">
              {stringify(item)}
            </pre>
          );
        }

        const id = pickFirstText(item, ["id", "qid"]) || `question-${index + 1}`;
        const category = pickFirstText(item, ["category"]);
        const difficulty = pickFirstText(item, ["difficulty"]);
        const prompt = pickFirstText(item, ["prompt", "question", "question_de", "task"]);
        const answerShort = pickFirstText(item, ["answer_short", "answer", "answer_de"]);
        const answerLong = pickFirstText(item, ["answer_long"]);
        const explainFa = pickFirstText(item, ["explain_fa"]);

        return (
          <div key={id} className="rounded-md border p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded border px-2 py-0.5">{id}</span>
              {category && <span className="rounded border px-2 py-0.5 text-muted-foreground">{category}</span>}
              {difficulty && <span className="rounded border px-2 py-0.5 text-muted-foreground">{difficulty}</span>}
            </div>

            {prompt && (
              <div className="space-y-1">
                <div className="text-sm font-medium">Question</div>
                <div className="text-sm leading-6">{renderInlineMarkdown(prompt)}</div>
              </div>
            )}

            {(answerShort || answerLong) && (
              <div className="space-y-1">
                <div className="text-sm font-medium">Answer</div>
                {answerShort && <div className="text-sm leading-6 text-muted-foreground">{renderInlineMarkdown(answerShort)}</div>}
                {answerLong && <div className="text-sm leading-6 text-muted-foreground">{renderInlineMarkdown(answerLong)}</div>}
              </div>
            )}

            {explainFa && (
              <div className="space-y-1">
                <div className="text-sm font-medium text-right" dir="rtl">توضیح فارسی</div>
                <div dir="rtl">{renderMultilineText(explainFa, true)}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function renderExplainResult(result: unknown) {
  if (!isRecord(result)) return null;

  const schemaName = typeof result.schema_name === "string" ? result.schema_name : "";
  if (schemaName === "tutor_asset.explain.v1") {
    const title = typeof result.title === "string" ? result.title : "";
    const summary = typeof result.summary === "string" ? result.summary : "";
    const lang = typeof result.lang === "string" ? result.lang.toLowerCase() : "de";
    const rtl = lang === "fa";
    const blocks = Array.isArray(result.blocks) ? result.blocks : [];
    if (!title && !summary && blocks.length === 0) return null;

    return (
      <div className="space-y-4">
        {title && <h3 className="text-base font-semibold">{title}</h3>}
        {summary && (
          <div className="rounded-md border p-3">
            {renderMultilineText(summary, rtl)}
          </div>
        )}
        {blocks.map((block, index) => {
          if (!isRecord(block)) return null;
          const kind = typeof block.kind === "string" ? block.kind : `block-${index + 1}`;
          const text = typeof block.text === "string" ? block.text : "";
          if (!text.trim()) return null;
          return (
            <div key={`${kind}-${index}`} className="rounded-md border p-3 space-y-2">
              <div className="font-medium capitalize">{kind.replaceAll("_", " ")}</div>
              {renderMultilineText(text, rtl)}
            </div>
          );
        })}
      </div>
    );
  }

  const title = typeof result.title === "string" ? result.title : "";
  const sectionsRaw = Array.isArray(result.sections) ? result.sections : [];
  if (!title && sectionsRaw.length === 0) return null;

  const exercises = toStringArray(result.exercises);
  const examTips = toStringArray(result.exam_tips);
  const glossaryEntries = normalizeGlossaryEntries(result.glossary);

  return (
    <div className="space-y-4">
      {title && <h3 className="text-base font-semibold">{title}</h3>}

      {sectionsRaw.map((section, index) => {
        if (!isRecord(section)) return null;
        const heading = typeof section.heading === "string"
          ? section.heading
          : (typeof section.title === "string" ? section.title : `Section ${index + 1}`);
        const body = typeof section.body === "string" ? section.body : "";
        const rtl = section.rtl === true;
        const paragraphs = toStringArray(section.paragraphs);
        const bullets = toStringArray(section.bullets);

        return (
          <div key={`${heading}-${index}`} className="rounded-md border p-3 space-y-2">
            <div className="font-medium">{heading}</div>
            {body && renderMultilineText(body, rtl)}
            {paragraphs.map((paragraph, pIndex) => (
              <p key={`${heading}-p-${pIndex}`} className="text-sm leading-6 text-muted-foreground">
                {paragraph}
              </p>
            ))}
            {bullets.length > 0 && (
              <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                {bullets.map((bullet, bIndex) => (
                  <li key={`${heading}-b-${bIndex}`}>{bullet}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {(exercises.length > 0 || (Array.isArray(result.exercises) && result.exercises.some((e) => isRecord(e)))) && (
        <div className="rounded-md border p-3 space-y-2">
          <div className="font-medium">Exercises</div>
          {Array.isArray(result.exercises) && result.exercises.some((e) => isRecord(e)) ? (
            <div className="space-y-2">
              {result.exercises.map((exercise, index) => {
                if (!isRecord(exercise)) return null;
                const task = typeof exercise.task_fa === "string"
                  ? exercise.task_fa
                  : (typeof exercise.task_de === "string"
                    ? exercise.task_de
                    : (typeof exercise.task === "string" ? exercise.task : ""));
                const expected = typeof exercise.expected === "string" ? exercise.expected : "";
                return (
                  <div key={`exercise-${index}`} className="rounded border p-2 space-y-1">
                    {task && <div className="text-sm">{task}</div>}
                    {expected && <div className="text-xs text-muted-foreground">Expected: {expected}</div>}
                  </div>
                );
              })}
            </div>
          ) : (
            <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
              {exercises.map((exercise, index) => (
                <li key={`exercise-${index}`}>{exercise}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {examTips.length > 0 && (
        <div className="rounded-md border p-3 space-y-2">
          <div className="font-medium">Exam Tips</div>
          <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
            {examTips.map((tip, index) => (
              <li key={`tip-${index}`}>{tip}</li>
            ))}
          </ul>
        </div>
      )}

      {glossaryEntries.length > 0 && (
        <div className="rounded-md border p-3 space-y-2">
          <div className="font-medium">Glossary</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {glossaryEntries.map(({ term, definition }, index) => (
              <div key={`${term}-${index}`} className="rounded border p-2">
                {term && <div className="text-sm font-medium">{term}</div>}
                <div className="text-xs text-muted-foreground">
                  {renderInlineMarkdown(definition)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function TutorOutputTabs({
  execution,
  logs,
  variants = [],
  selectedVariant = "",
  onVariantChange,
}: TutorOutputTabsProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  const executionVariants: DisplayVariant[] = (() => {
    if (!execution || !isRecord(execution.result) || !Array.isArray(execution.result.variants)) return [];
    const currentLang = execution.request.lang.toLowerCase();
    return execution.result.variants
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .map((item) => {
        const id = typeof item.id === "string" ? item.id : "";
        const labels = isRecord(item.labels) ? item.labels : null;
        const label = labels
          ? (typeof labels[currentLang] === "string"
            ? String(labels[currentLang])
            : (typeof labels.de === "string"
              ? labels.de
              : (typeof labels.fa === "string" ? labels.fa : id)))
          : (typeof item.title === "string" ? item.title : id);
        return { id, label };
      })
      .filter((item) => item.id.length > 0);
  })();
  const variantsForSelector: DisplayVariant[] = executionVariants.length > 0
    ? executionVariants
    : variants.map((item) => ({ id: item.id, label: item.label || item.id }));

  const getCopyableCode = () => {
    if (!execution || !isRecord(execution.result)) return "";
    const pseudocode = execution.result.pseudocode;
    if (typeof pseudocode === "string" && pseudocode.trim()) return pseudocode;
    return JSON.stringify(execution.result, null, 2);
  };

  const handleCopyCode = async () => {
    try {
      const text = getCopyableCode();
      if (!text) return;
      await navigator.clipboard.writeText(text);
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 1200);
    } catch {
      setCopyStatus("error");
      setTimeout(() => setCopyStatus("idle"), 1200);
    }
  };

  const handleFullscreen = () => {
    const root = document.documentElement;
    if (!document.fullscreenElement) {
      void root.requestFullscreen();
    } else {
      void document.exitFullscreen();
    }
  };

  if (!execution) {
    return (
      <Card className="h-full">
        <CardContent className="pt-6 space-y-3">
          <div className="text-sm text-muted-foreground">No output yet. Click Run to execute.</div>
          {logs.length > 0 && (
            <pre className="max-h-[40vh] overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap">
              {logs.join("\n")}
            </pre>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full border-border bg-card dark:border-slate-700/70 dark:bg-[#090d1a]">
      <CardHeader className="pb-3 px-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-xl sm:text-2xl font-semibold leading-none tracking-tight">Execution Output</CardTitle>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button size="sm" variant="outline" onClick={() => void handleCopyCode()}>
              {copyStatus === "copied" ? "Copied" : copyStatus === "error" ? "Copy failed" : "Copy Code"}
            </Button>
            <Button size="sm" variant="outline" onClick={handleFullscreen}>
              Fullscreen
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-3 sm:px-6">
        <Tabs defaultValue="result" className="w-full">
          <TabsList className="flex w-full overflow-x-auto rounded-lg bg-muted p-1 dark:bg-[#131b2e] gap-1 h-auto scrollbar-thin">
            <TabsTrigger value="result" className="min-w-[90px] data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-700 dark:data-[state=active]:text-emerald-600 dark:text-emerald-300">
              Result
            </TabsTrigger>
            <TabsTrigger value="events" className="min-w-[90px] data-[state=active]:bg-background data-[state=active]:text-foreground dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-slate-100">
              Events
            </TabsTrigger>
            <TabsTrigger value="questions" className="min-w-[90px] data-[state=active]:bg-background data-[state=active]:text-foreground dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-slate-100">
              Questions
            </TabsTrigger>
            <TabsTrigger value="stats" className="min-w-[90px] data-[state=active]:bg-background data-[state=active]:text-foreground dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-slate-100">
              Stats
            </TabsTrigger>
            <TabsTrigger value="raw" className="min-w-[90px] data-[state=active]:bg-background data-[state=active]:text-foreground dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-slate-100">
              Raw
            </TabsTrigger>
            <TabsTrigger value="logs" className="min-w-[90px] data-[state=active]:bg-background data-[state=active]:text-foreground dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-slate-100">
              Logs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="result" className="mt-4">
            {variantsForSelector.length > 0 && (
              <div className="sticky top-2 z-10 rounded-md border border-indigo-500/50 bg-card/95 backdrop-blur dark:bg-[#0f1730]/95 p-3 mb-3">
                <div className="grid gap-2 md:grid-cols-[140px_1fr] md:items-center">
                  <div className="text-sm font-medium text-muted-foreground">Variants ({variantsForSelector.length})</div>
                  <Select value={selectedVariant} onValueChange={(value) => onVariantChange?.(value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select variant" />
                    </SelectTrigger>
                    <SelectContent>
                      {variantsForSelector.map((variant) => (
                        <SelectItem key={variant.id} value={variant.id}>
                          {variant.label || variant.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {renderPseudocodeResult(execution.result, execution.request.lang, selectedVariant) ?? renderExplainResult(execution.result) ?? (
              <pre className="max-h-[55vh] overflow-auto rounded-md border p-3 text-xs">{stringify(execution.result)}</pre>
            )}
          </TabsContent>

          <TabsContent value="events" className="mt-4">
            <div className="max-h-[55vh] overflow-auto rounded-md border p-3 text-xs">
              {renderEvents(execution.events, execution.request.lang)}
            </div>
          </TabsContent>

          <TabsContent value="questions" className="mt-4">
            <div className="max-h-[55vh] overflow-auto rounded-md border p-3 text-xs">
              {renderQuestions(execution.questions)}
            </div>
          </TabsContent>

          <TabsContent value="stats" className="mt-4">
            <pre className="max-h-[55vh] overflow-auto rounded-md border p-3 text-xs">{stringify(execution.stats)}</pre>
          </TabsContent>

          <TabsContent value="raw" className="mt-4">
            <pre className="max-h-[55vh] overflow-auto rounded-md border p-3 text-xs">{stringify(execution.raw)}</pre>
          </TabsContent>

          <TabsContent value="logs" className="mt-4">
            <pre className="max-h-[55vh] overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap">
              {logs.length > 0 ? logs.join("\n") : "No logs."}
            </pre>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
