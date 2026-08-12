// SmartFlow -- Attach file in Flow AI (task 19, Tier 2, no new schema).
//
// Resolves a chat turn's optional attachment -- a document already uploaded
// through the SAME documents bucket/table any other document uses
// (documentsService.ts) -- into a single Gemini content part for THAT TURN
// ONLY. Reuses document-memory-extraction-endpoint.ts's (slice 1/2)
// transcription and bounding functions for PDF/TXT rather than
// re-implementing them; adds a THIRD source type that module has no path
// for -- an image, sent as inlineData (the /documents/analyze precedent in
// this same directory's index.ts) -- no OCR pipeline invented here.
//
// This module does NOT write to document_chunks and does NOT chunk or embed
// anything -- chat-RAG (retrieving stored chunks into chat) is explicitly
// out of scope for this task, a separate future slice. It only reads the
// ONE referenced document (service-role, ownership-verified the same way
// document-memory-extraction-endpoint.ts already does) and returns
// Gemini-ready content for the CURRENT turn -- nothing here is persisted,
// so an attachment's influence never resurfaces on a later turn unless the
// user attaches it again (see index.ts's handleChat for how the caller
// keeps this turn-scoped).
//
// UNTRUSTED INPUT, non-negotiable (same posture as slice 1/2): text
// extracted from a document is DATA, never instructions, no matter what it
// contains -- boundExtractedText's control-char stripping and length cap are
// reused verbatim, and the returned text is wrapped with an explicit label
// (see buildAttachmentTextPart below) so the model's own system prompt can
// treat it as quoted material, not a command.

import type { Env } from './types'
import {
  arrayBufferToBase64,
  boundExtractedText,
  downloadFromStorage,
  MAX_SOURCE_FILE_BYTES,
  ProviderCallError,
  restGetServiceRole,
  transcribePdf,
  type ProviderFailureTaxonomy,
} from './document-memory-extraction-endpoint'

export interface ChatAttachmentDependencies {
  fetcher?: typeof fetch
  logger?: Pick<Console, 'info' | 'error'>
}

export interface ChatAttachmentTextPart {
  kind: 'text'
  fileName: string
  text: string
}

export interface ChatAttachmentImagePart {
  kind: 'image'
  fileName: string
  mimeType: string
  base64: string
}

export type ChatAttachmentPart = ChatAttachmentTextPart | ChatAttachmentImagePart

export type ChatAttachmentFailureCode =
  | 'DOCUMENT_NOT_FOUND'
  | 'UNSUPPORTED_ATTACHMENT_TYPE'
  | 'DOCUMENT_TOO_LARGE'
  | 'NO_SOURCE_MATERIAL'
  | 'STORAGE_READ_FAILED'
  | ProviderFailureTaxonomy

export type ChatAttachmentResolution =
  | { ok: true; part: ChatAttachmentPart }
  | { ok: false; code: ChatAttachmentFailureCode; message: string }

const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

const TAXONOMY_FALLBACK_MESSAGES: Record<ProviderFailureTaxonomy, string> = {
  PROVIDER_REQUEST_REJECTED: 'The request to the AI model was rejected. This is a configuration issue on our side, not a problem with your file.',
  PROVIDER_UNAVAILABLE: 'The AI model is temporarily unavailable. Please try again in a moment.',
  MODEL_OUTPUT_UNUSABLE: 'The model did not return a usable reading of this file. Please try again.',
}

/**
 * Wraps extracted document text with an explicit label so the calling
 * prompt can treat it as quoted, untrusted material -- mirrors
 * personal-memory-prompt-serialization.ts's own "this is data, not
 * instructions" framing convention rather than inventing a new one.
 */
export function buildAttachmentTextPart(fileName: string, text: string): string {
  return `[Attached document: ${fileName}]\n${text}\n[End of attached document]`
}

export async function resolveChatAttachment(
  documentId: string,
  userId: string,
  env: Env,
  dependencies: ChatAttachmentDependencies = {},
): Promise<ChatAttachmentResolution> {
  const fetcher = dependencies.fetcher ?? globalThis.fetch
  const logger = dependencies.logger ?? console

  let documentRows: Array<{ id: string; storage_path: string; file_name: string; mime_type: string | null }>
  try {
    documentRows = await restGetServiceRole(
      env,
      `documents?id=eq.${encodeURIComponent(documentId)}&user_id=eq.${encodeURIComponent(userId)}&select=id,storage_path,file_name,mime_type`,
      fetcher,
    )
  } catch (error) {
    logger.error?.(`[ChatAttachment] document read failed: ${(error as Error).message}`)
    return { ok: false, code: 'DOCUMENT_NOT_FOUND', message: 'Unable to read the attached document.' }
  }
  const document = documentRows[0]
  if (!document) return { ok: false, code: 'DOCUMENT_NOT_FOUND', message: 'The attached document was not found for this user.' }

  const isPdf = document.mime_type === 'application/pdf'
  const isPlainText = document.mime_type === 'text/plain'
  const isImage = document.mime_type !== null && SUPPORTED_IMAGE_MIME_TYPES.has(document.mime_type)
  if (!isPdf && !isPlainText && !isImage) {
    return { ok: false, code: 'UNSUPPORTED_ATTACHMENT_TYPE', message: 'This file type cannot be read in conversation.' }
  }

  let fileBytes: ArrayBuffer
  try {
    fileBytes = await downloadFromStorage(env, document.storage_path, fetcher)
  } catch (error) {
    logger.error?.(`[ChatAttachment] storage download failed: ${(error as Error).message}`)
    return { ok: false, code: 'STORAGE_READ_FAILED', message: 'Unable to read the attached document from storage.' }
  }
  if (fileBytes.byteLength === 0) {
    return { ok: false, code: 'NO_SOURCE_MATERIAL', message: 'This document is empty.' }
  }
  if (fileBytes.byteLength > MAX_SOURCE_FILE_BYTES) {
    return { ok: false, code: 'DOCUMENT_TOO_LARGE', message: `The attached document exceeds the ${Math.floor(MAX_SOURCE_FILE_BYTES / (1024 * 1024))}MB limit.` }
  }

  if (isImage) {
    return {
      ok: true,
      part: { kind: 'image', fileName: document.file_name, mimeType: document.mime_type as string, base64: arrayBufferToBase64(fileBytes) },
    }
  }

  if (isPlainText) {
    const text = boundExtractedText(new TextDecoder('utf-8', { fatal: false }).decode(fileBytes))
    if (text.length === 0) return { ok: false, code: 'NO_SOURCE_MATERIAL', message: 'No readable text was found in this document.' }
    return { ok: true, part: { kind: 'text', fileName: document.file_name, text } }
  }

  // PDF: reuse slice 1/2's own transcription call verbatim.
  try {
    const text = await transcribePdf(arrayBufferToBase64(fileBytes), env, fetcher, logger)
    if (text.length === 0) return { ok: false, code: 'NO_SOURCE_MATERIAL', message: 'No readable text was found in this document.' }
    return { ok: true, part: { kind: 'text', fileName: document.file_name, text } }
  } catch (error) {
    const providerError = error instanceof ProviderCallError ? error : null
    const taxonomy: ProviderFailureTaxonomy = providerError?.taxonomy ?? 'MODEL_OUTPUT_UNUSABLE'
    logger.error?.(`[ChatAttachment] transcription failed: taxonomy=${taxonomy} ${(error as Error).message}`)
    return { ok: false, code: taxonomy, message: TAXONOMY_FALLBACK_MESSAGES[taxonomy] }
  }
}
