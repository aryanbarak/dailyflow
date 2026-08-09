# Conversation Quality v1 — Design Note (Draft)

Tier 2 under [ADR-0008](../../decisions/adr/ADR-0008-tiered-change-governance.md):
internal, deterministic routing/UI refinement over an existing, already-
approved read/write boundary. No new tool, no approval/execution change, no
schema change. Covers both slices of task `9`.

## Slice 1 — Conversation-first intent boundary

### The problem, concretely

`shouldUseReasoningForMessage` (`src/pages/ChatPage.tsx`) is today a
**denylist**: everything that isn't a recognized greeting/thanks/filler or an
"ordinary generic explanation" (why is/explain/tell me about) is sent to
reasoning mode, which may produce an intent card. This means a message with
no concrete, tool-shaped target — "Check the status of my project rollout",
"Help me study and review a concept for my FIAE exam" — is attempted as an
action request by default, not treated as conversation by default. The
Product Owner's screenshot showed exactly this: a study-help request
produced a proposal card instead of a study answer.

### The fix is NOT "require domain evidence to reach reasoning mode"

The obvious-looking fix — gate reasoning mode behind
`getStrongReadDomainEvidence` (`intentValidator.ts`) returning non-null —
was tried on paper and rejected. That function's evidence patterns are
calibrated for a different job: *rescuing* an already-returned LLM proposal
by confirming it against an explicit domain word (`github`, `connected`,
`aufgaben`...). Reusing it as the *gate into* reasoning mode breaks
`"Show me my repositories"` / `"list my repos"` — perfectly ordinary,
unambiguous, explicit requests that don't happen to contain the qualifier
words those rescue patterns require. Narrowing the gate this way would
regress a large fraction of today's correctly-explicit cases, which the task
explicitly forbids ("Explicit path behavior byte-compatible with today").

### The fix that was chosen: two narrow, additive carve-outs

`shouldUseReasoningForMessage`'s existing structure — ordinary-conversation
exclusion, then Persian-reasoning-intent inclusion, then filler exclusion,
then default-true — is **kept exactly as is**. Two new, narrow conditions
are added, each targeting one specific, named failure mode, neither widening
what already returns `true`:

1. **"Help me study/review/prepare" is unconditionally conversational** —
   added to the existing `ordinaryConversation` bucket (which already treats
   "explain"/"tell me about" as generic regardless of domain words). A
   request to study *for* an exam is asking for tutoring content, not asking
   SmartFlow to inspect the user's own learning-progress data — even though
   it contains "study", the same word `getStrongReadDomainEvidence`'s
   `learning` evidence uses. This is the direct fix for the Product Owner's
   FIAE-exam screenshot. EN: `/\bhelp me (study|review|prepare|practice)\b/i`;
   DE: `/\bhilf mir (beim|zu) (lernen|wiederholen|vorbereiten|üben)\b/i`; FA:
   a "help me" + "study/review/exam" proximity match. This returns
   `conversational` immediately, before any evidence check runs — the same
   short-circuit "why is/explain" already uses.

2. **A narrative status-inquiry with no concrete domain evidence is
   ambiguous, not explicit.** New pattern family: "how is/are X doing",
   "how's X going" (EN), "wie läuft/geht X" (DE), "X چطور پیش می‌رود" (FA) —
   distinguished from an *imperative* request ("check the status of X",
   "kannst du X prüfen") by having no command verb, only a WH-question about
   how something is going. This alone is not enough to disqualify a message
   (many such patterns will still be paired with real domain evidence, e.g.
   "how are my tasks doing" — "tasks" is concrete, stays explicit); it only
   demotes to `ambiguous` when **combined with** `getStrongReadDomainEvidence`
   returning `null` — i.e. the message has no nameable tool behind it at
   all. `"How is my project doing?"` is the canonical case: no domain word
   matches (task/calendar/learning/workspace/github patterns all miss
   "project"), so it demotes from the old default-`true` to `ambiguous`.

Everything else is unchanged. Verified against every existing
`shouldUseReasoningForMessage` test case in `ChatPage.test.tsx`: none of them
match either new pattern, so **no existing test's expected value changes**
(see Section E of the task's final report).

### Three-way classification, made concrete

```
classifyMessageIntentSignal(message): 'explicit' | 'ambiguous' | 'conversational'
```

- `conversational` — ordinary-conversation match (incl. the new study-help
  clause), or filler/greeting/thanks. No card, no offer. Routed through
  plain `/chat` exactly as `shouldUseReasoningForMessage() === false` is
  today.
- `ambiguous` — narrative status-inquiry with no domain evidence. Routed
  through plain `/chat` (never reasoning mode — no card is attempted). After
  the model's own reply comes back, SmartFlow code (never the model)
  deterministically appends one optional trailing offer line, only when a
  concrete offerable tool exists for the message (see below). No offer text
  is ever generated by the model; a fixed, per-language string is appended
  client-side.
- `explicit` — everything else (today's `true`). Routed through reasoning
  mode exactly as today — same schema-enforced call, same intent card, same
  approval flow. `shouldUseReasoningForMessage(message)` becomes a thin
  wrapper: `classifyMessageIntentSignal(message) === 'explicit'`, kept for
  the existing call site and existing tests' import name.

### The trailing offer

`getAmbiguousOfferHint(message): 'github' | null` — a tiny, explicit table,
not a general classifier: bare "project"/"projekt"/"پروژه" in a narrative
status-inquiry maps to `'github'`, because a GitHub-connected repository's
live issue/PR/workflow state is the most concrete, verifiable "real status"
signal this app can pull for a project today. No other mapping exists yet;
an ambiguous message that matches no hint gets a plain conversational reply
with no offer at all — the design explicitly allows "no offer" as a valid
ambiguous outcome, not every ambiguous message needs one.

The offer text itself is a **fixed, per-response-language string**
(`SupportedAiResponseLanguage`-keyed, not the UI's interface language, since
the offer must match whatever language the model's own reply is in),
appended by `ChatPage.tsx` after the plain-chat reply returns — never sent
to the model as something to say, never claimed as already-fetched data. A
normal user reply of assent ("yes", "sure") on the next turn is just a new
message, classified fresh through the same three-way gate; if it now reads
as explicit (e.g. because the assistant's own trailing question makes the
user's "yes, check GitHub" phrasing concrete) it goes through the *normal*
explicit path. There is no pre-armed action, no state carried between
turns, no special-casing of "the user is replying to an offer" — this is a
deliberate simplicity choice, not an oversight: a state machine here would
reintroduce exactly the kind of implicit, hard-to-audit behavior ADR-0004's
write boundaries were written to avoid.

### The two recorded language-heuristic fixes

- **German bare "offen" collision** (`intentValidator.ts`'s task-domain
  evidence, `getStrongReadDomainEvidence`). Today: `/\b(...|offen|offene|
  offenen|...)\b/i` — a message containing "offen" ("open") in *any* sense
  ("Ist die Bibliothek offen?" — is the library open?) falsely evidences the
  `tasks` domain. Fix: bare "offen(e/en)" is removed from the standalone
  word list; it now only counts as task evidence when it appears within ~30
  characters of an explicit task/issue/PR noun
  (`aufgabe(n)?|issue(s)?|pr|pull request`) in either order — "Zeige meine
  offenen Aufgaben" still matches (offenen ← 12 chars → Aufgaben); "Ist die
  Bibliothek offen?" no longer does.
- **Persian possessive-marker extension.** The existing detector's own
  comment (`ChatPage.tsx`) already explains, correctly, why extending it to
  bare word-final suffixes (کارم, دستم) is unsafe: those letters are
  ordinary root-final letters in many unrelated words, and no regex can
  reliably tell "my X" from "a word ending in that letter" without real
  morphological context. That reasoning is not revisited here — it is
  correct, and the task's own dissent-rule spirit means a known-unsafe
  "fix" is worse than an honestly-scoped smaller one. The safe extension
  actually made: standalone possessive-emphasis words `خودم/خودت/خودش/
  خودمان/خودتان/خودشان` ("my own"/"your own"/... ) are added alongside the
  existing bare `من` check — these are whole words, not suffixes, so they
  carry zero attachment-ambiguity risk. The deeper gap (bare suffixes) stays
  open, exactly as the existing comment already discloses; that comment is
  left in place, not reworded to imply it was fully closed.

## Slice 2 — Tutor topic liberation

`LearnAIMode` (`src/features/learn-ai/types.ts`) widens from a closed
4-value union to `string`. This requires no schema change:
`learn_ai_messages.mode` is already a plain `text not null` column with no
`CHECK` constraint (`20260504000000_create_dashboard_tables.sql`), and
`SettingsPage.tsx`'s stored default is a JSON string in `localStorage` — both
already accept arbitrary text. The four existing values become named
constants (`LEARN_AI_SUGGESTED_TOPICS`) offered as suggestion chips, not the
only legal values. History scoping (`listHistory`/`insertMessage`, keyed by
exact `mode` string) is unaffected: a free-typed topic simply becomes its
own history thread, exactly like switching between the four chips already
does today.

- `LearnAIPage.tsx`: the closed 4-button toggle keeps its four buttons
  (now explicitly "suggestions") and gains a free-text input next to them;
  typing a topic and submitting calls the same `setMode` the chips already
  call, with the typed string instead of a canonical value.
- `SettingsPage.tsx`'s "Learn with AI defaults" → "Default topic (optional)":
  the closed `<Select>` is replaced with the same chip + free-text pattern,
  for the same stored field, no new storage key.

### Confirmed-memory context in the tutor prompt — verified, not changed

`useLearnAI.ts`'s `sendMessage` already calls `getConfirmedMemoryPromptContext`
(built in task `7b`) and passes the result as `memoryContext` to `askLearnAI`
(`src/features/learn-ai/aiService.ts`), which sends it as its own top-level
`memoryContext` field in the request body. **This call goes to
`https://api.barakzai.cloud/analyze` — an external service with no source in
this repository.** This design note can verify, and does verify, that the
client sends the confirmed-memory context in its most explicit possible
form (a distinct field, not merged into free text); it cannot verify or
strengthen how that external service's own prompt template uses the field,
because that code does not exist in this repository. This limitation is
disclosed rather than glossed over — "strengthen the wording" was only
possible on the client side, and the client side was already about as
explicit as it can be without inventing a v2 payload shape unilaterally.

## Non-goals

- No approval/execution/write-runtime change — an explicit card's downstream
  flow (approve → run → result) is untouched.
- No new tools, no LLM-based routing decision (the three-way gate stays a
  deterministic regex layer, exactly as the existing binary gate was).
- No removal of reasoning mode, no change to its own schema or prompt.
- No localization pass beyond the two named heuristic fixes and the new
  offer strings.
- No UI redesign beyond the tutor topic control described above.
- No fix to the deeper Persian bare-suffix possessive gap — named as
  deferred, not silently dropped.
