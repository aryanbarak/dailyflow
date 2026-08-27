import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

// flowWritePermissions.ts imports the Supabase client for its browser
// read/write helpers; the pure default function under test touches none of
// it. Same stub ChatPage.test.tsx uses; must precede the imports below.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: vi.fn() }, from: vi.fn() },
}));

import { writeIntentRegistry } from "../../../shared/writeIntentRegistry";
import { defaultFlowWritePermissionMode } from "./flowWritePermissions";

// ADR-0019 Known Hazard 1 / INC-02 (GitHub #188).
//
// The write-policy default exists TWICE: defaultFlowWriteMode in the Worker
// and defaultFlowWritePermissionMode in the browser -- the same logic in
// two files, because agent/worker is an independently bundled deployable
// whose own tsconfig states "nothing else needs to reach outside this
// directory."
//
// Nothing enforced their agreement until now, and the failure they permit
// is quiet and specifically bad: Settings renders the CLIENT default while
// the Worker enforces its own, so a divergence shows the user a policy the
// system does not apply. Same shape as INC-01/INC-02/OBS-01 -- the system
// reporting one thing and doing another.
//
// WHY THIS READS SOURCE RATHER THAN IMPORTING THE WORKER FUNCTION:
// importing agent/worker from src/ drags the Cloudflare ambient types
// (`Ai`, from worker-configuration.d.ts) into the src typecheck, which
// fails with TS2304 -- the two runtimes deliberately do not share a type
// environment. Reading the other runtime's source is the convention this
// repo already uses for exactly this cross-runtime duplication problem
// (see unavailableCause.test.ts, which pins the Worker's duplicated cause
// literals the same way).
//
// So: the CLIENT function is exercised for real, behaviourally; the WORKER
// function is pinned structurally here and exercised for real in its own
// runtime's tests (flow-write-policy.test.ts, "INC-02: clamps reversible
// task create/update to ask"). Neither half is sufficient alone.
describe("flow-write default parity (Worker <-> client)", () => {
  // Resolved from THIS FILE, never process.cwd() -- the working directory
  // is a property of how the runner was invoked, not of where the source
  // lives.
  function readSource(relativeFromRepoRoot: string): string {
    return readFileSync(fileURLToPath(new URL(`../../../${relativeFromRepoRoot}`, import.meta.url)), "utf8");
  }

  /** The body of a named function, from its opening brace to the first column-0 close. */
  function functionBody(source: string, signatureStart: string): string {
    const start = source.indexOf(signatureStart);
    expect(start, `could not find ${signatureStart}`).toBeGreaterThan(-1);
    const open = source.indexOf("{", start);
    const close = source.indexOf("\n}", open);
    expect(close, `could not find the end of ${signatureStart}`).toBeGreaterThan(open);
    return source.slice(open + 1, close);
  }

  // Erases everything the two runtimes legitimately differ on -- quote
  // style, semicolons, single-statement braces, indentation, comments --
  // leaving only the RULES. A divergence in behaviour cannot survive this;
  // a divergence in formatting cannot trip it.
  function normalizeRules(body: string): string {
    return body
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/["']/g, "'")
      .replace(/[;{}]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const workerRules = normalizeRules(
    functionBody(
      readSource("agent/worker/flow-write-policy.ts"),
      "export function defaultFlowWriteMode(",
    ),
  );
  const clientRules = normalizeRules(
    functionBody(
      readSource("src/features/agent/flowWritePermissions.ts"),
      "export function defaultFlowWritePermissionMode(",
    ),
  );

  it("encodes identical rules in both runtimes", () => {
    expect(workerRules).toBe(clientRules);
  });

  // Pins what those rules actually ARE, so parity cannot be satisfied by
  // changing both sides together. This is the assertion that fails when
  // INC-02's clamp is undone -- deliberately. Retire it only alongside the
  // exit condition recorded at both constants: ENG-07 (GitHub #185) Part A
  // abort plumbing AND Part B recovery surface.
  it("INC-02: the shared rules clamp every path to ask, with no auto branch", () => {
    expect(workerRules).toContain("return 'ask'");
    expect(workerRules).not.toContain("return 'auto'");
    expect(clientRules).not.toContain("return 'auto'");
    // 'off' would also be non-auto, and would silently disable writes
    // rather than confirm them. INC-02 asks for confirmation, not removal.
    expect(workerRules).not.toContain("return 'off'");
    expect(clientRules).not.toContain("return 'off'");
  });

  // The client half, exercised for real rather than read. Every (domain,
  // action) the registry produces -- so a new capability is covered the
  // moment it is registered -- plus the paths no entry exercises today.
  const ALL_PAIRS = [
    ...writeIntentRegistry.map((entry) => [entry.domain, entry.action] as const),
    ["tasks", "delete"],
    ["calendar", "delete"],
    ["finance", "delete"],
    ["finance", "update"],
    ["engineering", "propose"],
    ["unknown_domain", "create"],
    ["", ""],
  ] as const;

  it.each(ALL_PAIRS)("client default for (%s, %s) is ask", (domain, action) => {
    expect(defaultFlowWritePermissionMode(domain, action)).toBe("ask");
  });

  it("INC-02: no registry capability auto-executes while the clamp stands", () => {
    for (const entry of writeIntentRegistry) {
      expect(defaultFlowWritePermissionMode(entry.domain, entry.action)).not.toBe("auto");
    }
  });
});
