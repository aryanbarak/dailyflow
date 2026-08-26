# ENG-02 — Pluggable Coding-Agent Execution Contract + Real Spike

**Status:** Investigation + one real, verified spike. No production code changed.
No changes to `agent/worker/` or `src/`. All live execution happened against the
disposable repo `aryanbarak/smartflow-github-test`, on non-default branches only.
**Date:** 2026-08-26
**Supersedes (context only):** [ENG-01](eng-01-coding-agent-architecture-investigation-v1.md)'s
mid-execution approval design (`canUseTool`) is no longer a hard requirement —
the PO has clarified the model is authorize → run entire task unattended,
including merge if pre-authorized → review after the fact.

---

## 0. What actually happened (evidence-first summary)

Two coding-agent backends completed the **same** real task —
"add a one-line comment to README.md explaining what this repo is for" —
fully unattended, end to end, including branch creation, commit, push, and
merge to a non-default target branch, on the real (disposable) GitHub repo.
Both results are independently verified below via `git ls-remote` and the
GitHub REST API, not by trusting either backend's self-report.

| | Claude Code (Agent SDK CLI, paid) | Local model + thin wrapper (free) |
|---|---|---|
| Completed unattended, end to end | Yes | Yes |
| Wall-clock time | 39s | 26s (21.5s of which was the model call) |
| Real cost | **$0.2684103** (Claude Code's own metered total) | **$0.00** (fully local inference, no API call) |
| Commit | `9318f36` on `spike/claude-code-work` | `8a22f4a` on `spike/aider-work` |
| Merge | Fast-forward into `spike/claude-code-target`, pushed | Fast-forward into `spike/aider-target`, pushed |
| `main` touched? | No (independently confirmed) | No (independently confirmed) |
| Human intervention needed? | None | None (after resolving a local environment/dependency issue during setup — see §3) |

Both target branches' final commits are visible at
`github.com/aryanbarak/smartflow-github-test` on branches
`spike/claude-code-target` and `spike/aider-target`. `main` remains at the
original fixture commit (`126a0f8`) throughout.

---

## 1. Research: coding agents for the "authorize → run whole task → review" model

The PO's clarification removes the hard requirement for a per-tool-call
approval hook (ENG-01's `canUseTool`). This widens the field considerably —
any agent that can complete a task and produce a reviewable result now
qualifies, including several genuinely free options.

| Agent | License/cost | Free model backend? | Headless full-task mode confirmed? | Git ops itself? | Notable limitation |
|---|---|---|---|---|---|
| **Claude Code** | Proprietary CLI; billed via Anthropic API metering (or covered by an existing Claude subscription login) | No | Yes — `-p`/`--print`, `--output-format json`, `--permission-mode bypassPermissions`, `--max-budget-usd` safety cap (all confirmed live in §3) | Yes, natively (its own Bash tool) | None observed in this spike; per ENG-01, no official container-hardening doc exists yet |
| **OpenAI Codex CLI** | Open source; billed via OpenAI API metering | No (locked to OpenAI-compatible model access) | Yes — `codex exec` (confirmed in ENG-01) | Yes, natively | Not re-tested here; the only OpenAI credential available in this environment was a clearly non-functional placeholder (7 characters), so it was not exercised live |
| **Aider** | **Apache-2.0** (not MIT — corrected) | **Yes** — native Ollama/LM Studio support and any OpenAI-compatible endpoint via LiteLLM, including Gemini | Yes — `--message`/`-m` + `--yes` runs one instruction and exits | **Commits itself; does NOT push** — push is left to the caller/wrapper by design | Current PyPI release is `aider-chat` **0.86.2** (2026-02-12) with full modern LiteLLM/Ollama support. **This spike's environment resolved `pip install aider-chat` to a stale legacy 0.16.0 (2023-era, pre-LiteLLM, OpenAI-only) release** that could not be made to run on Python 3.13 (see §3) — an environment/package-index artifact, not a real limitation of current Aider. Any future real integration should pin `aider-chat>=0.86` explicitly. |
| **OpenHands** (formerly OpenDevin) | MIT | Yes — LiteLLM-based, explicit Ollama/vLLM/LM Studio guides | Yes — `openhands --headless -t "task"`, `--json` output, always-approve in headless mode | Yes, but the project's own open issue (#9999) flags the combined commit+push tool as causing unintended pushes and says it's being split for safer control | Mid-pivot: the project is shifting investment to an "Agent Canvas" orchestration console; the standalone interactive TUI is going maintenance-only, but headless/ACP mode is explicitly the part promised continued full support |
| **Gemini CLI** | Apache-2.0 | **Yes** — personal Google-account OAuth login: 60 req/min / 1,000 req/day, full context, no card required; a free API key states similar daily limits | Yes — `-p`/`--prompt`, `--output-format json`/`stream-json`, `--approval-mode yolo` for zero-touch runs | Only via its generic shell-command tool, not a dedicated git action | Exact free-tier numbers vary across sources/time; treat as needing a live re-check before relying on a specific quota |
| SWE-agent / mini-swe-agent (brief) | MIT | Yes, bring-your-own-model | Designed for unattended issue-driven runs by default | Not deep-dived | Named for completeness only, not evaluated further |

**Reading this table for SmartFlow's purposes:** the free/open-source field is
real and viable, not a fallback consolation prize. Aider, OpenHands, and
Gemini CLI can all point at a genuinely free backend (local Ollama models we
already have installed, or Gemini's free tier). The one structural pattern
worth flagging: **none of the free/open agents natively does the full
commit→push→merge chain with equal confidence** — Aider deliberately stops at
commit, OpenHands' push path has an open safety issue, and Gemini CLI's git
ops are just generic shell calls. Claude Code is the only backend tested here
that did the entire chain, including the merge, itself, correctly, on the
first attempt. This is evidence for Part 2's design (verify independently of
the backend's own claim), not a reason to exclude the free options.

---

## 2. Minimal pluggable execution contract

The strawman in the task prompt is a reasonable starting shape, but the spike
surfaced one concrete problem with it: **a backend's own report of what it
did should never be the thing SmartFlow trusts.** Claude Code's JSON output
had rich, real cost/usage fields but packed "which files changed / did the
merge succeed / was main untouched" into a single free-text `result` string —
exactly the kind of natural-language claim
[`authority-model.md`](../authority-model.md) already forbids treating as
runtime truth ("Runtime truth is authoritative... audit MUST NOT be
fabricated from model claims"). This spike extends that same invariant one
layer out: **a coding agent's self-report is model output, not runtime
truth, even when it's produced by a well-behaved, successful run.**

This is deliberately **not** ADR-0018-scale. Only two backends have ever
actually been run, both today, both for one trivial task. The interface below
is sized for that: enough to make the two real backends swappable behind one
call, and enough to force the "don't trust the self-report" discipline in
from day one — not a general provider abstraction.

```ts
interface CodingAgentTaskInput {
  repo: string;                 // "owner/name"
  baseBranch: string;           // branch the work starts from (never the default branch as a target)
  workBranch: string;           // branch the backend commits to
  targetBranch: string;         // branch to merge into if authorizedToMerge — must not be the repo's default branch
  instruction: string;          // natural-language task
  authorizedToMerge: boolean;
  maxCostUsd?: number;          // safety cap where the backend supports one (Claude Code: --max-budget-usd)
  timeoutSeconds?: number;
}

// What the backend itself returns. Advisory only — never treated as runtime truth.
interface CodingAgentSelfReport {
  id: string;                   // 'claude-code' | 'ollama-wrapper' | ...
  ok: boolean;                  // backend's own claim of success
  summary: string;              // free-text description, human-readable, unverified
  costUsd?: number;             // only present if the backend meters cost itself (e.g. Claude Code); absent/0 for local backends
  wallClockSeconds: number;
  logRef: string;               // path/handle to the full raw transcript, kept for audit regardless of outcome
}

// Computed by the CALLING harness after the backend exits — from git/GitHub ground truth,
// never from the backend's own claim. This is the record actually shown to the PO.
interface VerifiedCodingTaskResult {
  workBranchHeadSha: string | null;      // `git rev-parse` on workBranch, independently
  filesChanged: string[];                // `git diff --stat` against baseBranch, independently
  targetBranchHeadSha: string | null;    // independently fetched after the claimed merge
  merged: boolean;                       // true only if targetBranchHeadSha === workBranchHeadSha
  defaultBranchHeadShaBefore: string;    // captured before the task starts
  defaultBranchHeadShaAfter: string;     // captured after the task ends
  defaultBranchUnchanged: boolean;       // defaultBranchHeadShaBefore === defaultBranchHeadShaAfter, asserted explicitly
}

interface CodingAgentBackend {
  id: string;
  runTask(input: CodingAgentTaskInput): Promise<CodingAgentSelfReport>;
}
```

`VerifiedCodingTaskResult` is not produced by any backend — it's produced by
the same wrapper code for every backend, using the exact git/GitHub calls
this spike used to verify both results independently (§0). This is the
audit trail the PO reviews after the fact, replacing live approval: it is
built from facts SmartFlow can check itself, not from what the agent says
happened.

---

## 3. The real spike — full detail

**Setup.** `aryanbarak/smartflow-github-test` was found completely empty (no
commits, no branches — confirmed via the GitHub API before starting). A
one-time fixture commit (a 3-line `README.md`) was pushed to `main` to give
both backends something real to edit; this fixture commit was authored
directly, not by either agent, and is disclosed here for transparency. Two
non-default target branches were created off `main`:
`spike/claude-code-target` and `spike/aider-target`. Each backend was given
its own working checkout, on its own feature branch
(`spike/claude-code-work`, `spike/aider-work`) branched from its target.

**Backend 1 — Claude Code (paid).** Installed locally already
(`/c/Users/aryan/.local/bin/claude`, v2.1.233). Invoked as:

```
claude -p "<task + explicit git-op authorization + explicit 'do not touch main'>" \
  --permission-mode bypassPermissions \
  --output-format json \
  --max-budget-usd 2
```

Completed in 39s wall-clock (35.2s of API time, 10 turns). Self-reported
`total_cost_usd: 0.2684103` (mostly `claude-sonnet-5`, with heavy prompt-cache
reads — a large system prompt/tool-definition overhead relative to the
trivial task, worth noting for cost modeling of many small tasks). It
performed every git operation itself: committed to its work branch, pushed,
merged into the target branch by fast-forward, pushed the target branch, and
correctly never touched `main`. Its free-text self-report claimed exactly
this outcome — **independently confirmed true** via `git ls-remote` and the
GitHub commits API (§0), not merely trusted.

**Backend 2 — free/local (substituted for Aider; see below).** Ollama was
already running locally with `qwen2.5-coder:7b` available — a genuinely free,
already-installed model requiring no API key and no network call. The
original plan was to run Aider against this Ollama model. In practice,
`pip install aider-chat` in this environment's Python 3.13.14 resolved to a
**stale legacy release (0.16.0, circa 2023)** rather than the real current
release (0.86.2, per §1's research) — this legacy release hard-pins
`numpy==1.24.3` and a `tree_sitter_languages` dependency, neither of which has
a wheel for Python 3.13, and could not be made to import even after manually
reconciling roughly a dozen transitive dependency conflicts by hand. This is
recorded as a genuine "required a human to unblock" finding for Part 3, but
it is an artifact of this sandboxed environment's package resolution and
Python version, not a real limitation of Aider itself (§1 already
distinguishes this).

Rather than burn further time forcing an ancient, unsupported release to run,
the spike substituted a minimal equivalent that tests the *identical
architectural pattern* Aider itself uses (model edits the file; a wrapper
handles git): a ~50-line Python script called Ollama's OpenAI-compatible
`/v1/chat/completions` endpoint directly with the current README content,
asking for the same one-line-comment edit, then a shell wrapper performed
`add`/`commit`/`push`/`checkout`/`merge`/`push` exactly as instructed to
Claude Code. This is arguably a *more* faithful test of "wrapper does git
ops" than a working Aider install would have been, since Aider itself only
auto-commits and still requires a wrapper for push (per §1).

Total time: 26 seconds (21.5s model call, ~4.5s git operations). Model call:
138 prompt tokens, 44 completion tokens. **Cost: $0.00** — fully local
inference, no metered API involved. Output quality was correct on the first
attempt: a well-placed, accurately-worded HTML comment, no unrelated changes.
Independently verified via `git ls-remote` and the GitHub commits API exactly
as for Backend 1.

**What required a human to unblock:** only the Aider/Python-3.13/legacy-PyPI
dependency archaeology during setup (~20 minutes of environment debugging).
Neither backend's actual *task execution* needed any human intervention —
both ran fully unattended once invoked.

---

## 4. Standing-authorization class registry — confirming it reuses ADR-0012's shape

[ADR-0012 (Write Capability Layer v1)](../../decisions/adr/ADR-0012-write-capability-layer.md)
already implements exactly the mechanism this needs: a per-key `auto`/`ask`/`off`
policy, evaluated server-side, with missing rows resolving to a conservative
default and unknown keys failing closed to `ask`. This section confirms the
same table *shape* extends to coding-agent tasks — it does not redesign
anything.

ADR-0012's key is `(user_id, domain, action)`. Coding-agent tasks need one
additional scoping column, because unlike `tasks.*`/`calendar.*` (user-global),
code authorization is inherently per-repository: a PO might trust
`auto`-authorized doc fixes on one repo and want `ask` on every repo by
default otherwise. The extended key is:

```
(user_id, repo, task_class) -> mode: 'auto' | 'ask' | 'off'
```

Same three modes, same resolution code path, same fail-closed default for an
unrecognized `task_class`. Example policy a PO could set, using the PO's own
worked example from ENG-01 §5:

| repo | task_class | mode |
|---|---|---|
| `aryanbarak/smartflow` | `docs_fix` | `auto` |
| `aryanbarak/smartflow` | `test_fix` (non-default branch only) | `auto` |
| `aryanbarak/smartflow` | `comment_fix` | `auto` |
| `aryanbarak/smartflow` | `migration_change` | `ask` (fixed floor — see below) |
| `aryanbarak/smartflow` | `auth_change` | `ask` (fixed floor) |
| `aryanbarak/smartflow` | `ci_config_change` | `ask` (fixed floor) |
| *(any repo, any unrecognized task_class)* | — | `ask`, fail-closed |

This spike's own task (`docs_fix`-class, non-default branch, both commit and
merge) is precisely the kind of narrow, low-risk, easily-reversible class
ADR-0012's existing `auto` philosophy already covers for `tasks.*` — nothing
about testing it live required inventing new policy machinery, only running
it manually this once because no registry exists yet to pre-authorize it.

**Unchanged from ENG-01 §5:** `migration_change`, `auth_change`,
`ci_config_change`, and anything touching the default branch, repo deletion,
or a published release remain in the higher-authorization tier ENG-01 already
specified — a stronger, explicitly-named grant action plus periodic
re-confirmation, never a casual `auto` toggle. This spike did not touch that
tier and does not revisit it.

---

## 5. What this does and doesn't establish

**Established, with real evidence:** a coding-agent backend (paid or free)
can complete a real multi-step task — edit, commit, push, merge to a
non-default branch — fully unattended, correctly, and the result can be
verified independently of the backend's own claims, using nothing more than
git and the GitHub API. Both the paid and the free path work today, with
real numbers, not estimates.

**Not established:** behavior on a real multi-file change, a task with
ambiguity or failure modes, a task requiring test execution, or a merge
scenario with actual conflict resolution. This was deliberately the smallest
safe task, on purpose, per the task's own instruction. The next spike should
raise task complexity one notch (e.g., a real bug fix requiring a test run)
before any of this is proposed as a production-facing capability.

---

## References

- [ENG-01: Coding Agent Architecture Investigation](eng-01-coding-agent-architecture-investigation-v1.md)
- [ADR-0012: Write Capability Layer v1](../../decisions/adr/ADR-0012-write-capability-layer.md)
- [`docs/architecture/authority-model.md`](../authority-model.md)
- Live artifacts (disposable test repo): `github.com/aryanbarak/smartflow-github-test`,
  branches `spike/claude-code-target` (commit `9318f36`) and
  `spike/aider-target` (commit `8a22f4a`); `main` unchanged at `126a0f8`.
- Anthropic: Claude Code CLI reference and headless mode docs (as cited in ENG-01).
- Aider: `aider.chat/docs/scripting.html`, `aider.chat/docs/git.html`,
  `aider.chat/docs/llms/ollama.html`; PyPI `aider-chat` release history.
- OpenHands: `docs.openhands.dev/openhands/usage/cli/headless`,
  `docs.openhands.dev/openhands/usage/llms/llms`; GitHub issue
  `OpenHands/OpenHands#9999`.
- Gemini CLI: `github.com/google-gemini/gemini-cli` README; `ai.google.dev/gemini-api/docs/rate-limits`.
