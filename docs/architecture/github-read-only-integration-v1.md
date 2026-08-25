# GitHub Read-only Integration V1 - Slice 1

**Status:** Live in production, read-only permissions confirmed 2026-08-25.
GitHub App "SmartFlow Agent" is registered with read-only permissions,
connected to account `aryanbarak`, and the deployed Worker successfully
lists real repositories. GitHub credentials exist as Worker **secrets**
(`GITHUB_APP_PRIVATE_KEY`, `GITHUB_CLIENT_SECRET`, etc. — see
`agent/worker/wrangler.toml`'s own comment pointing at `wrangler secret
put`), not `[vars]`; an earlier read-only status check (GH-01) found no
`GITHUB_*` `[vars]` entries and correctly reported that as evidence
against production readiness, but did not check secrets — that was out of
its declared scope, not a wrong finding.  
**Last updated:** 2026-08-25 (GH-04 status correction)

The scope and trust-boundary description below (Purpose, Scope, Worker
Routes, Configuration Contract, Manual Registration Checklist) documents
Slice 1 as originally designed and is left as the historical record of
that design. The surface actually built and now live is materially
larger — see "Routes Beyond Slice 1 Scope (GH-04, 2026-08-25)" after the
Worker Routes table below for what is not covered by this doc's original
text.

## Purpose

Define the bounded GitHub App connection and repository-listing architecture for
SmartFlow's first remote provider integration.

## Scope

Slice 1 supports one capability only:

```text
inspect_github_repositories -> github.repositories.list
```

It connects an authenticated SmartFlow user to one verified GitHub App
installation and returns at most 20 sanitized repository metadata records. It
does not read source, commits, branches, issues, pull requests, checks, Actions,
or any other GitHub resource. It performs no GitHub writes.

## Trust Boundaries

### Connection start

1. The browser sends `POST /github/connect/start` with its Supabase bearer token.
2. The Worker validates that token through Supabase Auth and derives the user ID.
3. The Worker creates 32 cryptographically random bytes, stores only their
   SHA-256 hash, binds the attempt to the verified user ID, and applies a
   10-minute expiry.
4. The Worker returns only the fixed GitHub App installation URL and expiry.

Starting another attempt removes the same user's older unfinished attempts.
State is single-use and is never stored in plaintext.

### Setup URL versus authorization callback

GitHub's Setup URL and User Authorization Callback are separate boundaries.

The Setup URL receives `installation_id`, but that value is only a claim. It is
not trusted or persisted as a verified connection. The Setup handler consumes
the setup state atomically, records the claimed installation ID, creates a new
single-use OAuth state, and redirects to GitHub's fixed user authorization URL.

The User Authorization Callback consumes the second state atomically and
exchanges the authorization code server-side. The resulting GitHub user access
token is used only to call the fixed authenticated-user installation endpoint.
The Worker accepts the connection only when:

- the installation ID returned by GitHub equals the Setup URL claim,
- the authorizing GitHub user can access that installation,
- the installation's App ID equals the configured SmartFlow GitHub App ID, and
- the attempt is valid, unexpired, unused, and bound to its initiating
  SmartFlow user.

Changing the browser's current SmartFlow session cannot change the user ID
already bound to callback state. State replay, a spoofed installation ID, and a
wrong App ID fail closed.

### Token lifecycle

The GitHub user access token exists only inside the callback request. It is not
returned or persisted and is discarded after installation verification.

Repository listing creates a short-lived GitHub App JWT and then a short-lived
installation access token on the Worker. The installation token exists only for
that listing request, expires naturally, and is never returned or persisted.

The private key, client secret, Supabase service key, bearer tokens, and provider
tokens never enter browser JavaScript or database records.

## Worker Routes

| Method | Route | Responsibility |
| --- | --- | --- |
| `POST` | `/github/connect/start` | Authenticate the SmartFlow user and create setup state. |
| `GET` | `/github/connect/setup` | Consume setup state, record an untrusted installation claim, and start GitHub user authorization. |
| `GET` | `/github/connect/callback` | Verify the claim with a transient user token and persist verified metadata. |
| `GET` | `/github/connection` | Return only the authenticated user's bounded connection status. |
| `GET` | `/github/repositories` | Authenticate the user, mint an installation token, and return bounded repository metadata. |
| `POST` | `/github/disconnect` | Delete only the authenticated user's local SmartFlow mapping. |

Only `https://github.com` and `https://api.github.com` are valid provider
origins. Hostnames, REST paths, GraphQL queries, pagination, and installation
IDs cannot be supplied by the user or LLM.

Disconnect does not uninstall the GitHub App. The user manages installation and
repository access separately in GitHub settings.

## Routes Beyond Slice 1 Scope (GH-04, 2026-08-25)

The table above is Slice 1's original 6 routes. Code inspection
(`agent/worker/github-integration.ts`, GH-01/GH-02) confirms 10 additional
routes are implemented and live, none of which this doc originally
described. Five extend the read-only surface without a dedicated new ADR
— they follow the same read-only tool-registration checklist this doc
already defines under "Adding a New Read-only Tool"; four are governed by
ADR-0004 or ADR-0005; one (`code-proposals/approve`) is a SmartFlow-side
approval step that itself only calls GitHub to read, never to mutate.

| Method | Route | Purpose | Governing ADR |
| --- | --- | --- | --- |
| `GET` | `/github/repository-inventory` | Cached repository name/metadata inventory backing the tools below, avoiding a re-list of installation repositories on every call. | None dedicated — extends this doc's own read-only registration pattern. |
| `GET` | `/github/issues` | `github.issues.list` — list issues for a connected repository. | None dedicated — same pattern. |
| `GET` | `/github/epics` | `github.epics.list` — list epics (reuses the issues endpoint with `state=all` plus label filtering). | None dedicated — same pattern. |
| `GET` | `/github/pulls` | `github.pulls.list` — list open pull requests. | None dedicated — same pattern. |
| `GET` | `/github/workflow_runs` | `github.workflow_runs.list` — list recent Actions workflow runs. | None dedicated — same pattern. |
| `GET` | `/github/files/read` | Read a single file's contents; supports reviewing a code proposal before approval. | ADR-0005 (read leg of the code-write flow). |
| `POST` | `/github/issues/comment` | `github.issues.comment` — post a comment on an issue. | **ADR-0004** — reuses the `tasks.complete`-style write pipeline; ADR-0004 discloses that server-side approval enforcement is not implemented for this tool (browser-UX-only gate). |
| `PATCH` | `/github/issues/update` | `github.issues.update` — update issue fields (e.g. state, labels). | **ADR-0004** — same disclosed gap as above. |
| `POST` | `/github/code-proposals/approve` | Records a server-verified approval artifact (`agent_code_proposal_approvals`) for a pending file-write proposal. Calls GitHub only to read the current branch head for staleness checking; makes no GitHub mutation itself. | **ADR-0005**. |
| `POST` | `/github/files/update` | `github.files.update` — commit a single file change to a non-default branch, creating the branch first if needed. The only write route with genuine server-side approval enforcement (the Worker re-derives base SHA/content digest/risk level itself rather than trusting the browser). | **ADR-0005**. |

Both `github.issues.comment`/`github.issues.update` and `github.files.update`
share SmartFlow's standard write-execution pipeline
(`src/features/agent/writeRuntime.ts`'s `SUPPORTED_WRITE_TOOL_IDS`,
`executionPolicy.ts`, `agent_write_log` audit) — none of the three GitHub
write tools has a bespoke or weaker mechanism. There is no independent
kill switch for the write routes: `resolveConfig()` in
`github-integration.ts` gates the entire read+write route dispatch chain
in one place: registering the App with write permissions activates all
three write routes' code paths, since the write routes cannot be disabled
independently of the read routes short of not granting GitHub the write
scopes in the first place (see GH-02's finding and recommendation).

## Database Model and RLS

`public.github_connections` stores:

- generated row ID,
- verified SmartFlow user ID,
- verified installation ID,
- verified GitHub account ID,
- bounded GitHub account login,
- `connected` or `revoked` status,
- verification, creation, and update timestamps.

There is one connection per SmartFlow user and one SmartFlow mapping per GitHub
installation. Authenticated clients receive `SELECT` only and can read only rows
where `auth.uid() = user_id`. Browser insert, update, and delete privileges are
revoked. Finalization and replacement require the Worker's service role.

`public.github_connection_attempts` stores only bounded continuity metadata:

- attempt ID and SmartFlow user ID,
- setup and OAuth state hashes,
- the unverified installation claim,
- expiry and single-use timestamps.

RLS is enabled and all access is revoked from `anon` and `authenticated`; no
client policy exists. The table contains no provider credentials.

## Repository Result Contract

The Worker requests only page 1 with `per_page=20`. Every returned repository is
validated and reduced to:

- stable repository ID,
- name,
- owner/account label,
- `public`, `private`, or `internal` visibility,
- default branch,
- archived flag.

All strings and arrays are bounded. A malformed item fails the response rather
than being guessed or silently passed through. Raw GitHub responses and errors,
clone credentials, files, diffs, permissions, collaborators, and webhooks are
excluded.

## Agent Boundary

The Tool Registry contains one additive contract:

- tool ID: `github.repositories.list`
- intent: `inspect_github_repositories`
- domain: `github`
- capability and mode: `read`
- risk: `none`
- approval: not required, `view_only`
- external effect: false
- input: empty

The LLM may propose the intent, but deterministic validation, resolver mapping,
Execution Policy, the read-only runtime, and the explicit handler remain
authoritative. The handler receives authenticated identity only through its
runtime client. Execution Audit records shape/count metadata only and never
tokens or raw provider payloads.

## Adding a New Read-only Tool

This is a checklist of every place a new GitHub (or other domain) read-only
tool must be registered, gathered here because a miss in any one of them
fails silently rather than with an obvious error — especially the first item,
which is the easiest to miss and the hardest to debug: the tool simply never
gets proposed, with no exception anywhere.

1. `SUPPORTED_INTENT_VALUES` in `agent/worker/reasoning-endpoint.ts` — feeds
   the Gemini response schema's `type` enum for both `/agent/reason` and
   `/chat` reasoning mode. Miss this and Gemini's structured output is
   constrained to never include the new intent; there is no error, no log
   line, no failed request — the model simply cannot emit the value, and it
   silently resolves to something else or `ask_clarification`.
2. `supportedIntentTypes`, `intentToolMap`, `domainByIntent` in
   `src/features/agent/reasoning/intentValidator.ts` — the deterministic
   validator's own contract for the intent.
3. `TOOL_EVIDENCE_PATTERNS` in the same file, if the new tool shares a domain
   with an existing tool — otherwise the conflicting-evidence disambiguation
   (see below) can never distinguish it, and evidence-rescue always falls
   back to guessing or leaves the LLM's raw type unchecked.
4. `executableReadOnlyToolIds` in `src/features/agent/toolResolver.ts` and
   `SUPPORTED_READ_ONLY_TOOL_IDS` in `src/features/agent/readOnlyRuntime.ts`
   — both allowlists are checked independently; a tool present in one but not
   the other fails closed at whichever boundary is missing it.
5. The presentation layers: `readOnlyResultPresenter.ts` (safe summary/preview
   text), `responseComposer.ts` (EN/DE/FA copy), `contextSynthesis.ts`, and
   `reflectionEngine.ts`. Missing any of these does not error — the tool runs
   and returns data, but the user-facing response falls back to a generic
   "action completed" message instead of the tool's actual result.

Also required but not silent-failure-prone (a missing one causes an obvious
compile error, test failure, or unregistered handler): the tool definition in
`src/features/agent/tools/githubTools.ts`, a handler in
`src/features/agent/handlers/`, a browser client in
`src/features/integrations/github/`, the `AgentIntentType`/`toolId` unions in
`reasoningTypes.ts`, wiring the client into `ChatPage.tsx`'s execution
context, and i18n keys in `src/i18n/index.ts`.

New read-only GitHub tools do not need a new `WorkspacePlanActionType` or an
`explicitReadOnlyMappings` entry — the resolver trusts `expectedToolId` passed
directly from `intentToolMap` (see `toolResolver.ts`), bypassing the
domain+actionType lookup table entirely for intent-driven proposals.

## Configuration Contract

Non-secret Worker configuration:

- `GITHUB_APP_ID`
- `GITHUB_CLIENT_ID`
- `GITHUB_APP_SLUG`
- `GITHUB_SETUP_URL`
- `GITHUB_CALLBACK_URL`
- `GITHUB_ALLOWED_ORIGINS`

Worker secrets:

- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_CLIENT_SECRET`
- existing `SUPABASE_SERVICE_KEY`

Existing Supabase URL, public anon key, service key, and explicit allowed origins
form the server-only base configuration. The status and disconnect routes do not
require GitHub App credentials. Connection start verifies the Supabase bearer
token before missing provider configuration returns a safe `503`. No GitHub
credential uses a `VITE_` variable or belongs in `wrangler.toml`.

The tracked `.dev.vars.example` contains placeholders only. Real local values
belong in ignored `agent/worker/.dev.vars`.

## Environment Separation

Local QA must use a dedicated GitHub App and dedicated test account or
installation. Local callback URLs use loopback HTTP and work only while the
local Worker is reachable from the same browser.

Staging and production require separate GitHub Apps, HTTPS Worker URLs, explicit
frontend origins, separately provisioned secrets, and separate Supabase
environments. Credentials and installation mappings must never be shared across
environments.

GitHub Remote is the only provider boundary in Slice 1. A future Local Bridge is
a separate architecture and is not implemented, inferred, or proxied here.

## Failure Behavior

Authentication, configuration, state, ownership, App identity, provider status,
timeout, malformed response, and storage failures are normalized to bounded
errors. Provider bodies are never forwarded. There is no retry, fallback,
automatic reconnect, callback execution, or autonomous tool chain.

## Testing Status

Mocked tests cover connection authentication, state expiry/binding/replay,
spoofed and wrong-App installations, inaccessible installations, transient token
handling, cross-user ownership, configuration failure, repository ownership,
result bounding/sanitization, provider status normalization, timeout, malformed
responses, no retry, bounded connection status, disconnect, browser transport,
all connection UI states, English/German/Persian copy, Persian RTL markup, and
the complete deterministic agent path.

Current automated results are 24 Worker tests, 19 frontend client/UI tests,
4 migration/type-structure tests, and 5 live local Supabase RLS/lifecycle
tests. The full default repository suite passes 474 tests and intentionally
skips the 5 environment-gated live-RLS tests; those 5 pass when run explicitly
against the local stack.

**Corrected 2026-08-25 (GH-04, sourced from GH-01's fresh live test run):**
the counts above are Slice 1's original counts as of 2026-07-22 and
undersell the surface actually built by roughly 5-6x — they predate the
10 routes documented above under "Routes Beyond Slice 1 Scope." Re-run
2026-08-24/25: `agent/worker/github-integration.test.ts` alone passes
**139** Worker tests (not 24); the frontend GitHub client/UI test files
pass **115** tests across 20 files (not 19); `supabase/tests/
github_read_only_connections.test.ts` plus its `.rls.test.ts` companion
still match the original counts exactly — 4 migration/type-structure
tests and 5 live-RLS tests (still skipped by default, still passing when
run explicitly against the local stack). The whole-repository default
suite total has also grown well past the 474 figure above — 3752
passed/76 skipped/0 failed as of the most recent full-suite run recorded
elsewhere in `PROJECT_STATUS.md` (TITLE-01) — but that number covers the
entire repository, not GitHub specifically, and is not re-derived here.

The complete migration history was replayed successfully on a clean local
Supabase database. Live tests with two real local users verify own-row reads,
cross-user isolation, denied browser mutations, service-only attempts, unique
installation ownership, expiry, callback consumption/replay protection, and
verified callback persistence. Canonical Supabase TypeScript contracts include
both GitHub tables without unrelated generated drift.

An authenticated local Worker lifecycle smoke verified unauthenticated denial,
not-connected status, fail-closed missing App configuration, bounded connected
status, cross-user disconnect isolation, owner disconnect, and return to the
not-connected state. The in-app browser backend was unavailable in the current
execution environment, so live visual Settings/Integrations browser QA remains
pending and is not represented as passed.

No real GitHub request, App registration, installation, or authenticated GitHub
QA has been performed. The slice must not be marked complete until that manual
prerequisite and QA pass.

**Superseded 2026-08-25 (GH-04):** this manual prerequisite has been
completed. PO confirmed GitHub App "SmartFlow Agent" (read-only
permissions) is registered, connected to account `aryanbarak`, and the
deployed Worker successfully lists real repositories in production.

## Manual GitHub App Registration Checklist

Use this checklist after local implementation review. Do not send credentials
through chat or commit them.

1. Register a dedicated App with proposed name `SmartFlow Read-only QA - Aryan`
   or another globally unique QA-only name.
2. Set Homepage URL to `https://github.com/aryanbarak/smartflow` for the QA App.
3. Set Setup URL to `http://127.0.0.1:8787/github/connect/setup` for local QA.
4. Enable user authorization and set callback URL to
   `http://127.0.0.1:8787/github/connect/callback`.
5. Disable webhooks for Slice 1.
6. Request no repository permission beyond GitHub's automatically granted
   read-only Metadata permission.
7. Request no account or organization permissions.
8. Limit installation to the dedicated QA owner/account.
9. Select only dedicated non-sensitive QA repositories; do not grant all
   repositories.
10. Generate a private key and configure it only as
    `GITHUB_APP_PRIVATE_KEY` in the local Worker secret file.
11. Configure the generated client secret only as `GITHUB_CLIENT_SECRET`.
12. Configure App ID, Client ID, App slug, setup URL, callback URL, and explicit
    local frontend origins with the non-secret names above.
13. Start local Supabase, apply the migration, start the Worker, and start the
    frontend before initiating the connection.
14. Verify one authenticated connection, repository listing, disconnect, replay
    rejection, and cross-user isolation using synthetic QA data only.
15. Register separate staging/production Apps later with HTTPS callbacks and
    environment-specific secrets. Do not reuse the local QA App.

**Note (GH-04, 2026-08-25):** item 6 above ("no repository permission
beyond ... Metadata") reflects Slice 1's original read-only-repositories-
only plan. The App as actually registered and confirmed live grants more
than Metadata alone, because the read surface itself grew (see "Routes
Beyond Slice 1 Scope" above) before registration happened — see GH-02's
permission analysis for the full Issues/Contents/Pull requests/Actions
breakdown of what a read-only registration needs versus what the write
routes would additionally require if ever granted.

## References

- [GitHub App installation flow](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url)
- [GitHub App setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url)
- [Get an installation for the authenticated user](https://docs.github.com/en/rest/apps/installations#get-an-app-installation-for-the-authenticated-user)
- [Create an installation access token](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app)
- [List repositories accessible to an installation](https://docs.github.com/en/rest/apps/installations#list-repositories-accessible-to-the-app-installation)
- [Documentation Standard v1.0](../standards/DOCUMENTATION_STANDARD_V1.0.md)
