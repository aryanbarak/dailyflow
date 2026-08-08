// SmartFlow -- Inferred Project Context Layer (ADR-0009).
//
// Orchestration layer: resolves the trusted authenticated owner, validates
// input, verifies the owning ProjectRecord, and calls the persistence
// boundary (inferredProjectContextFieldRepository.ts), translating every
// failure into a typed InferredContextFieldError. Never accepts an owner id
// from caller input -- exactly projectEvidenceService.ts's convention.
//
// In production, model-authored fields are created by the Worker's own
// Context Derivation route (agent/worker/context-derivation-endpoint.ts),
// which cannot import this module and instead calls the same
// create_inferred_context_field RPC directly over REST with the user's own
// forwarded JWT. This service exists so the identical persistence contract
// is testable and usable from the browser/CLI side too (e.g. by a future
// confirm/correct UI, or contextRebuildService.ts's read path below) --
// both callers ultimately hit the same database function, so there is no
// duplicated business logic, only two HTTP client mechanics for reaching it.

import {
  INFERRED_CONTEXT_FIELD_KINDS,
  InferredContextFieldError,
  type CompleteInferredContextDerivationRunInput,
  type CreateInferredContextDerivationRunInput,
  type CreateInferredContextFieldInput,
  type CreateInferredContextFieldResult,
  type InferredContextDerivationRun,
  type InferredProjectContextField,
  type ResolveInferredContextFieldInput,
  type ResolveInferredContextFieldResult,
} from "./inferredProjectContextFieldTypes";
import {
  computeInferredFieldContentFingerprint,
  isSupportedInferredContextFieldKind,
  isSupportedInferredFieldConfidence,
  validateInferredFieldContent,
  validateSourceEvidenceIds,
} from "./inferredProjectContextFieldValidation";
import {
  InferredContextFieldPersistenceError,
  InferredContextFieldTransactionError,
  type InferredProjectContextFieldRepository,
} from "./inferredProjectContextFieldRepository";
import type { ProjectRecordRepository } from "./projectRecordRepository";

export type OwnerIdResolver = () => Promise<string | null>;

export interface InferredProjectContextFieldServiceDependencies {
  repository: InferredProjectContextFieldRepository;
  projectRepository: ProjectRecordRepository;
  resolveOwnerId: OwnerIdResolver;
}

const TRANSACTION_ERROR_MAP: Record<string, InferredContextFieldError["code"] | undefined> = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  PROJECT_NOT_FOUND: "PROJECT_NOT_FOUND",
  PROJECT_ARCHIVED: "PROJECT_ARCHIVED",
  RUN_NOT_FOUND: "RUN_NOT_FOUND",
  SOURCE_EVIDENCE_NOT_FOUND: "SOURCE_EVIDENCE_NOT_FOUND",
  FIELD_NOT_FOUND: "FIELD_NOT_FOUND",
  FIELD_NOT_PROPOSED: "FIELD_NOT_PROPOSED",
};

function toServiceError(error: unknown, fallbackMessage: string): InferredContextFieldError {
  if (error instanceof InferredContextFieldError) return error;
  if (error instanceof InferredContextFieldTransactionError) {
    const code = TRANSACTION_ERROR_MAP[error.code];
    return new InferredContextFieldError(code ?? "PERSISTENCE_FAILED", fallbackMessage);
  }
  if (error instanceof InferredContextFieldPersistenceError) {
    return new InferredContextFieldError("PERSISTENCE_FAILED", fallbackMessage);
  }
  return new InferredContextFieldError("PERSISTENCE_FAILED", fallbackMessage);
}

export interface InferredProjectContextFieldService {
  create(input: unknown): Promise<CreateInferredContextFieldResult>;
  resolve(input: ResolveInferredContextFieldInput): Promise<ResolveInferredContextFieldResult>;
  listByProject(projectId: string): Promise<readonly InferredProjectContextField[]>;
  createRun(input: CreateInferredContextDerivationRunInput): Promise<InferredContextDerivationRun>;
  completeRun(input: CompleteInferredContextDerivationRunInput): Promise<InferredContextDerivationRun>;
}

function validateCreateInput(input: unknown): { valid: true; value: CreateInferredContextFieldInput } | { valid: false } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { valid: false };
  const record = input as Record<string, unknown>;
  const projectId = typeof record.projectId === "string" ? record.projectId : "";
  const runId = typeof record.runId === "string" ? record.runId : "";
  if (!projectId || !runId) return { valid: false };
  if (!isSupportedInferredContextFieldKind(record.kind)) return { valid: false };
  const sourceEvidenceIds = validateSourceEvidenceIds(record.sourceEvidenceIds);
  if (!sourceEvidenceIds) return { valid: false };
  if (!isSupportedInferredFieldConfidence(record.confidence)) return { valid: false };
  const modelIdentity = typeof record.modelIdentity === "string" ? record.modelIdentity.trim() : "";
  const derivationVersion = typeof record.derivationVersion === "string" ? record.derivationVersion.trim() : "";
  if (!modelIdentity || !derivationVersion) return { valid: false };
  const contentResult = validateInferredFieldContent(record.kind, record.content);
  if (contentResult.valid === false) return { valid: false };

  return {
    valid: true,
    value: {
      projectId,
      runId,
      kind: record.kind,
      content: contentResult.value,
      sourceEvidenceIds,
      modelIdentity,
      derivationVersion,
      confidence: record.confidence,
    },
  };
}

export function createInferredProjectContextFieldService(
  dependencies: InferredProjectContextFieldServiceDependencies,
): InferredProjectContextFieldService {
  const repository = dependencies.repository;
  const projectRepository = dependencies.projectRepository;
  const resolveOwnerId = dependencies.resolveOwnerId;

  async function requireOwnerId(): Promise<string> {
    const ownerId = await resolveOwnerId();
    if (!ownerId) throw new InferredContextFieldError("UNAUTHENTICATED", "You must be signed in to manage inferred context fields.");
    return ownerId;
  }

  return {
    async create(input) {
      const ownerId = await requireOwnerId();
      const validation = validateCreateInput(input);
      if (validation.valid === false) {
        throw new InferredContextFieldError("INVALID_INPUT", "Inferred context field input is invalid.");
      }
      const value = validation.value;

      let project;
      try {
        project = await projectRepository.findById(ownerId, value.projectId);
      } catch (error) {
        throw toServiceError(error, "Unable to load the owning project.");
      }
      if (!project) throw new InferredContextFieldError("PROJECT_NOT_FOUND", "Project was not found for this user.");
      if (project.status === "archived") throw new InferredContextFieldError("PROJECT_ARCHIVED", "Cannot record an inferred field for an archived project.");

      try {
        return await repository.insert(value);
      } catch (error) {
        throw toServiceError(error, "Unable to create inferred context field.");
      }
    },

    async resolve(input) {
      const ownerId = await requireOwnerId();
      if (!INFERRED_CONTEXT_FIELD_KINDS.length) throw new InferredContextFieldError("INVALID_INPUT", "Unsupported field kind.");

      let field: InferredProjectContextField | null;
      try {
        field = await repository.findById(ownerId, input.fieldId);
      } catch (error) {
        throw toServiceError(error, "Unable to load the inferred context field.");
      }
      if (!field) throw new InferredContextFieldError("FIELD_NOT_FOUND", "Inferred context field was not found for this user.");
      if (field.status !== "proposed") throw new InferredContextFieldError("FIELD_NOT_PROPOSED", "Only a still-proposed field can be resolved.");

      let correctedContentFingerprint: string | undefined;
      if (input.action === "correct") {
        if (!input.correctedContent) {
          throw new InferredContextFieldError("INVALID_INPUT", "Corrected content is required for a correction.");
        }
        const contentResult = validateInferredFieldContent(field.kind, input.correctedContent);
        if (contentResult.valid === false) {
          throw new InferredContextFieldError("INVALID_INPUT", "Corrected content is invalid for this field's kind.", contentResult.errors);
        }
        correctedContentFingerprint = await computeInferredFieldContentFingerprint(field.kind, contentResult.value);
      }

      try {
        return await repository.resolve(input, correctedContentFingerprint);
      } catch (error) {
        throw toServiceError(error, "Unable to resolve inferred context field.");
      }
    },

    async listByProject(projectId) {
      const ownerId = await requireOwnerId();
      let project;
      try {
        project = await projectRepository.findById(ownerId, projectId);
      } catch (error) {
        throw toServiceError(error, "Unable to load the owning project.");
      }
      if (!project) throw new InferredContextFieldError("PROJECT_NOT_FOUND", "Project was not found for this user.");

      try {
        return await repository.listByProject(ownerId, projectId);
      } catch (error) {
        throw toServiceError(error, "Unable to list inferred context fields.");
      }
    },

    async createRun(input) {
      await requireOwnerId();
      try {
        return await repository.createRun(input);
      } catch (error) {
        throw toServiceError(error, "Unable to create a derivation run.");
      }
    },

    async completeRun(input) {
      await requireOwnerId();
      try {
        return await repository.completeRun(input);
      } catch (error) {
        throw toServiceError(error, "Unable to complete a derivation run.");
      }
    },
  };
}
