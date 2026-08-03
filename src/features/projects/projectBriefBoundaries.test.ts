// Static boundary tests for Project Brief Foundation, mirroring
// contextRebuildBoundaries.test.ts's technique: a runtime mock cannot prove
// an import was never made or a mutating call never constructed; scanning
// the source text can.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MODULE_FILES = [
  "projectBriefTypes.ts",
  "projectBriefMarkdownSections.ts",
  "projectBriefExtractorTypes.ts",
  "projectBriefProjectStatusExtractor.ts",
  "projectBriefAdrExtractor.ts",
  "projectBriefRoadmapExtractor.ts",
  "projectBriefArchitectureExtractor.ts",
  "projectBriefProductDirectionExtractor.ts",
  "projectBriefAssembler.ts",
  "projectBriefServiceTypes.ts",
  "projectBriefService.ts",
] as const;

function readModule(fileName: string): string {
  return readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
}

function importLines(source: string): string[] {
  return source.split(/\r?\n/).filter((line) => /^\s*import\b/.test(line));
}

describe("Project Brief source acquisition, execution, and authority boundaries", () => {
  it("never imports the filesystem, path, or child-process modules -- no raw source re-read", () => {
    for (const file of MODULE_FILES) {
      for (const line of importLines(readModule(file))) {
        expect(line).not.toMatch(/node:fs|node:path|node:child_process/);
      }
    }
  });

  it("never imports or invokes an Evidence Source Adapter", () => {
    for (const file of MODULE_FILES) {
      const source = readModule(file);
      for (const line of importLines(source)) {
        expect(line).not.toMatch(/repositoryDocumentAdapter|repositoryDocumentFileReader|repositoryDocumentPathSecurity/);
      }
      expect(source).not.toMatch(/createRepositoryDocumentAdapter\s*\(/);
      expect(source).not.toMatch(/readRepositoryDocument\s*\(/);
    }
  });

  it("never imports a provider client (GitHub, Gmail, Calendar, Slack)", () => {
    for (const file of MODULE_FILES) {
      for (const line of importLines(readModule(file))) {
        expect(line).not.toMatch(/integrations\/github/i);
        expect(line).not.toMatch(/gmail|calendar|slack/i);
      }
    }
  });

  it("never imports an LLM/AI provider module or calls one", () => {
    for (const file of MODULE_FILES) {
      for (const line of importLines(readModule(file))) {
        expect(line).not.toMatch(/gemini/i);
        expect(line).not.toMatch(/llmReasoning/i);
        expect(line).not.toMatch(/learn-ai|ai-memory/i);
      }
    }
  });

  it("never imports the agent/execution/approval layer, and never references ExecutionIntent", () => {
    for (const file of MODULE_FILES) {
      const source = readModule(file);
      for (const line of importLines(source)) {
        expect(line).not.toMatch(/features\/agent/);
        expect(line).not.toMatch(/approval/i);
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

  it("never writes to ProjectEvidence or ProjectRecord: no insert/update/delete/rpc call anywhere in these modules", () => {
    for (const file of MODULE_FILES) {
      const source = readModule(file);
      expect(source).not.toMatch(/\.insert\s*\(/);
      expect(source).not.toMatch(/\.update\s*\(/);
      expect(source).not.toMatch(/\.delete\s*\(/);
      expect(source).not.toMatch(/\.archive\s*\(/);
      expect(source).not.toMatch(/\.updateConfig\s*\(/);
      expect(source).not.toMatch(/supabase\s*\.\s*rpc\s*\(/);
      expect(source).not.toMatch(/\bfrom\(\s*["']project_/);
    }
  });

  it("only projectBriefService.ts imports Context Rebuild, and none of these modules imports the Supabase client directly", () => {
    for (const file of MODULE_FILES) {
      expect(readModule(file)).not.toMatch(/integrations\/supabase/);
    }
    const serviceSource = readModule("projectBriefService.ts");
    expect(serviceSource).toMatch(/from ["']\.\/contextRebuildService["']/);
    expect(serviceSource).toMatch(/rebuildService\.rebuildProjectContext\s*\(/);
  });

  it("no extractor accesses the filesystem/network, and each is a pure function of one text document", () => {
    const extractorFiles = [
      "projectBriefProjectStatusExtractor.ts",
      "projectBriefAdrExtractor.ts",
      "projectBriefRoadmapExtractor.ts",
      "projectBriefArchitectureExtractor.ts",
      "projectBriefProductDirectionExtractor.ts",
    ];
    for (const file of extractorFiles) {
      const source = readModule(file);
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/\bawait\b/);
      expect(source).toMatch(/input: ProjectBriefExtractorInput/);
    }
  });

  it("ProjectContextBuilder is never invoked by any Project Brief module -- Project Brief does not depend on it", () => {
    for (const file of MODULE_FILES) {
      // Excludes `rebuildProjectContext(` (Context Rebuild's own, expected
      // call) -- only a bare `buildProjectContext(` call, never prefixed by
      // a letter, would be an actual ProjectContextBuilder invocation.
      expect(readModule(file)).not.toMatch(/[^a-zA-Z]buildProjectContext\s*\(/);
    }
  });

  it("never generates a next action, risk, or decision from unlabeled prose -- every extractor uses only bounded bullet/labeled-sentence helpers", () => {
    const extractorFiles = [
      "projectBriefProjectStatusExtractor.ts",
      "projectBriefAdrExtractor.ts",
      "projectBriefRoadmapExtractor.ts",
      "projectBriefArchitectureExtractor.ts",
      "projectBriefProductDirectionExtractor.ts",
    ];
    for (const file of extractorFiles) {
      const source = readModule(file);
      expect(source).not.toMatch(/\.split\(\s*["']\s*\.\s*["']\s*\)/); // no naive sentence-splitting-as-semantics
      expect(source).not.toMatch(/\b(summarize|inferRisk|generateAction|rankBy)\s*\(/i);
    }
  });
});
