// SmartFlow -- Memory Transparency Level v1 (CORE-W6, ADR-0023 SS1).
//
// Extraction-run visibility + retry. No new schema: personal_memory_extraction_runs
// already carries everything needed (see personalMemoryRecordRepository.ts's
// listRunsByOwner) -- this component only adds a UI that was previously
// missing entirely. "Retry" is the SAME triggerExtraction prop
// PersonalMemorySection already receives, not a new mechanism.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { localeFor, useT, type TranslationKey } from "@/i18n";
import type { PersonalMemoryExtractionRun } from "../personalMemoryRecordTypes";
import type { PersonalMemoryRecordService } from "../personalMemoryRecordService";
import type { PersonalMemoryExtractionTriggerResult } from "../personalMemoryExtractionTriggerClient";

export interface PersonalMemoryExtractionRunHistoryProps {
  readonly service: Pick<PersonalMemoryRecordService, "listRuns">;
  readonly triggerExtraction: () => Promise<PersonalMemoryExtractionTriggerResult>;
  /** Called after a successfully-completed retry, so the record list above can refresh too. */
  readonly onRunsChanged?: () => void;
}

// A synchronous run that started this long ago and never got a completed_at
// almost certainly means the Worker died mid-request (crash/timeout), not
// "still in flight" -- there is no async job queue here to actually still be
// running. ADR-0023 SS1: rendered as "Interrupted", distinct from a
// completed run's own outcome ('completed' | 'failed').
const INTERRUPTED_AFTER_MS = 2 * 60 * 1000;

type RunDisplayOutcome = "completed" | "failed" | "interrupted" | "in_progress";

function displayOutcome(run: PersonalMemoryExtractionRun, now: number): RunDisplayOutcome {
  if (run.outcome === "completed") return "completed";
  if (run.outcome === "failed") return "failed";
  const startedAtMs = new Date(run.startedAt).getTime();
  return now - startedAtMs > INTERRUPTED_AFTER_MS ? "interrupted" : "in_progress";
}

function runKindLabel(run: PersonalMemoryExtractionRun): "facts" | "people" {
  return run.derivationVersion.startsWith("people-extraction") ? "people" : "facts";
}

const OUTCOME_BADGE_CLASSES: Record<RunDisplayOutcome, string> = {
  completed: "rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600 dark:text-emerald-400",
  failed: "rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive",
  interrupted: "rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-600 dark:text-amber-400",
  in_progress: "rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground",
};

// TranslationKey is a closed union of literal keys -- a dynamically built
// template-string key would not type-check against it, so the mapping is
// spelled out explicitly rather than interpolated.
const OUTCOME_LABEL_KEY: Record<RunDisplayOutcome, TranslationKey> = {
  completed: "personal_memory_extraction_history_outcome_completed",
  failed: "personal_memory_extraction_history_outcome_failed",
  interrupted: "personal_memory_extraction_history_outcome_interrupted",
  in_progress: "personal_memory_extraction_history_outcome_in_progress",
};

const KIND_LABEL_KEY: Record<"facts" | "people", TranslationKey> = {
  facts: "personal_memory_extraction_history_kind_facts",
  people: "personal_memory_extraction_history_kind_people",
};

export function PersonalMemoryExtractionRunHistory({
  service,
  triggerExtraction,
  onRunsChanged,
}: Readonly<PersonalMemoryExtractionRunHistoryProps>) {
  const { t, lang } = useT();
  const locale = localeFor(lang);
  const [runs, setRuns] = useState<readonly PersonalMemoryExtractionRun[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await service.listRuns();
      setRuns(result);
      setLoadError(null);
    } catch (error) {
      // A plain, untranslated fallback -- deliberately NOT calling t() here
      // (mirrors PersonalMemorySection.tsx's own load() exactly): including
      // `t` in this callback's deps would give it a new identity every
      // render (useT() returns a fresh closure each call), and since this
      // callback is itself the sole dependency of the mount-time useEffect
      // below, that would re-fire the effect -- and therefore re-fetch --
      // on every render, eventually exhausting a test's mocked resolved
      // values and setting `runs` to undefined.
      setLoadError(error instanceof Error ? error.message : "Extraction history could not be loaded.");
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    setRetryMessage(null);
    try {
      const result = await triggerExtraction();
      // The `in` guard (not `if (!result.ok)`/`if (result.ok)`) because this
      // tsconfig has strictNullChecks off, where a boolean discriminant does
      // not narrow a discriminated union (same gotcha documented in
      // JournalCompanion.tsx / SchedulePicker.tsx, verified against tsc 5.9).
      if ("code" in result) {
        setRetryMessage(result.message);
      } else {
        setRetryMessage(t("personal_memory_extraction_history_retry_success", { accepted: result.acceptedCount }));
        await load();
        onRunsChanged?.();
      }
    } finally {
      setRetrying(false);
    }
  }, [load, onRunsChanged, triggerExtraction, t]);

  const now = Date.now();

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="personal-memory-extraction-history-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="personal-memory-extraction-history-heading" className="text-sm font-semibold text-foreground">
          {t("personal_memory_extraction_history_title")}
        </h3>
        <Button type="button" size="sm" variant="outline" onClick={() => void handleRetry()} disabled={retrying}>
          <RefreshCw className={retrying ? "mr-1.5 h-3.5 w-3.5 animate-spin" : "mr-1.5 h-3.5 w-3.5"} aria-hidden="true" />
          {retrying ? t("personal_memory_extraction_history_retrying") : t("personal_memory_extraction_history_retry")}
        </Button>
      </div>

      {retryMessage && (
        <p role="status" aria-live="polite" className="mt-2 text-xs text-muted-foreground">
          {retryMessage}
        </p>
      )}
      {loadError && (
        <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {loadError}
        </p>
      )}
      {runs === null && !loadError && (
        <p className="mt-3 text-sm text-muted-foreground">{t("personal_memory_extraction_history_loading")}</p>
      )}
      {runs !== null && runs.length === 0 && !loadError && (
        <p className="mt-3 text-sm text-muted-foreground">{t("personal_memory_extraction_history_empty")}</p>
      )}

      {runs !== null && runs.length > 0 && (
        <ul className="mt-3 space-y-2">
          {runs.map((run) => {
            const outcome = displayOutcome(run, now);
            return (
              <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">{t(KIND_LABEL_KEY[runKindLabel(run)])}</span>
                  <span className="mx-1.5 text-muted-foreground">&middot;</span>
                  <span className="text-muted-foreground">{new Date(run.startedAt).toLocaleString(locale)}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className={OUTCOME_BADGE_CLASSES[outcome]}>
                    {t(OUTCOME_LABEL_KEY[outcome])}
                  </span>
                  {outcome !== "in_progress" && (
                    <span className="text-muted-foreground">
                      {t("personal_memory_extraction_history_counts", {
                        accepted: run.acceptedCount,
                        dropped: run.droppedCount,
                      })}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
