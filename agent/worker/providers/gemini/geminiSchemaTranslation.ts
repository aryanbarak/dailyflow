// SmartFlow -- ADR-0018 Decision 3: translates a NeutralSchema
// (providers/schema/neutralSchema.ts) into the exact `responseSchema`
// JSON shape Gemini's `generateContent` API expects. This is the ONLY
// function that knows Gemini's dialect for structured output; nothing
// else in this codebase should construct a Gemini responseSchema by hand.
//
// Key ORDER matters here, not just key presence: shared/*.snapshot.json's
// purity tests compare recursively by property insertion order (see
// shared/reasoningResponseSchema.purity.test.ts's own header comment for
// why toEqual alone is not enough). Each branch below builds its output
// object via sequential property assignment in the exact order the four
// PRE-S2 hand-written builders happened to emit -- derived from the S2
// Phase A baseline snapshots, not chosen freely:
//   string: type, [enum]
//   number/integer: type
//   boolean: type
//   array: type, [minItems], [maxItems], items
//   object: type, [required], properties
// `description` (unused by any of the four current builders, so untested
// by the snapshot round-trip) is appended last for every branch -- the
// natural "least structural" position, consistent across all five.
import type {
  NeutralArraySchema,
  NeutralBooleanSchema,
  NeutralNumberSchema,
  NeutralObjectSchema,
  NeutralSchema,
  NeutralStringSchema,
} from '../schema/neutralSchema'

// The shape translateNeutralSchema produces -- deliberately loose
// (Record<string, unknown>), not a typed mirror of Gemini's own schema
// dialect: this is the one function allowed to know that dialect's exact
// field names/casing, and a stricter return type would just duplicate
// that knowledge in a second place.
export type GeminiSchema = Record<string, unknown>

function translateString(schema: NeutralStringSchema): GeminiSchema {
  const out: GeminiSchema = { type: 'STRING' }
  if (schema.enum !== undefined) out.enum = [...schema.enum]
  if (schema.description !== undefined) out.description = schema.description
  return out
}

function translateNumber(schema: NeutralNumberSchema): GeminiSchema {
  const out: GeminiSchema = { type: schema.integer ? 'INTEGER' : 'NUMBER' }
  if (schema.description !== undefined) out.description = schema.description
  return out
}

function translateBoolean(schema: NeutralBooleanSchema): GeminiSchema {
  const out: GeminiSchema = { type: 'BOOLEAN' }
  if (schema.description !== undefined) out.description = schema.description
  return out
}

function translateArray(schema: NeutralArraySchema): GeminiSchema {
  const out: GeminiSchema = { type: 'ARRAY' }
  if (schema.minItems !== undefined) out.minItems = schema.minItems
  if (schema.maxItems !== undefined) out.maxItems = schema.maxItems
  out.items = translateNeutralSchema(schema.items)
  if (schema.description !== undefined) out.description = schema.description
  return out
}

function translateObject(schema: NeutralObjectSchema): GeminiSchema {
  const out: GeminiSchema = { type: 'OBJECT' }
  if (schema.required !== undefined) out.required = [...schema.required]
  out.properties = Object.fromEntries(
    Object.entries(schema.properties).map(([key, value]) => [key, translateNeutralSchema(value)]),
  )
  if (schema.description !== undefined) out.description = schema.description
  return out
}

export function translateNeutralSchema(schema: NeutralSchema): GeminiSchema {
  switch (schema.type) {
    case 'string': return translateString(schema)
    case 'number': return translateNumber(schema)
    case 'boolean': return translateBoolean(schema)
    case 'array': return translateArray(schema)
    case 'object': return translateObject(schema)
  }
}
