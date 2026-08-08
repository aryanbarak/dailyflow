// SmartFlow -- Personal Memory Layer (ADR-0010).
//
// The persistence boundary. Mirrors inferredProjectContextFieldRepository.ts's
// shape exactly: an explicit, strongly-typed interface so the service layer
// depends on a contract, not a concrete Supabase client. `insert`/`resolve`/
// `remove` call the three SECURITY DEFINER functions (create_personal_memory_record,
// resolve_personal_memory_record, delete_personal_memory_record) -- never a
// plain table INSERT/UPDATE/DELETE, since `authenticated` holds neither
// grant on personal_memory_records.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CompletePersonalMemoryExtractionRunInput,
  CreatePersonalMemoryExtractionRunInput,
  CreatePersonalMemoryRecordInput,
  CreatePersonalMemoryRecordResult,
  DeletePersonalMemoryRecordResult,
  PersonalMemoryExtractionRun,
  PersonalMemoryRecord,
  ResolvePersonalMemoryRecordInput,
  ResolvePersonalMemoryRecordResult,
} from "./personalMemoryRecordTypes";
import { computePersonalMemoryContentFingerprint } from "./personalMemoryRecordValidation";

/** Loosely typed rows -- the generated Database type does not yet include these tables, exactly like inferredProjectContextFieldRepository.ts's own identical, already-accepted convention. Every field is still explicitly mapped below, never blindly spread. */
interface PersonalMemoryRecordRow {
  id: string;
  user_id: string;
  run_id: string | null;
  kind: string;
  content: unknown;
  provenance_source_kind: string;
  provenance_source_ref_ids: string[];
  model_identity: string;
  derivation_version: string;
  confidence: string;
  status: string;
  source: string;
  supersedes_id: string | null;
  content_fingerprint: string;
  created_at: string;
}

interface PersonalMemoryExtractionRunRow {
  id: string;
  user_id: string;
  model_identity: string;
  derivation_version: string;
  started_at: string;
  completed_at: string | null;
  prompt_token_count: number | null;
  response_token_count: number | null;
  candidate_count: number;
  accepted_count: number;
  dropped_count: number;
  outcome: string | null;
  failure_reason: string | null;
}

const RECORD_TRANSACTION_ERROR_CODES = new Set([
  "UNAUTHENTICATED",
  "RUN_NOT_FOUND",
  "SOURCE_REFERENCE_NOT_FOUND",
  "UNSUPPORTED_PROVENANCE_SOURCE_KIND",
  "RECORD_NOT_FOUND",
  "RECORD_NOT_PROPOSED",
  "UNSUPPORTED_ACTION",
  "INVALID_CORRECTED_CONTENT",
  // create_personal_memory_record's race-safe unique_violation handler
  // raises this only if the row a concurrent duplicate insert implies
  // exists cannot actually be found -- a genuine inconsistency, never a
  // normal outcome. Typed here so it surfaces as a
  // PersonalMemoryRecordTransactionError rather than a generic
  // PersonalMemoryRecordPersistenceError, mirroring
  // inferredProjectContextFieldRepository.ts's identical DUPLICATE_LOOKUP_FAILED
  // handling.
  "DUPLICATE_LOOKUP_FAILED",
]);

export class PersonalMemoryRecordTransactionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PersonalMemoryRecordTransactionError";
  }
}

export class PersonalMemoryRecordPersistenceError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "PersonalMemoryRecordPersistenceError";
  }
}

function extractTransactionErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return null;
  const trimmed = message.trim();
  return RECORD_TRANSACTION_ERROR_CODES.has(trimmed) ? trimmed : null;
}

function mapRowToRecord(row: PersonalMemoryRecordRow): PersonalMemoryRecord {
  const record: PersonalMemoryRecord = {
    id: row.id,
    ownerId: row.user_id,
    kind: row.kind as PersonalMemoryRecord["kind"],
    content: row.content as PersonalMemoryRecord["content"],
    provenance: {
      sourceKind: row.provenance_source_kind as PersonalMemoryRecord["provenance"]["sourceKind"],
      sourceReferenceIds: row.provenance_source_ref_ids,
    },
    modelIdentity: row.model_identity,
    derivationVersion: row.derivation_version,
    confidence: row.confidence as PersonalMemoryRecord["confidence"],
    status: row.status as PersonalMemoryRecord["status"],
    source: row.source as PersonalMemoryRecord["source"],
    contentFingerprint: row.content_fingerprint,
    createdAt: row.created_at,
  };
  if (row.run_id) (record as { runId?: string }).runId = row.run_id;
  if (row.supersedes_id) (record as { supersedesId?: string }).supersedesId = row.supersedes_id;
  return record;
}

function mapRowToRun(row: PersonalMemoryExtractionRunRow): PersonalMemoryExtractionRun {
  const run: PersonalMemoryExtractionRun = {
    id: row.id,
    ownerId: row.user_id,
    modelIdentity: row.model_identity,
    derivationVersion: row.derivation_version,
    startedAt: row.started_at,
    candidateCount: row.candidate_count,
    acceptedCount: row.accepted_count,
    droppedCount: row.dropped_count,
  };
  if (row.completed_at) (run as { completedAt?: string }).completedAt = row.completed_at;
  if (row.prompt_token_count !== null) (run as { promptTokenCount?: number }).promptTokenCount = row.prompt_token_count;
  if (row.response_token_count !== null) (run as { responseTokenCount?: number }).responseTokenCount = row.response_token_count;
  if (row.outcome) (run as { outcome?: "completed" | "failed" }).outcome = row.outcome as "completed" | "failed";
  if (row.failure_reason) (run as { failureReason?: string }).failureReason = row.failure_reason;
  return run;
}

const RECORD_COLUMNS =
  "id,user_id,run_id,kind,content,provenance_source_kind,provenance_source_ref_ids,model_identity,derivation_version,confidence,status,source,supersedes_id,content_fingerprint,created_at";
const RUN_COLUMNS =
  "id,user_id,model_identity,derivation_version,started_at,completed_at,prompt_token_count,response_token_count,candidate_count,accepted_count,dropped_count,outcome,failure_reason";

export interface PersonalMemoryRecordRepository {
  insert(input: CreatePersonalMemoryRecordInput): Promise<CreatePersonalMemoryRecordResult>;
  /**
   * `correctedContentFingerprint` is required when `input.action === "correct"`
   * and omitted otherwise -- identical division of labor to
   * inferredProjectContextFieldRepository.ts's own `resolve`.
   */
  resolve(input: ResolvePersonalMemoryRecordInput, correctedContentFingerprint?: string): Promise<ResolvePersonalMemoryRecordResult>;
  /** ADR-0010 Q1: hard delete at any status. No ADR-0009 analogue. */
  remove(recordId: string): Promise<DeletePersonalMemoryRecordResult>;
  findById(ownerId: string, recordId: string): Promise<PersonalMemoryRecord | null>;
  listByOwner(ownerId: string): Promise<readonly PersonalMemoryRecord[]>;
  createRun(input: CreatePersonalMemoryExtractionRunInput): Promise<PersonalMemoryExtractionRun>;
  completeRun(input: CompletePersonalMemoryExtractionRunInput): Promise<PersonalMemoryExtractionRun>;
}

export function createSupabasePersonalMemoryRecordRepository(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any>,
): PersonalMemoryRecordRepository {
  return {
    async insert(input) {
      const fingerprint = await computePersonalMemoryContentFingerprint(input.kind, input.content);
      const { data, error } = await client.rpc("create_personal_memory_record", {
        p_run_id: input.runId,
        p_kind: input.kind,
        p_content: input.content,
        p_provenance_source_kind: input.provenance.sourceKind,
        p_provenance_source_ref_ids: input.provenance.sourceReferenceIds,
        p_model_identity: input.modelIdentity,
        p_derivation_version: input.derivationVersion,
        p_confidence: input.confidence,
        p_content_fingerprint: fingerprint,
      });

      if (error) {
        const code = extractTransactionErrorCode(error);
        if (code) throw new PersonalMemoryRecordTransactionError(code, "The personal memory record transaction was rejected.");
        throw new PersonalMemoryRecordPersistenceError("Unable to create personal memory record.", error);
      }
      const result = data as { outcome?: "created" | "duplicate_suppressed"; field?: PersonalMemoryRecordRow };
      if ((result.outcome !== "created" && result.outcome !== "duplicate_suppressed") || !result.field?.id) {
        throw new PersonalMemoryRecordPersistenceError("The personal memory record transaction returned an incomplete result.");
      }
      return { outcome: result.outcome, record: mapRowToRecord(result.field) };
    },

    async resolve(input, correctedContentFingerprint) {
      if (input.action === "correct" && (!input.correctedContent || !correctedContentFingerprint)) {
        throw new PersonalMemoryRecordTransactionError("INVALID_CORRECTED_CONTENT", "Corrected content and its fingerprint are required.");
      }
      const { data, error } = await client.rpc("resolve_personal_memory_record", {
        p_record_id: input.recordId,
        p_action: input.action,
        p_corrected_content: input.correctedContent ?? null,
        p_corrected_content_fingerprint: correctedContentFingerprint ?? null,
      });

      if (error) {
        const code = extractTransactionErrorCode(error);
        if (code) throw new PersonalMemoryRecordTransactionError(code, "The resolve transaction was rejected.");
        throw new PersonalMemoryRecordPersistenceError("Unable to resolve personal memory record.", error);
      }
      const result = data as { outcome?: "user_confirmed" | "user_corrected" | "user_rejected"; field?: PersonalMemoryRecordRow };
      if (!result.outcome || !result.field?.id) {
        throw new PersonalMemoryRecordPersistenceError("The resolve transaction returned an incomplete result.");
      }
      return { outcome: result.outcome, record: mapRowToRecord(result.field) };
    },

    async remove(recordId) {
      const { data, error } = await client.rpc("delete_personal_memory_record", { p_record_id: recordId });

      if (error) {
        const code = extractTransactionErrorCode(error);
        if (code) throw new PersonalMemoryRecordTransactionError(code, "The delete transaction was rejected.");
        throw new PersonalMemoryRecordPersistenceError("Unable to delete personal memory record.", error);
      }
      const result = data as { outcome?: "deleted"; id?: string };
      if (result.outcome !== "deleted" || !result.id) {
        throw new PersonalMemoryRecordPersistenceError("The delete transaction returned an incomplete result.");
      }
      return { outcome: "deleted", id: result.id };
    },

    async findById(ownerId, recordId) {
      const { data, error } = await client
        .from("personal_memory_records")
        .select(RECORD_COLUMNS)
        .eq("id", recordId)
        .eq("user_id", ownerId)
        .maybeSingle();

      if (error) throw new PersonalMemoryRecordPersistenceError("Unable to load personal memory record.", error);
      return data ? mapRowToRecord(data as PersonalMemoryRecordRow) : null;
    },

    async listByOwner(ownerId) {
      const { data, error } = await client
        .from("personal_memory_records")
        .select(RECORD_COLUMNS)
        .eq("user_id", ownerId)
        .order("created_at", { ascending: false });

      if (error) throw new PersonalMemoryRecordPersistenceError("Unable to list personal memory records.", error);
      return ((data ?? []) as PersonalMemoryRecordRow[]).map(mapRowToRecord);
    },

    async createRun(input) {
      const { data, error } = await client
        .from("personal_memory_extraction_runs")
        .insert({
          model_identity: input.modelIdentity,
          derivation_version: input.derivationVersion,
          started_at: input.startedAt,
        })
        .select(RUN_COLUMNS)
        .single();

      if (error) throw new PersonalMemoryRecordPersistenceError("Unable to create extraction run.", error);
      return mapRowToRun(data as PersonalMemoryExtractionRunRow);
    },

    async completeRun(input) {
      const patch: Record<string, unknown> = {
        completed_at: input.completedAt,
        candidate_count: input.candidateCount,
        accepted_count: input.acceptedCount,
        dropped_count: input.droppedCount,
        outcome: input.outcome,
      };
      if (input.promptTokenCount !== undefined) patch.prompt_token_count = input.promptTokenCount;
      if (input.responseTokenCount !== undefined) patch.response_token_count = input.responseTokenCount;
      if (input.failureReason !== undefined) patch.failure_reason = input.failureReason;

      const { data, error } = await client
        .from("personal_memory_extraction_runs")
        .update(patch)
        .eq("id", input.runId)
        .select(RUN_COLUMNS)
        .single();

      if (error) throw new PersonalMemoryRecordPersistenceError("Unable to complete extraction run.", error);
      return mapRowToRun(data as PersonalMemoryExtractionRunRow);
    },
  };
}
