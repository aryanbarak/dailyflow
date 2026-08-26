# ENG-01 — Coding Agent Architecture Investigation

**Status:** Investigation only. Not an ADR. Not implemented. No code, config, or
registration changed by this document.
**Date:** 2026-08-26
**Scope:** Evaluates four candidate architectures for letting SmartFlow itself run
the plan → code → test → branch/PR → review loop, gated by PO approval, instead
of the PO manually relaying instructions to a coding agent. Ends with a
recommendation and a named blocking unknown, per the task's own request.

---

## 1. Framing: ceiling vs. floor (not a conflict)

The investigation brief states two things that read as tension but are not:

- **Capability ceiling: unrestricted.** SmartFlow should eventually be able to
  do any engineering task with full technical capability — no capability
  pre-restricted.
- **Unattended-execution floor: zero.** Nothing happens unless the PO
  instructed it, in the moment or via a specific standing instruction given in
  advance. No silent, self-triggered action, ever.

This is exactly the shape [`authority-model.md`](../authority-model.md) and
[ADR-0005](../../decisions/adr/ADR-0005-code-write-mutation-boundary.md)
already encode for the one write capability SmartFlow has today
(`github.files.update`): the *tool* can be as powerful as the underlying
GitHub API allows (branch, commit, arbitrary file content), but every external
effect still requires one exact, digest-bound, server-verified approval before
it happens. Nothing in this investigation should be read as proposing to
loosen that boundary. The question is purely: **what new component(s) let
SmartFlow itself drive a multi-file, multi-step version of that same loop,
without moving the approval floor.**

---

## 2. Where does the code execution physically happen? (Investigation §1)

Confirmed from [`current-architecture.md`](../current-architecture.md) §"Technology
Stack" and §"Deployment Architecture": SmartFlow's only backend compute is a
Cloudflare Worker (`agent/worker/`). Workers are V8 isolates — no filesystem
persistence across requests, no arbitrary subprocess spawning, no long-lived
processes, and a hard per-request CPU/wall-clock ceiling. A Worker cannot
`git clone`, cannot run `npm install`, cannot run a test suite, and cannot host
a coding-agent CLI. This is a platform constraint, not a policy choice — it
cannot be worked around from inside `agent/worker/` as it exists today.

Today this work already happens *somewhere*: the PO's own machine, running
Claude Code interactively, with the PO manually relaying instructions from
this chat. The PO is the orchestrator today, by necessity, not by design.

Three concrete ways to move that role to SmartFlow, each requiring a new
architectural component the Worker calls out to:

| Option | Description | Feasibility | Cost | Security shape |
|---|---|---|---|---|
| **1. Local companion process on the PO's own machine** | A small persistent service (or Claude Code run via the Agent SDK in daemon-like mode) that the Worker reaches via a queue poll, long-lived WebSocket/SSE, or a Cloudflare Tunnel exposing an inbound endpoint. | Cheapest to build; works only while the PO's machine and process are both up. | ~$0 | Ties SmartFlow's capability to one machine's uptime and local security posture; credentials live on a personal laptop. |
| **2. PO-provisioned always-on server/VM** | A small cloud VM or persistent container the Worker calls directly over HTTPS; hosts the coding-agent CLI plus a thin control API. | More available than a laptop; still bespoke infra to build and operate. | Low-modest recurring cost | Better than (1) but still a standing service holding credentials between tasks — a different risk shape from SmartFlow's current "nothing persists between approved actions" model. |
| **3. Ephemeral per-task sandbox** | A fresh container/VM provisioned per approved task (e.g. Cloudflare's Sandbox/Containers, or a similar on-demand sandbox), torn down after. Clone → run agent → capture diff → destroy. | Most build effort: provisioning API, per-task secret injection, egress control, cost metering. | Highest, but bounded per-task | Best match to ADR-0005's "one bounded action per approval" philosophy — credentials and blast radius exist only for the duration of one task. |

**Recommendation on this axis:** sequence infrastructure investment behind
proving the approval-wiring first — start with (2), a single, tightly-scoped,
PO-controlled always-on service, because it is real infrastructure the Worker
calls (not a manual relay) without committing to sandbox-provisioning
engineering before the approval model across a companion-process boundary is
even proven to work. Graduate to (3) once that's proven — this mirrors exactly
how EPIC-08 itself sequenced Slice 1 (prove the proposal/diff/approval
contract with zero mutation capability) before Slice 3 (add the actual
mutation).

---

## 3. The four candidate architectures

### A. Custom GitHub REST integration (current) + external coding-agent CLI, invoked programmatically

**What the research confirms (official docs, not assumption):**

- **Claude Code CLI** has a documented, non-interactive **print mode**
  (`-p`/`--print`), reads stdin, writes structured output via
  `--output-format json|stream-json`, and exits with a code scripts can branch
  on. It can already run arbitrary shell commands itself (Bash is a built-in
  tool, gated by the permission system) — so `npm test` inside the loop is not
  a gap. Permission surface includes `--allowedTools`/`--disallowedTools` and
  `--permission-mode` (`default`/`auto`/`dontAsk`/`acceptEdits`/`plan`/`bypassPermissions`).
  An official **Claude Agent SDK** (Python + TypeScript) wraps the same agent
  loop as a library, and the CLI's `-p --output-format json` mode is
  explicitly documented as the cross-language fallback for driving that same
  loop as a subprocess.
- Critically, the **Agent SDK exposes a `canUseTool` callback**: the *host
  process* (i.e., something SmartFlow controls) can approve or deny each
  individual tool call — a file write, a shell command — at the moment it is
  about to happen, on top of declarative allow/deny rules and permission
  modes. This is the one mechanism in all four options that can deliver
  **per-step approval gating from code SmartFlow owns**, not just "approve the
  final diff." The bare CLI subprocess has no TTY to answer an interactive
  prompt, so this live gating specifically requires the SDK's control
  protocol (or an orchestrator reimplementing its `stream-json` protocol
  directly) — not the plain CLI alone.
- **OpenAI Codex CLI** has an equivalent non-interactive mode, `codex exec
  "<prompt>"`, with `--json`/`--output-schema` for structured output.
  Sandbox modes (`read-only`/`workspace-write`/`danger-full-access`) and
  approval policies (`untrusted`/`on-request`/`never`/`granular`) are
  configured *before* the run starts — the plain `codex exec` path has no
  documented per-call live-approval hook. `codex mcp-server` mode exposes
  shell/patch approvals through the MCP elicitation protocol, which a calling
  MCP client can answer per-request — Codex's closest analog to `canUseTool`,
  though less fully documented.
- Neither tool's official docs require a TTY; both explicitly document
  piped/CI/non-interactive use. Codex additionally documents an official
  container-hardening pattern (Docker as the isolation boundary, network off
  by default, explicit allowlisting) with an explicit warning against running
  it against untrusted repos without that isolation. No equivalent official
  container-hardening page was found for Claude Code — a real documentation
  gap, not a confirmed absence of the capability.

**Assessment:** This is the only option whose approval mechanism can be made
to match ADR-0005/EPIC-08's existing granularity (bind to exact step, tool,
target, content) rather than only "approve the final result." It requires
building the companion/sandbox component from §2, plus a relay from
`canUseTool` (which blocks mid-execution, waiting for an answer) back into
whatever SmartFlow uses as its approval surface — this relay is new, real
engineering, not a config change.

### B. GitHub's official remote MCP server as the GitHub capability layer + the same external CLI

Per GH-10 (already answered, not re-litigated here): auth is compatible
(`ghs_` installation tokens), roughly 25% of `github-integration.ts` would be
replaced, and it adds one network hop.

**Confirmed: this is orthogonal to the coding-agent question.** The MCP server
is a transport/tool-surface substitute for SmartFlow's own hand-rolled GitHub
REST calls (issues, PRs, files) — it says nothing about who edits code or how.
Whichever coding-agent CLI is chosen under (A) still needs the exact same
companion/sandbox invocation, the exact same `canUseTool`/elicitation
approval-gating story, and the exact same relay back to SmartFlow. The one
place these two decisions touch: if the coding-agent process is itself given
the GitHub MCP server as one of *its own* tools (so it can open a PR or
comment directly, rather than SmartFlow doing that afterward through its own
client), then GitHub-mutation tool calls and file-edit tool calls would flow
through the *same* per-call approval boundary inside that one process — which
is achievable, but is a choice about what tools the agent is given, not
something (B) forces or prevents. **(B) is GH-10's question, not this one; it
does not change the answer to A vs. C vs. D.**

### C. GitHub Copilot as the coding agent, SmartFlow as requester/approver

**What the research confirms (official docs.github.com and github.blog, not
marketing pages):**

- **Copilot coding agent** (GA 2025-09-25) is real and it literally runs as a
  GitHub Actions workflow (`copilot-swe-agent`): plans, edits, and runs
  tests/linters in an ephemeral sandbox GitHub owns, then opens a branch and a
  (draft) PR.
- **Third-party programmatic assignment is documented** — a REST assignee
  endpoint, a GraphQL mutation, and a newer "Agent Tasks" API
  (`POST /agents/repos/{owner}/{repo}/tasks`, with an optional
  `create_pull_request` flag that can defer PR creation). **But GitHub's own
  docs state plainly that GitHub App installation (server-to-server) tokens
  are not supported for this** — only PATs, OAuth app tokens, or GitHub App
  user-to-server tokens work, because Copilot billing/seat attribution
  requires a human identity. **This directly blocks a drop-in integration**:
  SmartFlow's entire GitHub capability today is built on the App installation
  token (ADR-0004/ADR-0005/`authority-model.md`'s "Worker owns GitHub App
  credentials"). Using Copilot's coding agent would require building and
  operating a *second*, user-authorized OAuth/user-to-server credential flow
  alongside the existing one — genuinely new infrastructure and a new consent
  surface, not a config toggle.
- **Approval leverage is coarser than ADR-0005's model.** There is no
  documented API for a third party to gate individual edits inside a running
  Copilot task — only org-level allow/deny-list controls exist, not a per-task
  approval webhook. SmartFlow's real leverage is exactly two checkpoints:
  deciding whether to *assign* the task at all (a per-instance or standing PO
  decision, achievable), and approving/merging the resulting PR. There is no
  mid-flight "approve this diff before it's committed" gate the way
  `canUseTool` gives option A — assignment is the only "start" gate, and it is
  coarse (whole-task, not per-file or per-edit).
- Visibility is **partially**, not fully, a black box: because the agent runs
  as a standard Actions workflow, a third party with the right permissions can
  observe the workflow run, logs, checks, and branch commits via standard
  REST/webhooks as they happen — often from session start, since branch +
  draft PR are frequently created immediately. What is not exposed via any
  documented third-party API is the agent's internal reasoning/session log
  (GitHub's own Agents-panel UI only).
- **Copilot CLI** (GA 2026-02-25) is a separate product from the cloud coding
  agent: a genuine headless terminal coding agent (`-p`/`--prompt`, env-var
  auth, `--allow-all-tools`/`--allow-tool`/`--deny-tool`). It is architecturally
  a substitute for Claude Code/Codex CLI inside option A's companion/sandbox
  slot, not an instance of the cloud PR-opening agent — worth naming precisely
  so the two "Copilot" capabilities are not conflated in future decisions.
- **Copilot SDK** (GA 2026-06-02) is a third, distinct surface: embedding a
  Copilot-like agent runtime into your own app (an analog to the Claude Agent
  SDK), superseding the now-fully-sunset Copilot Extensions/Skillsets
  (deprecated 2025-09-24, sunset 2025-11-10, replaced by MCP). It is not the
  PR-opening cloud agent either.
- **Pricing** (docs.github.com/en/copilot/get-started/plans, current):
  Free $0; Pro $10/seat/mo; Pro+ $39/seat/mo; **Business $19/seat/mo
  (includes coding agent, admin-enabled)**; Enterprise $39/seat/mo. The
  coding agent additionally consumes the account's shared GitHub Actions
  minutes plus one AI-credit/premium-request per session — a real new cost
  line beyond what the existing GitHub App integration needs today (which is
  free API access via the installation token). Billing terminology shifted
  from "premium requests" to per-token "AI credits" around 2026-06 — flagged
  as still evolving, not settled.

**Assessment:** Real, documented, and cheapest to build in one sense (GitHub
hosts the actual execution — no sandbox/companion process for SmartFlow to
build or operate). But it is a structurally poorer fit for the PO's approval
model today: the installation-token blocker forces new credential
infrastructure, and the missing mid-task approval hook means it cannot
deliver diff-level gating the way ADR-0005 already requires for the one write
tool SmartFlow has. Worth revisiting only if GitHub adds installation-token
support and a finer-grained in-flight approval API — not a fit today.

### D. Provider-neutral "Coding Agent Gateway" (ADR-0018-style abstraction)

ADR-0018 is the right precedent to reason from, and it argues *against*
building this now, on its own terms. ADR-0018 was only written **after**
`PA-01` confirmed, from real code, exactly what shapes existed across 14
already-implemented AI call sites — the interface was extracted from working
reality, not designed from documentation in advance. Here, **zero
coding-agent backends are implemented yet.** Building a gateway interface now
means guessing at Codex's or Copilot's contract shape from docs alone —
exactly the trap ADR-0018's own sequencing avoided.

There is also a harder problem than ADR-0018 faced: ADR-0018's three
capabilities differ in request/response shape and fallback policy, but not in
*fundamental approval granularity*. A coding-agent gateway would have to
represent that Claude Code (via the Agent SDK) can offer live per-tool-call
approval while Copilot's cloud agent structurally cannot — collapsing that
difference into one interface would be exactly the kind of lossy abstraction
ADR-0018's own `rawFinishReason` amendment explicitly called out and fixed:
"a lossy abstraction that silently drops \[a] real signal... is the same
failure shape" as the incident that motivated the whole ADR. Any future
gateway interface must carry an explicit `supportsPerStepApproval`-style
contract field per backend, not paper over the difference.

**Recommendation on this axis:** premature now. Build one backend (A) fully,
end-to-end, through the existing EPIC-08 pipeline shape, first. Extract the
gateway interface from that one real, working call site afterward — mirroring
ADR-0018's own sequencing (confirm real shapes → write the ADR → implement
provider 1 → add provider 2 later without a new ADR, per that ADR's own
Supersession clause). Building D today would be designing against
assumptions this investigation itself had to go verify against docs; there is
nothing yet to generalize from.

---

## 4. Comparison

| | A. External CLI (e.g. Claude Code + Agent SDK) | B. + GitHub MCP server | C. Copilot coding agent | D. Provider-neutral gateway |
|---|---|---|---|---|
| **Unattended-vs-approved gap closed** | Largest — `canUseTool` gives per-tool-call gating matching ADR-0005's granularity, extended to multi-file/multi-step | Same as A (orthogonal) | Smallest — only "assign" and "merge" are gate-able; no mid-task diff approval | Same ceiling as whichever backend it wraps; adds nothing on its own |
| **New infrastructure required** | Companion service/sandbox (§2) + approval-relay wiring | Everything A needs, plus MCP server integration | New OAuth/user-to-server credential flow (installation token unsupported); no sandbox needed (GitHub hosts execution) | None beyond backend(s) wrapped |
| **Build effort** | Medium–high | A's effort plus ~25% of `github-integration.ts` migration, for no coding-agent benefit | Medium (new auth + webhook/polling); execution itself is free | Low if deferred until after one backend is proven; wasted if built now |
| **Risk** | New process class to sandbox-contain; least mature "SmartFlow drives a real agent" trust story, but matches existing approval philosophy | Adds a dependency/hop for a benefit unrelated to this question | Approval-granularity mismatch with existing architecture; new per-seat cost; assignment APIs marked "public preview, subject to change" | Risk of guessing a wrong contract shape if built pre-emptively; low but real waste |
| **Reversibility of choice** | High — additive companion service behind an internal boundary; swapping CLI backend later is a backend swap | Same as A on this axis (GitHub-transport choice already separately decided by GH-10) | Medium — auth flow is self-contained, but UX built around Copilot's coarse approval shape is costly to unwind later | This *is* the reversibility mechanism for A/B/C, best built after, not instead of, a first backend |

---

## 5. Approval granularity (Investigation §2)

Candidate gates, evaluated against the PO's rule (nothing unattended;
standing instructions allowed, including for irreversible actions if named
explicitly):

- **(a) Approve task/plan before code is touched.** Valuable for
  expensive or ambiguous multi-file work (avoid burning compute on a
  misunderstood task), but not a hard safety requirement the way (b) is. A
  reasonable candidate for standing pre-authorization for narrowly-scoped,
  recurring task classes — the PO's own example, "you may always fix failing
  tests on non-default branches," is exactly this gate.
- **(b) Approve the diff before commit — load-bearing, never removable.**
  This is the direct multi-file generalization of what ADR-0005 already
  requires for one file: approval bound to exact path(s), base revision(s),
  and content digest(s). A standing instruction can authorize *skipping the
  click* (see below), but the diff must still be deterministically generated
  and bound to a server-verifiable record before any commit — "auto" must
  never mean "unrecorded." This gate should never be defaulted away, only
  ever pre-authorized per ADR-0012's existing `auto` mechanism.
- **(c) Approve the PR before merge — load-bearing for the default branch.**
  Mirrors ADR-0005 Decision 3's absolute default-branch protection. This
  should be the *last* gate ever covered by a standing instruction, and then
  only for a narrowly-named class, since merging to default is categorically
  harder to reverse than committing to a throwaway branch.
- **(d) Standing pre-authorization for a bounded change class.**
  **SmartFlow already has this mechanism** — it does not need to be invented.
  [ADR-0012 (Write Capability Layer v1)](../../decisions/adr/ADR-0012-write-capability-layer.md)
  already implements a per-`(domain, action)` `auto`/`ask`/`off` policy for
  `tasks.*`/`calendar.*`, evaluated by trusted runtime code (never
  browser-decided), with exactly the invariants this investigation needs:
  irreversible operations never default to `auto`, unknown domain/action
  fails closed to `ask`, `auto` requires an undo path, and every `auto`
  execution still produces the same audit record class as a manually approved
  one. **Recommendation: extend this exact model to code changes**, keyed on
  `(repository, change-class)` rather than inventing a new mechanism —
  e.g. `auto` for "fix failing tests on non-default branches," `ask` (the
  ADR-0005 default) for anything touching migrations, auth code, or CI config,
  `off` by default for anything unclassified.

**For the irreversible tier specifically** (default-branch merge, repo
deletion, published release) — which the PO has explicitly confirmed a
standing instruction *can* cover, provided it names the exact action class
rather than "handle everything" — ADR-0012's current model is not quite
sufficient as-is: it has no expiry or re-confirmation concept, because
auto-creating a task is a categorically lower-stakes grant than auto-merging
to `main`. Recommend two narrow amendments, scoped only to this new
irreversible tier (not a reopening of ADR-0012's existing task/calendar
defaults):

1. **A stronger grant mechanism.** An irreversible-class standing instruction
   should require its own explicit, separately-presented approval action (not
   a casual settings checkbox) that names the precise action class in the UI
   at grant time — mirroring how ADR-0005 itself required a new
   server-verifiable artifact (`agent_code_proposal_approvals`) rather than
   trusting browser state, once the stakes crossed a threshold.
2. **Periodic re-confirmation.** Unlike `tasks.auto`, an irreversible-class
   grant should expire or require re-attestation after a bounded period or
   number of executions, so a standing grant from months ago cannot silently
   keep authorizing merges to `main` indefinitely.

This is a small, targeted amendment to an already-accepted pattern, not a new
architecture — consistent with ADR-0008's tiered-governance philosophy of
matching process weight to actual risk.

---

## 6. Relationship to EPIC-08 / EPIC-09 (Investigation §3)

**Yes — this investigation's recommended shape effectively is the re-scoping
work both frozen epics are waiting for**, though it answers two different
questions each epic owns:

- [`product-direction-v1.md`](../../product/product-direction-v1.md) §13
  freezes **EPIC-08** pending re-scoping as "a controlled Project-domain Act
  capability." The *architecture* question this investigation answers — which
  execution backend, which physical-execution component, how a multi-file
  diff gets proposed and bound to approval — is exactly EPIC-08-shaped: it
  answers *where and how* the capability lives.
- The same document freezes **EPIC-09** pending a "bounded-autonomy
  definition" that must stay "constrained by the same boundaries already
  governing every write tool today." The *standing-instruction* extension in
  §5 above — how much can run without a fresh per-instance approval, and
  under what naming/re-confirmation discipline for the irreversible tier — is
  exactly EPIC-09-shaped: it answers *how much* can happen unattended, once
  pre-authorized.

**What a following ADR would need, to formally unfreeze both:**

1. Explicit PO acceptance of one execution architecture from §3/§4 (this
   report recommends A) and one physical-execution option from §2, as the
   sole authorized path — following ADR-0005's own decision shape: one scoped
   capability, explicitly bounded, no chaining implied.
2. Explicit PO acceptance of the ADR-0012 extension in §5, including the
   specific bounded change-classes eligible for `auto` and the irreversible-
   tier grant/re-confirmation mechanism.
3. A Slice-1-style non-mutating proof, mirroring EPIC-08's own sequencing:
   demonstrate the chosen backend can be invoked headlessly, produce a real
   diff across multiple files, and have that diff captured and bound for
   approval — with **zero** commit/branch/PR capability authorized yet. Only
   after that is proven should a follow-up ADR (mirroring ADR-0005's own
   relationship to EPIC-08 Slices 1–2 before Slice 3) authorize the actual
   mutation capability.

---

## 7. Recommendation and the one blocking unknown

**Recommendation:** Pursue **Option A** — an external coding-agent CLI
(Claude Code via the official Agent SDK) invoked from a SmartFlow-controlled
companion service (§2, option 2 first, ephemeral sandboxes later), using the
SDK's `canUseTool` callback as the per-step approval gate, with standing
instructions handled by extending ADR-0012's existing `auto`/`ask`/`off`
model (§5) rather than inventing a new mechanism. Treat **B** as already
answered by GH-10 and orthogonal to this decision. Treat **C** as a real but
currently poor fit — the GitHub-App-installation-token blocker and the
missing mid-task approval hook are not incidental, they are structural
mismatches with SmartFlow's existing approval model — worth revisiting only if
GitHub's APIs change. Defer **D** until Option A has one real, working
backend to generalize from.

**The specific unknown that blocks going further than this recommendation:**
whether the Agent SDK's `canUseTool` callback — which blocks the coding-agent
process mid-execution, synchronously, waiting for an answer — can actually be
wired across a companion-process boundary to SmartFlow's own approval surface
(the same server-verifiable, digest-bound record ADR-0005 Decision 7 already
requires) without either (a) violating "the Worker is the mutation trust
boundary" by letting the companion process itself decide what counts as
approved, or (b) introducing unacceptable latency in a live human-in-the-loop
pause. This has not been tested; the official docs establish that the
mechanism exists, not that it composes cleanly with SmartFlow's specific
approval architecture.

**Concrete next step, before any design or ADR work:** a small, throwaway
technical spike — run Claude Code headless via the Agent SDK locally against
a real (non-production) repo, wire a `canUseTool` callback that blocks on an
external HTTP call standing in for SmartFlow's approval endpoint, and confirm
the round-trip is clean enough to bind to a server-verifiable approval record
the way ADR-0005 already requires. That spike's result — not further
document research — is what should determine whether this recommendation
becomes a formal EPIC-08/EPIC-09 re-scoping ADR as-is, or needs a different
physical-execution shape.

---

## References

- [`docs/product/product-direction-v1.md`](../../product/product-direction-v1.md) §13–14
- [`docs/roadmap/epic-08-write-code-design-v1.md`](../../roadmap/epic-08-write-code-design-v1.md)
- [ADR-0005: Code Write Mutation Boundary](../../decisions/adr/ADR-0005-code-write-mutation-boundary.md)
- [ADR-0012: Write Capability Layer v1](../../decisions/adr/ADR-0012-write-capability-layer.md)
- [ADR-0018: Capability-Oriented AI Provider Abstraction](../../decisions/adr/ADR-0018-capability-oriented-ai-provider-abstraction.md)
- [ADR-0008: Tiered Change Governance](../../decisions/adr/ADR-0008-tiered-change-governance.md)
- [`docs/architecture/authority-model.md`](../authority-model.md)
- [`docs/architecture/target-architecture.md`](../target-architecture.md)
- [`docs/architecture/agent-orchestration.md`](../agent-orchestration.md)
- [`docs/architecture/current-architecture.md`](../current-architecture.md)
- Anthropic: Claude Code headless mode (`code.claude.com/docs/en/headless`), CLI
  reference, Agent SDK overview and permissions docs.
- OpenAI: Codex CLI non-interactive mode and config reference
  (`developers.openai.com/codex/`).
- GitHub: Copilot coding agent, Copilot CLI, Copilot SDK, and plans/pricing
  docs (`docs.github.com/en/copilot/`, `github.blog/changelog/`).
