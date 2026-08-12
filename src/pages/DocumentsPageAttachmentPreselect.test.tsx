// @vitest-environment jsdom
//
// Task 19 (Attach file in Flow AI), scope item 4: the chat composer's
// post-send "Add to personal memory?" offer navigates here with
// { preselectDocumentId } in router state, deep-linking straight into the
// EXISTING AI tab / type-selector + "Add to personal memory" flow rather
// than reimplementing any of it. Source-verification pattern, matching
// DocumentsPageMemoryTypeSelector.test.tsx's own convention for this same
// (render-heavy, hook-laden) page.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(path.resolve(process.cwd(), "src", "pages", "DocumentsPage.tsx"), "utf-8");

describe("DocumentsPage: attachment preselect deep link (task 19)", () => {
  it("reads preselectDocumentId from router location state, not a query param or prop", () => {
    expect(pageSource).toMatch(
      /const preselectId = \(location\.state as \{ preselectDocumentId\?: string \} \| null\)\?\.preselectDocumentId;/,
    );
  });

  it("switches to the AI tab and selects the document via the SAME handleAiDocChange the manual dropdown uses -- no separate selection path", () => {
    expect(pageSource).toMatch(/setActiveTab\("ai"\);/);
    expect(pageSource).toMatch(/handleAiDocChange\(preselectId\);/);
  });

  it("consumes the navigation state exactly once (guarded), so a later unrelated re-render or navigation never replays it", () => {
    expect(pageSource).toMatch(/const consumedPreselect = useRef\(false\);/);
    expect(pageSource).toMatch(/if \(!preselectId \|\| consumedPreselect\.current\) return;/);
    expect(pageSource).toMatch(/consumedPreselect\.current = true;/);
  });

  it("clears the navigation state after consuming it, so a manual back/forward doesn't replay the preselect", () => {
    expect(pageSource).toMatch(/nav\(location\.pathname, \{ replace: true, state: \{\} \}\);/);
  });

  it("never writes anything -- the effect only selects a tab and a document id, it calls no create/update/delete/extraction function", () => {
    const effectStart = pageSource.indexOf("const consumedPreselect = useRef(false);");
    const effectEnd = pageSource.indexOf("}, [location.state, location.pathname, nav]);", effectStart);
    const effectBody = pageSource.slice(effectStart, effectEnd);
    expect(effectBody).not.toMatch(/triggerDocumentMemoryChunking|triggerPersonalMemoryExtraction|updateDocumentType|createDocument|deleteDocument/);
  });
});
