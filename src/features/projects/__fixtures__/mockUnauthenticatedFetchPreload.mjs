// CI-01b: loaded via `NODE_OPTIONS=--import <file:// URL of this file>` when
// spawning localProjectRefreshCliActual.test.ts's / createProjectCliActual
// .test.ts's "dummy configured invalid token" cases -- these tests spawn the
// REAL CLI as a separate OS process (see runCli's own spawnSync call), so a
// vitest-level `vi.fn()`/`vi.mock()` mock in the PARENT test process cannot
// reach it; Node's own `--import` preload mechanism is what runs INSIDE that
// child process, before the CLI script's own top-level code, and is the
// standard way to intercept a global in a process you don't otherwise
// control the module graph of.
//
// Deliberately intercepts ONLY the Supabase Auth `/user` endpoint and always
// returns a 401 (an "invalid/expired token" response, the exact scenario
// these two tests exist to prove is sanitized) -- every other request
// (including SMARTFLOW's own CliSupabaseEnvironmentGate reachability probe,
// if one is ever added) falls through to the real global fetch unchanged.
// This is a plain, dependency-free ESM script (not a .ts file) because
// `--import` runs it with Node's native loader, before vite-node's own TS
// transform is ever registered.
//
// No real network reaches this endpoint at all when this preload is active
// -- the CLI's own `SMARTFLOW_SUPABASE_URL` in these tests can point at any
// syntactically-loopback URL; nothing is ever actually connected to.
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("/auth/v1/user")) {
    return new Response(
      JSON.stringify({ code: 401, error_code: "bad_jwt", msg: "invalid JWT: token is malformed" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }
  return originalFetch(input, init);
};
