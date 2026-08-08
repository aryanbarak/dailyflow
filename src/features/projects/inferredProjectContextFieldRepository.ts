// SmartFlow -- Inferred Project Context Layer (ADR-0009).
//
// The persistence boundary. Mirrors projectEvidenceRepository.ts's shape
// exactly: an explicit, strongly-typed interface so the service layer
// depends on a contract, not a concrete Supabase client. `insert`/`resolve`
// call the two SECURITY DEFINER functions (create_inferred_context_field,
// resolve_inferred_context_field) -- never a plain table INSERT/UPDATE,
// since `authenticated` holds neither grant on inferred_project_context_fields.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CompleteInferredContextDerivationRunInput,
  CreateInferredContextDerivationRunInput,
  CreateInferredContextFieldInput,
  CreateInferredContextFieldResult,
  InferredContextDerivationRun,
  InferredProjectContextField,
  ResolveInferredContextFieldInput,
  ResolveInferredContextFieldResult,
} from "./inferredProjectContextFieldTypes";
import { computeInferredFieldContentFingerprint } from "./inferredProjectContextFieldValidation";

/** Loosely typed rows -- the generated Database type does not yet include these tables (a canonical regeneration against a migrated database is future work, exactly like the existing github_connections drift noted in PROJECT_STATUS.md's Technical Debt). Every field is still explicitly mapped below, never blindly spread. */
interface InferredProjectContextFieldRow {
  id: string;
  user_id: string;
  project_id: string;
  run_id: string | null;
  kind: string;
  content: unknown;
  source_evidence_ids: string[];
  model_identity: string;
  derivation_version: string;
  confidence: string;
  status: string;
  source: string;
  supersedes_id: string | null;
  content_fingerprint: string;
  created_at: string;
}

interface InferredContextDerivationRunRow {
  id: string;
  user_id: string;
  project_id: string;
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

const FIELD_TRANSACTION_ERROR_CODES = new Set([
  "UNAUTHENTICATED",
  "PROJECT_NOT_FOUND",
  "PROJECT_ARCHIVED",
  "RUN_NOT_FOUND",
  "SOURCE_EVIDENCE_NOT_FOUND",
  "FIELD_NOT_FOUND",
  "FIELD_NOT_PROPOSED",
  "UNSUPPORTED_ACTION",
  "INVALID_CORRECTED_CONTENT",
  // Review finding F3: create_inferred_context_field's race-safe
  // unique_violation handler raises this only if the row a concurrent
  // duplicate insert implies exists cannot actually be found -- a genuine
  // inconsistency, never a normal outcome. Typed here so it surfaces as an
  // InferredContextFieldTransactionError rather than a generic
  // InferredContextFieldPersistenceError.
  "DUPLICATE_LOOKUP_FAILED",
]);

export class InferredContextFieldTransactionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "InferredContextFieldTransactionError";
  }
}

export class InferredContextFieldPersistenceError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "InferredContextFieldPersistenceError";
  }
}

function extractTransactionErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return null;
  const trimmed = message.trim();
  return FIELD_TRANSACTION_ERROR_CODES.has(trimmed) ? trimmed : null;
}

function mapRowToField(row: InferredProjectContextFieldRow): InferredProjectContextField {
  const field: InferredProjectContextField = {
    id: row.id,
    ownerId: row.user_id,
    projectId: row.project_id,
    kind: row.kind as InferredProjectContextField["kind"],
    content: row.content as InferredProjectContextField["content"],
    sourceEvidenceIds: row.source_evidence_ids,
    modelIdentity: row.model_identity,
    derivationVersion: row.derivation_version,
    confidence: row.confidence as InferredProjectContextField["confidence"],
    status: row.status as InferredProjectContextField["status"],
    source: row.source as InferredProjectContextField["source"],
    contentFingerprint: row.content_fingerprint,
    createdAt: row.created_at,
  };
  if (row.run_id) (field as { runId?: string }).runId = row.run_id;
  if (row.supersedes_id) (field as { supersedesId?: string }).supersedesId = row.supersedes_id;
  return field;
}

function mapRowToRun(row: InferredContextDerivationRunRow): InferredContextDerivationRun {
  const run: InferredContextDerivationRun = {
    id: row.id,
    ownerId: row.user_id,
    projectId: row.project_id,
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

export interface InferredProjectContextFieldRepository {
  insert(input: CreateInferredContextFieldInput): Promise<CreateInferredContextFieldResult>;
  /**
   * `correctedContentFingerprint` is required when `input.action ===
   * "correct"` and omitted otherwise. Computed by the caller (the service
   * layer, which already looks up the original field and therefore knows
   * its `kind`) via `computeInferredFieldContentFingerprint(kind,
   * correctedContent)` -- the repository itself never resolves `kind` on
   * its own, keeping this module a pure persistence boundary, exactly like
   * projectEvidenceRepository.ts's own division of labor with its service.
   */
  resolve(input: ResolveInferredContextFieldInput, correctedContentFingerprint?: string): Promise<ResolveInferredContextFieldResult>;
  findById(ownerId: string, fieldId: string): Promise<InferredProjectContextField | null>;
  listByProject(ownerId: string, projectId: string): Promise<readonly InferredProjectContextField[]>;
  createRun(input: CreateInferredContextDerivationRunInput): Promise<InferredContextDerivationRun>;
  completeRun(input: CompleteInferredContextDerivationRunInput): Promise<InferredContextDerivationRun>;
}

export function createSupabaseInferredProjectContextFieldRepository(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any>,
): InferredProjectContextFieldRepository {
  return {
    async insert(input) {
      const fingerprint = await computeInferredFieldContentFingerprint(input.kind, input.content);
      const { data, error } = await client.rpc("create_inferred_context_field", {
        p_project_id: input.projectId,
        p_run_id: input.runId,
        p_kind: input.kind,
        p_content: input.content,
        p_source_evidence_ids: input.sourceEvidenceIds,
        p_model_identity: input.modelIdentity,
        p_derivation_version: input.derivationVersion,
        p_confidence: input.confidence,
        p_content_fingerprint: fingerprint,
      });

      if (error) {
        const code = extractTransactionErrorCode(error);
        if (code) throw new InferredContextFieldTransactionError(code, "The inferred field transaction was rejected.");
        throw new InferredContextFieldPersistenceError("Unable to create inferred context field.", error);
      }
      const result = data as { outcome?: "created" | "duplicate_suppressed"; field?: InferredProjectContextFieldRow };
      if ((result.outcome !== "created" && result.outcome !== "duplicate_suppressed") || !result.field?.id) {
        throw new InferredContextFieldPersistenceError("The inferred field transaction returned an incomplete result.");
      }
      return { outcome: result.outcome, field: mapRowToField(result.field) };
    },

    async resolve(input, correctedContentFingerprint) {
      if (input.action === "correct" && (!input.correctedContent || !correctedContentFingerprint)) {
        throw new InferredContextFieldTransactionError("INVALID_CORRECTED_CONTENT", "Corrected content and its fingerprint are required.");
      }
      const { data, error } = await client.rpc("resolve_inferred_context_field", {
        p_field_id: input.fieldId,
        p_action: input.action,
        p_corrected_content: input.correctedContent ?? null,
        p_corrected_content_fingerprint: correctedContentFingerprint ?? null,
      });

      if (error) {
        const code = extractTransactionErrorCode(error);
        if (code) throw new InferredContextFieldTransactionError(code, "The resolve transaction was rejected.");
        throw new InferredContextFieldPersistenceError("Unable to resolve inferred context field.", error);
      }
      const result = data as { outcome?: "user_confirmed" | "user_corrected" | "user_rejected"; field?: InferredProjectContextFieldRow };
      if (!result.outcome || !result.field?.id) {
        throw new InferredContextFieldPersistenceError("The resolve transaction returned an incomplete result.");
      }
      return { outcome: result.outcome, field: mapRowToField(result.field) };
    },

    async findById(ownerId, fieldId) {
      const { data, error } = await client
        .from("inferred_project_context_fields")
        .select(
          "id,user_id,project_id,run_id,kind,content,source_evidence_ids,model_identity,derivation_version,confidence,status,source,supersedes_id,content_fingerprint,created_at",
        )
        .eq("id", fieldId)
        .eq("user_id", ownerId)
        .maybeSingle();

      if (error) throw new InferredContextFieldPersistenceError("Unable to load inferred context field.", error);
      return data ? mapRowToField(data as InferredProjectContextFieldRow) : null;
    },

    async listByProject(ownerId, projectId) {
      const { data, error } = await client
        .from("inferred_project_context_fields")
        .select(
          "id,user_id,project_id,run_id,kind,content,source_evidence_ids,model_identity,derivation_version,confidence,status,source,supersedes_id,content_fingerprint,created_at",
        )
        .eq("user_id", ownerId)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw new InferredContextFieldPersistenceError("Unable to list inferred context fields.", error);
      return ((data ?? []) as InferredProjectContextFieldRow[]).map(mapRowToField);
    },

    async createRun(input) {
      const { data, error } = await client
        .from("inferred_context_derivation_runs")
        .insert({
          project_id: input.projectId,
          model_identity: input.modelIdentity,
          derivation_version: input.derivationVersion,
          started_at: input.startedAt,
        })
        .select(
          "id,user_id,project_id,model_identity,derivation_version,started_at,completed_at,prompt_token_count,response_token_count,candidate_count,accepted_count,dropped_count,outcome,failure_reason",
        )
        .single();

      if (error) throw new InferredContextFieldPersistenceError("Unable to create derivation run.", error);
      return mapRowToRun(data as InferredContextDerivationRunRow);
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
        .from("inferred_context_derivation_runs")
        .update(patch)
        .eq("id", input.runId)
        .select(
          "id,user_id,project_id,model_identity,derivation_version,started_at,completed_at,prompt_token_count,response_token_count,candidate_count,accepted_count,dropped_count,outcome,failure_reason",
        )
        .single();

      if (error) throw new InferredContextFieldPersistenceError("Unable to complete derivation run.", error);
      return mapRowToRun(data as InferredContextDerivationRunRow);
    },
  };
}
