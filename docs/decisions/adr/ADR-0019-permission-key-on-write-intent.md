# ADR-0019: Flow-Write Permissions Keyed on Write-Intent Identity

- **Status:** Proposed. Draft approved in shape by the Product Owner on
  2026-08-27; stays Proposed until the migration and the code changes in
  Consequences ship.
- **Date:** 2026-08-27
- **Decision Makers:** Product Owner (Aryan Barakzai) - decision; Claude Code - drafting.
- **Supersedes:** None. Amends the permission-key shape introduced by
  ADR-0012 (write capability layer) and consumes the registry established
  by ADR-0013 (write intent registry v2).
- **Superseded by:** None

## Context

`flow_write_permissions` keys on `(user_id, domain, action)`. Three
findings, reached from two independent starting questions, show that key
cannot express the capability set it governs.

1. **A capability with no key at all.** `propose_engineering_task` has no
   `flow_write_permissions` row, no Settings control, no default mode and
   no way for a user to set it to `ask` or `off` - and it is the capability
   that launches an unattended coding-agent run against a real repository.
   The highest-consequence capability in the product is the only one with
   no representation in the permission model. (GitHub #191, section 2a-ii.)

2. **Two capabilities sharing one key.** `create_finance_transaction` and
   `import_bank_statement` both register as `finance.create`, so neither
   can be permitted without the other. The registry itself already draws
   the distinction, via `exposure: 'chat' | 'ui-only'` (ADR-0017 Ruling 2)
   - the permission model simply cannot express it. Settings consequently
   renders two identical `finance.create` rows with a duplicate React key.
   (GitHub #193.)

3. **The coarseness, noticed independently.** While assessing (1), the
   `(domain, action)` key was noted as already too coarse in one place.
   That observation was later confirmed as finding (2). It is not separate
   evidence; it is evidence that the defect is reachable from more than one
   direction.

These are not three problems. They are one question - **what must the
permission key be?** - with three visible consequences. Ruling on any one
in isolation settles the others by default: de-duplicating the derivation
would permanently freeze `import_bank_statement` under `finance.create`,
and a bespoke engineering-task control would settle the key question by
precedent.

### Why this warranted an ADR

The permission key defines the shape of a security-relevant table, which
makes it a schema change requiring Tier-1 handling and PO authorisation
rather than a refactor any single ticket can take.

An earlier draft argued the ADR was needed because the table "holds real
user data." **That was wrong and is corrected here:**
`flow_write_permissions` is **empty in production** - zero rows, verified
against project `taqxwnlwllbywaklwyno` on 2026-08-27. No user has ever set
an explicit policy, so every write behaviour observed to date comes from
the code default at `agent/worker/flow-write-policy.ts:293`.

The correction inverts the urgency rather than removing it. The ADR is
warranted because the key encodes a governance decision, not because
migrating it is expensive - and the empty table is a reason to move
sooner, not later. See Decision 5.

## Decision

### 1. The key becomes `(user_id, intent_type, mode)`

`flow_write_permissions` is re-keyed on the `writeIntentRegistry` entry's
**`intentType`**. One row per capability.

### 2. The identifier is `intentType` - not a new `id` field, and not `toolId`

`WriteIntentDescriptor` has no `id` field today. Its fields are
`intentType`, `domain`, `action`, `toolId`, `capability`, `undoKind`,
`targetIdField?`, `createRequiredTargetFields?`, `reversible`,
`successSummary`, `i18n`, `promptInstruction?`, `exposure`,
`descriptionTitle`, `previewLines`, `buildHandlerInput`. Both `intentType`
and `toolId` are unique across all six entries, so either would function.
`intentType` is chosen deliberately:

> **`toolId` names the executing mechanism. `intentType` names the intent.
> A permission binds to what is authorised, not to how it is carried out.**

This is the same reason `exposure` is rejected from the key below: routing
and execution details do not belong in a policy key. If the tool that
carries out an intent changes - renamed, split, reimplemented - the user's
permission must not break or silently reset.

No new field is added to the registry. `intentType` already exists, is
already unique, and is already the value every other permission-adjacent
derivation uses.

### 3. `propose_engineering_task` becomes a registry entry

The corollary that makes finding (1) expressible. It is currently a
hand-written literal in eight derivations and absent from the four that are
purely computed - the reasoning prompt among them, which is why the model
was instructed that engineering tasks are unsupported (GitHub #191).

Entering the registry fixes the permission gap and the prompt in one
change, because both are derived. See Consequences for the two hazards this
creates.

### 4. Its default mode is `ask`

`defaultFlowWriteMode` already falls through to `ask` for everything that
is not a tasks/calendar create-or-update:

```ts
// agent/worker/flow-write-policy.ts:290-295
if (action === 'delete') return 'ask'
if (domain === 'finance') return 'ask'
if ((domain === 'tasks' || domain === 'calendar') && (create|update)) return 'auto'
return 'ask'                                  // <- engineering tasks land here
```

`auto` is the narrow special case; `ask` is the catch-all. The default
costs nothing to specify and nothing to implement.

**Open, deliberately not ruled here:** whether `propose_engineering_task`
also warrants the finance-style *hard clamp* - the rule at
`flow-write-policy.ts:317` under which even an explicitly stored `auto` row
resolves to `ask`. That question interacts with GitHub #194 (the approval
card gates the enqueue, not the run) and is deferred to avoid answering the
smaller question in a way that appears to settle the larger one. Under this
ADR's key the clamp becomes per-intent rather than per-domain, so the
mechanism exists either way and costs one line.

### 5. `import_bank_statement` gets its own key, even though nothing consults it

Nothing will read this key today. `import_bank_statement` is unreachable
from chat behind five independent, documented gates: `exposure: 'ui-only'`
filters it from both the prompt and the Worker schema enum;
`createRequiredTargetFields: ['batchId']` has no legitimate source in a
chat message; it has no entry in `registeredWriteHandlers` so it fails
closed at `handler_not_found`; `intentValidator.ts` converts the type to
`unsupported` before normalisation; and the finance clamp applies on top.

It gets a key regardless, because **an inexpressible distinction is the
defect this ADR exists to fix.** A model that cannot represent a
distinction cannot be asked about it later. Whether the Finance-page UI
flow should ever consult that key is a separate product question and is not
decided here.

This also matters because the two finance capabilities are not comparable
in blast radius. `create_finance_transaction` writes one row.
`executeBatchFinanceImport` inserts every parsed row of a bank statement in
a single atomic bulk POST - tens to hundreds of rows, with no cap found in
the parser or preview.

### 6. The default stays in code; the table holds explicit user choices only

`flow_write_permissions` records **only** what a user has explicitly
chosen. Absence of a row means *no preference expressed*, and the code
default governs.

This is the right shape, and it is worth stating why, because the codebase
has a live counter-example. `fetchUserLanguage`
(`agent/worker/context-builder.ts:107-115`) collapses "no `user_settings`
row" and "row says `en`" into an identical `'en'`, and every consumer then
reads that value as *the user's language* and renders text from it. The
system invents a preference the user never expressed and acts on it as
though it were stated (GitHub #189).

The permission model must not acquire that property. Keeping the default in
code preserves the distinction structurally: an absent row cannot be
mistaken for a choice, because there is nothing to mistake. Fail-safe
behaviour is preserved too - `resolveServerFlowWriteMode` returns `'ask'`
when the permissions fetch throws, so an unreachable table degrades toward
confirmation rather than toward execution.

### 7. An approval card does not substitute for standing policy

Ruled on code evidence (GitHub #194). The engineering-task approval card
gates whether a proposal becomes a **pending row**; the run happens
afterwards, when the companion claims that row with a shared secret. There
is no second checkpoint, no per-repo scope, no rate limit and no off
switch, and `claim_pending_engineering_task` takes no user parameter.

Per-run consent and standing policy are different kinds of control. This
ADR supplies the second for the first time. It does **not** close #194:
a permission key governs whether a proposal auto-executes into a pending
row, not what the companion does once that row exists.

## Alternatives Considered

### A. Engineering tasks as a new `domain`

Add `domain: 'engineering'`, keep `(domain, action)`.

**Rejected:** resolves finding (1) only. The finance collision (finding 2)
survives untouched, and the key remains one that cannot express two
capabilities in the same domain-and-action. It answers the symptom that
happened to be noticed first.

### B. Add `exposure` to the key - `(user_id, domain, action, exposure)`

Would separate `create_finance_transaction` from `import_bank_statement`,
since they differ on `exposure`.

**Rejected:** `exposure` describes *how a capability is reached* -
whether the reasoning layer may propose it. That is routing, and routing
does not belong in a policy key. It would also break the moment two
capabilities shared a domain, action **and** exposure, which nothing
prevents. Same principle as Decision 2: permissions bind to what is
authorised, not to how it is carried out.

### C. De-duplicate the derivation

Make `WIRED_FLOW_WRITE_CAPABILITIES` unique on `(domain, action)`.

**Rejected:** it removes the duplicate Settings row and the React
duplicate-key warning while permanently freezing `import_bank_statement`
under `finance.create` - closing the visible symptom and settling the
governance question by default. This is precisely the failure mode
described in Context.

### D. Do nothing; rely on approval cards

**Rejected by Decision 7 on code evidence.** Cards gate the enqueue, not
the run.

## Consequences

### Ordering constraint - now moot, and recorded rather than deleted

The original draft carried a blocking constraint: **the migration must land
before any row is written to `flow_write_permissions`, including the
INC-02 `auto`->`ask` clamp**, because the empty table is what makes the
migration free and clamp rows would encode a governance decision in the
very key this ADR replaces.

**That constraint no longer binds, because the clamp does not need the
table at all.** Changing the code default - `defaultFlowWriteMode`
(`flow-write-policy.ts:290-295`) and its client twin
`defaultFlowWritePermissionMode` (`src/features/agent/flowWritePermissions.ts:29-36`)
- achieves the identical clamp with **zero rows written**, and because the
table is empty that default currently governs 100% of real behaviour. That
route is key-agnostic and survives the re-key untouched.

Recorded rather than removed: the reasoning still applies to any *other*
proposal to write rows before this migration ships. The constraint is
satisfied, not withdrawn.

### Known hazard 1: the duplicated default

`defaultFlowWriteMode` (Worker) and `defaultFlowWritePermissionMode`
(client) are the same logic in two files. They agree today.

**They must change together.** Changing one and not the other makes
Settings display a mode the Worker does not enforce - a UI that states a
policy the system does not apply. Unifying them is out of scope here (the
shared-module constraint in `writeIntentRegistry.ts` governs what may be
shared between the two runtimes), but any change to either is incomplete
without the other.

### Known hazard 2: the enum-duplication trap

`SUPPORTED_INTENT_VALUES` (`agent/worker/reasoning-endpoint.ts:31-49`)
spreads chat-exposed registry entries **and** carries
`'propose_engineering_task'` as a hand-written literal at line 46. Adding
the registry entry without removing that literal puts the value in the
schema enum **twice**.

**The registry entry and the removal of that literal must be the same
commit**, and `shared/reasoning-response-schema.snapshot.json` needs
regenerating. This fails loudly rather than shipping silently:
`shared/reasoningResponseSchema.purity.test.ts` compares the built schema
against the snapshot with an order-sensitive walk, so CI blocks first.

The same pattern applies to the other seven hand-written literals -
`writeRuntime.ts:58`, `intentValidator.ts:53/72/110/133`,
`ChatPage.tsx:275`, `reasoningTypes.ts`,
`proposalOutcomeReporting.ts:48` - each must be reviewed for duplication
as the entry lands.

### Verification: `provider-contract-smoke` is necessary but NOT sufficient

Adding the entry with `exposure: 'chat'` changes
`REGISTRY_SUPPORTED_INTENTS` (`src/features/agent/reasoning/reasoningPrompt.ts:23`)
and therefore the reasoning prompt. That is the intended fix for #191.

`provider-contract-smoke` does **not** verify it. Read from the script
rather than assumed:

```ts
// scripts/provider-contract-smoke.ts:93
import { buildReasoningSystemInstruction, buildReasoningResponseSchema,
         SUPPORTED_INTENT_VALUES } from '../agent/worker/reasoning-endpoint'
```

It imports the **Worker's** system instruction - five generic sentences
that enumerate no intents ("The type field must use one supported SmartFlow
intent from the supplied prompt") - and the schema enum. It does **not**
import `buildReasoningPrompt`, which lives in `src/`, is built client-side,
and is posted to the Worker as `message`. The "Supported intents:" line the
model actually reads is in that prompt.

So the smoke covers the schema-enum half of this change - including the
duplication trap above - and cannot cover the prompt half, which is the
half that fixes the bug.

**Blocking gate, not a nice-to-have: the prompt change requires live
runtime verification, not CI alone.** A capture on the deployed path must
show the model emitting `propose_engineering_task` with a populated target
for a natural-language engineering request. GitHub #190 (the deployed
reasoning log records `proposal.type` and nothing else) should land first,
or that capture cannot answer the question it is taken to answer.

### Scope of the change

Zero rows to migrate. Code: six files, roughly nine sites.

| file | sites |
|---|---|
| `supabase/migrations/` | new migration: PK, check constraint, `updated_at` trigger, 3 RLS policies |
| `agent/worker/flow-write-policy.ts` | `defaultFlowWriteMode:290`, `resolveServerFlowWriteMode:297` incl. the `domain=eq&action=eq` query, finance clamp `:317` |
| `src/features/agent/flowWritePermissions.ts` | `WIRED_FLOW_WRITE_CAPABILITIES:25`, `defaultFlowWritePermissionMode:29`, `resolveFlowWritePermissionMode:38`, `listBrowserFlowWritePermissions:47`, `upsert:69` incl. `onConflict` |
| `src/pages/SettingsPage.tsx` | render key `:678`, state reducer `:455-457`, upsert call `:459` |
| `agent/worker/index.ts` | call site `:1174` (signature only) |
| `shared/writeIntentRegistry.ts` | add the `propose_engineering_task` entry |

Both runtimes import the registry, so this is a Worker change **and** a
frontend change: `npx wrangler deploy` is required after
`provider-contract-smoke`.

### What this resolves and what it does not

**Resolves:** GitHub #191 sections 2a-0, 2a-i and 2a-ii, and #193 - as one
change, which is what the Context section argues they require.

**Does not resolve:** #194 (the approval card gates the enqueue, not the
run). This ADR gives engineering tasks a permission key for the first time;
what happens after a pending row exists remains ungoverned.

## References

- ADR-0004 write boundaries; ADR-0005 approval flow; ADR-0012 write
  capability layer; ADR-0013 write intent registry v2; ADR-0017 Ruling 2
  (`exposure` as a first-class registry field).
- GitHub #191 (ENG-10) - the registry-derivation audit; sections 2a-0/i/ii.
- GitHub #193 (UI-01) - the duplicate `finance.create` control.
- GitHub #194 (GOV-01) - the card gates the enqueue, not the run.
- GitHub #190 (OBS-02), #189 (OBS-01), #188 (INC-02).
