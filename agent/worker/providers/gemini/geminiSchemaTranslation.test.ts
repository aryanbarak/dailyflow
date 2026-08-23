import { describe, expect, it } from 'vitest'
import { translateNeutralSchema } from './geminiSchemaTranslation'
import type { NeutralSchema } from '../schema/neutralSchema'

// ADR-0018 S2: unit coverage for every subset feature in isolation --
// shared/*.purity.test.ts already proves the four REAL builders round-trip
// byte-identically against the pinned pre-S2 snapshots; these tests exist
// so a feature this codebase doesn't currently exercise (e.g. `boolean`,
// or `description` -- neither used by any of the four builders today) is
// still covered, and so a translation regression is diagnosable per
// feature rather than only as "some snapshot somewhere changed."

describe('translateNeutralSchema', () => {
  describe('string', () => {
    it('translates a plain string with no enum', () => {
      expect(translateNeutralSchema({ type: 'string' })).toEqual({ type: 'STRING' })
    })

    it('translates enum, spread into a plain array (not the original readonly reference)', () => {
      const enumValues = ['a', 'b', 'c'] as const
      const result = translateNeutralSchema({ type: 'string', enum: enumValues })
      expect(result).toEqual({ type: 'STRING', enum: ['a', 'b', 'c'] })
      expect((result.enum as unknown[])).not.toBe(enumValues)
    })
  })

  describe('number', () => {
    it('translates a plain number to Gemini NUMBER', () => {
      expect(translateNeutralSchema({ type: 'number' })).toEqual({ type: 'NUMBER' })
    })

    it('translates integer:true to Gemini INTEGER (amendment 2, ADR-0018 2026-08-23)', () => {
      expect(translateNeutralSchema({ type: 'number', integer: true })).toEqual({ type: 'INTEGER' })
    })

    it('translates integer:false the same as omitted -- NUMBER, not INTEGER', () => {
      expect(translateNeutralSchema({ type: 'number', integer: false })).toEqual({ type: 'NUMBER' })
    })
  })

  describe('boolean', () => {
    it('translates to Gemini BOOLEAN', () => {
      expect(translateNeutralSchema({ type: 'boolean' })).toEqual({ type: 'BOOLEAN' })
    })
  })

  describe('array', () => {
    it('translates items with no minItems/maxItems', () => {
      const schema: NeutralSchema = { type: 'array', items: { type: 'string' } }
      expect(translateNeutralSchema(schema)).toEqual({ type: 'ARRAY', items: { type: 'STRING' } })
    })

    it('translates minItems and maxItems (amendment 1, ADR-0018 2026-08-23), in that key order, before items', () => {
      const schema: NeutralSchema = { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } }
      const result = translateNeutralSchema(schema)
      expect(result).toEqual({ type: 'ARRAY', minItems: 1, maxItems: 3, items: { type: 'STRING' } })
      expect(Object.keys(result)).toEqual(['type', 'minItems', 'maxItems', 'items'])
    })

    it('translates maxItems alone, without minItems', () => {
      const schema: NeutralSchema = { type: 'array', maxItems: 20, items: { type: 'string' } }
      const result = translateNeutralSchema(schema)
      expect(result).toEqual({ type: 'ARRAY', maxItems: 20, items: { type: 'STRING' } })
      expect(Object.keys(result)).toEqual(['type', 'maxItems', 'items'])
    })

    it('translates nested arrays and objects recursively', () => {
      const schema: NeutralSchema = {
        type: 'array',
        items: { type: 'object', properties: { name: { type: 'string' } } },
      }
      expect(translateNeutralSchema(schema)).toEqual({
        type: 'ARRAY',
        items: { type: 'OBJECT', properties: { name: { type: 'STRING' } } },
      })
    })
  })

  describe('object', () => {
    it('translates properties with no required', () => {
      const schema: NeutralSchema = { type: 'object', properties: { name: { type: 'string' } } }
      const result = translateNeutralSchema(schema)
      expect(result).toEqual({ type: 'OBJECT', properties: { name: { type: 'STRING' } } })
      expect(Object.keys(result)).toEqual(['type', 'properties'])
    })

    it('translates required, in key order BEFORE properties', () => {
      const schema: NeutralSchema = {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      }
      const result = translateNeutralSchema(schema)
      expect(result).toEqual({ type: 'OBJECT', required: ['name'], properties: { name: { type: 'STRING' } } })
      expect(Object.keys(result)).toEqual(['type', 'required', 'properties'])
    })

    it('translates an empty properties object', () => {
      expect(translateNeutralSchema({ type: 'object', properties: {} })).toEqual({ type: 'OBJECT', properties: {} })
    })

    it('preserves property insertion order', () => {
      const schema: NeutralSchema = {
        type: 'object',
        properties: { z: { type: 'string' }, a: { type: 'string' }, m: { type: 'string' } },
      }
      const result = translateNeutralSchema(schema) as { properties: Record<string, unknown> }
      expect(Object.keys(result.properties)).toEqual(['z', 'a', 'm'])
    })
  })

  describe('description (subset feature, unused by any of the four real builders today)', () => {
    it('is appended last for every schema kind', () => {
      expect(translateNeutralSchema({ type: 'string', enum: ['a'], description: 'd' }))
        .toEqual({ type: 'STRING', enum: ['a'], description: 'd' })
      expect(Object.keys(translateNeutralSchema({ type: 'string', description: 'd' }))).toEqual(['type', 'description'])
      expect(Object.keys(translateNeutralSchema({ type: 'number', description: 'd' }))).toEqual(['type', 'description'])
      expect(Object.keys(translateNeutralSchema({ type: 'boolean', description: 'd' }))).toEqual(['type', 'description'])
      expect(Object.keys(translateNeutralSchema({ type: 'array', items: { type: 'string' }, description: 'd' })))
        .toEqual(['type', 'items', 'description'])
      expect(Object.keys(translateNeutralSchema({ type: 'object', properties: {}, description: 'd' })))
        .toEqual(['type', 'properties', 'description'])
    })

    it('is omitted entirely when not provided, not emitted as description: undefined', () => {
      expect(Object.keys(translateNeutralSchema({ type: 'string' }))).toEqual(['type'])
    })
  })

  describe('deep composition (a small realistic schema, exercising every subset feature at once)', () => {
    it('translates a nested object/array/enum/required/minItems/maxItems/integer schema correctly', () => {
      const schema: NeutralSchema = {
        type: 'object',
        required: ['items'],
        properties: {
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 5,
            items: {
              type: 'object',
              required: ['kind', 'count'],
              properties: {
                kind: { type: 'string', enum: ['a', 'b'] },
                count: { type: 'number', integer: true },
                active: { type: 'boolean' },
              },
            },
          },
        },
      }
      expect(translateNeutralSchema(schema)).toEqual({
        type: 'OBJECT',
        required: ['items'],
        properties: {
          items: {
            type: 'ARRAY',
            minItems: 1,
            maxItems: 5,
            items: {
              type: 'OBJECT',
              required: ['kind', 'count'],
              properties: {
                kind: { type: 'STRING', enum: ['a', 'b'] },
                count: { type: 'INTEGER' },
                active: { type: 'BOOLEAN' },
              },
            },
          },
        },
      })
    })
  })
})
