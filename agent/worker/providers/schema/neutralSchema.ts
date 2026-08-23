// SmartFlow -- ADR-0018 Decision 3: the minimal JSON-Schema subset the
// four [STRUCTURED_GEN] builders (buildReasoningResponseSchema,
// buildDerivationResponseSchema, buildExtractionResponseSchema,
// buildTaskTitleResponseSchema) emit, owned by SmartFlow -- not Gemini's
// dialect. `providers/gemini/geminiSchemaTranslation.ts` is the ONLY
// place that knows how this maps to Gemini's `responseSchema` wire shape.
//
// Subset (ADR-0018 Decision 3 + Amendments 2026-08-23): object, string,
// number, boolean, array (of the above), enum (string only), required,
// maxItems, minItems, description. NOTHING more. If a builder needs
// something outside this subset, that is a new decision (see the ADR's
// own "Supersession and Change Control" section) -- do not widen this
// file to route around that.
//
// Two amendments to the ADR's original subset text, both discovered
// during S2 Phase A (the baseline snapshot of all four builders' CURRENT
// Gemini-dialect output) and both necessary for the neutral-schema
// round-trip to stay byte-identical to that baseline -- see the ADR's own
// "Amendments (2026-08-23)" section for the full rationale:
//   1. `minItems` -- 3 of the 4 real builders use it (bounded-but-nonempty
//      arrays). Without it, the round-trip would silently drop a real,
//      currently-enforced provider-side constraint.
//   2. `integer` on the `number` schema -- Gemini's dialect distinguishes
//      `type: "INTEGER"` from `type: "NUMBER"` as two different wire
//      values (reasoning's `target.issueNumber`, derivation's
//      `content.order` are both INTEGER today). The ADR's subset names
//      only "number" as a primitive, not a second "integer" type, so this
//      is a boolean modifier on NeutralNumberSchema rather than a new
//      top-level type -- the smallest change that lets translation
//      reproduce the exact wire value.

export type NeutralSchema =
  | NeutralObjectSchema
  | NeutralStringSchema
  | NeutralNumberSchema
  | NeutralBooleanSchema
  | NeutralArraySchema

export interface NeutralObjectSchema {
  type: 'object'
  properties: Record<string, NeutralSchema>
  required?: readonly string[]
  description?: string
}

export interface NeutralStringSchema {
  type: 'string'
  enum?: readonly string[]
  description?: string
}

export interface NeutralNumberSchema {
  type: 'number'
  // See amendment 2 above -- absent/false means Gemini's NUMBER, true
  // means Gemini's INTEGER. Neither JSON-Schema nor this ADR's own subset
  // text has a separate "integer" primitive; this is the narrowest way to
  // preserve the real wire distinction without introducing one.
  integer?: boolean
  description?: string
}

export interface NeutralBooleanSchema {
  type: 'boolean'
  description?: string
}

export interface NeutralArraySchema {
  type: 'array'
  items: NeutralSchema
  minItems?: number
  maxItems?: number
  description?: string
}
