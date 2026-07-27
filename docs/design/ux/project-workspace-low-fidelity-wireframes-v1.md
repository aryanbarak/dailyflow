# SmartFlow Project Workspace — Low-Fidelity Wireframes v1

**Version:** 1.0
**Status:** Draft — for Product Owner review
**Date:** 2026-07-28
**Derives from:**
[`docs/product/product-direction-v1.md`](../../product/product-direction-v1.md) (v1.1,
Approved),
[`docs/design/ux/ux-architecture-v1.md`](ux-architecture-v1.md) (v1.1, Draft), and
[`docs/design/ux/project-workspace-wireframe-spec-v1.md`](project-workspace-wireframe-spec-v1.md)
(v1.1, Draft)
**Scope:** Low-fidelity, text/ASCII wireframes for the eight Project Workspace
destinations named in the Wireframe Specification §21. No visual design, no colour,
typography, iconography, spacing, or component definitions. No product or UX-architecture
redefinition.

---

## 0. How to Read These Wireframes

Each wireframe is a structural sketch, not a mockup. Boxes represent grouped information,
not visual containers with a defined size or style. Every box or line carries a priority
label instead of a visual treatment:

- **[High priority]** — immediately visible, corresponds to the Wireframe Specification
  §6 "immediately visible" tier.
- **[Supporting]** — reached with one deliberate interaction, corresponds to §6's "one
  deliberate interaction" tier.
- **[Secondary]** — a distinct destination or deep supporting detail, corresponds to §6's
  "deep supporting detail" tier or a named secondary screen (Wireframe Spec §5).

`[ Label ]` denotes an available action. `[ Label > ]` denotes a transition to another
destination. No colour, icon, font, or exact spacing is implied by any of this — where the
required format below says "ASCII wireframe," it is these same conventions applied to a
box layout, nothing more.

Every wireframe maps to at least one stage of Observe → Understand → Act → Verify
(Wireframe Spec §11):

| Wireframe | Primary OUAV stage(s) |
|---|---|
| 1. Project Workspace — Main Desktop | Observe, Understand |
| 2. Project Workspace — Main Mobile | Observe, Understand |
| 3. Project Workspace — Attention States | Observe, Understand |
| 4. Approval Review | Act |
| 5. Execution Result | Act → Verify (the hinge between the two) |
| 6. Evidence & Verification | Verify |
| 7. History | Observe (retrospective) |
| 8. Connection Status / Details | Observe (a precondition for all other stages) |

No wireframe forces a user through this sequence — every one of them is also a valid entry
point on its own (Wireframe Spec §4, §11), reachable directly rather than only by
completing the previous stage.

---

## 1. Project Workspace — Main Desktop

**Scenario:** a connected, fresh Software Project with a clear Current Focus and no
outstanding exceptions — the workspace's baseline condition.

**Primary user question:** "What is this project's state, and what should I do now?"
(Wireframe Spec §5)

**ASCII wireframe:**

```
+----------------------------------------------------------------------+
| Project: <name>                         Connection: Connected · Fresh|  [High priority]
| Repository: <owner/repo>                Objective: <current objective>|
+----------------------------------------------------------------------+
| CURRENT FOCUS                                            [High priority]
| <single next step, one line>                                          |
| [ Why this? > ]                                                       |
+----------------------------------------------------------------------+
| RECENT ACTIVITY                          | ASSISTANT                 |
| - <important event, most recent>         | Flow AI presence: idle    |  [High priority /
| - <important event>                      | "<one-line contextual     |   Supporting]
| - <important event>                      |  suggestion, if any>"     |
| [ View Recent Activity > ]  [ History > ] | [ Open Assistant > ]      |
+----------------------------------------------------------------------+
| HEALTH                                   | CONNECTIONS                |
| Overall: <Healthy / Attention needed>     | GitHub: Connected          |  [Supporting]
| - <contributing signal, if any>           | Last synchronized: <time> |
|                                            | [ Connection details > ]  |
+----------------------------------------------------------------------+
| PENDING APPROVALS: <count, only if > 0>          [ Review approvals > ]|  [High priority
+----------------------------------------------------------------------+   if count > 0]
```

**Information hierarchy** (Wireframe Spec §6):

- **[High priority]:** project identity/context row, Current Focus, the Pending
  Approvals row (only rendered when its count is greater than zero).
- **[Supporting]:** Recent Activity's concise list, Health's overall signal, Connections'
  brief status, Assistant's presence and any single-line suggestion.
- **[Secondary]** (not shown inline, reached via the actions below): full Recent Activity
  list, History, Evidence for any specific claim, Connection Status/Details, Approval
  Review, Execution Result.

**Primary actions:** open Approval Review (when a proposal is pending); open the full
Recent Activity list; enter Assistant with this project's context loaded.

**Secondary actions:** open History; open Connection Status/Details; open Evidence for a
specific Health signal or Recent Activity item; open Execution Result for the most recent
action.

**Navigation transitions:** from Home, Projects list, Tasks, Assistant, or a deep link
(Wireframe Spec §4) into this screen; from this screen into any of the six secondary
destinations named above; Primary Navigation (Home/Projects/Tasks/Learning/Assistant/
Connections) remains available throughout, structurally separate from Assistant's
contextual presence (UX Architecture §4).

**Important states:** Fresh (shown); No actionable work (Pending Approvals row absent,
Health reads "Healthy"). Other states are covered by Wireframe 3.

**Safety and approval boundaries:** the Pending Approvals count is an indicator only — it
never exposes an approve/reject control inline; deciding a proposal always requires
entering Approval Review (§4 below). Assistant's suggestion line is conversational, never
an executed action or an implied one.

**Responsive notes:** this is the desktop baseline; see Wireframe 2 for the mobile
variant and what collapses.

**Accessibility notes:** reading order follows visual priority top-to-bottom
(identity → Current Focus → Pending Approvals → Recent Activity/Assistant →
Health/Connections); the Pending Approvals row, when present, must be announced on arrival
rather than requiring discovery; every `[ ... > ]` transition is independently reachable by
keyboard.

**RTL and localisation:** project name, objective, and Assistant's suggestion text follow
interface reading order (RTL for Persian); repository identity (`<owner/repo>`), issue
identifiers, and any code/path fragments remain left-to-right even inside an RTL flow;
timestamps ("Last synchronized: …") are locale-formatted but never ambiguous; German
labels ("Verbindung", "Letzte Synchronisierung", etc.) run longer than English and must
not force identity or Current Focus text to truncate.

**Rationale:** every element traces to Wireframe Spec §5–§7, §9, §15–§16; nothing here is
new. The layout deliberately avoids showing full History, full Evidence, or a second
project's data on this screen (Wireframe Spec §5 "must not appear here").

---

## 2. Project Workspace — Main Mobile

**Scenario:** the same project as Wireframe 1, viewed on a constrained screen.

**Primary user question:** unchanged — "What is this project's state, and what should I
do now?"

**ASCII wireframe:**

```
+----------------------------------+
| <name>            [Connected]    |   [High priority]
| Objective: <current objective>   |
+----------------------------------+
| CURRENT FOCUS                    |   [High priority]
| <single next step>               |
| [ Why this? > ]                  |
+----------------------------------+
| PENDING APPROVALS: <count>       |   [High priority, only if > 0]
| [ Review approvals > ]           |
+----------------------------------+
| [ Recent Activity > ]            |   [Supporting — collapsed
| [ Health > ]                     |    behind one interaction
| [ Connections > ]                |    each, not shown inline]
+----------------------------------+
| ( Assistant presence indicator ) |   [Supporting — small,
| [ Open Assistant > ]             |    persistent, not full-width]
+----------------------------------+
```

**Information hierarchy:** identical priority assignment to Wireframe 1 (Wireframe Spec
§6 does not change by device). What changes is *presentation*, not priority: Recent
Activity, Health, and Connections move from inline summaries to single-line entry points,
consistent with "one deliberate interaction" already being their tier on desktop — mobile
simply makes that interaction the only way to see them, rather than also showing a
preview.

**Primary actions:** open Approval Review when a proposal is pending; open Current Focus's
"Why this?"; open Assistant.

**Secondary actions:** open Recent Activity, Health, or Connections via their respective
entry points; each opens as its own reachable destination rather than expanding inline.

**Navigation transitions:** identical set to Wireframe 1; Primary Navigation must remain
reachable in one step regardless of how much vertical space Current Focus and Pending
Approvals occupy (Wireframe Spec §18).

**Important states:** Fresh / No actionable work (shown); see Wireframe 3 for attention
variants, which follow the same collapse rules — an attention indicator still appears
inline (it is high priority), but the detail behind it is still one interaction away.

**Safety and approval boundaries:** identical to Wireframe 1 — the Pending Approvals
count never exposes a decision control on this screen; deciding still requires entering
Approval Review. This is deliberately unchanged by device: approval safety must never be
abbreviated for space (Wireframe Spec §18).

**Responsive notes (this wireframe's core purpose):**

- Current Focus stays near the top, immediately below identity — never pushed down by
  Recent Activity or Health.
- Approval warnings (the Pending Approvals row) remain visible without scrolling when
  present — they are not demoted to a collapsed entry point the way Recent Activity,
  Health, and Connections are.
- This is not a shrunk copy of Wireframe 1: Recent Activity's list and Health's signals
  are not compressed into smaller boxes, they are removed from the inline view entirely
  and replaced with a single entry point each (progressive disclosure, not compression).
- Assistant's presence indicator stays small and persistent; it does not expand to occupy
  the screen or push Current Focus out of view. Opening it is a deliberate step, matching
  desktop.

**Accessibility notes:** the same top-to-bottom priority order as Wireframe 1, condensed;
each collapsed entry point (`[ Recent Activity > ]`, `[ Health > ]`, `[ Connections > ]`)
must announce its own label, not just "expand" or "more"; the Pending Approvals row must
be announced immediately on screen-read, matching its always-visible priority.

**RTL and localisation:** identical concerns to Wireframe 1, compounded by less horizontal
space — repository identity and issue identifiers still must not be transliterated or
wrapped mid-token; German's longer labels are more likely to need truncation-safe
wording specifically on this narrow layout (e.g., "Letzte Synchronisierung" may need a
shorter mobile-specific phrasing at copywriting time — a content decision, not one this
wireframe makes).

**Rationale:** directly implements Wireframe Spec §18 — the explicit requirement that
mobile is not "the desktop layout, compressed," but the same information hierarchy with a
different disclosure mechanism.

---

## 3. Project Workspace — Attention States

**Scenario:** the same main screen (desktop shell shown; the same rules apply to the
mobile shell from Wireframe 2) under each of seven conditions that make Health,
Connections, or Current Focus deviate from the healthy baseline.

**Primary user question:** "What, specifically, needs my attention, and why?"

**ASCII wireframe (shared shell; only the varying rows are shown per state below):**

```
+----------------------------------------------------------------------+
| Project: <name>                         Connection: <state>          |
| Repository: <owner/repo>                Objective: <current objective>|
+----------------------------------------------------------------------+
| CURRENT FOCUS                                                         |
| <reflects the exception if it is genuinely the most relevant thing>  |
+----------------------------------------------------------------------+
| HEALTH: Attention needed                                              |
| - <the specific contributing signal for this state, see below>       |
+----------------------------------------------------------------------+
| [ rest of the baseline shell unchanged from Wireframe 1 ]             |
+----------------------------------------------------------------------+
```

**State variants** (Wireframe Spec §15, §17):

| State | What Health shows | What else changes |
|---|---|---|
| Pending approval(s) | "Blocked: N pending approval(s)" | Pending Approvals row shows count; `[ Review approvals > ]` present |
| Failed execution | "Failed execution: <one-line summary>" | Recent Activity's top item is the failure; `[ View Execution Result > ]` offered |
| Stale context | "Context is stale — last synchronized: <time>" | Every claim on screen (Current Focus, Health, Recent Activity) is labeled stale, not presented as current |
| Connection problem | "Connection needs attention" | Connections row shows the specific condition (§16); recovery path offered |
| Incomplete verification | "Verification incomplete for <item>" | Never shown as if verified or failed — its own explicit condition |
| Overdue important task | "Overdue: <task name>" | Links to the task in Tasks; the task itself is not duplicated here |
| Empty / no actionable work | Health section absent entirely | Current Focus reads as an onboarding prompt (e.g., "no tracked activity yet"); Recent Activity and History have nothing to show |

**Information hierarchy:** the exception itself is always **[High priority]** — it never
requires an interaction to discover that *something* needs attention, only to see the full
detail. This matches the "immediately visible" tier for Health (Wireframe Spec §6) exactly
— nothing here promotes exception detail above where Health already sits.

**Primary actions:** whichever action resolves the specific exception (review an approval,
inspect a failed execution, reconnect, address an overdue task).

**Secondary actions:** open Evidence behind the Health signal; open History for
longer-running context.

**Navigation transitions:** identical to Wireframe 1; an exception never changes which
screens are reachable, only what is flagged on arrival.

**Important states:** all seven listed above, individually — this wireframe is exactly
the state-variant set, not an additional state of its own.

**Safety and approval boundaries:** none of these states auto-resolves anything — a
failed execution does not auto-retry (no automatic retry, ADR-0004); a stale or incomplete
state never silently resolves itself into "fine." A pending approval shown here still
requires the full Approval Review flow (Wireframe 4) to decide.

**Note on "Needs Attention" terminology:** the exception surface shown here is this
**Project Workspace's own Health signal**, scoped to this one project — it is not Home's
cross-project Needs Attention widget (UX Architecture §5), which rolls the same kinds of
exceptions up *across* projects at the Home level. This wireframe never aggregates another
project's data; see Consistency Review (§11) for why this distinction matters and is kept
explicit here.

**Per the instruction not to build a permanent dashboard section:** the Health/exception
row is present only in the seven states above. In the "No actionable work" baseline
(Wireframe 1), it does not appear as an empty placeholder — the section is absent, exactly
as Home's Needs Attention is absent when nothing qualifies (Wireframe Spec §5, applied
here at project scope).

**Responsive notes:** on mobile (Wireframe 2's shell), the exception indicator remains in
the always-visible tier exactly like the Pending Approvals row — it is never demoted to a
collapsed entry point the way healthy Recent Activity/Health/Connections summaries are.

**Accessibility notes:** an exception must be announced on arrival, not only shown
visually (color or position alone is insufficient, consistent with Wireframe Spec §20);
each state's specific wording (e.g., "stale," "incomplete," "overdue") must be exposed as
text, not implied by an icon.

**RTL and localisation:** exception wording is translated per-state (English/German/
Persian); embedded technical tokens (issue IDs, repository names, timestamps) keep the
same LTR-within-RTL and unambiguous-timestamp treatment as Wireframe 1; German's longer
phrasing is most likely to affect this wireframe specifically, since exception text tends
to be a full sentence rather than a label.

**Rationale:** implements Wireframe Spec §15 (Health, decomposable, never an unexplained
score) and §17 (Workspace States) directly; explicitly avoids inventing an eighth,
permanent "Needs Attention" section that would contradict the instruction against a
permanent dashboard element.

---

## 4. Approval Review

**Scenario:** a project with two independent pending proposals; one is selected for
review.

**Primary user question:** "Exactly what is being proposed, and should I allow it?" —
asked once per proposal (Wireframe Spec §12).

**ASCII wireframe:**

```
+------------------------------------------------------------------+
| Approval Review — <project name>                                  |
+------------------------------------------------------------------+
| PENDING PROPOSALS (2)                                [High priority]
| > 1. Update issue #42 (title, labels)             [Pending]        |
|   2. Comment on issue #57                         [Pending]        |
+------------------------------------------------------------------+
| SELECTED: 1. Update issue #42                        [High priority]
|--------------------------------------------------------------------
| Proposed action    : Update the issue's title and labels            |
| Target             : <owner/repo>, issue #42                        |
| Reason             : <evidence-backed justification, one line>      |
| Expected effect    : Title -> "<new title>"; label +<label>          |
| Affected resource  : <owner/repo> via <connection name>              |
| Execution scope    : Can update this issue's title/labels only.     |
|                       Cannot merge, delete, or touch anything else. |
| Risk / reversibility: Reversible manually afterward in GitHub.       |
| Approval status    : Pending                                        |
+------------------------------------------------------------------+
| [ Approve ]   [ Reject ]   [ Defer ]   [ Cancel review ]            |
+------------------------------------------------------------------+
```

**Information hierarchy:** the proposal list and the selected proposal's full detail are
both **[High priority]** — none of the required fields (Wireframe Spec §12) is hidden
behind a further interaction once a proposal is selected. The list itself is the only
"[Supporting]"-tier element for the *other*, unselected proposal(s) — visible as an
identifier and status only, not their full detail, until selected.

**Primary actions:** select a proposal from the list; approve, reject, or defer the
selected proposal.

**Secondary actions:** cancel the review (leave without deciding, §12); open Evidence
behind the "Reason" field.

**Navigation transitions:** entered from the Main Workspace's Pending Approvals indicator,
from Home's Needs Attention, or from an Assistant proposal that has become actionable
(Wireframe Spec §4, §10); on Approve, transitions to Execution Result (Wireframe 5).

**Important states:** Single pending approval; multiple simultaneous pending approvals
(shown); reject/defer acknowledgment (a brief confirmation that the decision was recorded,
without leaving the list).

**Safety and approval boundaries (this wireframe's core purpose):**

- No control approves or rejects more than one proposal at once — there is no "select
  all" or batch action anywhere on this screen.
- Every field listed under §12 of the Wireframe Specification is present for the selected
  proposal, every time, with no abbreviated variant.
- Approving is the only action that leads to execution, and it leads to execution for
  *this proposal only* — a second pending proposal is unaffected and remains reviewable
  independently, including while the first is executing (Wireframe Spec §17, "Execution in
  progress").
- Cancel leaves the proposal exactly as it was (no decision recorded); Defer explicitly
  keeps it pending and visible elsewhere (Main Workspace indicator, Home's Needs
  Attention); Reject is a recorded decision, not merely a dismissal.

**Responsive notes:** on mobile, the proposal list and the selected proposal's detail
cannot both stay on-screen simultaneously — selecting a proposal may need to become its
own full step (list → detail → decision) rather than an inline expansion, but every field
in §12 must still appear in full before Approve is available (Wireframe Spec §18 —
approval safety is never abbreviated for space).

**Accessibility notes:** each list item must expose its own approval status as text (not
color alone); selecting a proposal must move focus to that proposal's detail heading;
Approve must require an explicit, unambiguous confirmation action, never a bare tap with
no distinguishable confirmation state (Wireframe Spec §20).

**RTL and localisation:** "Execution scope" wording is the field most at risk of losing
precision in translation — the exact boundary of what the action can and cannot do must
never become vaguer in German or Persian than the English original; issue identifiers and
repository identity stay LTR inside RTL flow; German's longer field labels and
"Execution scope" sentences are the most likely to need wrapping — this must not be
solved by truncating the boundary statement itself.

**Rationale:** implements Wireframe Spec §12 and the Product Owner's "multiple pending
approvals" decision precisely — independent list, independent detail, independent
decision, no batch action anywhere.

---

## 5. Execution Result

**Scenario:** the proposal approved in Wireframe 4 has just run.

**Primary user question:** "Did it work, and what exactly happened?" (Wireframe Spec §13)

**ASCII wireframe — succeeded:**

```
+------------------------------------------------------------------+
| Execution Result — <project name>                                 |
+------------------------------------------------------------------+
| Status: Succeeded                                    [High priority]
| Action performed : Updated issue #42 (title, labels)               |
| Affected target  : <owner/repo>, issue #42                          |
| Result summary   : Title and labels updated as approved.            |
+------------------------------------------------------------------+
| Verification status: Verified                        [Supporting] |
| [ View Evidence & Verification > ]                                 |
+------------------------------------------------------------------+
| Audit reference: [ View in History > ]                [Secondary] |
+------------------------------------------------------------------+
| Next: [ Return to Overview ]   [ Related task: <task name> > ]     |
+------------------------------------------------------------------+
```

**ASCII wireframe — failed:**

```
+------------------------------------------------------------------+
| Execution Result — <project name>                                 |
+------------------------------------------------------------------+
| Status: Failed                                        [High priority]
| Action attempted : Update issue #42 (title, labels)                 |
| Affected target  : <owner/repo>, issue #42                          |
| Failure explanation: <what went wrong, in plain terms>               |
| Next option      : Create a fresh proposal and approve again —      |
|                     no automatic retry.                              |
+------------------------------------------------------------------+
| Audit reference: [ View in History > ]                [Secondary] |
+------------------------------------------------------------------+
| Next: [ Return to Overview ]                                        |
+------------------------------------------------------------------+
```

**Information hierarchy:** status, the restated action, target, and result/failure text
are **[High priority]** — a user must never have to dig for whether something worked.
Verification status is **[Supporting]** (one interaction to the full Evidence &
Verification breakdown). The audit reference into History is **[Secondary]**.

**Primary actions:** none required — this is a report, not a decision point; the closest
thing to a primary action is opening Evidence & Verification to confirm the outcome.

**Secondary actions:** open History for the audit record; return to Overview; address a
related task; on failure, create a fresh proposal (a new, separate Approval Review, not a
retry button on this screen).

**Navigation transitions:** entered automatically from an approved action in Wireframe 4;
exits to Overview (Wireframe 1), History (Wireframe 7), or Evidence & Verification
(Wireframe 6).

**Important states:** Execution succeeded (shown); Execution failed (shown); Execution in
progress (a transient state, shown as "Status: In progress" with no result content yet —
not modeled as a separate wireframe since it is the same shell with content pending).

**Safety and approval boundaries:** no path on this screen originates a new proposal
directly — retrying after failure requires a fresh proposal and a fresh, explicit approval
(no automatic retry, ADR-0004); this screen never re-executes anything on its own.

**Responsive notes:** the four required blocks (status/action/target/result, verification,
audit, next steps) stack vertically with no loss of content on mobile — nothing here is
dense enough to require the same list/detail split as Approval Review.

**Accessibility notes:** the status transition (in progress → succeeded/failed) must be
announced, not only shown visually (Wireframe Spec §20); failure explanations must be
exposed as text, never color-only.

**RTL and localisation:** result summaries and failure explanations follow interface
direction; the restated action, target, and any technical identifiers stay LTR within RTL
flow; timestamps embedded in the audit reference remain unambiguous across locales.

**Rationale:** implements Wireframe Spec §13 exactly, including the explicit prohibition
on this screen originating a new, unrelated proposal.

---

## 6. Evidence & Verification

**Scenario:** inspecting the facts behind the execution result from Wireframe 5.

**Primary user question:** "What is this actually based on, and has it been confirmed?"
(Wireframe Spec §14)

**ASCII wireframe — verified:**

```
+------------------------------------------------------------------+
| Evidence & Verification — "Issue #42 update"                       |
+------------------------------------------------------------------+
| ACTION RESULT (claim)                                [High priority]
| "Execution reported: title and labels were updated."                |
+------------------------------------------------------------------+
| EVIDENCE (underlying facts)                          [High priority]
| Current state of issue #42, checked <time>:                         |
|  - Title: "<current title>"                                          |
|  - Labels: <current labels>                                          |
+------------------------------------------------------------------+
| VERIFICATION STATUS: Verified                        [High priority]
| The action result matches the evidence above.                        |
+------------------------------------------------------------------+
| [ Back to Execution Result ]   [ Back to Overview ]                 |
+------------------------------------------------------------------+
```

**ASCII wireframe — unresolved uncertainty:**

```
+------------------------------------------------------------------+
| Evidence & Verification — "Issue #42 update"                       |
+------------------------------------------------------------------+
| ACTION RESULT (claim)                                               |
| "Execution reported: title and labels were updated."                |
+------------------------------------------------------------------+
| EVIDENCE (underlying facts)                                         |
| Not currently available — connection could not be reached to        |
| refresh the issue's current state.                                  |
+------------------------------------------------------------------+
| VERIFICATION STATUS: Incomplete                       [High priority]
| Not confirmed. This is not the same as failed — the action result   |
| has simply not been checked against current evidence yet.           |
+------------------------------------------------------------------+
| [ Retry verification ]   [ Back to Execution Result ]               |
+------------------------------------------------------------------+
```

**Information hierarchy:** all three (or four, counting "unresolved uncertainty" as its
own condition rather than an omission) elements are **[High priority]** — none of the four
distinctions in Wireframe Spec §14 is allowed to be buried, since the entire purpose of
this screen is to keep them visibly distinct.

**Primary actions:** none required for the "verified" variant (it is confirmation, not a
decision); "Retry verification" for the "incomplete" variant, when the underlying cause
(e.g., connectivity) may have resolved.

**Secondary actions:** navigate back to whatever surfaced the claim (Execution Result,
Overview, Health, Recent Activity).

**Navigation transitions:** reached from Execution Result, Recent Activity, or a Health
signal; returns to whichever of those it was opened from.

**Important states:** Verified (shown); Verification incomplete (shown) — no third state
is introduced; a claim is never shown as simultaneously verified and failed.

**Safety and approval boundaries:** this screen never originates a proposal or a
recommendation — it reports facts and confirmation status only (Wireframe Spec §5, "must
not appear here: a new recommendation or proposal"). Critically, "Incomplete" is never
rendered as if it were "Verified," and never rendered as if it were a failure either — it
is its own condition, exactly as specified.

**Responsive notes:** the three blocks stack vertically on mobile with no content loss;
this screen has no list/detail split to simplify.

**Accessibility notes:** "Verified" and "Incomplete" must be distinguishable as text, not
by color alone; a screen reader must announce which of the two states is present, since
the entire value of this screen is disambiguation.

**RTL and localisation:** evidence content (issue titles/labels, repository identifiers)
stays LTR within RTL flow; the distinction between "Verified" and "Incomplete" must
translate with equal precision in German and Persian — this is the one place where a
translation blurring that line would be most damaging, since it directly protects users
from being told something succeeded when it has merely not been checked.

**Rationale:** implements Wireframe Spec §14's four-way distinction directly, including
the explicit instruction not to present verification as complete when evidence is
incomplete.

---

## 7. History

**Scenario:** investigating everything that has happened on this project over time.

**Primary user question:** "What has actually happened over time, and can I trace it?"
(Wireframe Spec §5, §9)

**ASCII wireframe:**

```
+------------------------------------------------------------------+
| History — <project name>                              [Secondary] |
+------------------------------------------------------------------+
| Filter (conceptual): [ All ] [ Execution ] [ Approval ]             |
|                       [ Verification ] [ Status change ]            |
+------------------------------------------------------------------+
| Time       | Event type   | Actor         | Related action          |
|------------|--------------|---------------|--------------------------|
| 14:02      | Execution    | User + Flow AI| Update issue #42         |
| 13:58      | Approval     | User          | Approved proposal 1      |
| 13:40      | Verification | System        | Verified update           |
| Yesterday  | Status change| System        | Objective changed         |
| 2 days ago | Connection   | System        | Connection restored       |
+------------------------------------------------------------------+
| [ Open Evidence for selected row > ]                                |
+------------------------------------------------------------------+
```

**Information hierarchy:** the filter set and the chronological list are both
**[Secondary]** at the Main Workspace's level (this whole screen *is* the "deep supporting
detail" for Recent Activity, Wireframe Spec §6) but function as **[High priority]** once
the user is on this screen — everything here is the point of being here.

**Primary actions:** scan or filter the timeline by event kind.

**Secondary actions:** open the Evidence behind any specific row.

**Navigation transitions:** reached only from the Main Workspace's "History" entry point,
or from Recent Activity's "go deeper" path (Wireframe Spec §5, §9); returns to Overview.

**Important states:** a populated timeline (shown); long-history pagination or chunking
(implied by the filter/list structure — bounded chunks, never an unbounded scroll dump,
per Wireframe Spec §18).

**Safety and approval boundaries:** History is read-only — no row offers an approve,
retry, or edit action; it reports what happened, including past approvals and executions,
without re-opening them for a new decision.

**Responsive notes:** on mobile, the filter row collapses to a single selector rather than
a row of options; the table's columns reduce to event type + related action + relative
time, with actor and exact timestamp available on selecting a row — content is
reorganized, not omitted (Wireframe Spec §18).

**Accessibility notes:** the timeline must be navigable row-by-row via keyboard; filters
must announce their current selection; "related action" text must be descriptive enough
to be meaningful read in isolation by a screen reader, not relying on table position.

**RTL and localisation:** event-type and actor labels follow interface direction; related
action text keeps repository/issue identifiers LTR within RTL flow; relative timestamps
("Yesterday," "2 days ago") must translate to unambiguous equivalents in German and
Persian, not literal mistranslations of relative time.

**Rationale:** implements Wireframe Spec §5 and §9's explicit distinction from Recent
Activity — a complete, filterable, investigable record, never a truncated duplicate of
the concise summary shown on the main screen.

---

## 8. Connection Status / Details

**Scenario:** this project's GitHub connection needs attention.

**Primary user question:** "Is this project's connection healthy, and if not, what do I
do?" (Wireframe Spec §16)

**ASCII wireframe (disconnected variant shown; other conditions listed below):**

```
+------------------------------------------------------------------+
| Connection — <project name>                            [Secondary] |
+------------------------------------------------------------------+
| GitHub connection: Disconnected                       [High priority]
| Since: <time>                                                        |
+------------------------------------------------------------------+
| What this affects:                                     [Supporting] |
| - Recent Activity and Health cannot refresh                          |
| - No new proposals can be created until reconnected                  |
+------------------------------------------------------------------+
| Recovery: [ Go to Connections to reconnect > ]                       |
+------------------------------------------------------------------+
```

**Other conditions (same shell, varying the top two blocks):**

| Condition | Top block reads | "What this affects" reads |
|---|---|---|
| Connected | "Connected — verified and current" | (block omitted; nothing to explain) |
| Stale | "Connected, but not recently refreshed" | Every claim elsewhere in the Workspace is labeled stale until this refreshes |
| Permission problem | "Connected, but access is limited" | Which specific capability is affected (e.g., issue data unavailable, repository state still readable) |
| Partially available | "Partially available" | Exactly which capability works and which does not — never a single connected/disconnected binary |

**Information hierarchy:** the connection state itself is **[High priority]** — never
requires an interaction to learn whether something is wrong. "What this affects" is
**[Supporting]** — one glance further, explaining consequence rather than just status.

**Primary actions:** follow the recovery path into the Connections domain.

**Secondary actions:** none beyond returning to Overview — this screen does not attempt to
resolve the connection itself.

**Navigation transitions:** entered from the Main Workspace's Connections entry point or
from an attention-state indicator (Wireframe 3); exits to the general Connections domain
(outside this Workspace's scope) or back to Overview.

**Important states:** all five listed above.

**Safety and approval boundaries:** this screen never performs re-authorization,
credential entry, or provider setup itself (Wireframe Spec §16 — that belongs to the
Connections domain); it surfaces the problem and points at the fix.

**Responsive notes:** the two blocks stack vertically with no content loss on mobile; the
recovery action remains a single, unambiguous step regardless of viewport.

**Accessibility notes:** the connection state must be announced in text terms
("Disconnected," "Stale," etc.), never by color or icon alone; the recovery path must be
reachable and clearly labeled by keyboard and screen reader alike.

**RTL and localisation:** state labels and consequence text follow interface direction;
the "Since: <time>" and any duration text must remain unambiguous across German, English,
and Persian; repository/account identifiers referenced in "what this affects" stay LTR
within RTL flow.

**Rationale:** implements Wireframe Spec §16's six connection conditions and explicit
"do not design provider setup" boundary directly.

---

## 9. Assistant Presence Across Wireframes

Not a separate wireframe — a cross-cutting note, since Assistant appears (in varying
form) in Wireframes 1, 2, and implicitly wherever a suggestion becomes a proposal reviewed
in Wireframe 4.

- **May:** explain project state (Wireframes 1–2's suggestion line), propose actions
  (which then become a Wireframe 4 entry), link to relevant project context, explain why
  an approval is needed (the "Reason" field in Wireframe 4, and "Why this?" in Current
  Focus).
- **Must not:** replace Primary Navigation (never shown as a substitute for the
  Home/Projects/Tasks/Learning/Assistant/Connections switcher); own the Workspace (it is
  one supporting element among several, never the frame the rest of the screen sits
  inside); execute unrestricted actions (every proposal still passes through Wireframe 4
  in full); hide approval boundaries (a suggestion is visibly not yet a proposal until the
  user acts on it, per Wireframe Spec §10); imply autonomous chained execution (one
  suggestion, if acted on, produces exactly one proposal — never a sequence presented as
  already agreed to).
- **Conversation ownership:** none of these wireframes model a persistent, project-owned
  conversation transcript. Where a wireframe shows "Open Assistant," it enters the
  Assistant domain with this project's context carried in — the conversation itself
  remains owned by the Assistant domain and may reference other projects, consistent with
  Wireframe Spec §10.

---

## 10. Out of Scope

Unchanged from the Wireframe Specification (§22), restated for this document specifically:
final visual design, colour, typography, design tokens, component APIs, iconography,
exact spacing or dimensions, animation, React or any implementation technology, and any
EPIC-08 or EPIC-09 capability. Nothing in these wireframes designs provider setup
(Wireframe 8), a chat interface (Wireframe 9), or a bulk-decision control of any kind
(Wireframe 4).

---

## 11. Consistency Review

Verified against Product Direction v1.1, UX Architecture v1.1, and the Project Workspace
Wireframe Specification v1.1. No contradictions were found — every wireframe traces to a
named section of one or more of the three documents, and the multiple-pending-approvals,
shared-importance, and Assistant-conversation-ownership decisions already resolved in the
Wireframe Specification are reflected exactly (Wireframes 3–4, 9).

One terminology tension surfaced during wireframing, not a contradiction requiring any
canonical document to change:

- **"Needs Attention" inside the Project Workspace.** This task's own brief asks
  Wireframe 1 to show "Needs Attention only when applicable" and Wireframe 3 to cover
  "Needs Attention" states at the project level. UX Architecture §5 and Wireframe
  Specification §15 both define Needs Attention specifically as **Home's** cross-project
  rollup — a different domain, a different scope. What Wireframe 3 actually shows is this
  **Project Workspace's own Health signal**, applying the same exception-only visibility
  principle (present only when something is genuinely actionable, absent otherwise) at a
  single-project scope. This document uses "Health" as the label in the wireframes
  themselves and calls out the distinction explicitly (Wireframe 3's "Note on 'Needs
  Attention' terminology") rather than introducing a second, project-scoped "Needs
  Attention" concept that would compete with Home's. No canonical document was changed to
  resolve this — the wireframes simply apply the existing Health/Needs Attention
  distinction (Wireframe Spec §15) as already written.

---

## 12. Open Decisions Discovered During Wireframing

None. Every question this task's brief raised — multiple pending approvals, shared
importance, Assistant conversation ownership, and the Health/Needs Attention terminology
above — was already resolved by the canonical documents or resolvable by applying them
consistently (§11). If a genuinely new product or architecture question surfaces once
these wireframes are reviewed against a real screen, it belongs in the Wireframe
Specification's own Open Decisions section (§23), not invented here to fill space.

---

## References

- [`docs/product/product-direction-v1.md`](../../product/product-direction-v1.md)
- [`docs/design/ux/ux-architecture-v1.md`](ux-architecture-v1.md)
- [`docs/design/ux/project-workspace-wireframe-spec-v1.md`](project-workspace-wireframe-spec-v1.md)
- [`docs/adr/ADR-0004-write-boundaries.md`](../../adr/ADR-0004-write-boundaries.md)
- [`PROJECT_STATUS.md`](../../../PROJECT_STATUS.md)
