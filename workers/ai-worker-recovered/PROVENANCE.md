# Provenance — recovered `dailyflow-ai-worker` source

## What this is

`index.js` in this directory is the **actual deployed production script**, recovered
directly from the Cloudflare account — not reconstructed, not guessed, not copied from
either local candidate repo (`smartflow-ai-worker/`, `smartflow-tutor-api-worker/`),
both of which were verified during the Phase-1 audit to be byte-identical copies of the
*tutor* worker and contain none of the routes this Worker actually serves.

Per the audit's own canonical rule ("the currently routed production Worker defines
expected production behavior"), **this file is the behavior baseline** for `/analyze`,
`/import-bank`, `/ocr`, `/photos/*`, `/translate`, `/tts`, `/tts-azure`, and the
production `/search` implementation — not source-inference, not the local repos.

## Recovery details

| Field | Value |
|---|---|
| Cloudflare Worker (script) name | `dailyflow-ai-worker` |
| Account ID | `963288cef04d64c743cc3d4c3260333a` |
| Recovered on | 2026-08-16 (this session) |
| Recovery method | `npx wrangler init --from-dash dailyflow-ai-worker` was attempted first and **crashed** on this Windows host during the `create-cloudflare` scaffolding step (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`, exit 3221226505) before it fetched any real content — it only produced a generic "Hello World" template, which was discarded (never committed). **Fell back to a direct, read-only Cloudflare REST API pull**: `GET /accounts/{account_id}/workers/scripts/dailyflow-ai-worker`, using the same OAuth credential wrangler itself was already authenticated with (`wrangler whoami` confirmed the session; no separate login or token was created for this). Response was `multipart/form-data`; the single `index.js` part was extracted and written verbatim (no edits, no reformatting, no comments added). |
| Cloudflare version ID (latest, at time of pull) | `775fa0b1-5874-4a72-b623-0b3c132ec807` (version number 73) |
| Version created_on | 2026-06-30T03:13:48.357Z |
| Version source | `wrangler` (i.e. last shipped via `wrangler deploy`, not the dashboard editor) |
| Version author | `barakzahi@web.de` |
| Script `modified_on` (from scripts list) | 2026-06-30T03:13:50.067408Z — consistent with the version timestamp above |

Raw evidence backing the table above is kept in `_raw/`:
- `_raw/content_headers.txt` — the actual HTTP response headers from the content pull (shows `Content-Type: multipart/form-data; boundary=...`).
- _raw/content_response.bin — removed 2026-08-16 after extraction (duplicated index.js byte-for-byte; sha256 of index.js recorded below covers integrity)
- `_raw/versions.json` — the full version-history response (10 most recent of 73 total versions), source of the version ID/timestamp above.

## What was explicitly NOT done

- No route, DNS, or deploy change of any kind.
- No secret values were requested, read, or printed. Cloudflare Worker secrets are
  write-only via the API used here; only **binding/secret names** as referenced in the
  code (`env.X`) were inventoried — see the audit report for that list.
- The failed `--from-dash` scaffold directory (generic Hello World template) was deleted
  immediately after being identified as non-authoritative; it was never staged or committed.
- Nothing in this directory has been edited since the pull.

## Integrity

SHA256 (index.js): c26fda0cb7f634f72e36ac9b58ca6d9ef0e76817673698c96c1102cd04ff1fa6
Size: 39135 bytes
Recorded: 2026-08-16
Any future mismatch of this hash means the file is no longer the byte-exact
production copy and must not be treated as the canonical baseline.

## Modifications after recovery

**2026-08-16 (task 26):** `index.js` was intentionally edited — this breaks the
integrity hash above **by design**, not by accident. The original SHA256 in the
Integrity section remains the recovery baseline (proof of what was actually live
in production as of version 73 / 775fa0b1) and must not be updated or replaced.

Change made: replaced the static `ALLOWED_ORIGIN = "https://barakzai.cloud"`
constant with an `ALLOWED_ORIGINS` allow-list (`smartaryn.com`, `www.smartaryn.com`,
`barakzai.cloud`, `www.barakzai.cloud`, plus existing `localhost` regex), so
`corsHeaders()` echoes the request's own `Origin` when allowed instead of always
returning the single hardcoded string. No other line was touched. Full diff is in
the task 26 report / `git diff`.

SHA256 (index.js) after this change: 1b4b6311bb0c3fc348b404c3fba6890ae82dee3a9658cd25cd4a44b800892a14
Size after this change: 39252 bytes
