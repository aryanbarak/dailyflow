export { buildProjectContext } from "./projectContextBuilder";
export {
  getSmartFlowProjectContext,
  SMARTFLOW_FIXTURE_GENERATED_AT,
  SMARTFLOW_PROJECT_CONTEXT_INPUT,
} from "./smartflowProjectContextFixture";
export { PROJECT_CONTEXT_VERSION } from "./projectContextTypes";

// Slice 3 -- ProjectRecord Foundation.
export { validateCreateProjectRecordInput, validateUpdateProjectRecordInput } from "./projectRecordValidation";
export {
  createSupabaseProjectRecordRepository,
  projectRecordRepository,
  ProjectRecordConflictError,
  ProjectRecordPersistenceError,
} from "./projectRecordRepository";
export type { ProjectRecordRepository } from "./projectRecordRepository";
export { createProjectRecordService, projectRecordService } from "./projectRecordService";
export type { OwnerIdResolver, ProjectRecordService, ProjectRecordServiceDependencies } from "./projectRecordService";
export { PROJECT_RECORD_EVIDENCE_SOURCE_KINDS, ProjectRecordError } from "./projectRecordTypes";

// Slice 4B -- ProjectEvidence Foundation.
export { validateCreateProjectEvidenceInput } from "./projectEvidenceValidation";
export {
  createSupabaseProjectEvidenceRepository,
  projectEvidenceRepository,
  ProjectEvidenceConflictError,
  ProjectEvidencePersistenceError,
  ProjectEvidenceTransactionError,
} from "./projectEvidenceRepository";
export type { ProjectEvidenceRepository } from "./projectEvidenceRepository";
export { createProjectEvidenceService, projectEvidenceService } from "./projectEvidenceService";
export type { ProjectEvidenceService, ProjectEvidenceServiceDependencies } from "./projectEvidenceService";
export { PROJECT_EVIDENCE_CLASSIFICATIONS, ProjectEvidenceError } from "./projectEvidenceTypes";
export type {
  CreateProjectEvidenceInput,
  CreateProjectEvidenceResult,
  ListProjectEvidenceOptions,
  NormalizedCreateProjectEvidenceInput,
  ProjectEvidence,
  ProjectEvidenceClassification,
  ProjectEvidenceErrorCode,
  ProjectEvidenceErrorIssue,
  ProjectEvidenceValidationErrorCode,
  ProjectEvidenceValidationIssue,
  ProjectEvidenceValidationResult,
  ProjectEvidenceWithObservation,
} from "./projectEvidenceTypes";

// ProjectEvidence Observation Foundation (ADR-0007).
export { validateCreateProjectEvidenceObservationTextInput } from "./projectEvidenceObservationValidation";
export {
  MAX_TEXT_OBSERVATION_BYTES,
  PROJECT_EVIDENCE_OBSERVATION_PAYLOAD_KINDS,
  PROJECT_EVIDENCE_OBSERVATION_TEXT_MIME_TYPES,
} from "./projectEvidenceObservationTypes";
export type {
  CreateProjectEvidenceObservationTextInput,
  ProjectEvidenceObservation,
  ProjectEvidenceObservationPayloadKind,
  ProjectEvidenceObservationTextMimeType,
  ProjectEvidenceObservationValidationErrorCode,
  ProjectEvidenceObservationValidationIssue,
  ProjectEvidenceObservationValidationResult,
  ValidatedProjectEvidenceObservationTextInput,
} from "./projectEvidenceObservationTypes";

// Repository Documents Adapter -- the first real Evidence Source Adapter.
export {
  DOCUMENT_ADAPTER_SUPPORTED_SOURCE_KINDS,
  validateRepositoryDocumentPath,
} from "./repositoryDocumentPathSecurity";
export type { PathRejectionReason, PathValidationResult } from "./repositoryDocumentPathSecurity";
export { MAX_DOCUMENT_BYTES, readLocalGitRevision, readRepositoryDocument } from "./repositoryDocumentFileReader";
export type { FileReadFailureReason, FileReadResult } from "./repositoryDocumentFileReader";
export { RepositoryDocumentAdapterError } from "./repositoryDocumentAdapterTypes";
export type {
  IngestRepositoryDocumentInput,
  IngestRepositoryDocumentResult,
  RepositoryDocumentAdapterErrorCode,
  RepositoryRootResolver,
} from "./repositoryDocumentAdapterTypes";
export {
  createRepositoryDocumentAdapter,
  REPOSITORY_DOCUMENT_ADAPTER_IDENTITY,
  REPOSITORY_DOCUMENT_ADAPTER_VERSION,
} from "./repositoryDocumentAdapter";
export type { RepositoryDocumentAdapter, RepositoryDocumentAdapterDependencies } from "./repositoryDocumentAdapter";

// Context Rebuild Foundation.
export { buildEvidenceSnapshot } from "./evidenceSnapshotBuilder";
export type { SnapshotProjectIdentity } from "./evidenceSnapshotBuilder";
export { EVIDENCE_SNAPSHOT_SCHEMA_VERSION } from "./evidenceSnapshotTypes";
export type {
  EvidenceSnapshot,
  EvidenceSnapshotBuildFailureCode,
  EvidenceSnapshotBuildIssue,
  EvidenceSnapshotBuildResult,
  EvidenceSnapshotItem,
} from "./evidenceSnapshotTypes";
export {
  mapEvidenceSnapshotToProjectContextInput,
  mapProjectToSoftwareProject,
  mapSnapshotItemToProjectSource,
} from "./contextRebuildProjectContextInput";
export type { ContextRebuildProjectIdentity } from "./contextRebuildProjectContextInput";
export { ContextRebuildError } from "./contextRebuildTypes";
export type {
  ContextNotDerivableReasonCode,
  ContextRebuildErrorCode,
  ContextRebuildErrorIssue,
  ContextRebuildMetadata,
  RebuildProjectContextNotDerivableResult,
  RebuildProjectContextReadyResult,
  RebuildProjectContextResult,
} from "./contextRebuildTypes";
export {
  canDeriveProjectContextFromSnapshot,
  contextRebuildService,
  createContextRebuildService,
} from "./contextRebuildService";
export type { ContextRebuildService, ContextRebuildServiceDependencies, EvidenceToContextCapabilityCheck } from "./contextRebuildService";

// Project Brief Foundation.
export {
  MAX_BRIEF_ITEMS_PER_FIELD,
  MAX_BRIEF_ITEM_TEXT_LENGTH,
  PROJECT_BRIEF_VERSION,
} from "./projectBriefTypes";
export type {
  BriefProvenance,
  ProjectBrief,
  ProjectBriefBuildResult,
  ProjectBriefExtractionWarning,
  ProjectBriefExtractionWarningCode,
  ProjectBriefSingleValueField,
  ProjectBriefTextItem,
  ProjectBriefValidationErrorCode,
  ProjectBriefValidationIssue,
} from "./projectBriefTypes";
export { buildProjectBriefFromSnapshot, type ProjectBriefIdentity } from "./projectBriefAssembler";
export { extractProjectStatusDocument } from "./projectBriefProjectStatusExtractor";
export { extractAdrDocument } from "./projectBriefAdrExtractor";
export { extractRoadmapDocument } from "./projectBriefRoadmapExtractor";
export { extractArchitectureDocument } from "./projectBriefArchitectureExtractor";
export { extractProductDirectionDocument } from "./projectBriefProductDirectionExtractor";
export { ProjectBriefError } from "./projectBriefServiceTypes";
export type { ProjectBriefErrorCode, ProjectBriefErrorIssue } from "./projectBriefServiceTypes";
export { createProjectBriefService, projectBriefService } from "./projectBriefService";
export type { ProjectBriefService, ProjectBriefServiceDependencies } from "./projectBriefService";

export type {
  CreateProjectRecordInput,
  ListProjectRecordsOptions,
  NormalizedCreateProjectRecordInput,
  NormalizedProjectRecordConfigChanges,
  ProjectRecord,
  ProjectRecordErrorCode,
  ProjectRecordLifecycleStatus,
  ProjectRecordRepositoryBinding,
  ProjectRecordRepositoryProvider,
  ProjectRecordValidationErrorCode,
  ProjectRecordValidationIssue,
  ProjectRecordValidationResult,
  UpdateProjectRecordInput,
} from "./projectRecordTypes";
export type {
  CandidateProjectAction,
  CandidateProjectActionInput,
  ProjectCapability,
  ProjectCapabilityInput,
  ProjectCapabilityStatus,
  ProjectContext,
  ProjectContextBuildResult,
  ProjectContextInput,
  ProjectContextMetadata,
  ProjectContextValidationErrorCode,
  ProjectContextValidationIssue,
  ProjectDecision,
  ProjectDecisionInput,
  ProjectDecisionStatus,
  ProjectMilestone,
  ProjectMilestoneInput,
  ProjectMilestoneStatus,
  ProjectObjective,
  ProjectObjectiveInput,
  ProjectObjectiveStatus,
  ProjectRepositoryBinding,
  ProjectRepositoryConnectionStatus,
  ProjectRisk,
  ProjectRiskInput,
  ProjectRiskSeverity,
  ProjectSource,
  ProjectSourceInput,
  ProjectSourceKind,
  ProjectType,
  SoftwareProject,
  SoftwareProjectInput,
} from "./projectContextTypes";
