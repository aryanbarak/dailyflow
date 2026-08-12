// SmartFlow -- Personal Memory Layer (ADR-0010).
//
// Orchestration layer: resolves the trusted authenticated owner, validates
// input, and calls the persistence boundary
// (personalMemoryRecordRepository.ts), translating every failure into a
// typed PersonalMemoryRecordError. Never accepts an owner id from caller
// input -- exactly inferredProjectContextFieldService.ts's convention. No
// project lookup at all -- this aggregate has no project dimension
// (ADR-0010 Decision section 1).
//
// In production, model-authored records are created by the Worker's own
// Personal Memory extraction route, which cannot import this module and
// instead calls the same create_personal_memory_record RPC directly over
// REST with the user's own forwarded JWT. This service exists so the
// identical persistence contract is testable and usable from the browser
// side too (e.g. the confirm/correct/delete review UI, a future task) --
// both callers ultimately hit the same database function, so there is no
// duplicated business logic, only two HTTP client mechanics for reaching
// it.

import {
  PersonalMemoryRecordError,
  type CompletePersonalMemoryExtractionRunInput,
  type ConfirmPersonalMemoryRecordUpdateInput,
  type ConfirmPersonalMemoryRecordUpdateResult,
  type CreatePersonalMemoryExtractionRunInput,
  type CreatePersonalMemoryRecordInput,
  type CreatePersonalMemoryRecordResult,
  type DeletePersonalMemoryRecordResult,
  type PersonalMemoryExtractionRun,
  type PersonalMemoryRecord,
  type ResolvePersonalMemoryRecordInput,
  type ResolvePersonalMemoryRecordResult,
} from "./personalMemoryRecordTypes";
import {
  computePersonalMemoryContentFingerprint,
  isSupportedPersonalMemoryConfidence,
  isSupportedPersonalMemoryRecordKind,
  isSupportedProvenanceSourceKind,
  validatePersonalMemoryContent,
  validateProvenanceSourceReferenceIds,
} from "./personalMemoryRecordValidation";
import {
  PersonalMemoryRecordPersistenceError,
  PersonalMemoryRecordTransactionError,
  type PersonalMemoryRecordRepository,
} from "./personalMemoryRecordRepository";

export type OwnerIdResolver = () => Promise<string | null>;

export interface PersonalMemoryRecordServiceDependencies {
  repository: PersonalMemoryRecordRepository;
  resolveOwnerId: OwnerIdResolver;
}

const TRANSACTION_ERROR_MAP: Record<string, PersonalMemoryRecordError["code"] | undefined> = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  RUN_NOT_FOUND: "RUN_NOT_FOUND",
  SOURCE_REFERENCE_NOT_FOUND: "SOURCE_REFERENCE_NOT_FOUND",
  UNSUPPORTED_PROVENANCE_SOURCE_KIND: "UNSUPPORTED_PROVENANCE_SOURCE_KIND",
  RECORD_NOT_FOUND: "RECORD_NOT_FOUND",
  RECORD_NOT_PROPOSED: "RECORD_NOT_PROPOSED",
  // Task 18, B3: confirm_personal_memory_record_update's candidate-side
  // errors carry the identical meaning as the existing RECORD_NOT_FOUND/
  // RECORD_NOT_PROPOSED codes -- mapped onto them rather than growing a
  // parallel pair with no semantic difference.
  CANDIDATE_NOT_FOUND: "RECORD_NOT_FOUND",
  CANDIDATE_NOT_PROPOSED: "RECORD_NOT_PROPOSED",
  SUPERSEDED_RECORD_NOT_FOUND: "SUPERSEDED_RECORD_NOT_FOUND",
  RECORD_ALREADY_SUPERSEDED: "RECORD_ALREADY_SUPERSEDED",
  KIND_MISMATCH: "KIND_MISMATCH",
  INVALID_SUPERSESSION_PAIR: "INVALID_SUPERSESSION_PAIR",
};

function toServiceError(error: unknown, fallbackMessage: string): PersonalMemoryRecordError {
  if (error instanceof PersonalMemoryRecordError) return error;
  if (error instanceof PersonalMemoryRecordTransactionError) {
    const code = TRANSACTION_ERROR_MAP[error.code];
    return new PersonalMemoryRecordError(code ?? "PERSISTENCE_FAILED", fallbackMessage);
  }
  if (error instanceof PersonalMemoryRecordPersistenceError) {
    return new PersonalMemoryRecordError("PERSISTENCE_FAILED", fallbackMessage);
  }
  return new PersonalMemoryRecordError("PERSISTENCE_FAILED", fallbackMessage);
}

export interface PersonalMemoryRecordService {
  create(input: unknown): Promise<CreatePersonalMemoryRecordResult>;
  resolve(input: ResolvePersonalMemoryRecordInput): Promise<ResolvePersonalMemoryRecordResult>;
  /** Task 18, B2/B3: confirms a proposed candidate as an update to a different existing record -- see the repository's own doc comment. */
  confirmUpdate(input: ConfirmPersonalMemoryRecordUpdateInput): Promise<ConfirmPersonalMemoryRecordUpdateResult>;
  remove(recordId: string): Promise<DeletePersonalMemoryRecordResult>;
  listByOwner(): Promise<readonly PersonalMemoryRecord[]>;
  /** ADR-0011: only `user_confirmed`/`user_corrected` records, status-filtered at the repository query. */
  listConfirmed(): Promise<readonly PersonalMemoryRecord[]>;
  createRun(input: CreatePersonalMemoryExtractionRunInput): Promise<PersonalMemoryExtractionRun>;
  completeRun(input: CompletePersonalMemoryExtractionRunInput): Promise<PersonalMemoryExtractionRun>;
}

function validateCreateInput(input: unknown): { valid: true; value: CreatePersonalMemoryRecordInput } | { valid: false } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { valid: false };
  const record = input as Record<string, unknown>;
  const runId = typeof record.runId === "string" ? record.runId : "";
  if (!runId) return { valid: false };
  if (!isSupportedPersonalMemoryRecordKind(record.kind)) return { valid: false };

  const provenance = record.provenance as Record<string, unknown> | undefined;
  if (!provenance || typeof provenance !== "object") return { valid: false };
  if (!isSupportedProvenanceSourceKind(provenance.sourceKind)) return { valid: false };
  const sourceReferenceIds = validateProvenanceSourceReferenceIds(provenance.sourceReferenceIds);
  if (!sourceReferenceIds) return { valid: false };

  if (!isSupportedPersonalMemoryConfidence(record.confidence)) return { valid: false };
  const modelIdentity = typeof record.modelIdentity === "string" ? record.modelIdentity.trim() : "";
  const derivationVersion = typeof record.derivationVersion === "string" ? record.derivationVersion.trim() : "";
  if (!modelIdentity || !derivationVersion) return { valid: false };
  const contentResult = validatePersonalMemoryContent(record.kind, record.content);
  if (contentResult.valid === false) return { valid: false };

  return {
    valid: true,
    value: {
      runId,
      kind: record.kind,
      content: contentResult.value,
      provenance: { sourceKind: provenance.sourceKind, sourceReferenceIds },
      modelIdentity,
      derivationVersion,
      confidence: record.confidence,
    },
  };
}

export function createPersonalMemoryRecordService(
  dependencies: PersonalMemoryRecordServiceDependencies,
): PersonalMemoryRecordService {
  const repository = dependencies.repository;
  const resolveOwnerId = dependencies.resolveOwnerId;

  async function requireOwnerId(): Promise<string> {
    const ownerId = await resolveOwnerId();
    if (!ownerId) throw new PersonalMemoryRecordError("UNAUTHENTICATED", "You must be signed in to manage personal memory.");
    return ownerId;
  }

  return {
    async create(input) {
      await requireOwnerId();
      const validation = validateCreateInput(input);
      if (validation.valid === false) {
        throw new PersonalMemoryRecordError("INVALID_INPUT", "Personal memory record input is invalid.");
      }

      try {
        return await repository.insert(validation.value);
      } catch (error) {
        throw toServiceError(error, "Unable to create personal memory record.");
      }
    },

    async resolve(input) {
      const ownerId = await requireOwnerId();

      let record: PersonalMemoryRecord | null;
      try {
        record = await repository.findById(ownerId, input.recordId);
      } catch (error) {
        throw toServiceError(error, "Unable to load the personal memory record.");
      }
      if (!record) throw new PersonalMemoryRecordError("RECORD_NOT_FOUND", "Personal memory record was not found for this user.");
      if (record.status !== "proposed") throw new PersonalMemoryRecordError("RECORD_NOT_PROPOSED", "Only a still-proposed record can be resolved.");

      let correctedContentFingerprint: string | undefined;
      if (input.action === "correct") {
        if (!input.correctedContent) {
          throw new PersonalMemoryRecordError("INVALID_INPUT", "Corrected content is required for a correction.");
        }
        const contentResult = validatePersonalMemoryContent(record.kind, input.correctedContent);
        if (contentResult.valid === false) {
          throw new PersonalMemoryRecordError("INVALID_INPUT", "Corrected content is invalid for this record's kind.", contentResult.errors);
        }
        correctedContentFingerprint = await computePersonalMemoryContentFingerprint(record.kind, contentResult.value);
      }

      try {
        return await repository.resolve(input, correctedContentFingerprint);
      } catch (error) {
        throw toServiceError(error, "Unable to resolve personal memory record.");
      }
    },

    async confirmUpdate(input) {
      await requireOwnerId();
      if (input.candidateRecordId === input.supersededRecordId) {
        throw new PersonalMemoryRecordError("INVALID_SUPERSESSION_PAIR", "A record cannot supersede itself.");
      }
      try {
        return await repository.confirmUpdate(input);
      } catch (error) {
        throw toServiceError(error, "Unable to confirm the personal memory record update.");
      }
    },

    async remove(recordId) {
      await requireOwnerId();
      try {
        return await repository.remove(recordId);
      } catch (error) {
        throw toServiceError(error, "Unable to delete personal memory record.");
      }
    },

    async listByOwner() {
      const ownerId = await requireOwnerId();
      try {
        return await repository.listByOwner(ownerId);
      } catch (error) {
        throw toServiceError(error, "Unable to list personal memory records.");
      }
    },

    async listConfirmed() {
      const ownerId = await requireOwnerId();
      try {
        return await repository.listConfirmedByOwner(ownerId);
      } catch (error) {
        throw toServiceError(error, "Unable to list confirmed personal memory records.");
      }
    },

    async createRun(input) {
      await requireOwnerId();
      try {
        return await repository.createRun(input);
      } catch (error) {
        throw toServiceError(error, "Unable to create an extraction run.");
      }
    },

    async completeRun(input) {
      await requireOwnerId();
      try {
        return await repository.completeRun(input);
      } catch (error) {
        throw toServiceError(error, "Unable to complete an extraction run.");
      }
    },
  };
}
