// SmartFlow -- Memory Transparency Level v1 (CORE-W6, ADR-0023 SS2).
//
// Displays recent recall batches: "these N records were recalled together
// at time T by consumer X". A batch whose every cited record has since been
// deleted has already had every one of its rows removed by the migration's
// ON DELETE CASCADE (see personal_memory_recall_log's own comment) -- it
// simply does not appear here anymore, which is the intended behavior, not
// something this component needs to special-case.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { localeFor, useT, type TranslationKey } from "@/i18n";
import { personalMemoryKindLabel } from "../personalMemoryRecordPresentation";
import {
  groupPersonalMemoryRecallEntriesIntoBatches,
  type PersonalMemoryRecallConsumer,
  type PersonalMemoryRecallLogEntry,
} from "../personalMemoryRecallLogTypes";
import type { PersonalMemoryRecallLogService } from "../personalMemoryRecallLogService";

export interface PersonalMemoryRecallLogViewerProps {
  readonly service: Pick<PersonalMemoryRecallLogService, "listByOwner">;
}

const CONSUMER_LABEL_KEY: Record<PersonalMemoryRecallConsumer, TranslationKey> = {
  chat: "personal_memory_recall_log_consumer_chat",
  briefing: "personal_memory_recall_log_consumer_briefing",
  tutor: "personal_memory_recall_log_consumer_tutor",
};

export function PersonalMemoryRecallLogViewer({ service }: Readonly<PersonalMemoryRecallLogViewerProps>) {
  const { t, lang } = useT();
  const locale = localeFor(lang);
  const [entries, setEntries] = useState<readonly PersonalMemoryRecallLogEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await service.listByOwner();
      setEntries(result);
      setLoadError(null);
    } catch (error) {
      // Plain, untranslated fallback -- see PersonalMemoryExtractionRunHistory.tsx's
      // identical comment: `t` must not be a dependency of a callback the
      // mount-time useEffect depends on, since useT() returns a new
      // closure every render.
      setLoadError(error instanceof Error ? error.message : "The recall log could not be loaded.");
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  const batches = entries === null ? null : groupPersonalMemoryRecallEntriesIntoBatches(entries);

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="personal-memory-recall-log-heading">
      <h3 id="personal-memory-recall-log-heading" className="text-sm font-semibold text-foreground">
        {t("personal_memory_recall_log_title")}
      </h3>

      {loadError && (
        <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {loadError}
        </p>
      )}
      {batches === null && !loadError && (
        <p className="mt-3 text-sm text-muted-foreground">{t("personal_memory_recall_log_loading")}</p>
      )}
      {batches !== null && batches.length === 0 && !loadError && (
        <p className="mt-3 text-sm text-muted-foreground">{t("personal_memory_recall_log_empty")}</p>
      )}

      {batches !== null && batches.length > 0 && (
        <ul className="mt-3 space-y-3">
          {batches.map((batch) => (
            <li key={batch.recallBatchId} className="rounded-md border border-border/60 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t(CONSUMER_LABEL_KEY[batch.consumer])}</span>
                <span className="text-xs text-muted-foreground">{new Date(batch.createdAt).toLocaleString(locale)}</span>
              </div>
              <ul className="mt-1.5 space-y-1">
                {batch.entries.map((entry) => (
                  <li key={entry.id} className="text-xs text-muted-foreground">
                    <span className="uppercase tracking-wide">{personalMemoryKindLabel(entry.recordKind)}</span>
                    <span className="mx-1">&middot;</span>
                    <span>{entry.recordPrimaryText}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
