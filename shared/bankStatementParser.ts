// Task 45b, ADR-0017 Slice 1: deterministic parser for Sparkasse's
// CSV-CAMT V2 export (and its "CSV mit Kategorien" variant), the primary
// target format chosen in ADR-0017 over model-based PDF extraction --
// see that ADR for why (a wrong amount is worse than a failed import) and
// for the exact column layout this module implements against.
//
// PURE, DEPENDENCY-FREE, NO I/O: same discipline as shared/financeDirection.ts
// and shared/writeIntentRegistry.ts -- no Supabase client, no React, no DOM,
// no worker-only bindings. This module does not know about the database, the
// Worker, or duplicate-checking against previously-imported rows (that is a
// later slice, per ADR-0017's own slice plan) -- it only turns raw bytes into
// { parsed rows, quarantined rows, a verdict }, computing a duplicate-hash
// PER ROW that a later slice can look up, never checking it here.
//
// SHARED-MODULE CONSTRAINT: importable by both the Cloudflare Worker
// (agent/worker/*.ts) and the frontend (src/*.ts), same as every other
// shared/ module -- see writeIntentRegistry.ts's own comment on this.
//
// QUARANTINE, NOT FAIL-CLOSED (ADR-0017 Decision item 2, PO decision task
// 45b, amending the original task-45 fail-closed draft): a row that fails
// any of the deterministic rules below is quarantined -- kept, with its
// line number, raw text, a reason code, and a human-readable reason -- not
// silently dropped and not treated as fatal on its own. The whole file is
// only blocked when the quarantined SHARE of data rows exceeds
// QUARANTINE_BLOCK_THRESHOLD (20%): past that point the more likely
// explanation is a structurally wrong file (wrong export format, wrong
// bank, a genuinely corrupted download), not a handful of edge rows in an
// otherwise-good statement. See ADR-0017 for the full argument against
// absolute fail-closed.
//
// NOT CRYPTOGRAPHIC: computeBankRowHash below uses a fast, well-distributed
// non-cryptographic string hash (cyrb53), not SHA-256. The hash exists only
// to detect exact-duplicate rows across re-exports of the same statement --
// it is never a security boundary -- so a synchronous, dependency-free
// implementation was chosen over Web Crypto's async subtle.digest, keeping
// this entire module synchronous and trivially testable.

// ---------------------------------------------------------------------------
// Column layout (ADR-0017 Decision item 1)
// ---------------------------------------------------------------------------

// The full canonical Sparkasse CSV-CAMT V2 header set. All 13 must be
// present (by name, case-insensitively, in ANY order -- see
// buildHeaderIndex below) for a file to be recognized as this format at
// all; a file missing any of these is a structural failure, not a
// row-level quarantine case, because it means this isn't actually a
// CSV-CAMT V2 export in the first place. Column ORDER is deliberately not
// relied on anywhere in this module -- multiple independent sources note
// Sparkasse's own column order can vary slightly by institution even
// though all Sparkassen share the same Finanz Informatik export platform.
const CAMT_V2_REQUIRED_HEADERS = [
  "Auftragskonto",
  "Buchungstag",
  "Valutadatum",
  "Buchungstext",
  "Verwendungszweck",
  "Auftraggeber/Begünstigter",
  "Kontonummer/IBAN",
  "BLZ/BIC",
  "Betrag",
  "Waehrung",
  "Gläubiger-ID",
  "Mandatsreferenz",
  "Kundenreferenz",
] as const;

// "CSV mit Kategorien" is CAMT V2's exact same column set plus one more --
// see ADR-0017's own note that its precise layout is only weakly sourced
// (secondary import-tool documentation, not a primary DK/Sparkassen-
// Finanzportal spec): detecting it as "CAMT V2 plus a Kategorie column"
// rather than a hand-authored separate column list is deliberately the
// most conservative claim this module can make about a format it hasn't
// seen a verified real sample of yet.
const CATEGORY_HEADER = "Kategorie";

export type BankStatementFormat = "camt-v2" | "camt-v2-categorized";

export const QUARANTINE_BLOCK_THRESHOLD = 0.2;

export type QuarantineReasonCode =
  | "column_count_mismatch"
  | "missing_field"
  | "invalid_date"
  | "invalid_amount"
  | "zero_amount";

export interface QuarantinedRow {
  /**
   * 1-based index of this DATA ROW (record) among all data rows, i.e. after
   * the header. Deliberately NOT a raw physical text-file line number: a
   * multi-line Verwendungszweck field spans several physical lines within
   * a single logical record, so a physical-line count would diverge from
   * what a user cross-referencing "row 5" against their own spreadsheet
   * view actually means. See tokenizeSemicolonCsv below.
   */
  readonly lineNumber: number;
  /** The exact original text of this record (may itself contain embedded newlines). */
  readonly rawLine: string;
  readonly reasonCode: QuarantineReasonCode;
  readonly reason: string;
}

export interface ParsedBankRow {
  readonly lineNumber: number;
  /** ISO YYYY-MM-DD, normalized from Buchungstag. */
  readonly date: string;
  /** ISO YYYY-MM-DD, normalized from Valutadatum -- omitted if absent or unparseable (non-fatal). */
  readonly valueDate?: string;
  /** Absolute value, always >= 0.01, two decimal places. */
  readonly amount: number;
  readonly direction: "income" | "expense";
  readonly currency: string;
  readonly counterparty: string;
  readonly counterpartyIban: string;
  readonly counterpartyBic: string;
  readonly purpose: string;
  readonly bookingText: string;
  /** Only ever populated for the "camt-v2-categorized" format. */
  readonly category?: string;
  readonly creditorId: string;
  readonly mandateReference: string;
  readonly customerReference: string;
  readonly rowHash: string;
}

export type BankStatementParseVerdict = "ok" | "blocked_structural" | "blocked_over_threshold";

export interface BankStatementParseResult {
  readonly verdict: BankStatementParseVerdict;
  /** null when verdict is "blocked_structural" and the format could not even be determined. */
  readonly format: BankStatementFormat | null;
  readonly encoding: "utf-8" | "windows-1252";
  readonly rows: readonly ParsedBankRow[];
  readonly quarantined: readonly QuarantinedRow[];
  readonly totalDataRows: number;
  /** quarantined.length / totalDataRows; 0 when totalDataRows is 0. */
  readonly quarantineRatio: number;
  /** Set only when verdict is "blocked_structural". */
  readonly structuralError?: string;
}

// ---------------------------------------------------------------------------
// Encoding (ADR-0017 rule: CP1252/ISO-8859-1 default, UTF-8 BOM override)
// ---------------------------------------------------------------------------

export function detectEncoding(bytes: Uint8Array): "utf-8" | "windows-1252" {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return "utf-8";
  }
  return "windows-1252";
}

export function decodeBankStatementBytes(bytes: Uint8Array): { text: string; encoding: "utf-8" | "windows-1252" } {
  const encoding = detectEncoding(bytes);
  if (encoding === "utf-8") {
    // Strip the BOM itself -- TextDecoder('utf-8') does not do this for us
    // the way { ignoreBOM: false } implies for some decoders; slicing is
    // unambiguous and avoids relying on decoder-specific BOM handling.
    const withoutBom = bytes.subarray(3);
    return { text: new TextDecoder("utf-8").decode(withoutBom), encoding };
  }
  return { text: new TextDecoder("windows-1252").decode(bytes), encoding };
}

// ---------------------------------------------------------------------------
// Amount (ADR-0017 rule: German decimal comma, optional thousands dots,
// optional bare-integer-with-no-decimal-part shorthand)
// ---------------------------------------------------------------------------

/**
 * Parses a Betrag field into a signed number with exactly two implied
 * decimal places, e.g. "1.234,56" -> 1234.56, "832,9" -> 832.9,
 * "-190" -> -190. Returns null for anything that doesn't confidently match
 * this convention -- never guesses, per ADR-0017's "never silently
 * mis-parse a financial value" premise. Exported for direct unit testing.
 */
export function parseGermanAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
  if (!body) return null;

  const lastComma = body.lastIndexOf(",");
  let integerPart: string;
  let decimalPart: string;

  if (lastComma === -1) {
    // No comma at all. Sparkasse's own bare-integer shorthand ("-190") has
    // no dot either -- accept as a whole-euro amount. A dot WITHOUT a
    // comma is only ever a German thousands separator (e.g. "1.234" ==
    // 1234 whole euros), which groups in blocks of exactly three digits --
    // require that shape strictly. Without this check, a US-style decimal
    // point ("45.23", meaning 45 euros 23 cents in that convention) would
    // silently be reinterpreted as the thousands-grouped whole number 4523
    // -- a two-orders-of-magnitude, financially catastrophic misread this
    // parser must reject instead of guess at.
    if (body.includes(".")) {
      const groups = body.split(".");
      const validThousandsGrouping =
        groups.length > 1 && /^\d{1,3}$/.test(groups[0]) && groups.slice(1).every((g) => /^\d{3}$/.test(g));
      if (!validThousandsGrouping) return null;
      integerPart = groups.join("");
    } else {
      integerPart = body;
    }
    decimalPart = "00";
  } else {
    integerPart = body.slice(0, lastComma).replace(/\./g, "");
    decimalPart = body.slice(lastComma + 1);
    if (decimalPart.length === 1) decimalPart = `${decimalPart}0`;
  }

  if (!/^\d+$/.test(integerPart)) return null;
  if (!/^\d{2}$/.test(decimalPart)) return null;

  const value = Number(`${integerPart}.${decimalPart}`);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

// ---------------------------------------------------------------------------
// Date (ADR-0017 rule: DD.MM.YY with a pivot window, or DD.MM.YYYY)
// ---------------------------------------------------------------------------

const DATE_PATTERN = /^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/;

/**
 * Parses Buchungstag/Valutadatum into ISO YYYY-MM-DD. Accepts DD.MM.YY
 * (2-digit year, windowed: 00-79 -> 2000-2079, 80-99 -> 1980-1999 -- a
 * generous pivot no real bank statement will ever hit the boundary of)
 * and DD.MM.YYYY. Performs a real calendar-range check (day 1-31, month
 * 1-12) but not a full Gregorian validity check (e.g. Feb 30 is not
 * separately rejected) -- that level of strictness was not asked for by
 * any of ADR-0017's six rules and a bank's own export is not going to
 * contain an impossible calendar date. Exported for direct unit testing.
 */
export function parseGermanBookingDate(raw: string): string | null {
  const trimmed = raw.trim();
  const match = DATE_PATTERN.exec(trimmed);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const yearPart = match[3];

  if (day < 1 || day > 31 || month < 1 || month > 12) return null;

  let year: number;
  if (yearPart.length === 4) {
    year = Number(yearPart);
  } else {
    const twoDigit = Number(yearPart);
    year = twoDigit <= 79 ? 2000 + twoDigit : 1900 + twoDigit;
  }

  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Tokenizer (ADR-0017 rule: semicolon delimiter, quoted-field-aware,
// multi-line Verwendungszweck support)
// ---------------------------------------------------------------------------

export interface CsvRecord {
  readonly fields: readonly string[];
  /** Exact original text of this record, including any embedded newlines. */
  readonly raw: string;
}

/**
 * Splits `text` into logical CSV records on ';', respecting RFC-4180-style
 * double-quoting: a quoted field may contain literal ';', '\n', '\r', and
 * an escaped '""' for a literal quote character. A record only ends at a
 * newline that is OUTSIDE an open quote -- this is what makes a genuinely
 * multi-line Verwendungszweck field survive as ONE record instead of being
 * corrupted into extra, malformed records (the bug in the current
 * comma-CSV importer's naive `text.split(/\r?\n/)`, which this module does
 * not repeat). \r\n, bare \n, and bare \r are all accepted as record
 * terminators. A trailing newline at end-of-file does not produce a
 * trailing empty record. Exported for direct unit testing.
 */
export function tokenizeSemicolonCsv(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let recordStart = 0;
  let i = 0;

  const endField = () => {
    fields.push(field);
    field = "";
  };
  const endRecord = (rawEnd: number) => {
    endField();
    // Skip a record produced by nothing but a single trailing blank line.
    if (!(fields.length === 1 && fields[0] === "" && records.length === 0 && rawEnd === recordStart)) {
      records.push({ fields, raw: text.slice(recordStart, rawEnd) });
    }
    fields = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ";") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      const rawEnd = i;
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      i += 1;
      endRecord(rawEnd);
      recordStart = i;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Final record with no trailing newline (or a genuinely non-empty
  // trailing partial record after the last terminator).
  if (field !== "" || fields.length > 0 || recordStart < text.length) {
    endRecord(text.length);
  }

  return records.filter((record) => !(record.fields.length === 1 && record.fields[0] === ""));
}

// ---------------------------------------------------------------------------
// Hash (duplicate detection input -- computed here, checked elsewhere)
// ---------------------------------------------------------------------------

// cyrb53 -- a small, well-distributed, public-domain-style non-cryptographic
// string hash (not our invention; a widely used short implementation of the
// same well-known algorithm). Chosen specifically because it is synchronous
// and dependency-free, unlike Web Crypto's async subtle.digest, keeping this
// entire module (and its tests) synchronous. Never used for anything
// security-sensitive -- see this file's header comment.
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return combined.toString(16).padStart(14, "0");
}

/**
 * Deterministic duplicate-detection hash, per ADR-0017's own formula:
 * user_id | Buchungstag (ISO) | Betrag (signed, as parsed) | Verwendungszweck | counterparty IBAN.
 * Computed here at parse time; checking it against previously-imported
 * rows is explicitly a LATER slice's job (needs the database) -- this
 * function has no I/O and no knowledge of what's already been imported.
 * Exported for direct unit testing.
 */
export function computeBankRowHash(
  userId: string,
  row: { readonly date: string; readonly signedAmount: number; readonly purpose: string; readonly counterpartyIban: string },
): string {
  const input = [userId, row.date, row.signedAmount.toFixed(2), row.purpose, row.counterpartyIban].join("|");
  return cyrb53(input);
}

// ---------------------------------------------------------------------------
// Header resolution
// ---------------------------------------------------------------------------

function buildHeaderIndex(headerFields: readonly string[]): Map<string, number> {
  const index = new Map<string, number>();
  headerFields.forEach((raw, i) => {
    const key = raw.trim().toLowerCase();
    if (key && !index.has(key)) index.set(key, i);
  });
  return index;
}

function missingRequiredHeaders(index: Map<string, number>): string[] {
  return CAMT_V2_REQUIRED_HEADERS.filter((name) => !index.has(name.toLowerCase()));
}

function field(fields: readonly string[], index: Map<string, number>, name: string): string {
  const i = index.get(name.toLowerCase());
  if (i === undefined || i >= fields.length) return "";
  return (fields[i] ?? "").trim();
}

// ---------------------------------------------------------------------------
// Top-level parse
// ---------------------------------------------------------------------------

/**
 * Parses raw Sparkasse CSV-CAMT V2 (or "CSV mit Kategorien") bytes.
 * Synchronous and pure -- no network, no Supabase, no filesystem. `userId`
 * is threaded through only to compute each row's duplicate-detection hash
 * (ADR-0017's formula includes it); this function performs no lookup
 * against any store of previously-imported rows.
 */
export function parseBankStatement(bytes: Uint8Array, userId: string): BankStatementParseResult {
  const { text, encoding } = decodeBankStatementBytes(bytes);

  if (!text.trim()) {
    return {
      verdict: "blocked_structural",
      format: null,
      encoding,
      rows: [],
      quarantined: [],
      totalDataRows: 0,
      quarantineRatio: 0,
      structuralError: "The file is empty.",
    };
  }

  const records = tokenizeSemicolonCsv(text);
  if (records.length === 0) {
    return {
      verdict: "blocked_structural",
      format: null,
      encoding,
      rows: [],
      quarantined: [],
      totalDataRows: 0,
      quarantineRatio: 0,
      structuralError: "The file has no header row.",
    };
  }

  const [headerRecord, ...dataRecords] = records;
  const headerIndex = buildHeaderIndex(headerRecord.fields);
  const missing = missingRequiredHeaders(headerIndex);
  if (missing.length > 0) {
    return {
      verdict: "blocked_structural",
      format: null,
      encoding,
      rows: [],
      quarantined: [],
      totalDataRows: 0,
      quarantineRatio: 0,
      structuralError: `Missing required column(s): ${missing.join(", ")}.`,
    };
  }

  const format: BankStatementFormat = headerIndex.has(CATEGORY_HEADER.toLowerCase())
    ? "camt-v2-categorized"
    : "camt-v2";
  const expectedFieldCount = headerRecord.fields.length;

  const rows: ParsedBankRow[] = [];
  const quarantined: QuarantinedRow[] = [];

  dataRecords.forEach((record, i) => {
    const lineNumber = i + 1;
    const quarantine = (reasonCode: QuarantineReasonCode, reason: string) => {
      quarantined.push({ lineNumber, rawLine: record.raw, reasonCode, reason });
    };

    if (record.fields.length !== expectedFieldCount) {
      quarantine(
        "column_count_mismatch",
        `Expected ${expectedFieldCount} columns, found ${record.fields.length}.`,
      );
      return;
    }

    const buchungstag = field(record.fields, headerIndex, "Buchungstag");
    const betrag = field(record.fields, headerIndex, "Betrag");
    const verwendungszweck = field(record.fields, headerIndex, "Verwendungszweck");

    if (!buchungstag) {
      quarantine("missing_field", "Buchungstag is empty.");
      return;
    }
    if (!betrag) {
      quarantine("missing_field", "Betrag is empty.");
      return;
    }

    const date = parseGermanBookingDate(buchungstag);
    if (!date) {
      quarantine("invalid_date", `Buchungstag "${buchungstag}" is not a valid DD.MM.YY or DD.MM.YYYY date.`);
      return;
    }

    const signedAmount = parseGermanAmount(betrag);
    if (signedAmount === null) {
      quarantine("invalid_amount", `Betrag "${betrag}" is not a valid German-formatted amount.`);
      return;
    }
    if (signedAmount === 0) {
      quarantine("zero_amount", "Betrag is 0 -- not a real transaction.");
      return;
    }

    const valutadatumRaw = field(record.fields, headerIndex, "Valutadatum");
    const valueDate = valutadatumRaw ? parseGermanBookingDate(valutadatumRaw) ?? undefined : undefined;

    const counterpartyIban = field(record.fields, headerIndex, "Kontonummer/IBAN");
    const currency = field(record.fields, headerIndex, "Waehrung") || "EUR";
    const categoryValue = format === "camt-v2-categorized" ? field(record.fields, headerIndex, CATEGORY_HEADER) : "";

    rows.push({
      lineNumber,
      date,
      ...(valueDate ? { valueDate } : {}),
      amount: Math.abs(signedAmount),
      direction: signedAmount < 0 ? "expense" : "income",
      currency,
      counterparty: field(record.fields, headerIndex, "Auftraggeber/Begünstigter"),
      counterpartyIban,
      counterpartyBic: field(record.fields, headerIndex, "BLZ/BIC"),
      purpose: verwendungszweck,
      bookingText: field(record.fields, headerIndex, "Buchungstext"),
      ...(categoryValue ? { category: categoryValue } : {}),
      creditorId: field(record.fields, headerIndex, "Gläubiger-ID"),
      mandateReference: field(record.fields, headerIndex, "Mandatsreferenz"),
      customerReference: field(record.fields, headerIndex, "Kundenreferenz"),
      rowHash: computeBankRowHash(userId, { date, signedAmount, purpose: verwendungszweck, counterpartyIban }),
    });
  });

  const totalDataRows = dataRecords.length;
  const quarantineRatio = totalDataRows === 0 ? 0 : quarantined.length / totalDataRows;
  const verdict: BankStatementParseVerdict =
    quarantineRatio > QUARANTINE_BLOCK_THRESHOLD ? "blocked_over_threshold" : "ok";

  return { verdict, format, encoding, rows, quarantined, totalDataRows, quarantineRatio };
}
