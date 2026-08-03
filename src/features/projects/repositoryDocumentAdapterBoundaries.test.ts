// Static boundary tests for the Repository Documents Adapter: prove it stays
// outside execution authority, LLM/provider integration, UI, and Smart
// Automation, and that it never writes to the repository or shells out --
// by scanning its own source text, mirroring
// projectEvidenceBoundaries.test.ts's technique. A runtime mock cannot prove
// an import was never made or a write call never constructed; the source
// text can.
//
// These checks only inspect `import` statements and actual API-call syntax,
// not prose -- the modules' own doc comments legitimately name "adapter",
// "LLM", "Context Rebuild", etc. to explain what they deliberately exclude,
// and that documentation is not itself a boundary violation.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MODULE_FILES = [
  "repositoryDocumentAdapterTypes.ts",
  "repositoryDocumentPathSecurity.ts",
  "repositoryDocumentFileReader.ts",
  "repositoryDocumentAdapter.ts",
] as const;

function readModule(fileName: string): string {
  return readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
}

function importLines(source: string): string[] {
  return source.split(/\r?\n/).filter((line) => /^\s*import\b/.test(line));
}

describe("Repository Documents Adapter boundaries", () => {
  it("never imports the agent/execution/tool/approval layer", () => {
    for (const file of MODULE_FILES) {
      for (const line of importLines(readModule(file))) {
        expect(line).not.toMatch(/features\/agent/);
        expect(line).not.toMatch(/approval/i);
      }
    }
  });

  it("never imports or calls the ProjectContext builder, and never triggers Context Rebuild", () => {
    for (const file of MODULE_FILES) {
      const source = readModule(file);
      for (const line of importLines(source)) {
        expect(line).not.toMatch(/projectContextBuilder/);
      }
      expect(source).not.toMatch(/buildProjectContext\s*\(/);
      expect(source).not.toMatch(/contextRebuild/i);
    }
  });

  it("never imports Smart Automation", () => {
    for (const file of MODULE_FILES) {
      for (const line of importLines(readModule(file))) {
        expect(line).not.toMatch(/smart[\s-]?automation/i);
      }
    }
  });

  it("never imports an LLM/AI provider module or calls one", () => {
    for (const file of MODULE_FILES) {
      const source = readModule(file);
      for (const line of importLines(source)) {
        expect(line).not.toMatch(/gemini/i);
        expect(line).not.toMatch(/llmReasoning/i);
        expect(line).not.toMatch(/learn-ai|ai-memory/i);
      }
    }
  });

  it("never imports the GitHub API integration", () => {
    for (const file of MODULE_FILES) {
      for (const line of importLines(readModule(file))) {
        expect(line).not.toMatch(/integrations\/github/i);
      }
    }
  });

  it("never imports Gmail, Calendar, or Slack", () => {
    for (const file of MODULE_FILES) {
      for (const line of importLines(readModule(file))) {
        expect(line).not.toMatch(/gmail|calendar|slack/i);
      }
    }
  });

  it("never calls browser storage APIs", () => {
    for (const file of MODULE_FILES) {
      expect(readModule(file)).not.toMatch(/\b(localStorage|sessionStorage)\s*\./);
    }
  });

  it("never imports UI, React, or a component module", () => {
    for (const file of MODULE_FILES) {
      for (const line of importLines(readModule(file))) {
        expect(line).not.toMatch(/\breact\b/i);
        expect(line).not.toMatch(/\.tsx["']/);
        expect(line).not.toMatch(/components\//);
      }
    }
  });

  it("never imports or invokes a child process, and never shells out", () => {
    for (const file of MODULE_FILES) {
      const source = readModule(file);
      for (const line of importLines(source)) {
        expect(line).not.toMatch(/child_process/);
      }
      expect(source).not.toMatch(/execFileSync|execSync|spawn\s*\(|(?<!\.)\bexec\s*\(/);
    }
  });

  it("never writes to the repository: no fs write/mutation call anywhere in the adapter's own modules", () => {
    for (const file of MODULE_FILES) {
      const source = readModule(file);
      expect(source).not.toMatch(/fs\.(writeFile|appendFile|unlink|rm|rmdir|mkdir|rename|chmod|chown|truncate|symlink|copyFile)/);
    }
  });

  it("never writes directly through the ProjectEvidence repository or the Supabase client", () => {
    const adapterSource = readModule("repositoryDocumentAdapter.ts");
    expect(adapterSource).not.toMatch(/supabase\s*\.\s*from\s*\(/);
    expect(adapterSource).not.toMatch(/\.insert\s*\(/); // persistence happens exclusively via evidenceService.create(...)
    for (const line of importLines(adapterSource)) {
      expect(line).not.toMatch(/integrations\/supabase/);
      expect(line).not.toMatch(/from ["']\.\/projectEvidenceRepository["']/);
    }
  });

  it("the orchestration module calls the existing ProjectEvidence service, never bypassing it", () => {
    const adapterSource = readModule("repositoryDocumentAdapter.ts");
    expect(adapterSource).toMatch(/from ["']\.\/projectEvidenceService["']/);
    expect(adapterSource).toMatch(/evidenceService\.create\s*\(/);
    expect(adapterSource).toMatch(/evidenceService\.listByProject\s*\(/);
  });

  it("the path-security and file-reader modules never import the ProjectEvidence service or repository", () => {
    for (const file of ["repositoryDocumentPathSecurity.ts", "repositoryDocumentFileReader.ts"] as const) {
      const source = readModule(file);
      for (const line of importLines(source)) {
        expect(line).not.toMatch(/projectEvidenceService|projectEvidenceRepository/);
      }
    }
  });

  it("the path-security module performs no I/O of any kind", () => {
    const source = readModule("repositoryDocumentPathSecurity.ts");
    for (const line of importLines(source)) {
      expect(line).not.toMatch(/node:fs|node:path|node:child_process|node:crypto/);
    }
  });

  it("never derives execution authority: no ExecutionIntent reference and no approval issuance", () => {
    for (const file of MODULE_FILES) {
      const source = readModule(file);
      for (const line of importLines(source)) {
        expect(line).not.toMatch(/executionIntent/i);
      }
      expect(source).not.toMatch(/ExecutionIntent/);
    }
  });
});
