// CI-01b: a network-level fetch failure (ECONNREFUSED, DNS failure,
// timeout, TLS error, ...) reaching @supabase/auth-js's own internal
// request helper triggers a raw `console.error(e)` call BEFORE that
// library converts the failure into a clean, structured error --
// node_modules/@supabase/auth-js/src/lib/fetch.ts's `_handleRequest`:
//
//   try {
//     result = await fetcher(url, { ...requestParams })
//   } catch (e) {
//     console.error(e)                                    // <-- the leak
//     throw new AuthRetryableFetchError(_getErrorMessage(e), 0)
//   }
//
// That `console.error(e)` prints the full raw Error object -- stack trace,
// file paths, and (for a Node `fetch` TypeError) the wrapped `cause` with
// connection details -- directly to this process's stderr, independent of
// and before any of this CLI's own try/catch/sanitization logic runs. It
// is third-party SDK code, not a bug in this repo's own CLI scripts --
// but the CLI scripts (scripts/smartflow-refresh-project.ts,
// scripts/smartflow-create-project.ts) are what makes stderr sanitization
// a promised contract (see their own *CliActual.test.ts assertions), so
// they are responsible for not letting a dependency violate it.
//
// The fix is a custom `fetch` passed to `createClient()`'s `global.fetch`
// option: `fetcher(url, ...)` above is whatever function we pass in, so if
// OUR fetch wrapper never REJECTS -- even on a real network failure --
// auth-js's own catch block (and its console.error) is never reached at
// all. Instead we resolve to a synthetic Response with a 5xx status,
// which auth-js's `handleError` already has an existing, already-tested,
// already-sanitized code path for (NETWORK_ERROR_CODES, node_modules/
// @supabase/auth-js/src/lib/fetch.ts:38,45-48) -- the SAME path a real
// upstream 5xx from Supabase itself would take, converted into a resolved
// `AuthRetryableFetchError`, which `_getUser`'s own catch (GoTrueClient.ts
// :1765-1776) already correctly treats as `isAuthError` and returns as a
// normal `{ data, error }` result rather than throwing further.
//
// Applies to every request the Supabase client makes (auth AND
// postgrest-js REST calls both read `global.fetch`), not just getUser --
// deliberately, since any of them could hit the same underlying SDK
// pattern for a network failure.
//
// Lives in src/features/projects/ (not scripts/, where its two callers
// live) so it can be unit tested -- vite.config.ts's vitest `test.exclude`
// excludes `scripts/**` entirely (that directory holds CLI entry points
// with side-effecting top-level `main().then(...)` calls, never meant to
// be collected as test suites), matching this codebase's own existing
// convention of the CLI scripts importing their real, testable logic from
// src/features/projects/ rather than inlining it.
export function createSanitizedFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      return await baseFetch(input, init)
    } catch {
      // Deliberately a fixed, bounded message -- never the caught error's
      // own .message/.cause, so nothing about the underlying fetch
      // implementation's error shape (host, port, internal file paths)
      // can ever end up in a Response body a caller might log or surface.
      return new Response(
        JSON.stringify({ error: 'network_error', error_description: 'Unable to reach the Supabase project.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      )
    }
  }) as typeof fetch
}
