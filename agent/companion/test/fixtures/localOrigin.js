import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFile = promisify(execFileCb);

/**
 * Creates a throwaway local bare repo (acting as "GitHub") with one commit
 * on main, plus a plain non-bare seed clone used only to push that first
 * commit. Tests use the returned `gitRemoteBase`/`repo` pair with
 * `remoteUrlFor` exactly as production uses a GitHub owner/name pair, so
 * companion code under test is exercised unmodified against a real git
 * repository, over the local filesystem instead of the network.
 */
export async function createLocalOrigin() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "companion-test-origin-"));
  const bareDir = path.join(root, "origin.git");
  const seedDir = path.join(root, "seed");

  await execFile("git", ["init", "--bare", "-b", "main", bareDir]);
  await execFile("git", ["clone", bareDir, seedDir]);
  await execFile("git", ["config", "user.email", "test@example.com"], { cwd: seedDir });
  await execFile("git", ["config", "user.name", "Companion Test"], { cwd: seedDir });
  await fs.writeFile(path.join(seedDir, "README.md"), "# test repo\n");
  await execFile("git", ["add", "-A"], { cwd: seedDir });
  await execFile("git", ["commit", "-m", "initial commit"], { cwd: seedDir });
  await execFile("git", ["push", "origin", "main"], { cwd: seedDir });

  return {
    gitRemoteBase: root,
    repo: "origin.git",
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
