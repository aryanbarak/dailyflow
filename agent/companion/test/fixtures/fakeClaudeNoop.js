// Fake "claude" that CLAIMS success but makes no file changes at all — used
// to test that independent verification catches a self-report that ground
// truth does not back up.
process.stdout.write(
  JSON.stringify({
    is_error: false,
    total_cost_usd: 0,
    session_id: "fake-session-noop",
    num_turns: 1,
    result: "Done! I made the requested change.",
  }),
);
