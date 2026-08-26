// Fake "claude" that never finishes in time — used to test timeout enforcement.
setTimeout(() => {
  process.stdout.write(JSON.stringify({ is_error: false, result: "too late" }));
}, 10_000);
