# ADR-0017: Deterministic Bank-Statement Import with Batch Write Governance

- **Status:** Proposed. Stays Proposed until the final implementation slice
  ships (see the slice plan referenced in Consequences).
- **Date:** 2026-08-22
- **Decision Makers:** Product Owner (Aryan Barakzai) - decision; Claude Code - drafting.
- **Supersedes:** None
- **Superseded by:** None
- **Amendment (task 45b):** the original draft (task 45) proposed absolute
  fail-closed row validation -- any unparseable row blocks the entire
  import. The PO reviewed this and chose **quarantine-with-threshold**
  instead (Decision item 2 below): valid rows import, rejected rows are
  shown with line number and reason in the pre-approval preview, and the
  whole import is blocked only if more than 20% of data rows fail to
  parse. Nothing is ever silently skipped either way -- the change is
  about what happens to the *good* rows when *some* rows are bad, not
  about relaxing what counts as bad. The original fail-closed proposal and
  the reasoning against it as the final choice are kept below under
  Alternatives Considered, not deleted, since the argument the PO weighed
  is part of the record.

---

## Context

Task 44 diagnosed why the PO could not import a Sparkasse bank statement
into Finance: the PDF path (via Flow AI chat attach) is blocked by an
unrelated 10 MB client-side constant with no connection to bank-statement
size or Gemini's real limits, and even when reachable, model-based PDF
extraction offers no deterministic guarantee on amounts. The CSV path's own
hint ("date, type, amount, category") describes a schema no Sparkasse export
(CSV-CAMT V2/V8, "CSV mit Kategorien", MT940, XML CAMT) can ever satisfy --
different delimiter, different decimal convention, different column names
entirely.

The PO decided both halves of the fix together: (B) deterministic parsing
for money, because a silently mis-read amount is worse than a failed import,
and (C) bringing bulk financial writes under this codebase's existing
write-governance model. These are one decision, not two, because they answer
the same question: how does bulk financial data enter SmartFlow
trustworthily. A deterministic parser with no governed commit path still
lets a browser insert N unreviewed rows via RLS alone (today's actual state
for the single-transaction finance write, confirmed in code); a governed
batch-approval flow around model-extracted, unverifiable numbers still risks
committing a wrong amount with full ceremony around it. Neither half fixes
the problem alone.

## Decision

1. **Parser: deterministic CAMT-CSV parsing, not model extraction.**
   A pure, dependency-free parser in `shared/` (importable by both the
   Worker and the frontend, following the existing `shared/financeDirection.ts`
   / `shared/writeIntentRegistry.ts` convention) implements: semicolon
   delimiter; header-name-driven column resolution (never fixed position,
   since column order varies by institution); German decimal-comma
   normalization; `DD.MM.YY`/`DD.MM.YYYY` date parsing with 2-digit-year
   pivot windowing; CP1252/ISO-8859-1 decoding by default with UTF-8 BOM
   override; quoted-field-aware multi-line `Verwendungszweck` handling; and
   sign-based direction (`Betrag < 0` = expense) with no separate
   Soll/Haben column to read. v1 targets CSV-CAMT V2 as primary and
   "CSV mit Kategorien" as secondary; CSV-CAMT V8 and MT940/XML CAMT are
   explicitly out of scope (see below).

2. **Quarantine-with-threshold, not absolute fail-closed (PO decision,
   task 45b, amending the original task-45 draft).** Every row is
   validated against the deterministic rules in item 1. A row that fails
   is **quarantined**, not silently dropped: it is retained with its line
   number, the raw record text, a machine-readable reason code, and a
   human-readable reason, and shown to the user in the pre-approval
   preview alongside the rows that did parse. Rows that pass validation
   are eligible to import. If the quarantined share of the file's data
   rows exceeds **20%**, the entire import is blocked (verdict
   `blocked_over_threshold`) -- past that point the problem is treated as
   structural (wrong file, wrong format, a parser gap wide enough to not
   trust the file at all), not a handful of edge rows a human should
   individually adjudicate. Nothing is ever silently skipped in either
   outcome: a quarantined row is always visible, whether the batch
   proceeds around it or the whole file is blocked because of how many
   there are.

   **Why not absolute fail-closed (the original task-45 proposal),
   argued explicitly rather than just reversed:** Sparkasse's CAMT export
   is machine-generated, not hand-typed -- when a row fails to parse
   against rules this specific (six deterministic, testable statements),
   the overwhelmingly likely cause is a gap in *this parser*, not
   corruption in the bank's own file. Under absolute fail-closed, a
   single such gap -- hit on row 47 of a 60-row statement -- means zero
   of the other 59 perfectly good rows import, and the only way forward
   for the PO is to manually hand-edit their bank's export to route
   around a bug in SmartFlow's parser. That is a worse outcome than
   quarantine for a machine-generated file: it turns a parser bug into a
   demand that the user edit financial source data by hand, which is
   exactly the kind of silent-mis-parse risk this ADR exists to avoid,
   just relocated to a spreadsheet instead of to the code. Quarantine
   keeps the same non-negotiable guarantee (a bad row is never imported
   as if it were good, and its badness is never hidden) while not
   punishing 59 good rows for 1 parser gap. The 20% threshold is what
   keeps quarantine from silently drifting into "import whatever parses,
   ignore the rest" for a file that is *actually* wrong (wrong format
   selected at export time, wrong bank entirely, a genuinely corrupted
   download) -- past that share, the file itself is the more likely
   culprit, and blocking outright is the fail-closed behavior for that
   case specifically.

3. **Duplicate detection via deterministic row hash.** Each parsed row is
   hashed (`user_id | Buchungstag | Betrag | Verwendungszweck | counterparty
   IBAN`) and checked against previously-imported rows before the batch
   proposal is built; duplicates are excluded from the proposed count and
   surfaced as their own preview line, never silently re-inserted.

4. **Batch writes join the existing write-governance model as one new
   write intent**, `import_bank_statement` (domain `finance`, action
   `create`), registered in `shared/writeIntentRegistry.ts` like every
   other domain (ADR-0013's registry-driven touch points). Its proposal
   target is shape-only -- row count, date range, sums, currency,
   duplicate count, quarantined-row count, quarantine ratio -- referencing
   a server-held `batchId`, never the parsed row values themselves,
   mirroring ADR-0016's existing shape-not-values discipline. It always
   resolves to the `ask` lane, never `auto` -- the same clamp ADR-0012
   already applies to every finance write, for the same reason (money),
   applied here to a larger blast radius.

5. **Batch undo is one action reversing the whole import.** Reuses the
   existing persist-first undo pattern (`flow-write-policy.ts`): the batch
   commits, then one undo record is persisted holding the list of inserted
   transaction ids; if persisting the undo record fails, the batch insert
   is rolled back and the write reported failed, exactly as
   `persistUndoOrRollback` already does for every other domain. Undo
   executes as a single `DELETE ... WHERE id = ANY(...)`.
   `flow_write_undo_records.kind` gains `import_bank_statement` via the
   same widen-the-CHECK-constraint migration pattern already used twice
   (`20260815000000`, `20260817000000`). The undo window for a batch is a
   separate, PO-set constant, not a reuse of the existing 10-minute
   single-write window, since a multi-row import plausibly needs longer
   for a human to review before the window closes.

6. **One ledger row per batch in `agent_proposal_outcomes`**, through the
   existing `recordProposalOutcome` choke-point, no schema change required
   (`domain: 'finance'` already covers it). `target_fields` names which
   shape fields were populated (`rowCount`, `dateRangeStart`, ...), never
   their values -- consistent with ADR-0016's existing rule, applied to a
   new intent type rather than requiring a new mechanism.

7. **The batch commit executes server-side, under `service_role`, not as
   a browser-authorized RLS insert.** This is a deliberate strengthening
   over today's actual state: even the existing single-transaction,
   ask-lane finance write (`financeCreateTransactionHandler.ts`) executes
   as a direct browser-side Supabase insert authorized purely by
   `finance_transactions_insert_own`'s RLS policy -- approval today is a
   UI gate only, not an enforced authority boundary; a user could call the
   insert directly and RLS would permit it. That gap is an accepted,
   low-blast-radius risk for one row; it is not accepted for a governed
   batch. Parsing may stay client-side (no secret required, better UX);
   the actual commit moves to two new authenticated Worker endpoints
   (`POST /finance/import-batch/prepare`, `POST /finance/import-batch/commit`),
   the second executing with `service_role` inside one transaction, after
   re-validating server-side (never trusting the client's own quarantine
   decision -- a tampered client could claim a row is valid). RLS on
   `finance_transactions` stays exactly as-is -- it's still correct and
   needed for every other write path; this adds an additive, second
   authority path for the batch case specifically, not a replacement.

8. **The existing `BankImportTool.tsx` (PDF+Gemini import UI) is retired**
   once this ships and has been used successfully at least once. It is
   removed from `FinancePage.tsx`; the `/import-bank` Worker endpoint is
   kept dormant (not deleted) for one release as a rollback path, then
   removed from `ROUTES`. Running it alongside a governed batch-import
   path would recreate exactly the dual-lane, differently-governed-writes
   problem ADR-0013 already spent five slices closing elsewhere in this
   codebase.

## Alternatives Considered

**Absolute fail-closed row validation (the original task-45 proposal).**
Any row that does not parse exactly rejects the entire file; zero rows
import until every row is fixed. This was the initial draft and is not a
strawman -- it is this codebase's default posture for financial writes
elsewhere (ADR-0012's finance `ask`-clamp, `flow-write-policy.ts`'s
ask-rather-than-infer amount/direction handling). **The PO reviewed it and
chose quarantine-with-threshold instead** (Decision item 2) on the
machine-generated-file reasoning above: for a file this structured, an
unparseable row is overwhelmingly a parser gap, and demanding the user
hand-edit their bank export to route around SmartFlow's own bug is a worse
outcome than showing them exactly which rows didn't make it and why, while
still importing the rest. The 20% threshold is what keeps this from
softening into "always import whatever parses" for files that are
structurally wrong rather than merely containing a few edge rows.

**Unbounded quarantine (no threshold at all).** Considered and rejected:
without a cutoff, a file exported in the wrong format, from the wrong bank,
or genuinely corrupted would still "import" its few accidentally-parseable
rows while quarantining the rest, silently normalizing a fundamentally
broken import as a partial success. The 20% threshold exists specifically
to catch that case and block outright, rather than ship a technically-not-
silent but practically-misleading partial import.

**Model-based extraction (Gemini reading the PDF or CSV) as the parsing
layer.** Rejected. Task 44's own investigation found the existing
`/import-bank` PDF path has no deterministic guarantee on any extracted
amount, three independently uncoordinated size limits (a 10 MB client-side
chat-attachment cap unrelated to bank statements at all, a 20 MB Worker-side
guess, and Gemini's own inline-data ceiling), and brittle JSON-fence-
stripping response parsing with observed `MAX_TOKENS` truncation on longer
statements. A wrong amount that looks plausible is strictly worse than a
failed import that says why it failed -- the explicit premise of this task's
own PO decision.

**Reuse the single-write `ask`-lane's existing RLS-only execution for the
batch commit too (no new Worker endpoints).** Rejected: acceptable blast
radius for one row is not acceptable blast radius for N rows of financial
data with no server-side re-validation of a client-computed batch.

## Consequences

- New `shared/` parser module, pure and dependency-free, following the
  `financeDirection.ts` convention -- testable via fixture files with zero
  UI or network dependency. Slice 1 (task 45b) delivers this module alone,
  imported by nothing yet; later slices (registry entry, Worker endpoints,
  batch-proposal UI, `BankImportTool.tsx` retirement) wire it in
  independently, each under its own validation gate.
- Every quarantined row must remain individually visible to the user in
  the pre-approval preview -- a UI that shows only a count, without the
  per-row line number and reason, does not satisfy Decision item 2.
- New write intent `import_bank_statement` in `shared/writeIntentRegistry.ts`
  -- the standard ~4-touch-point cost (registry entry, handler, undo-kind
  migration line, translations) this codebase's own
  `docs/architecture/adding-a-write-domain.md` already documents, plus this
  ADR's own new pieces: two new Worker endpoints, a batch-undo window
  constant, and a duplicate-hash storage mechanism (new column or side
  table -- implementation detail for a later slice, not this ADR).
- First finance write path in this codebase whose actual commit executes
  server-side under `service_role` rather than purely via RLS -- a
  deliberate precedent, worth revisiting for the single-transaction path
  too at some point, not claimed as free.
- `BankImportTool.tsx` and its Worker endpoint are retired -- one fewer
  finance-write surface, not two parallel ones.
- CSV-CAMT V8, "CSV mit Kategorien"'s exact column layout (only weakly
  sourced today from secondary import-tool documentation, not a primary DK
  or Sparkassen-Finanzportal specification), MT940/XML CAMT, non-Sparkasse
  banks, and automatic category inference from `Verwendungszweck` text are
  all explicitly out of scope for this ADR -- named here so they are
  deferred deliberately, not silently forgotten:
  - **PDF statements** -- out of scope entirely; this ADR targets
    machine-readable exports only.
  - **Other banks / non-Sparkasse formats** -- CAMT.052/053 is a general
    ISO 20022 standard, so a future bank's export is plausibly a variant
    of the same parser, but this ADR makes no claim about any bank other
    than Sparkasse and should not be read as covering them.
  - **Auto-categorization** -- the parser assigns no category unless
    "CSV mit Kategorien"'s own `Kategorie` column is present and used
    verbatim; every other imported row lands with the same fallback
    category convention already used elsewhere in this codebase, applied
    by a later slice, not the parser itself.
  - **MT940** -- deferred, not because it is obsolete (it is not currently
    scheduled for shutdown by the DK for statement/reporting messages,
    only for a different cross-border payment-instruction message class),
    but because it is a structurally different, positional SWIFT-block
    format needing its own parser, not a CSV variant.
- This ADR stays **Proposed** until the full slice plan (parser, registry
  entry, Worker endpoints, batch-proposal UI, `BankImportTool.tsx`
  retirement) has shipped -- it does not flip to Accepted on the strength
  of the parser slice alone.

## Related ADRs

- [ADR-0004: Write Boundaries for SmartFlow GitHub Integration](ADR-0004-write-boundaries.md)
- [ADR-0012: Write Capability Layer v1](ADR-0012-write-capability-layer.md)
- [ADR-0013: Write Intent Registry v2](ADR-0013-write-intent-registry-v2.md)
- [ADR-0016: Proposal Outcome Ledger](ADR-0016-proposal-outcome-ledger.md)
