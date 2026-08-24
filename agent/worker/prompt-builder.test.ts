import { describe, expect, it } from 'vitest'
import { buildChatSystemPrompt } from './prompt-builder'
import type { ConfirmedPersonalMemoryRecord } from './personal-memory-prompt-serialization'
import type { Language } from './types'

// Task 11c PART 3 (conversation-lane self-awareness) + PART 1/2 (close the
// legacy leak). buildChatSystemPrompt's signature was originally
// `(language: Language, confirmedMemory: ConfirmedPersonalMemoryRecord[])`
// -- there was no third parameter for legacy user_context or unreviewed
// goal content, so it was structurally impossible for this function to
// inject anything beyond those two inputs. DATE-01 added `now`/`timeZone`
// (see the describe block below) -- these tests still lock in (a) that
// only confirmed memory content ever appears, never a legacy-only fact,
// and (b) that the identity block from task 11c is always present, in
// every language, regardless of whether confirmed memory exists.

const now = '2026-08-10T09:00:00.000Z'

// DATE-01: a fixed, injected clock -- never real Date.now -- so the
// date-line assertions below are deterministic regardless of when the
// suite runs.
const FIXED_CLOCK = new Date('2026-08-24T14:30:00.000Z')
const FIXED_TIMEZONE = 'Europe/Berlin'

function confirmedSkill(summary: string): ConfirmedPersonalMemoryRecord {
  return { kind: 'skill', content: { summary }, createdAt: now }
}

describe('buildChatSystemPrompt', () => {
  // LANG-01: production evidence (AI_TEXT_PROVIDER=workers-ai) showed the
  // model literally refusing to reply in Persian ("I am required to reply
  // entirely in English, but I can fully understand your messages in
  // Persian") -- CHAT_PERSONA's language line used to be an absolute
  // command ("You MUST reply entirely in English") regardless of what
  // language the user actually wrote in, sourced only from the account's
  // stored `language` setting (fetchUserLanguage), never the message
  // itself. Reworded to an explicit priority order -- explicit in-
  // conversation request, then the current message's own language, then
  // the persona's own language as a last-resort default -- so a Gemma-
  // class model that follows instructions literally (unlike Gemini, which
  // was silently softening the old absolute wording) still produces the
  // right behavior.
  it.each([
    [
      'en',
      "1) If the user explicitly requests a specific language in the conversation, reply in that language. 2) Otherwise, reply in the language of the user's current message. 3) If the language is unclear or mixed, default to English.",
    ],
    [
      'de',
      'Wenn der Nutzer in der Unterhaltung ausdrücklich eine bestimmte Sprache verlangt, antworte in dieser Sprache. 2) Andernfalls antworte in der Sprache der aktuellen Nachricht des Nutzers. 3) Ist die Sprache unklar oder gemischt, antworte standardmäßig auf Deutsch.',
    ],
    [
      'fa',
      'اگر کاربر در طول گفتگو صراحتاً زبان خاصی را درخواست کرده، به همان زبان پاسخ بده. ۲) در غیر این صورت، به زبان پیام فعلی کاربر پاسخ بده. ۳) اگر زبان نامشخص یا ترکیبی بود، به‌طور پیش‌فرض به فارسی پاسخ بده.',
    ],
  ] as const)('%s: the language line is a priority order (explicit request > message language > persona default), not an absolute command', (language, priorityText) => {
    const prompt = buildChatSystemPrompt(language, [], FIXED_CLOCK, FIXED_TIMEZONE)
    expect(prompt).toContain(priorityText)
    expect(prompt).not.toContain('MUST reply entirely')
    expect(prompt).not.toContain('MUSST ausschließlich')
    expect(prompt).not.toContain('تمام پاسخ‌ها را باید به فارسی بنویسی')
  })

  it('(a) contains ONLY the confirmed memory passed in -- a legacy-only fact (never confirmed) is structurally absent since there is no legacy input to this function at all', () => {
    const confirmedMemory = [confirmedSkill('TELC B2'), confirmedSkill('TypeScript'), confirmedSkill('React')]
    const prompt = buildChatSystemPrompt('fa', confirmedMemory, FIXED_CLOCK, FIXED_TIMEZONE)

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
      const prompt = buildChatSystemPrompt(language, [], FIXED_CLOCK, FIXED_TIMEZONE)
      for (const phrase of mustContain) {
        expect(prompt, `${language} prompt missing: "${phrase}"`).toContain(phrase)
      }
    }
  })

  // Task 33-fix: production evidence showed the conversational reply
  // denying GitHub access ("متأسفم، دسترسی ندارم" / "خیر، من به گیت‌هاب
  // دسترسی ندارم") in the SAME turn a GitHub tool call succeeded. Root
  // cause (task 33's diagnosis): CHAT_IDENTITY's access enumeration only
  // ever named "tasks, calendar, or the app" -- it predates GitHub tools
  // entirely and was never extended, so nothing told the model not to
  // guess "no access" from its own training prior. Fixed with a DEFERRING
  // carve-out (neither claim access nor deny it -- GitHub is an optional,
  // per-user connection, unlike tasks/calendar which every user has), not
  // a blunt "never say you lack access" copy of the tasks/calendar
  // wording, which would be actively wrong for a user who genuinely never
  // connected GitHub. Looped over every language this file's own `Language`
  // union supports (task 29-fix's registry-loop spirit -- there is no
  // exported language list to iterate here, so the loop targets the same
  // three languages CHAT_IDENTITY itself is keyed by, matching the pattern
  // above rather than inventing a new source of truth just for this test).
  it.each([
    ['en', 'Never claim you have access to GitHub and never claim you lack it'],
    ['de', 'Behaupte niemals, dass du Zugriff auf GitHub hast, und behaupte niemals, dass dir Zugriff fehlt'],
    ['fa', 'هرگز ادعا نکن که به گیت‌هاب دسترسی داری و هرگز ادعا نکن که دسترسی نداری'],
  ] as const)('%s: CHAT_IDENTITY contains the deferring GitHub carve-out', (language, deferringPhrase) => {
    const prompt = buildChatSystemPrompt(language, [], FIXED_CLOCK, FIXED_TIMEZONE)
    expect(prompt).toContain(deferringPhrase)
    // The pre-existing tasks/calendar/app wording must survive untouched --
    // this is an addition, not a rewrite.
    expect(prompt).toContain('Flow AI')
  })

  it('(b) the identity block is present regardless of whether confirmed memory exists -- not conditional on memory content', () => {
    const withMemory = buildChatSystemPrompt('en', [confirmedSkill('React')], FIXED_CLOCK, FIXED_TIMEZONE)
    const withoutMemory = buildChatSystemPrompt('en', [], FIXED_CLOCK, FIXED_TIMEZONE)

    for (const prompt of [withMemory, withoutMemory]) {
      expect(prompt).toContain('Flow AI')
      expect(prompt).toContain('never tell the user to open SmartFlow')
    }
  })

  // DATE-01: production evidence showed the model inventing a date ("May
  // 19, 2024") or deflecting to "check your calendar" when asked what day
  // it is -- /chat never told it. `now`/`timeZone` are explicit, injected
  // parameters (see FIXED_CLOCK/FIXED_TIMEZONE above) precisely so this is
  // assertable against a fixed instant, never real Date.now.
  it('injects the current date, weekday, and time with timezone -- matches the injected fixed clock, not real time', () => {
    const prompt = buildChatSystemPrompt('en', [], FIXED_CLOCK, FIXED_TIMEZONE)
    // FIXED_CLOCK is 2026-08-24T14:30:00.000Z; Europe/Berlin is UTC+2 in
    // August (CEST) -- 16:30 local, still Monday.
    expect(prompt).toContain('Current date and time: 2026-08-24 (Monday), 16:30, Europe/Berlin')
  })

  it('the date/time line moves with the injected clock and timezone -- not hardcoded, not real Date.now', () => {
    const laterInAnotherZone = buildChatSystemPrompt('en', [], new Date('2026-01-05T23:15:00.000Z'), 'America/New_York')
    // 2026-01-05T23:15Z is 2026-01-05T18:15 in New York (EST, UTC-5) -- Monday.
    expect(laterInAnotherZone).toContain('Current date and time: 2026-01-05 (Monday), 18:15, America/New_York')
    expect(laterInAnotherZone).not.toContain('2026-08-24')
  })

  it('includes the same semantic Markdown contract in English, German, and Persian chat prompts', () => {
    const cases: Array<{ language: Language; phrases: string[] }> = [
      {
        language: 'en',
        phrases: [
          'Formatting contract for normal Flow AI chat replies:',
          'Use normal conversational prose for simple answers',
          'use real Markdown headings',
          'Do not concatenate multiple named items into one long paragraph',
        ],
      },
      {
        language: 'de',
        phrases: [
          'Formatvertrag für normale Flow-AI-Chatantworten:',
          'Nutze für einfache Antworten normale Gesprächsprosa',
          'nutze echte Markdown-Überschriften',
          'Fasse mehrere benannte Elemente nicht in einem langen Absatz zusammen',
        ],
      },
      {
        language: 'fa',
        phrases: [
          'قرارداد قالب‌بندی برای پاسخ‌های عادی چت Flow AI:',
          'برای پاسخ‌های ساده از نثر محاوره‌ای عادی استفاده کن',
          'از عنوان‌های واقعی Markdown استفاده کن',
          'چند مورد نام‌دار را در یک پاراگراف بلند به هم نچسبان',
        ],
      },
    ]

    for (const { language, phrases } of cases) {
      const prompt = buildChatSystemPrompt(language, [], FIXED_CLOCK, FIXED_TIMEZONE)
      for (const phrase of phrases) {
        expect(prompt, `${language} prompt missing: "${phrase}"`).toContain(phrase)
      }
    }
  })

  it('requires real headings for multi-section answers and gives a heading plus child-list example', () => {
    const prompt = buildChatSystemPrompt('en', [], FIXED_CLOCK, FIXED_TIMEZONE)

    expect(prompt).toContain('When an answer has multiple logical sections, use real Markdown headings')
    expect(prompt).toContain('## Major section')
    expect(prompt).toContain('### Subsection')
    expect(prompt).toContain('Preferred heading plus child list:')
    expect(prompt).toContain('### API Development')
    expect(prompt).toContain('* Build APIs for ML/DL models with Flask/FastAPI or Node.js')
  })

  it('does not recommend bold-list pseudo-headings for section titles', () => {
    const prompt = buildChatSystemPrompt('en', [], FIXED_CLOCK, FIXED_TIMEZONE)

    expect(prompt).toContain('Do not produce pseudo-heading list items such as:')
    expect(prompt).toContain('* **API Development:**')
    expect(prompt).toContain('* **Containerization:**')
    expect(prompt).not.toContain('Use bold-only list items as section headings')
    expect(prompt).not.toContain('Prefer "- **API Development:**"')
  })

  it('requires sibling named items to be split into separate list items', () => {
    const prompt = buildChatSystemPrompt('en', [], FIXED_CLOCK, FIXED_TIMEZONE)

    expect(prompt).toContain('Give each named item its own list item')
    expect(prompt).toContain('Preferred named-item list:')
    expect(prompt).toContain('* **LinkedIn**')
    expect(prompt).toContain('* **XING**')
    expect(prompt).toContain('Useful for professional networking and job discovery.')
  })

  it('preserves simple conversational answers instead of forcing headings everywhere', () => {
    const prompt = buildChatSystemPrompt('en', [], FIXED_CLOCK, FIXED_TIMEZONE)

    expect(prompt).toContain('Use normal conversational prose for simple answers')
    expect(prompt).toContain('do not force headings or lists when they are not useful')
    expect(prompt).toContain('do not create headings for every sentence')
    expect(prompt).not.toContain('Always use Markdown headings')
  })

  it('keeps supported task-write approval/execution authority in the server policy layer', () => {
    for (const language of ['en', 'de', 'fa'] as const) {
      const prompt = buildChatSystemPrompt(language, [], FIXED_CLOCK, FIXED_TIMEZONE)
      if (language === 'fa') {
        expect(prompt).toContain('سمت سرور')
        expect(prompt).toContain('سیاست')
      } else {
        expect(prompt).toContain('server')
        expect(prompt).toContain(language === 'de' ? 'Schreibrichtlinie' : 'policy')
      }
      expect(prompt).toContain('Flow AI')
      expect(prompt).not.toContain('Want me to prepare this so you can approve it?')
      expect(prompt).not.toContain('Soll ich das vorbereiten, damit du es freigeben kannst?')
      expect(prompt).not.toContain('می‌خواهی آماده‌اش کنم تا تو تاییدش کنی؟')
    }
  })

  it('does not ask the model to insert manual bidi control characters', () => {
    const bidiControls = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/

    for (const language of ['en', 'de', 'fa'] as const) {
      const prompt = buildChatSystemPrompt(language, [], FIXED_CLOCK, FIXED_TIMEZONE)
      expect(prompt).toContain('Unicode')
      expect(prompt).toContain('Flow AI')
      expect(prompt).not.toMatch(bidiControls)
    }
  })
})
