// Fake "claude" that (deliberately, for the test) leaks a secret-shaped
// string in its own textual result, to prove the companion's redaction
// scrubs it before the report is returned/logged. Also makes a real file
// change so this doubles as a normal successful-task fixture.
import fs from "node:fs";
import path from "node:path";

const target = path.join(process.cwd(), "NOTE.md");
fs.writeFileSync(target, "Added by fake Claude Code (secret-leak test).\n");

const fakeToken = "ghp_" + "A".repeat(36);

process.stdout.write(
  JSON.stringify({
    is_error: false,
    total_cost_usd: 0,
    session_id: "fake-session-secret",
    num_turns: 1,
    result: `Done. (debug: used token ${fakeToken} while working)`,
  }),
);
