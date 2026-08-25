# GitHub Chat-Tool Dependency Chain — Architecture Note

**Status:** Informational, non-binding. Written after GH-05 (diagnosis) and
GH-06 (fix) to record a structural characteristic worth knowing before
adding another multi-step chat tool, not a new decision.

## The observation

Most chat message types resolve in **one** Worker round-trip:
`ChatPage.tsx`'s `handleSend` sends `POST /chat`, the Worker computes a
reply (running deterministic detection, e.g. auto-task-write, entirely
server-side) and persists both the user and assistant rows to
`agent_chat_messages` before responding. If that one request resolves, the
turn is durable regardless of anything that happens afterward in the
browser.

A GitHub chat-tool message (e.g. "list my GitHub repositories") instead
depends on **three** sequential/concurrent stages before anything is shown
or persisted:

1. **Chat reply** — `chatCallPromise`, `POST /chat` (`mode` omitted/`chat`).
2. **Reasoning overlay** — `overlayPromise`, `POST /chat` (`mode=reasoning`)
   via `reasonAboutUserMessage`, run concurrently with (1) via
   `Promise.all`, used to decide *whether* a GitHub tool should run at all.
3. **Tool execution** — only after both (1) and (2) resolve, `runReadOnlyTool`
   makes a *third*, separate Worker call (e.g. `GET /github/repositories`)
   from the browser directly.

Nothing is appended to local state or persisted to `agent_chat_messages`
until all three stages have settled. GH-05 traced the resulting hang: with
no timeout on stages 1 or 2, a Worker stall on either one hung the entire
turn indefinitely, and because nothing had been shown or persisted yet, a
page refresh lost the message with no trace — unlike a single-round-trip
message type, which is already durable the moment the one Worker call
completes.

## The fix (GH-06)

Stage 3 already had a bounded timeout (`executionEngine.ts`'s
`withTimeout`, 10s, per read-tool handler `timeoutMs`) — it just never got
a chance to run if stages 1–2 hung first. GH-06 added the same
`withTimeout` convention to stages 1 (`CHAT_REQUEST_TIMEOUT_MS`, 15s) and 2
(10s inside `llmReasoningService.ts`), and — specifically for stage 1,
since a stage-1 timeout is the one case where nothing else in the chain has
produced anything to show or persist — added a direct, RLS-scoped browser
insert into `agent_chat_messages` so an honest bounded message
(`chat_error_provider_unavailable`) survives a refresh instead of leaving a
silent gap. A stage-2-only timeout does not need this: it already resolves
to a `providerUnavailable`-flagged result (INC-01's existing mechanism),
and stage 1 (if it succeeds) is still the one that gets a real reply
persisted.

## Why this matters for future multi-step tools

Any new chat tool that similarly depends on more than one Worker round-trip
before it can show or persist anything inherits the same risk by
construction: each additional stage is another place an unbounded wait can
turn into an indefinite spinner and a silent refresh-loss, and the *first*
stage that could plausibly still be the only thing that ran needs its own
durable, honest fallback — not just a timeout. Before adding a second
tool-execution-dependent stage to any chat flow, check:

- Does every stage have a bounded timeout (reuse `withTimeout`, don't
  invent a new mechanism)?
- If the *earliest* stage times out, is there anything durable to show the
  user, or does the turn simply vanish?
- Does a later stage's failure degrade silently into what the earlier
  stage already produced (as stage 2 does here), or does it need its own
  fallback too?

## References

- `PROJECT_STATUS.md`'s GH-06 entry for the full fix detail (GH-05 itself
  was a report-only diagnosis pass with no PROJECT_STATUS entry of its
  own); this note only records the durable, general-purpose structural
  lesson.
- `src/pages/ChatPage.tsx`'s `handleSend` (stages 1–3),
  `src/features/agent/executionEngine.ts`'s `withTimeout`,
  `src/features/agent/reasoning/llmReasoningService.ts`.
