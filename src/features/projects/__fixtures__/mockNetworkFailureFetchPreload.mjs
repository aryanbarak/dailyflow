// CI-01b: sibling of mockUnauthenticatedFetchPreload.mjs -- see that file's
// own header comment for why a Node `--import` preload is the correct
// injection mechanism for the REAL spawned CLI process these tests exercise.
//
// This one simulates a genuine network-level failure (what a real
// ECONNREFUSED/DNS failure/timeout looks like from fetch()'s own
// perspective: a REJECTED promise, not a resolved error Response) for the
// Supabase Auth /user request, so the NETWORK_UNAVAILABLE/exit-6 path can
// be proven deterministically without depending on any real port being
// free or occupied.
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("/auth/v1/user")) {
    const err = new TypeError("fetch failed");
    err.cause = { code: "ECONNREFUSED", address: "127.0.0.1", port: 54321 };
    throw err;
  }
  return originalFetch(input, init);
};
