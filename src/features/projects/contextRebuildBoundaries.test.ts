// Static boundary tests: prove Context Rebuild stays outside source
// acquisition, execution authority, LLM/AI provider use, Smart Automation,
// and UI by scanning its own source text, mirroring
// projectEvidenceBoundaries.test.ts's and
// repositoryDocumentAdapterBoundaries.test.ts's technique. A runtime mock
// cannot prove an import was never made or a mutating call was never
// constructed; the source text can.
//
// These checks only inspect `import` statements and actual API-call
// syntax, not prose -- the modules' own doc comments legitimately name
// "adapter", "LLM", "provider", and "execution" to explain what they
// deliberately exclude, and that documentation is not itself a boundary
// violation.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MODULE_FILES = [
  "evidenceSnapshotTypes.ts",
  "evidenceSnapshotBuilder.ts",
  "contextRebuildTypes.ts",
  "contextRebuildProjectContextInput.ts",
  "contextRebuildService.ts",
] as const;

function readModule(fileName: string): string {
  return readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
}

function importLines(source: string): string[] {
  return source.split(/\r?\n/).filter((line) => /^\s*import\b/.test(line));
}

describe("Context Rebuild source acquisition, execution, and authority boundaries", () => {
  it("never imports the filesystem, path, or child-process modules -- no raw source re-read of any kind", () => {
    for (const file of MODULE_FILES) {
      for (const line of importLines(readModule(file))) {
        expect(line).not.toMatch(/node:fs|node:path|node:child_process/);
      }
    }
  });

  it("never imports or invokes an Evidence Source Adapter, including the Repository Documents Adapter", () => {
    for (const file of MODULE_FILES) {
      const source = readModule(file);
      for (const line of importLines(source)) {
        expect(line).not.toMatch(/repositoryDocumentAdapter|repositoryDocumentFileReader|repositoryDocumentPathSecurity/);
      }
      expect(source).not.toMatch(/createRepositoryDocumentAdapter\s*\(/);
    }
  });

  it("never imports the GitHub API integration or any other provider client", () => {
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

  it("never imports the agent/execution/tool/approval layer", () => {
    for (const file of MODULE_FILES) {
      for (const line of importLines(readModule(file))) {
        expect(line).not.toMatch(/features\/agent/);
        expect(line).not.toMatch(/approval/i);
      }
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

  it("never imports UI, React, or a component module", () => {
    for (const file of MODULE_FILES) {
      for (const line of importLines(readModule(file))) {
        expect(line).not.toMatch(/\breact\b/i);
        expect(line).not.toMatch(/\.tsx["']/);
        expect(line).not.toMatch(/components\//);
      }
    }
  });

  it("never calls browser storage APIs", () => {
    for (const file of MODULE_FILES) {
      expect(readModule(file)).not.toMatch(/\b(localStorage|sessionStorage)\s*\./);
    }
  });

  it("never writes to ProjectEvidence: no insert/update/delete call, no RPC call, anywhere in these modules", () => {
    for (const file of MODULE_FILES) {
      const source = readModule(file);
      expect(source).not.toMatch(/\.insert\s*\(/);
      expect(source).not.toMatch(/\.update\s*\(/);
      expect(source).not.toMatch(/\.delete\s*\(/);
      expect(source).not.toMatch(/supabase\s*\.\s*rpc\s*\(/);
      expect(source).not.toMatch(/\bfrom\(\s*["']project_evidence/);
    }
  });

  it("never mutates ProjectRecord: no call into projectRecordService's write operations, no direct table write", () => {
    for (const file of MODULE_FILES) {
      const source = readModule(file);
      expect(source).not.toMatch(/\.archive\s*\(/);
      expect(source).not.toMatch(/\.updateConfig\s*\(/);
      expect(source).not.toMatch(/from\(\s*["']project_records["']\s*\)\s*\.\s*(insert|update|delete)/);
    }
  });

  it("only the service module imports the Supabase client, and only for auth -- never a direct table query", () => {
    for (const file of MODULE_FILES) {
      if (file === "contextRebuildService.ts") continue;
      expect(readModule(file)).not.toMatch(/integrations\/supabase/);
    }
    const serviceSource = readModule("contextRebuildService.ts");
    expect(serviceSource).toMatch(/integrations\/supabase\/client/);
    expect(serviceSource).toMatch(/supabase\s*\.\s*auth\s*\.\s*getUser/);
    expect(serviceSource).not.toMatch(/supabase\s*\.\s*from\s*\(/);
  });

  it("the service reads through the existing ProjectRecord and ProjectEvidence repositories only, never a raw query of its own", () => {
    const serviceSource = readModule("contextRebuildService.ts");
    expect(serviceSource).toMatch(/from ["']\.\/projectRecordRepository["']/);
    expect(serviceSource).toMatch(/from ["']\.\/projectEvidenceRepository["']/);
    expect(serviceSource).toMatch(/projectRepository\.findById\s*\(/);
    expect(serviceSource).toMatch(/evidenceRepository\.listByProject\s*\(/);
  });

  it("ProjectContextBuilder is invoked only from the service, and only via the real buildProjectContext export, never re-implemented", () => {
    for (const file of MODULE_FILES) {
      if (file === "contextRebuildService.ts") continue;
      expect(readModule(file)).not.toMatch(/buildProjectContext\s*\(/);
    }
    const serviceSource = readModule("contextRebuildService.ts");
    expect(serviceSource).toMatch(/from ["']\.\/projectContextBuilder["']/);
    expect(serviceSource).toMatch(/buildProjectContext\s*\(\s*contextInput\s*\)/);
  });

  it("never derives objectives, milestones, decisions, capabilities, risks, or candidate actions itself -- the mapper always emits empty collections for them", () => {
    const mapperSource = readModule("contextRebuildProjectContextInput.ts");
    expect(mapperSource).toMatch(/objectives:\s*\[\]/);
    expect(mapperSource).toMatch(/milestones:\s*\[\]/);
    expect(mapperSource).toMatch(/decisions:\s*\[\]/);
    expect(mapperSource).toMatch(/capabilities:\s*\[\]/);
    expect(mapperSource).toMatch(/risks:\s*\[\]/);
    expect(mapperSource).toMatch(/candidateActions:\s*\[\]/);
  });
});
