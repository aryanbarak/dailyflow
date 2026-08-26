// Fake "claude" binary for tests: actually edits a file in cwd, then prints
// output shaped like `claude -p ... --output-format json`.
import fs from "node:fs";
import path from "node:path";

const target = path.join(process.cwd(), "NOTE.md");
fs.writeFileSync(target, "Added by fake Claude Code for a companion test.\n");

process.stdout.write(
  JSON.stringify({
    is_error: false,
    total_cost_usd: 0,
    session_id: "fake-session",
    num_turns: 1,
    result: "Created NOTE.md as requested.",
  }),
);
