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
  | 'create_finance_transaction'

export type WriteIntentDomain = 'tasks' | 'calendar' | 'finance'
export type WriteIntentAction = 'create' | 'update'
export type WriteIntentToolId =
  | 'tasks.create'
  | 'tasks.update'
  | 'calendar.create_event'
  | 'calendar.update_event'
  | 'finance.create_transaction'
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
  // Task 28: amount/iban are STRING here for the same reason start/end are
  // above -- the Gemini structured-output schema has no numeric target type
  // in this flat object, and every one of these values is re-derived
  // deterministically from the raw message (never trusted from the model)
  // before it reaches a preview or execution -- see
  // agent/worker/flow-write-policy.ts's parseFinanceWriteIntent and
  // intentValidator.ts's normalizeTarget. category has no dedicated parser
  // (out of this task's stated parsing scope) and defaults to a fixed
  // fallback in buildHandlerInput when the user never mentioned one.
  finance: [
    { name: 'amount', schemaType: 'STRING' },
    { name: 'currency', schemaType: 'STRING' },
    { name: 'direction', schemaType: 'STRING' },
    { name: 'transactionDate', schemaType: 'STRING' },
    { name: 'category', schemaType: 'STRING' },
    { name: 'description', schemaType: 'STRING' },
    { name: 'iban', schemaType: 'STRING' },
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
  // Task 30: finance's own preview lines used to reuse title/due/notes
  // above (task/calendar's vocabulary), rendering as "Title: 45 EUR",
  // "Title: expense" (two lines both labeled Title), "Due: ...", "Notes:
  // ...". Finance needed its own label set instead of overloading the
  // task-shaped ones.
  readonly amount: string
  readonly direction: string
  readonly date: string
  readonly category: string
  readonly description: string
  readonly iban: string
}

// Task 30, mirroring 4995b29 (agent/worker/flow-write-policy.ts's own
// isolateForBidi): a bare digit/punctuation token (an amount or an ISO date)
// carries no directional strength of its own under the bidi algorithm
// (UAX#9) and can visually reorder inside a Persian preview line. This
// module is plain data/functions shared with the Worker (see the
// SHARED-MODULE CONSTRAINT above) -- no React tree to hand a <bdi> to even
// on the frontend side, since previewLines returns plain strings rendered
// via {stepApproval.previewText} (StepApprovalDialog.tsx), not markdown --
// so the same underlying mechanism as the Worker fix is applied directly in
// the string: U+2066 LEFT-TO-RIGHT ISOLATE / U+2069 POP DIRECTIONAL ISOLATE.
const LRI = '⁦'
const PDI = '⁩'
function isolateForBidi(token: string): string {
  return `${LRI}${token}${PDI}`
}

function formatFinanceAmountToken(amount: string, currency: string | undefined): string {
  const currencySuffix = currency ? ` ${currency}` : ''
  return isolateForBidi(`${amount}${currencySuffix}`)
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
  // Task 36b, ADR-0013 Slice 0: the per-intent write-guidance fragment
  // reasoningPrompt.ts hand-writes today (populate-these-fields
  // instructions, approval-required reminders) -- backfilled here, moved
  // verbatim from the current prompt text, as a future source for prompt
  // generation (ADR-0013 Slice 5). NOT YET CONSUMED by reasoningPrompt.ts or
  // anything else -- this slice only adds the data.
  //
  // Optional, not required: create_task/update_task have no equivalent
  // existing prose in reasoningPrompt.ts to move verbatim -- the model
  // currently infers task fields from the schema alone, with no dedicated
  // instruction sentence for them at all. Inventing new prompt-facing text
  // for those two here, unreviewed and untested via ADR-0013 Slice 5's
  // mandatory empirical replay, was explicitly considered and rejected
  // rather than silently done (PO decision, task 36b).
  readonly promptInstruction?: string
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
    // Task 36b, ADR-0013 Slice 0: moved verbatim from reasoningPrompt.ts's
    // create_calendar_event target-field clause (the create half of what
    // was one semicolon-joined sentence shared with update_calendar_event)
    // plus the calendar approval-required sentence, which already names
    // both create_calendar_event and update_calendar_event and is reused
    // verbatim, unsplit, in both entries below. Only edit from source: a
    // trailing period added where the original ended at a semicolon, and
    // capitalizing "Populate" for standalone use -- no wording changed.
    // reasoningPrompt.ts itself is untouched by this slice; nothing reads
    // this field yet.
    promptInstruction:
      'Populate target.eventTitle and target.start (and target.end if a duration or end time is given) for create_calendar_event. ' +
      'create_calendar_event and update_calendar_event require explicit user approval before anything runs -- you are proposing the action, not performing it. Never claim the event was created or updated.',
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
    // Task 36b, ADR-0013 Slice 0: moved verbatim from reasoningPrompt.ts's
    // update_calendar_event target-field clause (the update half of the
    // same source sentence create_calendar_event's own comment above
    // describes) plus the same calendar approval sentence, reused verbatim.
    // Only edit from source: capitalizing "populate" (mid-sentence in the
    // original) for standalone use -- no wording changed. Nothing reads
    // this field yet.
    promptInstruction:
      'Populate target.eventReference (or target.eventId if known) plus whichever of eventTitle/start/end changed for update_calendar_event. ' +
      'create_calendar_event and update_calendar_event require explicit user approval before anything runs -- you are proposing the action, not performing it. Never claim the event was created or updated.',
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
  {
    intentType: 'create_finance_transaction',
    domain: 'finance',
    action: 'create',
    toolId: 'finance.create_transaction',
    capability: 'create',
    undoKind: 'create_finance_transaction',
    // Task 28: amount and direction are the two fields nothing else can
    // stand in for -- a transaction with no amount or no income/expense
    // sign is not a well-formed write, the same bar create_task's `title`
    // and create_calendar_event's `eventTitle`+`start` set for their own
    // domains. transactionDate is not required here: parseFinanceWriteIntent
    // defaults an unmentioned date to "today" (see its own comment) rather
    // than asking, mirroring how create_task tolerates an absent dueDate.
    createRequiredTargetFields: ['amount', 'direction'],
    reversible: true,
    successSummary: 'Transaction recorded.',
    i18n: {
      titleKey: 'agent_intent_title_create_finance_transaction',
      descriptionKey: 'agent_intent_create_finance_transaction_description',
      approvalReasonKey: 'agent_intent_create_finance_transaction_approval_reason',
    },
    descriptionTitle: (target) => (target?.category as string | undefined) ?? '',
    // Task 36b, ADR-0013 Slice 0: moved verbatim, word-for-word, from
    // reasoningPrompt.ts's create_finance_transaction paragraph -- unlike
    // the calendar entries above, this source paragraph is entirely about
    // this one intent (no cross-domain content mixed in), so it required no
    // edits at all to extract. Nothing reads this field yet.
    promptInstruction:
      'Requests to record an income or expense transaction map to create_finance_transaction. Populate target.amount and target.direction -- both are required and must never be invented; propose ask_clarification ONLY if amount or direction is missing or unclear. Populate target.currency, target.transactionDate, target.category, and target.description when the message states them. Never ask which date to use and never propose ask_clarification for a missing date -- an unstated transactionDate is resolved deterministically to today outside of you; do not guess a date yourself either. target.iban is used only for the confirmation preview and is validated deterministically -- never invent it. create_finance_transaction ALWAYS requires explicit user approval before anything runs, regardless of any write-permission default -- you are proposing the action, not performing it. Never claim the transaction was recorded.',
    // Task 30: was labels.title/labels.title/labels.due/labels.notes/
    // labels.notes -- task/calendar's own vocabulary reused wholesale,
    // rendering "Title: 45 EUR" and "Title: expense" as two lines both
    // labeled Title. Now uses finance's own label set (added to
    // WriteIntentPreviewLabels above). Amount and date are bidi-isolated
    // (isolateForBidi) since these bare digit tokens render inside Farsi
    // preview text with no directional strength of their own.
    previewLines: (target, labels) => [
      target?.amount
        ? `${labels.amount}: ${formatFinanceAmountToken(target.amount as string, target.currency as string | undefined)}`
        : null,
      target?.direction ? `${labels.direction}: ${target.direction as string}` : null,
      target?.transactionDate ? `${labels.date}: ${isolateForBidi(target.transactionDate as string)}` : null,
      target?.category ? `${labels.category}: ${target.category as string}` : null,
      target?.description ? `${labels.description}: ${target.description as string}` : null,
      // IBAN is preview-only and never persisted -- see buildHandlerInput's
      // own comment below. Deliberately still shown here, flagged, so the
      // approval card's own generic "sensitive" rendering treats it as such
      // rather than a plain label/value line -- matches the tool catalog's
      // `inputSchema[].sensitive` marking for this same value.
      target?.iban ? `${labels.iban}: ${isolateForBidi(target.iban as string)} (sensitive, not stored)` : null,
    ],
    buildHandlerInput: ({ actorId, target }) => ({
      userId: actorId,
      type: target.direction,
      amount: target.amount,
      // finance_transactions.category is NOT NULL (unlike tasks.due_date's
      // nullable column, which is why create_task's own dueDate above is
      // `?? null`) -- category has no dedicated parser (out of this task's
      // stated scope), so an unmentioned category needs a real fallback
      // STRING here, not null, or the insert fails the column constraint.
      category: (target.category as string | undefined) ?? 'Flow AI',
      date: target.transactionDate,
      notes: target.description,
      // Task 28: IBAN is validated deterministically (mod-97, see
      // agent/worker/flow-write-policy.ts's validateIban and
      // intentValidator.ts's own re-derivation) but finance_transactions
      // has no iban column and this handler input feeds financeService's
      // insert shape directly -- there is nowhere safe to persist it, and
      // the ADR-0004 write boundary this registry's own "what stays
      // hand-written" doc section describes never invents a new column for
      // a value the approval preview already surfaced. Confirmation-only,
      // by design, not an oversight.
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
// WRITE_DOMAIN_TARGET_FIELDS's domain-grouped order (tasks then calendar then
// finance, appended in registration order) --
// this is what reproduces the pre-refactor schema's exact field order. Do
// not derive this by flat-mapping writeIntentRegistry directly: iterating
// by INTENT (create_task, update_task, ...) rather than by DOMAIN would
// interleave task/calendar fields in a different order than the original
// hand-written schema had, breaking the provider-contract-smoke
// byte-identical requirement.
export const WRITE_INTENT_TARGET_FIELD_NAMES: readonly string[] = [
  ...WRITE_DOMAIN_TARGET_FIELDS.tasks.map((field) => field.name),
  ...WRITE_DOMAIN_TARGET_FIELDS.calendar.map((field) => field.name),
  ...WRITE_DOMAIN_TARGET_FIELDS.finance.map((field) => field.name),
]
