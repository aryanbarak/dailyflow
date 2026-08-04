# Local Supabase QA

This workflow exists only for authenticated browser QA against a local Supabase stack. It must not be used against the production Supabase project.

## Start Local Supabase

```bash
supabase start
```

Use only the local URLs printed by the CLI, normally `http://127.0.0.1:54321`.

## Run The App Against Local Supabase

`npm run dev` requires `VITE_SMARTFLOW_SUPABASE_MODE` to be set explicitly --
it fails closed with a configuration error if the variable is unset, rather
than defaulting to production. This only applies to `npm run dev`; a
deployed/built bundle (Cloudflare Pages) still defaults to production when
the variable is absent, so no deployment configuration changes are needed.

Set browser-safe Vite values before starting the dev server:

```bash
VITE_SMARTFLOW_SUPABASE_MODE=local-qa
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<local anon key from supabase start>
npm run dev
```

On Windows PowerShell:

```powershell
$env:VITE_SMARTFLOW_SUPABASE_MODE = "local-qa"
$env:VITE_SUPABASE_URL = "http://127.0.0.1:54321"
$env:VITE_SUPABASE_ANON_KEY = "<local anon key from supabase start>"
npm run dev
```

Local QA mode fails closed if the URL is not loopback or if the anon key is
missing.

To deliberately run the dev server against the real production database
instead (rare -- only when you explicitly mean to), opt in explicitly:

```bash
VITE_SMARTFLOW_SUPABASE_MODE=production
npm run dev
```

```powershell
$env:VITE_SMARTFLOW_SUPABASE_MODE = "production"
npm run dev
```

## Seed A Named Scenario

The seed script requires local-only server-side values from the shell. Do not put service-role keys in tracked files.

```bash
SUPABASE_LOCAL_URL=http://127.0.0.1:54321
SUPABASE_LOCAL_ANON_KEY=<local anon key>
SUPABASE_LOCAL_SERVICE_ROLE_KEY=<local service role key>
SMARTFLOW_LOCAL_QA_PASSWORD=<local password>
npm run qa:seed -- --scenario workspace-rich --verify-rls
```

Supported scenarios:

- `empty`
- `tasks-basic`
- `workspace-rich`

`empty` means empty for the authenticated browser-QA state that can affect ARUX validation:
chat sessions/messages, agent briefings, learning messages, calendar events, finance transactions,
documents metadata, tasks, profile, and user settings. It is not a global wipe of every SmartFlow
feature domain.

The script derives date-sensitive fixtures from the current local date at runtime, including today, tomorrow, current-day calendar events, and completed-this-week task data.

Reset and fixture writes fail closed. If any ARUX-relevant table cannot be reset, verified empty, or seeded, the script stops with a non-zero exit code and must not be treated as a valid QA state.

## Local QA Login

Default email:

```text
smartflow-local-qa@example.com
```

Use the password supplied through `SMARTFLOW_LOCAL_QA_PASSWORD`.

## Safety Guards

- The seed script refuses non-loopback Supabase URLs.
- Local URLs must be plain loopback `http` origins without username, password, path, query, or hash.
- The browser never receives a service-role key.
- The app never silently falls back from local QA mode to production.
- The script resets only the isolated local QA user data for the ARUX-relevant tables listed above.
- `--verify-rls` confirms another local user cannot read the seeded user's task rows.

## Migration History Warning

The local compatibility migrations reconstruct schema that was previously manual or missing from clean local replay. Their historical ordering is required for a fresh local Supabase stack because later migrations depend on those tables/functions.

Do not blindly push, repair, or reset a remote production database with these files. Production migration history must be audited and reconciled separately before any remote migration operation.

## Stop Local Supabase

```bash
supabase stop
```
