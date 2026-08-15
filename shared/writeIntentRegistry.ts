// Task 23: the single per-tool registration for SmartFlow's frontend
// write-intent system (tasks + calendar today; see the "adding a write
// domain" doc at docs/architecture/adding-a-write-domain.md for what a
// third domain needs).
//
// WHY this file exists (task 22's own section-E finding, since proven by
// two production incidents): before this refactor, adding a write domain
// meant synchronized edits across ~10 places -- AgentIntentType, five
// separate lists in intentValidator.ts, a duplicated schema copy in the
// Worker, per-toolId switches in writeRuntime.ts, several derivation
// points in ChatPage.tsx, the flow-write-permissions capability list, and
// the undo-kind CHECK constraint. Task 22-fix and 22-fix2 each shipped a
// bug from missing exactly one of those places. Every one of those touch
// points now reads this registry at module load instead of carrying its
// own hardcoded copy.
//
// SCOPE BOUNDARY (read this before adding a field): this registry owns
// REGISTRATION metadata -- what does intent X need once it has already
// been decided. It deliberately does NOT own INTENT RESOLUTION -- the
// free-text detection regexes (requestLooksLikeTaskCreate and siblings in
// intentValidator.ts, parseTaskWriteIntent/parseCalendarWriteIntent in
// flow-write-policy.ts) and the write-precedence ordering between
// competing signals stay hand-written where they already lived. That
// ordering is a priority-ranked cascade across BOTH write and read intents
// together (calendar-before-task, completion-before-either, mixed-request
// detection spanning all of them) -- collapsing it into generic per-entry
// iteration would risk silently reordering priority for a genuinely
// ambiguous message, which is exactly the kind of behaviour change this
// task's HARD CONSTRAINT rules out. See the doc above, section "what
// stays hand-written", for the full reasoning.
//
// SHARED-MODULE CONSTRAINT: this file is imported by BOTH the Cloudflare
// Worker (agent/worker/*.ts, via a relative path) and the frontend
// (src/*.ts, also via a relative path) -- two independently bundled,
// independently deployed runtimes with no other shared module between
// them today. It must stay pure data plus pure, side-effect-free
// functions: no Supabase client, no React, no DOM, no worker-only
// bindings. The Worker remains the authority for POLICY (auto/ask/off)
// and RESOLUTION (turning a chat message into a concrete write) -- this
// file only describes what each already-resolved intent looks like.
//
// ORDERING NOTE: `writeIntentRegistry`'s array order is itself meaningful
// -- several consumers (SUPPORTED_INTENT_VALUES, supportedIntentTypes,
// intentToolMap, domainByIntent, UNDO_KIND_VALUES) splice this array's
// mapped values into a larger hardcoded list at a fixed position, and rely
// on this array producing create_task, update_task, create_calendar_event,
// update_calendar_event in that exact order to stay byte-identical with
// the pre-refactor literals. Target-field SCHEMA order is handled
// separately below (WRITE_DOMAIN_TARGET_FIELDS, grouped by domain, not by
// intent) for the same reason -- see its own comment.

export type WriteIntentType =
  | 'create_task'
  | 'update_task'
  | 'create_calendar_event'
  | 'update_calendar_event'

export type WriteIntentDomain = 'tasks' | 'calendar'
export type WriteIntentAction = 'create' | 'update'
export type WriteIntentToolId =
  | 'tasks.create'
  | 'tasks.update'
  | 'calendar.create_event'
  | 'calendar.update_event'
export type WriteIntentCapability = 'create' | 'update' | 'schedule'

export interface WriteIntentTargetField {
  readonly name: string
  readonly schemaType: 'STRING'
}

// Task fields and calendar fields, each in the exact order the pre-refactor
// literal schema/allow-lists already used (taskId, taskReference,
// taskTitleHint, title, notes, dueDate, then the calendar quintet) --
// grouped by DOMAIN, not by intent, because that is the order the original
// hand-written object literals used (all of a domain's fields together,
// update's extra id/reference fields before the fields create also has).
// Both create and update entries in a domain reference this SAME list --
// the Gemini structured-output schema is one flat target object shared by
// every intent (the model doesn't know which intent it's about to name
// until it names it), so per-intent field lists would just be redundant
// subsets of this.
export const WRITE_DOMAIN_TARGET_FIELDS: Record<WriteIntentDomain, readonly WriteIntentTargetField[]> = {
  tasks: [
    { name: 'taskId', schemaType: 'STRING' },
    { name: 'taskReference', schemaType: 'STRING' },
    { name: 'taskTitleHint', schemaType: 'STRING' },
    { name: 'title', schemaType: 'STRING' },
    { name: 'notes', schemaType: 'STRING' },
    { name: 'dueDate', schemaType: 'STRING' },
  ],
  calendar: [
    { name: 'eventTitle', schemaType: 'STRING' },
    { name: 'eventReference', schemaType: 'STRING' },
    { name: 'eventId', schemaType: 'STRING' },
    { name: 'start', schemaType: 'STRING' },
    { name: 'end', schemaType: 'STRING' },
  ],
}

// A loosely-typed read of a proposal's target object -- deliberately not
// the frontend's AgentIntentTarget or the Worker's normalized-proposal
// target type, since neither can be imported here (see the shared-module
// constraint above). Every hook below only reads fields it already expects
// by name, exactly like the hand-written code it replaced did against its
// own richer, file-local type.
export type WriteIntentTargetRecord = Record<string, unknown>

export interface WriteIntentPreviewLabels {
  readonly title: string
  readonly due: string
  readonly notes: string
  readonly start: string
  readonly end: string
  readonly none: string
}

export interface WriteIntentHandlerInputParams {
  readonly actorId: string
  readonly targetId?: string
  readonly target: WriteIntentTargetRecord
}

export interface WriteIntentDescriptor {
  readonly intentType: WriteIntentType
  readonly domain: WriteIntentDomain
  readonly action: WriteIntentAction
  readonly toolId: WriteIntentToolId
  // Matches the corresponding AgentToolDefinition's own `capability` field
  // (calendarTools.ts / taskTools.ts) -- calendar.create_event predates
  // this task's slice and already used "schedule", not "create", so that
  // asymmetry is preserved data, not something this refactor normalizes.
  readonly capability: WriteIntentCapability
  // flow_write_undo_records.kind value persisted for this intent. Equal to
  // intentType for every entry today (see the migration) -- kept as its
  // own field, not reused from intentType, because a future domain's undo
  // bookkeeping key is not guaranteed to match its intent name.
  readonly undoKind: WriteIntentType
  // Which target field holds the id of an already-resolved existing
  // record, for UPDATE intents only (create has no existing record yet).
  readonly targetIdField?: 'taskId' | 'eventId'
  // Fields writeRuntime's target-validity check requires as non-empty
  // strings before a CREATE proposal is considered well-formed. Update
  // intents intentionally have none here -- they fall back to the same
  // generic "step.targetId is a non-empty string" check every other write
  // tool (tasks.complete, the GitHub tools) already uses; that is today's
  // actual behaviour (update_task/update_calendar_event never got a
  // bespoke field check), not an oversight this refactor should fix.
  readonly createRequiredTargetFields?: readonly string[]
  readonly reversible: boolean
  readonly successSummary: string
  readonly i18n: {
    readonly titleKey: string
    readonly descriptionKey: string
    readonly approvalReasonKey: string
  }
  // The description-panel title interpolated into i18n.descriptionKey.
  readonly descriptionTitle: (target: WriteIntentTargetRecord | undefined) => string
  // The approval-card preview lines (before the caller's own
  // `.filter(Boolean).join('\n')`) -- ported verbatim from
  // approvalForReasoningStep's per-intent branches.
  readonly previewLines: (target: WriteIntentTargetRecord | undefined, labels: WriteIntentPreviewLabels) => Array<string | null>
  // The write-handler input object writeRuntime's buildHandlerInput used to
  // construct per-toolId -- ported verbatim.
  readonly buildHandlerInput: (params: WriteIntentHandlerInputParams) => Record<string, unknown>
}

export const writeIntentRegistry: readonly WriteIntentDescriptor[] = [
  {
    intentType: 'create_task',
    domain: 'tasks',
    action: 'create',
    toolId: 'tasks.create',
    capability: 'create',
    undoKind: 'create_task',
    createRequiredTargetFields: ['title'],
    reversible: true,
    successSummary: 'Task created.',
    i18n: {
      titleKey: 'agent_intent_title_create_task',
      descriptionKey: 'agent_intent_create_description',
      approvalReasonKey: 'agent_intent_create_approval_reason',
    },
    descriptionTitle: (target) => (target?.title as string | undefined) ?? '',
    previewLines: (target, labels) => [
      `${labels.title}: ${target?.title as string | undefined}`,
      target?.dueDate ? `${labels.due}: ${target.dueDate as string}` : null,
      target?.notes ? `${labels.notes}: ${target.notes as string}` : null,
    ],
    buildHandlerInput: ({ actorId, target }) => ({
      userId: actorId,
      title: target.title,
      notes: target.notes,
      dueDate: target.dueDate ?? null,
    }),
  },
  {
    intentType: 'update_task',
    domain: 'tasks',
    action: 'update',
    toolId: 'tasks.update',
    capability: 'update',
    undoKind: 'update_task',
    targetIdField: 'taskId',
    reversible: true,
    successSummary: 'Task updated.',
    i18n: {
      titleKey: 'agent_intent_title_update_task',
      descriptionKey: 'agent_intent_task_update_description',
      approvalReasonKey: 'agent_intent_task_update_approval_reason',
    },
    descriptionTitle: (target) => (target?.taskTitleHint as string | undefined) ?? (target?.taskReference as string | undefined) ?? '',
    previewLines: (target, labels) => [
      target?.title ? `${labels.title}: ${target.title as string}` : null,
      target?.dueDate !== undefined ? `${labels.due}: ${(target.dueDate as string | null) ?? labels.none}` : null,
      target?.notes ? `${labels.notes}: ${target.notes as string}` : null,
    ],
    buildHandlerInput: ({ actorId, targetId, target }) => ({
      userId: actorId,
      taskId: targetId,
      ...(target.title !== undefined ? { title: target.title } : {}),
      ...(target.notes !== undefined ? { notes: target.notes } : {}),
      ...(target.dueDate !== undefined ? { dueDate: target.dueDate } : {}),
    }),
  },
  {
    intentType: 'create_calendar_event',
    domain: 'calendar',
    action: 'create',
    toolId: 'calendar.create_event',
    capability: 'schedule',
    undoKind: 'create_calendar_event',
    createRequiredTargetFields: ['eventTitle', 'start'],
    reversible: true,
    successSummary: 'Event created.',
    i18n: {
      titleKey: 'agent_intent_title_create_calendar_event',
      descriptionKey: 'agent_intent_create_calendar_event_description',
      approvalReasonKey: 'agent_intent_create_calendar_event_approval_reason',
    },
    descriptionTitle: (target) => (target?.eventTitle as string | undefined) ?? '',
    previewLines: (target, labels) => [
      `${labels.title}: ${target?.eventTitle as string | undefined}`,
      `${labels.start}: ${target?.start as string | undefined}`,
      target?.end ? `${labels.end}: ${target.end as string}` : null,
    ],
    buildHandlerInput: ({ actorId, target }) => ({
      userId: actorId,
      title: target.eventTitle,
      dateTimeStart: target.start,
      ...(target.end !== undefined ? { dateTimeEnd: target.end } : {}),
    }),
  },
  {
    intentType: 'update_calendar_event',
    domain: 'calendar',
    action: 'update',
    toolId: 'calendar.update_event',
    capability: 'update',
    undoKind: 'update_calendar_event',
    targetIdField: 'eventId',
    reversible: true,
    successSummary: 'Event updated.',
    i18n: {
      titleKey: 'agent_intent_title_update_calendar_event',
      descriptionKey: 'agent_intent_calendar_event_update_description',
      approvalReasonKey: 'agent_intent_calendar_event_update_approval_reason',
    },
    descriptionTitle: (target) => (target?.eventTitle as string | undefined) ?? (target?.eventReference as string | undefined) ?? '',
    previewLines: (target, labels) => [
      target?.eventTitle ? `${labels.title}: ${target.eventTitle as string}` : null,
      target?.start ? `${labels.start}: ${target.start as string}` : null,
      target?.end ? `${labels.end}: ${target.end as string}` : null,
    ],
    buildHandlerInput: ({ actorId, targetId, target }) => ({
      userId: actorId,
      eventId: targetId,
      ...(target.eventTitle !== undefined ? { title: target.eventTitle } : {}),
      ...(target.start !== undefined ? { dateTimeStart: target.start } : {}),
      ...(target.end !== undefined ? { dateTimeEnd: target.end } : {}),
    }),
  },
]

export function findWriteIntentDescriptor(intentType: string): WriteIntentDescriptor | undefined {
  return writeIntentRegistry.find((entry) => entry.intentType === intentType)
}

export function findWriteIntentDescriptorByToolId(toolId: string): WriteIntentDescriptor | undefined {
  return writeIntentRegistry.find((entry) => entry.toolId === toolId)
}

// The union of every write intent's target field names, in
// WRITE_DOMAIN_TARGET_FIELDS's domain-grouped order (tasks then calendar) --
// this is what reproduces the pre-refactor schema's exact field order. Do
// not derive this by flat-mapping writeIntentRegistry directly: iterating
// by INTENT (create_task, update_task, ...) rather than by DOMAIN would
// interleave task/calendar fields in a different order than the original
// hand-written schema had, breaking the provider-contract-smoke
// byte-identical requirement.
export const WRITE_INTENT_TARGET_FIELD_NAMES: readonly string[] = [
  ...WRITE_DOMAIN_TARGET_FIELDS.tasks.map((field) => field.name),
  ...WRITE_DOMAIN_TARGET_FIELDS.calendar.map((field) => field.name),
]
