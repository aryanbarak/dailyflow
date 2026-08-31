// Chat V2 Slice 1 -- routing tests. Uses the REAL base classifier and the
// REAL action-verb vocabulary (imported from ChatPage, exactly what
// handleSend passes at runtime), so these cases pin end-to-end routing
// behavior, not a mocked approximation of it.
import { describe, expect, it, vi } from 'vitest'

// Same mock ChatPage.test.tsx uses: importing ChatPage pulls in the real
// Supabase client module, which requires VITE_SMARTFLOW_SUPABASE_MODE under
// vitest's DEV env. Nothing in these tests touches Supabase.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
    from: vi.fn(),
  },
}))

import { classifyMessageIntentSignal, looksLikeExplicitActionRequest, type MessageIntentSignal } from '@/pages/ChatPage'
import {
  classifyChatV2Route,
  resolveChatV2IntentSignal,
  shouldStartReasoningOverlay,
  type ChatV2RoutingDeps,
} from './chatV2Routing'

const deps: ChatV2RoutingDeps = { looksLikeExplicitActionRequest }

function route(message: string) {
  return classifyChatV2Route(message, classifyMessageIntentSignal(message), deps)
}

function resolvedSignal(message: string): MessageIntentSignal {
  return resolveChatV2IntentSignal(message, classifyMessageIntentSignal(message), deps)
}

describe('classifyChatV2Route -- FAST conversational routing', () => {
  // Slice 1 manual-acceptance case 1: greeting + capability question.
  it('routes the Persian greeting/capability question FAST', () => {
    expect(route('سلام، امروز برای چی می‌توانی کمکم کنی؟')).toBe('fast')
  })

  // Slice 1 manual-acceptance case 2: explain-a-concept in Persian.
  it('routes a Persian explain-a-concept request FAST', () => {
    expect(route('Bubble Sort را ساده تشریح کن.')).toBe('fast')
  })

  it('routes an ordinary English how-does-it-work question FAST', () => {
    expect(route('How does garbage collection work in Java?')).toBe('fast')
  })

  it('routes brainstorming FAST', () => {
    expect(route('Can you help me brainstorm ideas for my presentation?')).toBe('fast')
  })

  it('routes a German why-question FAST (conversational base signal passes through rule 1)', () => {
    expect(route('Warum ist der Himmel blau?')).toBe('fast')
  })

  it('routes pure conversational filler FAST', () => {
    expect(route('ok thanks!')).toBe('fast')
  })

  it('routes an empty message FAST (nothing to reason about)', () => {
    expect(classifyChatV2Route('   ', 'conversational', deps)).toBe('fast')
  })
})

describe('classifyChatV2Route -- LEGACY action/uncertain routing', () => {
  // Slice 1 manual-acceptance case 3: the doctor-appointment write.
  it('routes the Persian doctor-appointment create request LEGACY', () => {
    expect(route('برای دوشنبه ساعت ۹ یک نوبت داکتر بساز')).toBe('legacy')
  })

  it('routes an English task-create request LEGACY', () => {
    expect(route('Create a task for Monday: call the doctor')).toBe('legacy')
  })

  it('routes a calendar write LEGACY', () => {
    expect(route('Schedule a meeting with Thomas tomorrow at 9')).toBe('legacy')
  })

  it('routes a finance write LEGACY', () => {
    expect(route('Add a 20 euro expense for groceries')).toBe('legacy')
  })

  it('routes a Persian mark-complete request LEGACY', () => {
    expect(route('این کار را انجام شده علامت بزن')).toBe('legacy')
  })

  it('routes a read-tool request LEGACY (keeps the auto-read overlay path)', () => {
    expect(route('Show me my repositories')).toBe('legacy')
  })

  it('routes a bare-CI-noun status question LEGACY (real inspectable target)', () => {
    expect(route('Is my CI green?')).toBe('legacy')
  })

  it('routes an engineering-task request LEGACY', () => {
    expect(route('Fix the login bug in the smartflow repo')).toBe('legacy')
  })

  it('routes a schedule query without a domain noun LEGACY', () => {
    expect(route('Do I have anything tomorrow?')).toBe('legacy')
  })

  it('routes an uncertain non-conversational message LEGACY (fail-closed rule 4)', () => {
    // No conversational shape, no recognized action vocabulary: uncertainty
    // must fall to the existing safe path, never to FAST.
    expect(route('پرداخت قبض برق')).toBe('legacy')
  })

  it('routes a delete request LEGACY', () => {
    expect(route('Delete all my notes from last week')).toBe('legacy')
  })
})

describe('resolveChatV2IntentSignal -- downgrade-only invariant', () => {
  const SAMPLES = [
    'سلام، امروز برای چی می‌توانی کمکم کنی؟',
    'Bubble Sort را ساده تشریح کن.',
    'How does garbage collection work in Java?',
    'برای دوشنبه ساعت ۹ یک نوبت داکتر بساز',
    'Create a task for Monday: call the doctor',
    'Show me my repositories',
    'ok thanks!',
    'How is my project doing?',
    'پرداخت قبض برق',
    'Do I have anything tomorrow?',
  ]

  it("only ever downgrades 'explicit' to 'conversational' -- never upgrades, never invents a signal", () => {
    for (const message of SAMPLES) {
      const base = classifyMessageIntentSignal(message)
      const resolved = resolveChatV2IntentSignal(message, base, deps)
      if (base === 'explicit') {
        expect(['explicit', 'conversational']).toContain(resolved)
        if (resolved === 'conversational') {
          expect(classifyChatV2Route(message, base, deps)).toBe('fast')
        }
      } else {
        // Non-explicit base signals pass through untouched ('ambiguous'
        // keeps its trailing-offer behavior downstream).
        expect(resolved).toBe(base)
      }
    }
  })

  it("keeps 'ambiguous' intact for the narrative status inquiry (offer behavior unchanged)", () => {
    const message = 'How is my project doing?'
    expect(classifyMessageIntentSignal(message)).toBe('ambiguous')
    expect(resolvedSignal(message)).toBe('ambiguous')
  })

  it('keeps LEGACY-routed explicit messages explicit (task-write path unchanged)', () => {
    for (const message of ['برای دوشنبه ساعت ۹ یک نوبت داکتر بساز', 'Create a task for Monday: call the doctor', 'Show me my repositories']) {
      expect(classifyMessageIntentSignal(message)).toBe('explicit')
      expect(resolvedSignal(message)).toBe('explicit')
    }
  })
})

describe('shouldStartReasoningOverlay -- the FAST path never starts the reasoning lane', () => {
  it("is true only for 'explicit'", () => {
    expect(shouldStartReasoningOverlay('explicit')).toBe(true)
    expect(shouldStartReasoningOverlay('ambiguous')).toBe(false)
    expect(shouldStartReasoningOverlay('conversational')).toBe(false)
  })

  it('is false for every FAST-routed message (so Promise.all resolves on the chat lane alone)', () => {
    const fastMessages = [
      'سلام، امروز برای چی می‌توانی کمکم کنی؟',
      'Bubble Sort را ساده تشریح کن.',
      'How does garbage collection work in Java?',
      'Can you help me brainstorm ideas for my presentation?',
    ]
    for (const message of fastMessages) {
      expect(route(message)).toBe('fast')
      expect(shouldStartReasoningOverlay(resolvedSignal(message))).toBe(false)
    }
  })

  it('stays true for LEGACY explicit messages (overlay behavior preserved)', () => {
    expect(shouldStartReasoningOverlay(resolvedSignal('Show me my repositories'))).toBe(true)
  })
})
