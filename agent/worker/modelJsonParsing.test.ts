import { describe, expect, it } from 'vitest'
import { ModelJsonParseError, parseModelJsonObject } from './modelJsonParsing'

describe('parseModelJsonObject (task PA-02, provider-coupling-audit-v1.md §4)', () => {
  it('parses a bare JSON object with no fence', () => {
    expect(parseModelJsonObject('{"type":"inspect_tasks"}')).toEqual({ type: 'inspect_tasks' })
  })

  it('parses a bare JSON object with surrounding whitespace/newlines', () => {
    expect(parseModelJsonObject('\n  {"type":"inspect_tasks"}\n  ')).toEqual({ type: 'inspect_tasks' })
  })

  it('strips a ```json ... ``` fence wrapping the whole response', () => {
    expect(parseModelJsonObject('```json\n{"type":"inspect_tasks"}\n```')).toEqual({ type: 'inspect_tasks' })
  })

  it('strips a bare ``` ... ``` fence with no language tag', () => {
    expect(parseModelJsonObject('```\n{"type":"inspect_tasks"}\n```')).toEqual({ type: 'inspect_tasks' })
  })

  it('rejects prose-prefixed output (a JSON object is not the ENTIRE trimmed response)', () => {
    expect(() => parseModelJsonObject('Here is the JSON: {"type":"inspect_tasks"}')).toThrow(ModelJsonParseError)
  })

  it('rejects prose-suffixed output for the same reason', () => {
    expect(() => parseModelJsonObject('{"type":"inspect_tasks"} -- that is my answer.')).toThrow(ModelJsonParseError)
  })

  it('rejects truncated JSON (missing closing brace) as a parse failure, not a shape failure', () => {
    let caught: unknown
    try {
      parseModelJsonObject('{"type":"inspect_tasks"')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ModelJsonParseError)
    // Fails the startsWith/endsWith('}') shape check before ever reaching
    // JSON.parse -- proven by the exact message, not just "it threw".
    expect((caught as ModelJsonParseError).message).toBe('Model response must be exactly one JSON object.')
  })

  it('rejects syntactically invalid JSON that DOES have matching braces (a real JSON.parse failure)', () => {
    let caught: unknown
    try {
      parseModelJsonObject('{bad-json}')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ModelJsonParseError)
    expect((caught as ModelJsonParseError).message).toMatch(/^Model response was not valid JSON \(/)
  })

  it('rejects an empty string', () => {
    expect(() => parseModelJsonObject('')).toThrow(ModelJsonParseError)
  })

  it('ModelJsonParseError carries the fence-stripped, trimmed failedText for callers to snippet/log', () => {
    let caught: unknown
    try {
      parseModelJsonObject('```json\n{bad-json}\n```')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ModelJsonParseError)
    // The fence is already stripped in failedText -- proves the shared
    // helper's fence-stripping ran before the failing JSON.parse, not that
    // failedText is just the raw untouched input.
    expect((caught as ModelJsonParseError).failedText).toBe('{bad-json}')
  })

  it('a JSON object that legitimately contains a lone brace character in a string value still parses (fence regex is anchored to the whole string, not naive brace counting)', () => {
    const input = '{"note":"use { and } carefully"}'
    expect(parseModelJsonObject(input)).toEqual({ note: 'use { and } carefully' })
  })
})
