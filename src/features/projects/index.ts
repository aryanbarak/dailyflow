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
} from "./projectEvidenceRepository";
export type { ProjectEvidenceRepository } from "./projectEvidenceRepository";
export { createProjectEvidenceService, projectEvidenceService } from "./projectEvidenceService";
export type { ProjectEvidenceService, ProjectEvidenceServiceDependencies } from "./projectEvidenceService";
export { PROJECT_EVIDENCE_CLASSIFICATIONS, ProjectEvidenceError } from "./projectEvidenceTypes";
export type {
  CreateProjectEvidenceInput,
  ListProjectEvidenceOptions,
  NormalizedCreateProjectEvidenceInput,
  ProjectEvidence,
  ProjectEvidenceClassification,
  ProjectEvidenceErrorCode,
  ProjectEvidenceValidationErrorCode,
  ProjectEvidenceValidationIssue,
  ProjectEvidenceValidationResult,
} from "./projectEvidenceTypes";
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
