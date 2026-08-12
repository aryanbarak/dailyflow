// @vitest-environment jsdom
//
// Task 19 (Attach file in Flow AI): ChatPage.tsx's default export is
// auth/tasks/workspace-hook-heavy and is never mounted directly anywhere in
// this test suite (see ChatPageChromeCleanup.test.tsx's own header comment
// for the established reason) -- this file follows that same
// source-verification convention for the wiring this task adds: storage
// upload with type left NULL, documentId reaching the /chat request body,
// turn-scoped clearing after send, and the memory-offer affordance routing
// to Documents without writing anything itself.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(path.resolve(process.cwd(), "src", "pages", "ChatPage.tsx"), "utf-8");

describe("ChatPage: attachment storage upload (task 19, scope item 2)", () => {
  it("uploads into the SAME documents bucket/table any other document uses -- uploadToStorage + createDocument, not a bespoke path", () => {
    expect(pageSource).toMatch(/import \{ createDocument, uploadToStorage, type Document \} from '@\/features\/documents\/documentsService'/);
    expect(pageSource).toMatch(/const \{ storagePath, fileName \} = await uploadToStorage\(user\.id, file\)/);
    expect(pageSource).toMatch(/const document = await createDocument\(\{/);
  });

  it("never sets a type on the created document -- it stays untyped (NULL) until the user types it in Documents", () => {
    // createDocument's insert body: exactly storagePath/fileName/mimeType/
    // sizeBytes, never `type`.
    const callStart = pageSource.indexOf("const document = await createDocument({");
    const callEnd = pageSource.indexOf("})", callStart);
    const callBody = pageSource.slice(callStart, callEnd);
    expect(callBody).not.toMatch(/\btype:/);
  });

  it("does NOT trigger extraction to personal memory on upload -- no triggerDocumentMemoryChunking/triggerPersonalMemoryExtraction call anywhere in the attach handler", () => {
    const handlerStart = pageSource.indexOf("const handleAttachFile = useCallback");
    const handlerEnd = pageSource.indexOf("}, [user, t])", handlerStart);
    const handlerBody = pageSource.slice(handlerStart, handlerEnd);
    expect(handlerBody).not.toMatch(/triggerDocumentMemoryChunking|triggerPersonalMemoryExtraction/);
  });

  it("client-side validation runs before any upload -- rejected files never reach uploadToStorage", () => {
    expect(pageSource).toMatch(/const validation = validateChatAttachment\(file\)/);
    const handlerStart = pageSource.indexOf("const handleAttachFile = useCallback");
    const validationIndex = pageSource.indexOf("validateChatAttachment(file)", handlerStart);
    const uploadIndex = pageSource.indexOf("uploadToStorage(user.id, file)", handlerStart);
    expect(validationIndex).toBeGreaterThan(-1);
    expect(uploadIndex).toBeGreaterThan(validationIndex);
  });

  it("removing the attachment from the composer does NOT delete the uploaded document -- it stays a real, persisted Document", () => {
    const handlerStart = pageSource.indexOf("const handleRemoveAttachedFile = useCallback");
    const handlerEnd = pageSource.indexOf("}, [])", handlerStart);
    const handlerBody = pageSource.slice(handlerStart, handlerEnd);
    expect(handlerBody).not.toMatch(/deleteDocument/);
  });
});

describe("ChatPage: documentId reaches /chat, turn-scoped (task 19, scope item 3)", () => {
  it("the fetch body carries documentId from the CAPTURED sentDocument, not live state read at response time", () => {
    expect(pageSource).toMatch(/const sentDocument = attachedDocument/);
    expect(pageSource).toMatch(/documentId: sentDocument\?\.id \?\? null,/);
  });

  it("the composer's attachment is cleared after a successful send regardless of outcome -- never silently re-sent on a later, unrelated turn", () => {
    expect(pageSource).toMatch(/if \(sentDocument\) \{\s*setAttachedFile\(null\)\s*setAttachedDocument\(null\)/);
  });
});

describe("ChatPage: memory offer (task 19, scope item 4) -- dismissible, routes only, never writes", () => {
  it("the offer appears ONLY for extraction-capable mime types (PDF or plain text) -- an image attachment never triggers it", () => {
    expect(pageSource).toMatch(/const isMemoryOfferEligible = \(mimeType: string \| null\) =>\s*mimeType === 'application\/pdf' \|\| mimeType === 'text\/plain'/);
  });

  it("the offer's action navigates to /documents with preselectDocumentId -- it calls no create/update/extraction function itself", () => {
    const bannerStart = pageSource.indexOf("{memoryOffer && (");
    const bannerEnd = pageSource.indexOf("<ChatComposer", bannerStart);
    const bannerBody = pageSource.slice(bannerStart, bannerEnd);
    expect(bannerBody).toMatch(/nav\('\/documents', \{ state: \{ preselectDocumentId: offer\.documentId \} \}\)/);
    expect(bannerBody).not.toMatch(/triggerDocumentMemoryChunking|triggerPersonalMemoryExtraction|updateDocumentType|createDocument/);
  });

  it("the offer has its own explicit dismiss action, independent of the navigate action", () => {
    const bannerStart = pageSource.indexOf("{memoryOffer && (");
    const bannerEnd = pageSource.indexOf("<ChatComposer", bannerStart);
    const bannerBody = pageSource.slice(bannerStart, bannerEnd);
    expect(bannerBody).toMatch(/onClick=\{\(\) => setMemoryOffer\(null\)\}/);
    expect(bannerBody).toContain("chat_attach_memory_offer_dismiss");
  });
});
