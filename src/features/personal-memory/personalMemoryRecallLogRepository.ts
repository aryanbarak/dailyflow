// SmartFlow -- Memory Transparency Level v1 (CORE-W6, ADR-0023 SS2).
//
// Persistence boundary for the recall log. Mirrors
// personalMemoryRecordRepository.ts's shape: an explicit interface, real
// Supabase reads for the list, a SECURITY DEFINER RPC
// (log_personal_memory_recall) for the one write this repository ever
// performs -- the Learn AI tutor's own recall event, since the tutor runs
// entirely in the browser and never as service_role (see ADR-0023
// Context). /chat and briefing generation write directly via the Worker's
// supabasePost helper and never touch this repository.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PersonalMemoryRecordKind } from "./personalMemoryRecordTypes";
import { personalMemoryRecordPrimaryText } from "./personalMemoryRecordPresentation";
import type { PersonalMemoryRecallLogEntry } from "./personalMemoryRecallLogTypes";

export class PersonalMemoryRecallLogPersistenceError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "PersonalMemoryRecallLogPersistenceError";
  }
}

export class PersonalMemoryRecallLogTransactionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PersonalMemoryRecallLogTransactionError";
  }
}

const RECALL_TRANSACTION_ERROR_CODES = new Set([
  "UNAUTHENTICATED",
  "UNSUPPORTED_CONSUMER",
  "INVALID_RECORD_IDS",
  "RECORD_NOT_ELIGIBLE",
]);

function extractTransactionErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return null;
  const trimmed = message.trim();
  return RECALL_TRANSACTION_ERROR_CODES.has(trimmed) ? trimmed : null;
}

/** Loosely typed row -- same convention as personalMemoryRecordRepository.ts's own PersonalMemoryRecordRow (the generated Database type does not yet include this table). The embedded `personal_memory_records` relation is present only when the cited record still exists -- a deleted record's citation row was already removed by the migration's ON DELETE CASCADE, so it is never fetched with a null relation. */
interface PersonalMemoryRecallLogRow {
  id: string;
  record_id: string;
  consumer: string;
  recall_batch_id: string;
  created_at: string;
  personal_memory_records: { kind: string; content: unknown } | null;
}

const RECALL_LOG_COLUMNS = "id,record_id,consumer,recall_batch_id,created_at,personal_memory_records(kind,content)";

function mapRowToEntry(row: PersonalMemoryRecallLogRow): PersonalMemoryRecallLogEntry | null {
  // Defensive only -- PostgREST's embedded-resource select already excludes
  // rows whose relation target doesn't exist under RLS, and the cascade
  // means a deleted record's row is gone entirely, not null-relationed. A
  // null embed here would mean something unexpected, so it is dropped
  // rather than rendered with placeholder text.
  if (!row.personal_memory_records) return null;
  return {
    id: row.id,
    recordId: row.record_id,
    recordKind: row.personal_memory_records.kind as PersonalMemoryRecordKind,
    recordPrimaryText: personalMemoryRecordPrimaryText(row.personal_memory_records.content as never),
    consumer: row.consumer as PersonalMemoryRecallLogEntry["consumer"],
    recallBatchId: row.recall_batch_id,
    createdAt: row.created_at,
  };
}

export interface PersonalMemoryRecallLogRepository {
  listByOwner(ownerId: string, limit?: number): Promise<readonly PersonalMemoryRecallLogEntry[]>;
  /** The tutor's only write path -- calls log_personal_memory_recall (SECURITY DEFINER, re-verifies ownership + confirmed/corrected eligibility server-side). */
  logTutorRecall(recordIds: readonly string[]): Promise<{ readonly recallBatchId: string }>;
}

export function createSupabasePersonalMemoryRecallLogRepository(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any>,
): PersonalMemoryRecallLogRepository {
  return {
    async listByOwner(ownerId, limit = 50) {
      const { data, error } = await client
        .from("personal_memory_recall_log")
        .select(RECALL_LOG_COLUMNS)
        .eq("user_id", ownerId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw new PersonalMemoryRecallLogPersistenceError("Unable to list the recall log.", error);
      return ((data ?? []) as unknown as PersonalMemoryRecallLogRow[])
        .map(mapRowToEntry)
        .filter((entry): entry is PersonalMemoryRecallLogEntry => entry !== null);
    },

    async logTutorRecall(recordIds) {
      const { data, error } = await client.rpc("log_personal_memory_recall", {
        p_record_ids: recordIds,
        p_consumer: "tutor",
      });

      if (error) {
        const code = extractTransactionErrorCode(error);
        if (code) throw new PersonalMemoryRecallLogTransactionError(code, "The recall-log transaction was rejected.");
        throw new PersonalMemoryRecallLogPersistenceError("Unable to log the tutor's memory recall.", error);
      }
      const result = data as { outcome?: "logged"; recallBatchId?: string };
      if (result.outcome !== "logged" || !result.recallBatchId) {
        throw new PersonalMemoryRecallLogPersistenceError("The recall-log transaction returned an incomplete result.");
      }
      return { recallBatchId: result.recallBatchId };
    },
  };
}
