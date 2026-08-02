// Static boundary tests: prove ProjectRecord stays outside execution
// authority by scanning its own source text, the same technique this
// repository already uses for migration/type boundary checks (see
// supabase/tests/github_read_only_connections.test.ts). A runtime mock
// cannot prove an import was never made; the source text can.
//
// These checks only inspect `import` statements and actual API-call syntax
// (e.g. `localStorage.`), not prose -- the modules' own doc comments
// legitimately name "approval", "execution intent", and "localStorage" to
// explain what they deliberately exclude, and that documentation is not
// itself a boundary violation.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MODULE_FILES = [
  "projectRecordTypes.ts",
  "projectRecordValidation.ts",
  "projectRecordRepository.ts",
  "projectRecordService.ts",
] as const;

function readModule(fileName: string): string {
  return readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
}

function importLines(source: string): string[] {
  return source.split(/\r?\n/).filter((line) => /^\s*import\b/.test(line));
}

describe("ProjectRecord execution and authority boundaries", () => {
  it("never imports the agent/execution/tool/approval layer", () => {
    for (const file of MODULE_FILES) {
      for (const line of importLines(readModule(file))) {
        expect(line).not.toMatch(/features\/agent/);
        expect(line).not.toMatch(/approval/i);
      }
    }
  });

  it("never imports or calls the ProjectContext builder", () => {
    for (const file of MODULE_FILES) {
      const source = readModule(file);
      for (const line of importLines(source)) {
        expect(line).not.toMatch(/projectContextBuilder/);
      }
      expect(source).not.toMatch(/buildProjectContext\s*\(/);
    }
  });

  it("never calls browser storage APIs", () => {
    for (const file of MODULE_FILES) {
      expect(readModule(file)).not.toMatch(/\b(localStorage|sessionStorage)\s*\./);
    }
  });

  it("never imports an LLM/AI provider module", () => {
    for (const file of MODULE_FILES) {
      for (const line of importLines(readModule(file))) {
        expect(line).not.toMatch(/gemini/i);
        expect(line).not.toMatch(/llmReasoning/i);
        expect(line).not.toMatch(/learn-ai|ai-memory/i);
      }
    }
  });

  it("the repository module is the only one that imports the Supabase client, and the service only for auth", () => {
    expect(readModule("projectRecordTypes.ts")).not.toMatch(/integrations\/supabase/);
    expect(readModule("projectRecordValidation.ts")).not.toMatch(/integrations\/supabase/);
    expect(readModule("projectRecordRepository.ts")).toMatch(/integrations\/supabase\/client/);
    // The service resolves the authenticated owner via Supabase Auth directly
    // (mirroring journalService.ts) but performs no other Supabase call itself.
    const serviceSource = readModule("projectRecordService.ts");
    expect(serviceSource).toMatch(/integrations\/supabase\/client/);
    expect(serviceSource).not.toMatch(/supabase\s*\.\s*from\s*\(/);
  });
});
