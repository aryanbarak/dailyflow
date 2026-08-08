# Independent Tier-1 Pre-Merge Review: Personal Memory Layer v1 (ADR-0010, task 5b)

- **Reviewer role:** Independent reviewer per ADR-0008 Tier 1 governance. Read-only — no implementation code was modified during this review.
- **Reviewed against:** HEAD `3351d9c` (docs-only acceptance commit) plus the uncommitted working tree from task 5b.
- **Scope:** the new `personal_memory_records`/`personal_memory_extraction_runs` schema and its three `SECURITY DEFINER` functions, the TS validation/repository/service layer, the Worker extraction route, the `ENABLE_AUTO_MEMORY_WRITE` freeze, and the `AiMemoryTab` badge fix.

## A. Changeset reality vs 5b's report

Matches. `git log --oneline -5` at review start showed HEAD `3351d9c` ("docs: accept ADR-0010 personal memory layer with PO resolutions"), with `e129312`/`8dc3469`/`2195fbc` beneath it as reported. `git status --short` showed exactly the file set 5b's own report §G claims: 5 modified files (`agent/worker/index.ts`, `agent/worker/index.test.ts`, `docs/decisions/adr/ADR-0010-personal-memory-layer.md`, `src/features/ai-memory/AiMemoryTab.tsx`, `src/features/ai-memory/aiMemoryService.ts`) and 8 new paths (the migration, both new Worker-route files, the design note, `src/features/personal-memory/`, and the two new `supabase/tests/` files, plus `AiMemoryTab.test.tsx`). No drift. Independently re-ran the full suite: **130 files (5 skipped) / 1867 tests (76 skipped) passed**, matching the baseline-plus-new accounting exactly.

## B. Findings by severity

**MAJOR — Q3 ("SUPERSEDE") is only partially implemented; two live `user_context` write paths were not frozen.**
[`src/features/ai-memory/aiMemoryService.ts:91`](../../src/features/ai-memory/aiMemoryService.ts) (`autoDetectAndSave`) and [`:59`](../../src/features/ai-memory/aiMemoryService.ts) (`set`) still write new rows to `user_context` today, unchanged by this task (the diff to this file is limited to widening the `MemorySource` type). `autoDetectAndSave` remains wired to the live "Auto-detect" button in [`AiMemoryTab.tsx:90-99`](../../src/features/ai-memory/AiMemoryTab.tsx) via [`useAiMemory.ts:42-53`](../../src/features/ai-memory/useAiMemory.ts) — clicking it today still upserts new `mood_pattern`/`habit_pattern`/`finance_pattern` rows with `source='auto'`. This is not a marginal reading of Q3: ADR-0010's own Decision section 2.c, option 3 (the option the PO chose) says verbatim: *"freeze `user_context` writes (stop `extractAndSaveMemory`/`extractAndSaveMemoryFromChat`/`aiMemoryService.autoDetectAndSave` from writing new rows)"* — `autoDetectAndSave` is named explicitly, by identifier, as an in-scope target, not merely implied. 5b's implementation addressed only the first two of the three named functions (via `ENABLE_AUTO_MEMORY_WRITE`). The manual `set()` path (a user typing directly into an `AiMemoryTab` field) is a closer textual call — the ADR's option-3 text names only the three automated writers — but the Product Owner's own Resolution language ("freeze **ALL** new writes to `user_context`... existing rows remain **readable/deletable**" — not *editable*) points the same direction. Net effect: a user can, today, create a brand-new `user_context` row (manually or via auto-detect) after this task shipped, which is the exact "two places memory lives, one of them still growing" outcome ADR-0010 §2.c named as option 2's (rejected) risk, not option 3's.

**MAJOR — Q2's sensitive-content defense-in-depth heuristic has concrete, easily-anticipated blind spots not covered by its own test suite.**
`SENSITIVE_CONTENT_PATTERNS` is duplicated identically in [`personalMemoryRecordValidation.ts:64-115`](../../src/features/personal-memory/personalMemoryRecordValidation.ts) and [`personal-memory-extraction-endpoint.ts:356-367`](../../agent/worker/personal-memory-extraction-endpoint.ts). Traced two adversarial payloads by hand against the actual pattern list:
- `kind="personal_fact", content={summary: "My daughter starts kindergarten this fall"}` — **not rejected**. The family/relationship pattern group covers `wife`, `husband`, `spouse`, `partner`, `girlfriend`, `boyfriend`, `child(ren)`, `kids`, `family`, `parent(s|ing)`, `mom`, `dad`, `mother`, `father`, `sibling(s)`, `brother(s)`, `sister(s)`, `relationship` — but not `daughter` or `son`, two of the most common words for exactly the relationship-content category Q2 excludes.
- `kind="commitment", content={summary: "Annual checkup next month", status: "active"}` — **not rejected**. None of the health-pattern keywords (`health`, `medical`, `diagnos(is|ed)`, `disease`, `therapy`, `medication`, `depression`, `anxiety`, `doctor`, `hospital`, etc.) match ordinary medical phrasing like "checkup," "appointment," or a named specialty ("dentist," "dermatologist").

Both candidates would pass validation, be persisted as a `proposed` `personal_fact`/`commitment` row, and be visible via `listByOwner` — i.e., sensitive-category content Q2 says must be excluded would be *stored*, even though Q5 prevents it from being *consumed* while `proposed`. The design docs disclose the heuristic's imperfection in general terms ("will have false positives... false negatives are the actual risk") but neither the 28-case unit suite nor the 16-case equivalence suite includes a `daughter`/`son`/no-keyword-medical fixture, so this specific, foreseeable gap was not caught by the safety net that exists specifically to catch this class of drift. Recommend expanding the pattern list (`daughter`, `son`, `grandparent`, `aunt`, `uncle`, `checkup`, `appointment` combined with a health-adjacent noun) and adding fixtures for exactly these before this route is pointed at real user chat data.

**MINOR — ADR-0010's Decision section still says "null," contradicting the actual NOT NULL sentinel implementation (predicted by the task brief; confirmed present).**
Decision §1 states model-authored fields are *"populated for model-authored rows; both `null` for `source: 'user'` rows."* The actual migration and both `create_personal_memory_record`/`resolve_personal_memory_record` functions use NOT NULL columns with sentinel values (`'user'` / `'user-correction-v1'`), correctly matching ADR-0009's real, proven code — but the uncommitted "Implementation Notes" addendum only documents the no-automatic-supersession decision; it does not touch or reconcile this separate "null" sentence in Decision §1. A future reader of the Decision section alone would still be misled. Low severity: the Product Owner Resolutions and Implementation Notes (the parts that actually govern behavior) are correct; only the older Decision-section prose is stale.

**MINOR (inherited, not new) — the `content_fingerprint` column comment overclaims what the hash covers.**
The migration's column comment says the fingerprint is "Deterministic SHA-256 over `(user_id, kind, normalized content)`," but `computePersonalMemoryContentFingerprint(kind, content)` (and the Worker's duplicate) never takes or hashes `user_id` — the digest is over `(kind, content)` only. Not a security defect: the partial unique index adds `user_id` as a separate index column, so cross-user fingerprint collisions are still impossible at the database layer regardless of what the hash itself covers. This exact inaccuracy already exists, verbatim in spirit, in ADR-0009's own already-accepted `20260807000000` migration comment for `computeInferredFieldContentFingerprint` (also kind+content only, despite an analogous overclaim). Faithfully inherited, not introduced by 5b — noted for completeness, no action required beyond what ADR-0009 already carries.

**Note, not a defect — no dedicated scheduled-handler test for the briefing extraction call site.**
5b's report already disclosed this proportionality call. Independently traced it: `generateBriefing` (called from both the `scheduled()` cron handler and the manual "generate briefing now" request path) contains the sole `extractAndSaveMemory` call site, gated by the identical single `ENABLE_AUTO_MEMORY_WRITE` flag the chat path uses. One flag, traced through both real call sites, confirmed false in both. The missing dedicated test is a coverage-completeness gap, not a behavioral one.

## C. Conformance table

| Item | Status | Evidence |
|---|---|---|
| Q1 hard delete, any status | **Conforms** | `delete_personal_memory_record` has no status check; migration-structure test asserts `RECORD_NOT_PROPOSED` absent from its body |
| Q1 suppression dies with the record | **Conforms** | Partial unique index `WHERE status <> 'superseded'` is a live index over current rows; a hard `DELETE` removes the row and therefore the index entry, with no separate cleanup step — traced directly, live-DB re-verification blocked by the standing port conflict (see G) |
| Q1 no re-derivation marking | **Conforms** | No code path touches `agent_briefings`/`agent_chat_messages` on delete |
| Q2 six-kind taxonomy | **Conforms** | `kind` CHECK closed to exactly the six values; TS enum matches |
| Q2 sensitive-category exclusion | **Partially conforms — see MAJOR finding above** | Heuristic exists in both TS and Worker, kept equivalence-tested, but has concrete, undisclosed-in-detail blind spots (`daughter`/`son`, no-keyword medical phrasing) |
| Q3 supersede `user_context` | **Does not fully conform — see MAJOR finding above** | `extractAndSaveMemory`/`extractAndSaveMemoryFromChat` correctly frozen; `aiMemoryService.autoDetectAndSave` (explicitly named in the ADR's own option-3 text) and `aiMemoryService.set` are not |
| Q3 existing rows remain readable/deletable | **Conforms** | `AiMemoryTab` read/delete flows unchanged and covered by `AiMemoryTab.test.tsx` |
| Q3 "absorb" not planned, recorded | **Conforms** | ADR Consequences + PO Resolutions state this explicitly |
| Q4 explicit-trigger-only extraction | **Conforms** | New route requires an authenticated POST; no scheduler or chat/briefing call site invokes it |
| Q4 legacy always-on extraction disabled | **Conforms** | Both real call sites traced through the single flag, independently confirmed dead |
| Q5 zero consumption of any status | **Conforms today** | Repo-wide grep independently re-run: zero hits for the new module/table outside itself and its tests |
| ADR-0009-pattern: `search_path` pinned, `auth.uid()`-resolved ownership, non-disclosing errors | **Conforms** | All three functions: `search_path = public, pg_temp`; `v_owner_id := auth.uid()`; `RECORD_NOT_FOUND`/`RUN_NOT_FOUND` used for both "missing" and "not owned" |
| ADR-0009-pattern: race-safe `unique_violation` handling | **Conforms** | `create_personal_memory_record` discriminates on `constraint_name` before treating a violation as benign, built in from the start (verified against the table's only relevant unique constraint, `personal_memory_records_fingerprint_key`) |

## D. The three deviations — assessed individually

1. **No automatic supersession for any kind.** Sound, and correctly justified: no personal-memory kind has a downstream "at most one active X" validator the way `objective`/`milestone` do for the project layer, so inventing a slot rule here would risk exactly the wrong-discard failure ADR-0009's own Implementation Notes already named. Adversarial check: yes, two contradictory `goal` records (e.g., "become a doctor" confirmed, then later "quit medicine" also confirmed) can coexist indefinitely as both `user_confirmed` — but this is currently inert, not a live defect, because Q5 means **no consumer exists yet** to encounter the conflict (independently re-verified via the same grep in finding E). A future consumer will need its own conflict-surfacing (mirroring `contextPrecedenceResolver.ts`'s role for the project layer) before it may safely consume confirmed personal-memory records — this is a forward requirement to record for that future task, not a gap in this one.
2. **`explicit_user_statement` schema-ready but RPC-refused.** Consistent across all three layers checked: the migration's CHECK constraint allows it (forward-compat), `create_personal_memory_record` explicitly rejects it with `UNSUPPORTED_PROVENANCE_SOURCE_KIND`, and the TS `PERSONAL_MEMORY_PROVENANCE_SOURCE_KINDS` enum includes it with an explicit "unreachable via any write path in this task" comment, tested directly. No inconsistency found.
3. **Sentinel values vs. ADR "null" phrasing.** Confirmed present — see the MINOR finding in §B. The uncommitted Implementation Notes addendum reconciles the supersession question but not this one.

## E. Adversarial sensitive-content check results (with disclosed limits)

See the MAJOR finding in §B for the two concrete bypass payloads found (`daughter`/`son`; no-keyword medical phrasing). Confirmed the rejection path is enforced in code regardless of the model's own output: `validatePersonalMemoryContent` in the TS layer and `normalizeCandidate` in the Worker both run `containsSensitiveContent`/pattern-matching unconditionally, after shape validation and before any candidate is accepted — the system prompt's "MUST NOT extract health/relationship/emotional-state information" instruction is advisory only, the deterministic checks are the actual boundary, exactly as designed. The boundary is real; its current keyword coverage has gaps that are foreseeable and inexpensive to close.

## F. Q4/Q5 verification results

- **Q4:** Independently traced both real call sites (`generateBriefing`'s `extractAndSaveMemory` at index.ts:150, and the chat handler's `extractAndSaveMemoryFromChat` at index.ts:721) through the single `ENABLE_AUTO_MEMORY_WRITE = false` flag — both dead. The updated `index.test.ts` expectation (`ctx.waitUntil` never called on a plain chat turn) is the correct new expectation and does not appear to have silently dropped coverage of any other behavior the old assertion guarded (the surrounding assertions on `chatMessageWrites`/`sessionPatches`/Gemini call shape are untouched).
- **Q3 completeness (not just the two Worker call sites):** repo-wide grep for `user_context` found no *additional* writers beyond `aiMemoryService.ts` and the two now-dead Worker functions — but, per the MAJOR finding above, `aiMemoryService.ts` itself still contains two live writers this task did not address.
- **Q5:** independently re-ran the consumer grep for `personal_memory_records`/`personalMemoryRecordService`/`personalMemoryRecordRepository`/`PersonalMemoryRecord`/the three RPC names across `src/` and `agent/worker/` — every hit is inside the new module or its own tests. Zero consumption confirmed independently.
- **Worker route:** config check runs before auth (identical ordering to the already-accepted `context-derivation-endpoint.ts`, not a new deviation); auth is required before any DB/model access; every REST/RPC call forwards the user's own JWT, `SUPABASE_SERVICE_KEY` is never referenced in this file; source material is bounded (≤20 chat messages, ≤1 briefing, 2000 chars/item); output is bounded (`maxItems: 12` in the Gemini schema, 300-char summaries); empty source material returns 422 before any model call.

## G. Validation results + gap register

- Full suite: **130 files (5 skipped) / 1867 tests (76 skipped) passed**, exit 0 — independently re-run, matches 5b's report exactly.
- Typecheck: `npm run typecheck` → "79 baseline-tracked errors remain, 81 were in the baseline. No new or regressed errors." Matches.
- Lint: 84 problems (42 errors, 42 warnings), none inside any file this task touched — spot-checked the full output; all listed files are pre-existing and unrelated (`TutorAppPage.tsx`, `TutorPage.tsx`, `tailwind.config.ts`, etc.). Matches.
- Build: succeeded. Matches.
- **Gap register:**
  1. Live-RLS suite (`personal_memory_records.rls.test.ts`) is written but not executed. Independently attempted `supabase start` during this review and hit the identical standing port conflict (`Bind for 0.0.0.0:54322 failed: port is already allocated`) the prior ADR-0009 review already accepted as an environment constraint outside this task's control — consistent precedent, same acceptance applies here.
  2. The ADR-0010 Implementation Notes edit was read in full: it only adds the supersession-scope explanation between the Product Owner Resolutions and Consequences sections. It does not reword, delete, or contradict any sentence of the Accepted Decision text or the Product Owner Resolutions — confirmed by direct comparison, not merely by structural expectation. Not a MAJOR finding.
  3. No live Gemini call or live Worker deployment was exercised (by design, consistent with the ADR-0009 precedent) — the Worker's structured-output schema assumptions are verified only against the 16 mocked-fetcher tests.
  4. The `user_context` freeze gap (§B, MAJOR) is itself a new gap this review is surfacing, not one 5b's own report disclosed.

## H. Merge recommendation

**MERGE AFTER LISTED ITEMS.** The schema, the three `SECURITY DEFINER` functions, the RLS posture, the race-safety handling, and the Q1/Q4/Q5 mechanics are sound and independently verified — this is the highest-priority part of the review and it holds up. Before merge, address:
1. Either extend the `ENABLE_AUTO_MEMORY_WRITE`-style freeze to `aiMemoryService.autoDetectAndSave` (and decide explicitly, on the record, whether manual `set()` is in or out of scope for the freeze — the current ADR text is genuinely ambiguous on that one point, unlike `autoDetectAndSave` which is named outright), or obtain an explicit Product Owner amendment narrowing Q3's "freeze ALL new writes" language to only the LLM-extraction paths if that is in fact the intended, narrower scope.
2. Expand `SENSITIVE_CONTENT_PATTERNS` (both copies) to cover at minimum `daughter`/`son` and common no-keyword medical phrasing, and add corresponding fixtures to both the unit and equivalence test suites.
3. (Optional, low cost) Fix the stale "null" sentence in ADR-0010 Decision §1 to match the sentinel-value implementation, for the same reason ADR-0009's own Implementation Notes exists — so a future reader of the Decision section alone isn't misled.

None of these require re-architecting the schema or the RPC surface; all three are scoped, contained fixes.

## I. Verdict

**REVIEW FOUND BLOCKERS**

---

## Re-review (remediation delta) — 2026-08-08

Independent delta re-review of task 5c's remediation, verifying (not trusting) 5c's own closure claims. Read-only; the only file change made during this pass is this appended section. HEAD unchanged at `3351d9c`; working tree carries 8 modified + 10 new uncommitted paths (5c §E), no drift.

### Closure table

| Finding | Status | Evidence |
|---|---|---|
| **F1** — Q3 complete freeze (was MAJOR #1) | **CLOSED** | `git diff 3351d9c` on `aiMemoryService.ts` shows `set`/`autoDetectAndSave` deleted (method bodies gone, not merely unexported); `AppLayout.tsx` diff shows the automatic 5-second `autoDetectAndSave()` call and its import removed; `useAiMemory.ts` no longer exposes `set`/`autoDetect`/`isAutoDetecting`; `AiMemoryTab.tsx` diff shows the Auto-detect button now permanently `disabled` with a `title` explanation, every row's `<input>` now `disabled readOnly` with its own `title`, a new static (non-hover) `<p>` explaining the freeze, and the Save button/`isDirty` machinery removed entirely — text-based, not colour-only. `remove`/`getAll` untouched. Ran `AiMemoryTab.test.tsx` (10 tests) + new `aiMemoryService.test.ts` (4 tests) live: all pass, including explicit assertions that `'set' in aiMemoryService` and `'autoDetectAndSave' in aiMemoryService` are both `false`, and that Clear/delete still calls `remove`. |
| **F2** — sensitive-content coverage (was MAJOR #2) | **CLOSED** | Extracted and diffed both `SENSITIVE_CONTENT_PATTERNS` arrays programmatically (68 entries each) — zero differences. Ran the two exact review payloads (`"My daughter starts kindergarten this fall"`, `"Annual checkup next month"`) live through `personalMemoryRecordValidation.test.ts`, `personalMemoryValidationEquivalence.test.ts`, and `personal-memory-extraction-endpoint.test.ts` — all reject as expected (69 tests total, all passing; the route-level test's `droppedCount` moved from 3→5 to include both). "Known limitations" paragraph confirmed present in ADR-0010 Implementation Notes, honestly scoped (names Q5/Q1 as the real governing layers, explicitly disclaims completeness). |
| **F3** — MINOR fixes | **CLOSED** | Decision §1's "null" sentence now describes the sentinel implementation with a pointer to a new Implementation Notes paragraph; decision substance (what a `source:'user'` row means) unchanged — confirmed via `git diff`. New migration's fingerprint comment corrected to `(kind, content)` only, with the cross-user-collision non-risk explained. `git diff 3351d9c -- supabase/migrations/20260807000000_inferred_project_context_fields.sql` returns **empty** — ADR-0009's committed migration is provably untouched. |
| **F4** — ADR-0008 dissent rule | **CLOSED** | `git diff 3351d9c -- docs/decisions/adr/ADR-0008-tiered-change-governance.md` is 100% `+` lines (zero removals) — a new `## Implementation Notes` section inserted immediately before `## Consequences`, dated 2026-08-08, attributed to the Product Owner, containing the required boundary sentence in substance ("dissent is mandatory to *record*... never a license to *deviate* from the current decision while it stands"). Decision and Consequences sections of ADR-0008 itself carry no diff. The ADR-0010 Q3 amendment quote was independently confirmed to now include the fuller verbatim text (the `explicit_user_statement`/review-UI sentence) with nothing else in that section altered. |

### Independent grep + adversarial results

**F1 write-path grep (re-run independently, not trusting 5c's table):** `grep -rn "user_context"` across `src/` and `agent/` returns the same 10 files 5c's report named. Verb-specific re-check (`grep -Ei "upsert|\.insert\(|\.update\(|on_conflict"`) surfaces exactly the same two hits: `agent/worker/index.ts:995,1096`, the `on_conflict` POST bodies inside `extractAndSaveMemory`/`extractAndSaveMemoryFromChat`. Independently traced both functions' only call sites (lines 150, 721) — both still `if (ENABLE_AUTO_MEMORY_WRITE)`-gated, flag confirmed `false` at line 25, and `grep` for every call site of both function names across the entire repo found no third caller. **Confirmed unreachable — dead code, MINOR future-cleanup item, not reopened as MAJOR**, per this task's own instruction. Adversarial trace of the Settings surface and any import/onboarding flow: the complete file list touching the string `user_context` anywhere in `src/`/`agent/` contains no onboarding, import, or wizard file at all — there is no UI or service path outside the now-frozen `AiMemoryTab`/`aiMemoryService` that can create or update a `user_context` row today. **Zero reachable writers, independently confirmed.**

**F2 adversarial payloads (fresh, not reused from the fixtures):** ran three novel payloads against the confirmed-identical pattern list outside the test suite:
- `"My stepson just graduated high school"` — **missed** (the `\bson\b` pattern requires a word boundary before "son"; "step" immediately precedes it with no boundary, so `\bson(s)?\b` does not match "stepson").
- `"Getting an MRI scan next Tuesday"` — **missed** ("MRI"/"scan" not covered by any pattern).
- `"Annual physical exam scheduled"` — **missed** ("physical"/"exam" are distinct words from the covered "physician"/"checkup"/"appointment").

All three are genuine, honest gaps — but each falls outside (or at the edge of) the two specific bypass classes named in the original review (they are new phrasings, not the `daughter`/`son`/`checkup`/`appointment` cases already fixed), and the task's own instruction and ADR-0010's new "Known limitations" paragraph both anticipate exactly this: a keyword heuristic cannot be exhaustive. Per the task's explicit judgment call and the governing layers already in place (Q5 zero-consumption before confirmation; Q1 unconditional delete), **this is a disclosed-limitation note, not a reopened finding.** Recorded here for the next docs/heuristic pass, not as a blocker.

### New-violation sweep

Diff-read every file 5c touched (both remediation passes) against `3351d9c`: `aiMemoryService.ts`, `useAiMemory.ts`, `AiMemoryTab.tsx`, `AppLayout.tsx`, `ADR-0010-personal-memory-layer.md`, `ADR-0008-tiered-change-governance.md`, the new migration's comment region, and the pattern-list region of both `personalMemoryRecordValidation.ts` and `personal-memory-extraction-endpoint.ts`. No new RLS/authority/boundary issue found in any of them — every change is either a deletion of a write-capable method/call site, a UI affordance removal/disablement, or an additive documentation paragraph. No scope creep beyond F1–F4: no unrelated file was touched, no new feature was added. `agent/worker/index.ts`/`index.test.ts` diffs confirmed byte-identical to the original 5b diff already reviewed (5c made no further edits there). Accessibility: `AiMemoryTab`'s disabled states carry a `title` attribute and static visible explanatory text, not colour-only signaling — consistent with the same rule already applied to the AI-written badge.

### Validation results (independently re-run)

- Suite: **131 files (5 skipped) / 1885 tests (76 skipped) passed**, exit 0 — matches 5c's numbers exactly.
- Typecheck: "78 baseline-tracked errors remain, 81 were in the baseline. No new or regressed errors." — matches.
- Lint: 84 problems (42 errors, 42 warnings), unchanged — matches.
- Build: succeeded — matches.
- `git diff --check`: clean (benign CRLF warnings only).

### Final gap register

1. Live-RLS suite (`personal_memory_records.rls.test.ts`) remains written-only, not executed — same standing local port-54322 conflict accepted in both prior reviews of this layer. Consistent precedent; not re-litigated here.
2. The two Worker-side `on_conflict` POST bodies (`agent/worker/index.ts:995,1096`) remain dead code behind `ENABLE_AUTO_MEMORY_WRITE=false` — confirmed unreachable in this pass; recommended as a future MINOR dead-code-removal item, not a merge blocker.
3. The three fresh adversarial misses above (`stepson`, MRI/scan, physical exam) — disclosed-limitation notes for a future heuristic pass, consistent with ADR-0010's own new "Known limitations" paragraph; not a blocker given Q5/Q1's layered mitigation.
4. Nothing else outstanding from the original review's B/C/D/E/F findings — all four (F1–F4) independently verified CLOSED above.

### Merge recommendation

**MERGE AS-IS.** All four remediation items are independently verified closed with direct evidence (diffs, live test runs, and fresh adversarial probing), zero regressions across suite/typecheck/lint/build, and the two remaining gap-register items are pre-existing, disclosed, and non-blocking by this review's own judgment call under the task's stated criteria.

### Verdict

**RE-REVIEW PASSED — CLEARED FOR MERGE DECISION**
