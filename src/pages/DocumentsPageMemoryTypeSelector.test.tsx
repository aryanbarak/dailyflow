// @vitest-environment jsdom
//
// Task 18, A2: the unified document-type selector + single "Add to
// personal memory" action, replacing task 16's resume-only "Mark as
// resume"/"Unmark as resume" toggle. DocumentsPage.tsx's default export is
// heavy (useDocuments/useTasks/many AI-tool hooks) and has no existing test
// file (confirmed: no useDocuments.test.ts/documentsService.test.ts covered
// this page directly before this task) -- this file follows the
// source-verification pattern already established for similarly heavy
// pages (ChatPageChromeCleanup.test.tsx, SettingsPageOrbAppearance.test.tsx).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(path.resolve(process.cwd(), "src", "pages", "DocumentsPage.tsx"), "utf-8");

describe("DocumentsPage: unified document type selector (task 18, A2)", () => {
  it("the old 'Mark as resume'/'Unmark as resume' toggle is gone -- zero references to the removed handler or i18n keys", () => {
    expect(pageSource).not.toMatch(/handleToggleResumeType/);
    expect(pageSource).not.toMatch(/doc_memory_mark_resume/);
    expect(pageSource).not.toMatch(/doc_memory_unmark_resume/);
  });

  it("the type selector + action block is gated on isDocMemoryExtractable (PDF or plain text), not isDocPdf alone", () => {
    expect(pageSource).toMatch(/\{isDocMemoryExtractable\(aiSelectedDoc\) && \(/);
    expect(pageSource).toMatch(
      /const isDocMemoryExtractable = \(doc: Document\) => isDocExtractable\(doc\.mimeType, doc\.fileName\);/,
    );
  });

  it("isDocExtractable accepts BOTH pdf and plain-text mime/extension", () => {
    expect(pageSource).toMatch(/function isDocExtractable\(mimeType: string \| null, fileName: string\) \{/);
    expect(pageSource).toMatch(/return isPdf\(mimeType, fileName\) \|\| isDocPlainText\(mimeType, fileName\);/);
    expect(pageSource).toMatch(/mimeType === "text\/plain" \|\| fileName\.toLowerCase\(\)\.endsWith\("\.txt"\)/);
  });

  it("the type <select> is bound to the document's own type and offers every DOCUMENT_TYPES option", () => {
    expect(pageSource).toMatch(/value=\{aiSelectedDoc\.type \?\? ''\}/);
    expect(pageSource).toMatch(/onChange=\{e => void handleSetDocumentType\(\(e\.target\.value \|\| null\) as DocumentType \| null\)\}/);
    expect(pageSource).toMatch(/\{DOCUMENT_TYPES\.map\(docType => \(/);
  });

  it("the 'Add to personal memory' action is gated on the document HAVING a type (not specifically 'resume')", () => {
    expect(pageSource).toMatch(/\{aiSelectedDoc\.type !== null && \(/);
    expect(pageSource).not.toMatch(/aiSelectedDoc\.type === 'resume' &&/);
  });

  it("handleSetDocumentType persists via updateDocumentType and refreshes -- an existing 'resume'-typed document keeps working (no migration/backfill needed)", () => {
    expect(pageSource).toMatch(/const handleSetDocumentType = async \(type: DocumentType \| null\) => \{/);
    expect(pageSource).toMatch(/await updateDocumentType\(aiSelectedDoc\.id, type\);/);
  });

  it("the document title/file name is routed through isolateEmbeddedBidiRuns + dir=\"auto\" (mixed-direction file names)", () => {
    expect(pageSource).toMatch(/import \{ isolateEmbeddedBidiRuns \} from "@\/lib\/bidiText";/);
    expect(pageSource).toMatch(/<h4 dir="auto" className="text-base font-semibold truncate">/);
    expect(pageSource).toMatch(/\{isolateEmbeddedBidiRuns\(aiSelectedDoc\.title \?\? aiSelectedDoc\.fileName\)\}/);
  });
});
