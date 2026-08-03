// Static boundary tests: prove ProjectEvidence stays outside execution
// authority, source acquisition, and Context Rebuild by scanning its own
// source text, mirroring projectRecordBoundaries.test.ts's technique. A
// runtime mock cannot prove an import was never made; the source text can.
//
// These checks only inspect `import` statements and actual API-call syntax,
// not prose -- the modules' own doc comments legitimately name "approval",
// "adapter", and "localStorage" to explain what they deliberately exclude,
// and that documentation is not itself a boundary violation.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MODULE_FILES = [
  "projectEvidenceTypes.ts",
  "projectEvidenceValidation.ts",
  "projectEvidenceRepository.ts",
  "projectEvidenceService.ts",
  "projectEvidenceObservationTypes.ts",
  "projectEvidenceObservationValidation.ts",
] as const;

function readModule(fileName: string): string {
  return readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
}

function importLines(source: string): string[] {
  return source.split(/\r?\n/).filter((line) => /^\s*import\b/.test(line));
}

describe("ProjectEvidence execution, acquisition, and authority boundaries", () => {
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

  it("never invokes an Evidence Source Adapter or any real source-reading mechanism", () => {
    for (const file of MODULE_FILES) {
      const source = readModule(file);
      for (const line of importLines(source)) {
        expect(line).not.toMatch(/adapter/i);
        expect(line).not.toMatch(/integrations\/github/i);
      }
      expect(source).not.toMatch(/new\s+\w*Adapter\s*\(/);
    }
  });

  it("never references execution intent, policy, or runtime lifecycle", () => {
    for (const file of MODULE_FILES) {
      const source = readModule(file);
      for (const line of importLines(source)) {
        expect(line).not.toMatch(/executionIntent/i);
      }
      expect(source).not.toMatch(/ExecutionIntent/);
    }
  });

  it("never imports Smart Automation", () => {
    for (const file of MODULE_FILES) {
      for (const line of importLines(readModule(file))) {
        expect(line).not.toMatch(/smart[\s-]?automation/i);
      }
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

  it("never imports UI, React, or a component module", () => {
    for (const file of MODULE_FILES) {
      for (const line of importLines(readModule(file))) {
        expect(line).not.toMatch(/\breact\b/i);
        expect(line).not.toMatch(/\.tsx["']/);
        expect(line).not.toMatch(/components\//);
      }
    }
  });

  it("the repository module is the only one that imports the Supabase client, and the service only for auth plus the ProjectRecord repository", () => {
    expect(readModule("projectEvidenceTypes.ts")).not.toMatch(/integrations\/supabase/);
    expect(readModule("projectEvidenceValidation.ts")).not.toMatch(/integrations\/supabase/);
    expect(readModule("projectEvidenceObservationTypes.ts")).not.toMatch(/integrations\/supabase/);
    expect(readModule("projectEvidenceObservationValidation.ts")).not.toMatch(/integrations\/supabase/);
    expect(readModule("projectEvidenceRepository.ts")).toMatch(/integrations\/supabase\/client/);
    const serviceSource = readModule("projectEvidenceService.ts");
    expect(serviceSource).toMatch(/integrations\/supabase\/client/);
    expect(serviceSource).not.toMatch(/supabase\s*\.\s*from\s*\(/);
    expect(serviceSource).toMatch(/from ["']\.\/projectRecordRepository["']/);
  });

  it("the repository module never writes directly through a plain table insert on project_evidence -- only via the atomic RPC", () => {
    const repositorySource = readModule("projectEvidenceRepository.ts");
    expect(repositorySource).toMatch(/supabase\s*\.\s*rpc\s*\(\s*["']create_project_evidence_with_observation["']/);
    expect(repositorySource).not.toMatch(/from\(\s*["']project_evidence["']\s*\)\s*\.\s*insert/);
  });
});
