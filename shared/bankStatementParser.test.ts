// Task 45b, ADR-0017 Slice 1. Every deterministic rule the ADR states is
// tested both as a pure unit (the exported helper functions) and via a
// realistic fixture file (shared/__fixtures__/bankStatements/), per the
// task's own instruction that each rule map to at least one test. Fixtures
// were generated with explicit byte-level encoding control (see
// gen-fixtures script, not shipped) because the required header row itself
// contains "Begünstigter" -- a plain UTF-8-without-BOM write would decode
// incorrectly under this module's own default CP1252 path, which is
// exactly the bug class this module exists to avoid, so the fixtures were
// built to be byte-correct rather than relying on an editor's default
// encoding.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  QUARANTINE_BLOCK_THRESHOLD,
  computeBankRowHash,
  decodeBankStatementBytes,
  detectEncoding,
  parseBankStatement,
  parseGermanAmount,
  parseGermanBookingDate,
  tokenizeSemicolonCsv,
} from "./bankStatementParser";

const FIXTURE_DIR = path.join(__dirname, "__fixtures__", "bankStatements");

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURE_DIR, name)));
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

const USER_ID = "test-user-1";

// ---------------------------------------------------------------------------
// Rule: semicolon delimiter + quoted-field-aware tokenizer
// ---------------------------------------------------------------------------
describe("tokenizeSemicolonCsv", () => {
  it("splits on ';', not ','", () => {
    const records = tokenizeSemicolonCsv("a;b,c;d\r\n");
    expect(records).toEqual([{ fields: ["a", "b,c", "d"], raw: "a;b,c;d" }]);
  });

  it("handles a quoted field containing a literal ';' without splitting it", () => {
    const records = tokenizeSemicolonCsv('a;"b;c";d\r\n');
    expect(records[0].fields).toEqual(["a", "b;c", "d"]);
  });

  it("unescapes a doubled quote \"\" inside a quoted field to a single literal quote", () => {
    const records = tokenizeSemicolonCsv('a;"say ""hi""";c\r\n');
    expect(records[0].fields).toEqual(["a", 'say "hi"', "c"]);
  });

  it("keeps a newline inside a quoted field as part of the SAME record (multi-line Verwendungszweck)", () => {
    const records = tokenizeSemicolonCsv('a;"line one\nline two";c\r\n');
    expect(records).toHaveLength(1);
    expect(records[0].fields).toEqual(["a", "line one\nline two", "c"]);
  });

  it("resumes correctly on the next record after a multi-line quoted field", () => {
    const records = tokenizeSemicolonCsv('a;"x\ny";c\r\nd;e;f\r\n');
    expect(records).toHaveLength(2);
    expect(records[1].fields).toEqual(["d", "e", "f"]);
  });

  it("accepts CRLF, bare LF, and bare CR as record terminators", () => {
    expect(tokenizeSemicolonCsv("a;b\r\nc;d\n e;f\r g;h")).toHaveLength(4);
  });

  it("does not produce a trailing empty record for a trailing newline", () => {
    const records = tokenizeSemicolonCsv("a;b\r\n");
    expect(records).toHaveLength(1);
  });

  it("preserves the exact raw text of a record, including its internal newlines", () => {
    const records = tokenizeSemicolonCsv('a;"x\ny";c\r\nd;e;f\r\n');
    expect(records[0].raw).toBe('a;"x\ny";c');
  });
});

// ---------------------------------------------------------------------------
// Rule: German decimal comma (with optional thousands dots, optional
// bare-integer shorthand)
// ---------------------------------------------------------------------------
describe("parseGermanAmount", () => {
  it("parses a simple comma-decimal amount", () => {
    expect(parseGermanAmount("45,23")).toBe(45.23);
  });

  it("strips a thousands dot before the decimal comma", () => {
    expect(parseGermanAmount("1.234,56")).toBe(1234.56);
  });

  it("pads a one-decimal-digit amount to two places", () => {
    expect(parseGermanAmount("832,9")).toBe(832.9);
  });

  it("pads a NEGATIVE one-decimal-digit amount to two places", () => {
    expect(parseGermanAmount("-45,2")).toBe(-45.2);
  });

  it("accepts a bare integer with no comma at all, normalized to two decimal places", () => {
    expect(parseGermanAmount("-190")).toBe(-190);
    expect(parseGermanAmount("190")).toBe(190);
  });

  it("accepts a leading '+' sign", () => {
    expect(parseGermanAmount("+50,00")).toBe(50);
  });

  it("rejects a US-style decimal point instead of a comma (would silently mis-parse the magnitude)", () => {
    expect(parseGermanAmount("45.23")).toBeNull();
    expect(parseGermanAmount("12.34")).toBeNull();
  });

  it("accepts a dot-grouped thousands amount with no comma (valid German shorthand, 3-digit groups)", () => {
    expect(parseGermanAmount("1.234")).toBe(1234);
    expect(parseGermanAmount("12.345.678")).toBe(12345678);
  });

  it("rejects more than two decimal digits", () => {
    expect(parseGermanAmount("45,231")).toBeNull();
  });

  it("rejects non-numeric content", () => {
    expect(parseGermanAmount("abc,00")).toBeNull();
    expect(parseGermanAmount("")).toBeNull();
    expect(parseGermanAmount("   ")).toBeNull();
  });

  it("parses zero (rejecting it as a real transaction is the CALLER's job, not this function's)", () => {
    expect(parseGermanAmount("0,00")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Rule: DD.MM.YY / DD.MM.YYYY dates
// ---------------------------------------------------------------------------
describe("parseGermanBookingDate", () => {
  it("parses a 2-digit-year date with the low-window pivot (00-79 -> 2000-2079)", () => {
    expect(parseGermanBookingDate("01.03.26")).toBe("2026-03-01");
    expect(parseGermanBookingDate("31.12.79")).toBe("2079-12-31");
  });

  it("parses a 2-digit-year date with the high-window pivot (80-99 -> 1980-1999)", () => {
    expect(parseGermanBookingDate("15.06.80")).toBe("1980-06-15");
    expect(parseGermanBookingDate("01.01.99")).toBe("1999-01-01");
  });

  it("parses a 4-digit-year date", () => {
    expect(parseGermanBookingDate("03.03.2026")).toBe("2026-03-03");
  });

  it("rejects an out-of-range day or month rather than guessing", () => {
    expect(parseGermanBookingDate("32.13.26")).toBeNull();
    expect(parseGermanBookingDate("00.01.26")).toBeNull();
    expect(parseGermanBookingDate("01.00.26")).toBeNull();
  });

  it("rejects a non-German date shape (e.g. ISO YYYY-MM-DD)", () => {
    expect(parseGermanBookingDate("2026-03-01")).toBeNull();
  });

  it("rejects garbage", () => {
    expect(parseGermanBookingDate("not a date")).toBeNull();
    expect(parseGermanBookingDate("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rule: CP1252-vs-UTF-8 detection
// ---------------------------------------------------------------------------
describe("detectEncoding / decodeBankStatementBytes", () => {
  it("defaults to windows-1252 when there is no BOM", () => {
    expect(detectEncoding(utf8Bytes("plain ascii"))).toBe("windows-1252");
  });

  it("detects a UTF-8 BOM (EF BB BF) and overrides to utf-8", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8Bytes("hi")]);
    expect(detectEncoding(withBom)).toBe("utf-8");
  });

  it("decodes real CP1252 umlaut bytes correctly by default (no BOM)", () => {
    const bytes = loadFixture("camt-v2-cp1252.csv");
    const { text, encoding } = decodeBankStatementBytes(bytes);
    expect(encoding).toBe("windows-1252");
    expect(text).toContain("Überweisung für Büromöbel");
    expect(text).toContain("Müller & Söhne GmbH");
  });

  it("decodes a UTF-8-with-BOM file correctly via the override path", () => {
    const bytes = loadFixture("camt-v2-utf8-bom.csv");
    const { text, encoding } = decodeBankStatementBytes(bytes);
    expect(encoding).toBe("utf-8");
    expect(text).toContain("Überweisung für Büromöbel");
    expect(text.startsWith("﻿")).toBe(false); // BOM stripped, not left in the text
  });
});

// ---------------------------------------------------------------------------
// Rule: Soll/Haben direction from Betrag's sign alone (no separate column)
// ---------------------------------------------------------------------------
describe("direction derivation (via parseBankStatement)", () => {
  it("a negative Betrag is 'expense' with a positive stored amount", () => {
    const result = parseBankStatement(loadFixture("camt-v2-clean.csv"), USER_ID);
    const rent = result.rows.find((r) => r.customerReference === "REF002");
    expect(rent?.direction).toBe("expense");
    expect(rent?.amount).toBe(650);
  });

  it("a positive Betrag is 'income' with a positive stored amount", () => {
    const result = parseBankStatement(loadFixture("camt-v2-clean.csv"), USER_ID);
    const salary = result.rows.find((r) => r.customerReference === "REF001");
    expect(salary?.direction).toBe("income");
    expect(salary?.amount).toBe(2500);
  });
});

// ---------------------------------------------------------------------------
// computeBankRowHash: deterministic, order-of-inputs-sensitive
// ---------------------------------------------------------------------------
describe("computeBankRowHash", () => {
  const base = { date: "2026-03-01", signedAmount: -45.2, purpose: "Einkauf", counterpartyIban: "DE00" };

  it("is deterministic for identical input", () => {
    expect(computeBankRowHash(USER_ID, base)).toBe(computeBankRowHash(USER_ID, base));
  });

  it("differs when the user differs (per ADR-0017's own hash formula)", () => {
    expect(computeBankRowHash(USER_ID, base)).not.toBe(computeBankRowHash("other-user", base));
  });

  it("differs when the amount differs", () => {
    expect(computeBankRowHash(USER_ID, base)).not.toBe(
      computeBankRowHash(USER_ID, { ...base, signedAmount: -45.21 }),
    );
  });

  it("differs when the date differs", () => {
    expect(computeBankRowHash(USER_ID, base)).not.toBe(
      computeBankRowHash(USER_ID, { ...base, date: "2026-03-02" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Full parseBankStatement, fixture-driven
// ---------------------------------------------------------------------------
describe("parseBankStatement -- clean file", () => {
  it("parses all 6 rows with no quarantine, verdict 'ok', format 'camt-v2'", () => {
    const result = parseBankStatement(loadFixture("camt-v2-clean.csv"), USER_ID);
    expect(result.verdict).toBe("ok");
    expect(result.format).toBe("camt-v2");
    expect(result.encoding).toBe("windows-1252");
    expect(result.totalDataRows).toBe(6);
    expect(result.rows).toHaveLength(6);
    expect(result.quarantined).toHaveLength(0);
    expect(result.quarantineRatio).toBe(0);
  });

  it("normalizes both a 2-digit-year and a 4-digit-year date in the same file", () => {
    const result = parseBankStatement(loadFixture("camt-v2-clean.csv"), USER_ID);
    expect(result.rows.find((r) => r.customerReference === "REF001")?.date).toBe("2026-03-01");
    expect(result.rows.find((r) => r.customerReference === "REF002")?.date).toBe("2026-03-03");
  });

  it("captures direct-debit fields (Gläubiger-ID / Mandatsreferenz) when present", () => {
    const result = parseBankStatement(loadFixture("camt-v2-clean.csv"), USER_ID);
    const directDebit = result.rows.find((r) => r.customerReference === "REF006");
    expect(directDebit?.creditorId).toBe("DE98ZZZ09999999999");
    expect(directDebit?.mandateReference).toBe("MREF-2026-001");
  });

  it("every row carries a computed rowHash", () => {
    const result = parseBankStatement(loadFixture("camt-v2-clean.csv"), USER_ID);
    expect(result.rows.every((r) => typeof r.rowHash === "string" && r.rowHash.length > 0)).toBe(true);
  });

  it("no row carries a category (this is the non-categorized format)", () => {
    const result = parseBankStatement(loadFixture("camt-v2-clean.csv"), USER_ID);
    expect(result.rows.every((r) => r.category === undefined)).toBe(true);
  });
});

describe("parseBankStatement -- 'CSV mit Kategorien' variant", () => {
  it("detects format 'camt-v2-categorized' and captures the Kategorie column", () => {
    const result = parseBankStatement(loadFixture("camt-v2-categorized.csv"), USER_ID);
    expect(result.verdict).toBe("ok");
    expect(result.format).toBe("camt-v2-categorized");
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.category)).toEqual(["Lebensmittel", "Gehalt", "Wohnen"]);
  });
});

describe("parseBankStatement -- header-name resolution, not fixed position", () => {
  it("parses correctly when the columns are in a completely different order", () => {
    const result = parseBankStatement(loadFixture("camt-v2-reordered-columns.csv"), USER_ID);
    expect(result.verdict).toBe("ok");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ date: "2026-03-18", amount: 100, direction: "income", purpose: "Testzahlung eins" });
    expect(result.rows[1]).toMatchObject({ date: "2026-03-19", amount: 50, direction: "expense", purpose: "Testzahlung zwei" });
  });
});

describe("parseBankStatement -- multi-line Verwendungszweck", () => {
  it("keeps a multi-line purpose field intact as a single row and resumes correctly on the next row", () => {
    const result = parseBankStatement(loadFixture("camt-v2-multiline-purpose.csv"), USER_ID);
    expect(result.verdict).toBe("ok");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].purpose).toBe("Rechnung Nr. 4711\nBestellung vom 10.03.2026\nVielen Dank fuer Ihren Einkauf");
    expect(result.rows[1].purpose).toBe("Rueckerstattung");
  });
});

describe("parseBankStatement -- header-only file", () => {
  it("is a valid, empty result -- not a structural failure and not blocked", () => {
    const result = parseBankStatement(loadFixture("camt-v2-header-only.csv"), USER_ID);
    expect(result.verdict).toBe("ok");
    expect(result.format).toBe("camt-v2");
    expect(result.rows).toHaveLength(0);
    expect(result.quarantined).toHaveLength(0);
    expect(result.totalDataRows).toBe(0);
    expect(result.quarantineRatio).toBe(0);
  });
});

describe("parseBankStatement -- structural failures", () => {
  it("blocks a genuinely empty file", () => {
    const result = parseBankStatement(new Uint8Array(0), USER_ID);
    expect(result.verdict).toBe("blocked_structural");
    expect(result.format).toBeNull();
    expect(result.structuralError).toMatch(/empty/i);
  });

  it("blocks a file missing a required column, naming it in the error", () => {
    const result = parseBankStatement(loadFixture("camt-v2-missing-column.csv"), USER_ID);
    expect(result.verdict).toBe("blocked_structural");
    expect(result.format).toBeNull();
    expect(result.rows).toHaveLength(0);
    expect(result.structuralError).toContain("Waehrung");
  });
});

// ---------------------------------------------------------------------------
// Quarantine, not fail-closed (ADR-0017 Decision item 2)
// ---------------------------------------------------------------------------
describe("parseBankStatement -- quarantine under the 20% threshold", () => {
  it("imports the 5 good rows and quarantines the 1 bad row, with a line number and reason", () => {
    const result = parseBankStatement(loadFixture("camt-v2-partial-quarantine.csv"), USER_ID);
    expect(result.verdict).toBe("ok");
    expect(result.totalDataRows).toBe(6);
    expect(result.rows).toHaveLength(5);
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantineRatio).toBeCloseTo(1 / 6);

    const bad = result.quarantined[0];
    expect(bad.lineNumber).toBe(6);
    expect(bad.reasonCode).toBe("invalid_amount");
    expect(bad.reason).toContain("abc,00");
    expect(bad.rawLine).toContain("REF007");
  });
});

describe("parseBankStatement -- blocked over the 20% threshold", () => {
  it("blocks the entire import (zero committable rows implied by the verdict) when quarantine exceeds 20%", () => {
    const result = parseBankStatement(loadFixture("camt-v2-over-threshold.csv"), USER_ID);
    expect(result.verdict).toBe("blocked_over_threshold");
    expect(result.totalDataRows).toBe(5);
    expect(result.quarantined).toHaveLength(2);
    expect(result.quarantineRatio).toBeCloseTo(0.4);
    expect(result.quarantined.map((q) => q.reasonCode).sort()).toEqual(["invalid_amount", "invalid_date"]);
  });
});

describe("parseBankStatement -- threshold boundary is pinned exactly (> not >=)", () => {
  // Constructed in-memory rather than as fixture files: precise, minimal
  // control over the exact ratio on both sides of the 20% line. Encoded as
  // CP1252/Latin-1 bytes (not plain UTF-8 TextEncoder), matching the
  // parser's own default no-BOM decode path -- the header row contains
  // "Begünstigter"/"Gläubiger-ID", and a UTF-8-without-BOM encoding of
  // those would be misread as windows-1252 by the parser itself (its own
  // default rule), corrupting the required header names and tripping a
  // structural block instead of exercising the threshold logic this test
  // is actually about. Every character used here is <= U+00FF, so a
  // Latin-1 byte-per-char encoding is byte-identical to CP1252 for this
  // content -- same technique the fixture generator used.
  function encodeCp1252(text: string): Uint8Array {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes;
  }

  function buildCsv(goodCount: number, badCount: number): Uint8Array {
    const header =
      "Auftragskonto;Buchungstag;Valutadatum;Buchungstext;Verwendungszweck;Auftraggeber/Begünstigter;Kontonummer/IBAN;BLZ/BIC;Betrag;Waehrung;Gläubiger-ID;Mandatsreferenz;Kundenreferenz";
    const rows: string[] = [];
    for (let i = 0; i < goodCount; i++) {
      rows.push(`${ACCT};01.03.26;01.03.26;Gutschrift;Zahlung ${i};Kunde ${i};DE00000000000000000${i};;10,00;EUR;;;REF${i}`);
    }
    for (let i = 0; i < badCount; i++) {
      rows.push(`${ACCT};01.03.26;01.03.26;Gutschrift;Fehler ${i};Kunde ${i};DE00000000000000000${i};;xx,00;EUR;;;BAD${i}`);
    }
    return encodeCp1252([header, ...rows].join("\r\n") + "\r\n");
  }
  const ACCT = "DE02500105170137075030";

  it("passes at exactly the 20% threshold (2 bad of 10) -- QUARANTINE_BLOCK_THRESHOLD itself is 0.2", () => {
    expect(QUARANTINE_BLOCK_THRESHOLD).toBe(0.2);
    const result = parseBankStatement(buildCsv(8, 2), USER_ID);
    expect(result.quarantineRatio).toBeCloseTo(0.2);
    expect(result.verdict).toBe("ok");
  });

  it("blocks just over the 20% threshold (3 bad of 10)", () => {
    const result = parseBankStatement(buildCsv(7, 3), USER_ID);
    expect(result.quarantineRatio).toBeCloseTo(0.3);
    expect(result.verdict).toBe("blocked_over_threshold");
  });
});

// ---------------------------------------------------------------------------
// Nothing is ever silently skipped -- every quarantined row is accounted for
// ---------------------------------------------------------------------------
describe("parseBankStatement -- accounting invariant", () => {
  it("parsed rows + quarantined rows always equals totalDataRows, for every fixture", () => {
    for (const name of [
      "camt-v2-clean.csv",
      "camt-v2-partial-quarantine.csv",
      "camt-v2-over-threshold.csv",
      "camt-v2-multiline-purpose.csv",
      "camt-v2-categorized.csv",
      "camt-v2-reordered-columns.csv",
    ]) {
      const result = parseBankStatement(loadFixture(name), USER_ID);
      expect(result.rows.length + result.quarantined.length).toBe(result.totalDataRows);
    }
  });
});
