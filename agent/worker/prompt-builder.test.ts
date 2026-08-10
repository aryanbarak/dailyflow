import { describe, expect, it } from 'vitest'
import { buildChatSystemPrompt } from './prompt-builder'
import type { ConfirmedPersonalMemoryRecord } from './personal-memory-prompt-serialization'
import type { Language } from './types'

// Task 11c PART 3 (conversation-lane self-awareness) + PART 1/2 (close the
// legacy leak). buildChatSystemPrompt's own signature is
// `(language: Language, confirmedMemory: ConfirmedPersonalMemoryRecord[])`
// -- there is no third parameter for legacy user_context or unreviewed
// goal content, so it is structurally impossible for this function to
// inject anything beyond the two inputs it actually receives. These tests
// lock in (a) that only confirmed memory content ever appears, never a
// legacy-only fact, and (b) that the identity block from task 11c is
// always present, in every language, regardless of whether confirmed
// memory exists.

const now = '2026-08-10T09:00:00.000Z'

function confirmedSkill(summary: string): ConfirmedPersonalMemoryRecord {
  return { kind: 'skill', content: { summary }, createdAt: now }
}

describe('buildChatSystemPrompt', () => {
  it('(a) contains ONLY the confirmed memory passed in -- a legacy-only fact (never confirmed) is structurally absent since there is no legacy input to this function at all', () => {
    const confirmedMemory = [confirmedSkill('TELC B2'), confirmedSkill('TypeScript'), confirmedSkill('React')]
    const prompt = buildChatSystemPrompt('fa', confirmedMemory)

    expect(prompt).toContain('TELC B2')
    expect(prompt).toContain('TypeScript')
    expect(prompt).toContain('React')
    // The production-evidence legacy fact ("IT specialist in app development
    // (IHK)") was never part of the confirmed set passed in here, and
    // cannot appear -- there is no code path in this function that reads
    // anything else.
    expect(prompt).not.toContain('IHK')
    expect(prompt).not.toContain('متخصص')
  })

  it('(b) regression lock: the identity block is present in every language -- states Flow AI/SmartFlow, never claims lack of access, never tells the user to open the app, never claims it ran an action', () => {
    const cases: Array<{ language: Language; mustContain: string[] }> = [
      {
        language: 'en',
        mustContain: [
          'Flow AI',
          "SmartFlow's own assistant",
          'the user is using the SmartFlow app right now',
          'you do not run those yourself and must not claim you did',
          'never tell the user to open SmartFlow',
        ],
      },
      {
        language: 'de',
        mustContain: [
          'Flow AI',
          'der eigene Assistent von SmartFlow',
          'du hättest es getan',
          'fordere den Nutzer nie auf, SmartFlow zu öffnen',
        ],
      },
      {
        language: 'fa',
        mustContain: [
          'Flow AI',
          'دستیار خودِ SmartFlow',
          'نباید ادعا کنی که اجرا کرده‌ای',
          'هرگز به کاربر نگو که SmartFlow را باز کند',
        ],
      },
    ]

    for (const { language, mustContain } of cases) {
      const prompt = buildChatSystemPrompt(language, [])
      for (const phrase of mustContain) {
        expect(prompt, `${language} prompt missing: "${phrase}"`).toContain(phrase)
      }
    }
  })

  it('(b) the identity block is present regardless of whether confirmed memory exists -- not conditional on memory content', () => {
    const withMemory = buildChatSystemPrompt('en', [confirmedSkill('React')])
    const withoutMemory = buildChatSystemPrompt('en', [])

    for (const prompt of [withMemory, withoutMemory]) {
      expect(prompt).toContain('Flow AI')
      expect(prompt).toContain('never tell the user to open SmartFlow')
    }
  })
})
