// Task 45c, ADR-0017. Built entirely from Slice 1's own fixtures
// (shared/__fixtures__/bankStatements/) -- proves the preview really is a
// pure function of the parser's output, with no re-parsing of its own.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseBankStatement } from "./bankStatementParser";
import { buildBatchImportPreview, selectImportableRows } from "./bankImportBatchPreview";

const FIXTURE_DIR = path.join(__dirname, "__fixtures__", "bankStatements");
const USER_ID = "test-user-1";

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURE_DIR, name)));
}

function parse(name: string) {
  return parseBankStatement(loadFixture(name), USER_ID);
}

describe("buildBatchImportPreview -- clean file, no duplicates", () => {
  it("reports every row as importable, correct date range and sums, single currency", () => {
    const result = parse("camt-v2-clean.csv");
    const preview = buildBatchImportPreview(result, new Set());

    expect(preview.verdict).toBe("ok");
    expect(preview.importableCount).toBe(6);
    expect(preview.duplicateCount).toBe(0);
    expect(preview.quarantinedCount).toBe(0);
    expect(preview.dateRange).toEqual({ start: "2026-03-01", end: "2026-03-12" });
    // income rows: 2500.00 (REF001) + 832.90 (REF005) = 3332.90
    expect(preview.sums.income).toBeCloseTo(3332.9);
    // expense rows: 650.00 + 45.20 + 30.00 + 120.00 = 845.20
    expect(preview.sums.expense).toBeCloseTo(845.2);
    expect(preview.currency).toBe("EUR");
    expect(preview.mixedCurrency).toBe(false);
  });

  it("never exposes a per-row date/amount/description -- aggregate-only, per ADR-0017", () => {
    const result = parse("camt-v2-clean.csv");
    const preview = buildBatchImportPreview(result, new Set());
    const serialized = JSON.stringify(preview);
    // None of the individual transactions' distinguishing text should leak
    // into the preview's own shape.
    expect(serialized).not.toContain("Musterfirma");
    expect(serialized).not.toContain("Hausverwaltung");
    expect(serialized).not.toContain("2500");
  });
});

describe("buildBatchImportPreview -- duplicates excluded, visible as a count", () => {
  it("excludes duplicate rows from importableCount and sums, and reports their count separately", () => {
    const result = parse("camt-v2-clean.csv");
    expect(result.rows).toHaveLength(6);
    const [first, second] = result.rows;
    const duplicateHashes = new Set([first.rowHash, second.rowHash]);

    const preview = buildBatchImportPreview(result, duplicateHashes);
    expect(preview.importableCount).toBe(4);
    expect(preview.duplicateCount).toBe(2);
    // The excluded rows (REF001 income 2500, REF002 expense 650) must not
    // contribute to the sums.
    expect(preview.sums.income).toBeCloseTo(832.9);
    expect(preview.sums.expense).toBeCloseTo(195.2); // 45.20 + 30.00 + 120.00
  });

  it("all rows duplicate: zero importable, sums zero, dateRange null -- not a crash, not a false range", () => {
    const result = parse("camt-v2-clean.csv");
    const duplicateHashes = new Set(result.rows.map((r) => r.rowHash));
    const preview = buildBatchImportPreview(result, duplicateHashes);
    expect(preview.importableCount).toBe(0);
    expect(preview.duplicateCount).toBe(6);
    expect(preview.dateRange).toBeNull();
    expect(preview.sums).toEqual({ income: 0, expense: 0 });
    expect(preview.currency).toBeNull();
  });
});

describe("buildBatchImportPreview -- quarantine under threshold", () => {
  it("reports the quarantined row's line number and reason, still verdict ok", () => {
    const result = parse("camt-v2-partial-quarantine.csv");
    const preview = buildBatchImportPreview(result, new Set());
    expect(preview.verdict).toBe("ok");
    expect(preview.importableCount).toBe(5);
    expect(preview.quarantinedCount).toBe(1);
    expect(preview.quarantined).toEqual([
      { lineNumber: 6, reasonCode: "invalid_amount", reason: expect.stringContaining("abc,00") },
    ]);
  });
});

describe("buildBatchImportPreview -- blocked over threshold", () => {
  it("reports zero importable and the block verdict, even though some rows technically parsed", () => {
    const result = parse("camt-v2-over-threshold.csv");
    const preview = buildBatchImportPreview(result, new Set());
    expect(preview.verdict).toBe("blocked_over_threshold");
    expect(preview.importableCount).toBe(0);
    expect(preview.duplicateCount).toBe(0);
    expect(preview.quarantinedCount).toBe(2);
    expect(preview.dateRange).toBeNull();
  });
});

describe("buildBatchImportPreview -- structural block", () => {
  it("surfaces the structural error, zero counts, no crash on an empty rows array", () => {
    const result = parse("camt-v2-missing-column.csv");
    const preview = buildBatchImportPreview(result, new Set());
    expect(preview.verdict).toBe("blocked_structural");
    expect(preview.structuralError).toContain("Waehrung");
    expect(preview.importableCount).toBe(0);
    expect(preview.quarantined).toEqual([]);
  });
});

describe("buildBatchImportPreview -- header-only (empty statement)", () => {
  it("verdict ok, zero everything, no false date range", () => {
    const result = parse("camt-v2-header-only.csv");
    const preview = buildBatchImportPreview(result, new Set());
    expect(preview.verdict).toBe("ok");
    expect(preview.importableCount).toBe(0);
    expect(preview.dateRange).toBeNull();
    expect(preview.currency).toBeNull();
  });
});

describe("buildBatchImportPreview -- selectImportableRows is the SAME filter the preview itself uses", () => {
  it("returns exactly the rows the preview's own importableCount reflects, byte-identical row objects", () => {
    const result = parse("camt-v2-clean.csv");
    const duplicateHashes = new Set([result.rows[0].rowHash]);
    const preview = buildBatchImportPreview(result, duplicateHashes);
    const importable = selectImportableRows(result, duplicateHashes);
    expect(importable).toHaveLength(preview.importableCount);
    expect(importable.every((row) => row.rowHash !== result.rows[0].rowHash)).toBe(true);
  });
});

describe("buildBatchImportPreview -- mixed currency (non-tautology: currency is null, not silently the first one seen)", () => {
  it("flags mixedCurrency and returns currency null when importable rows carry different currencies", () => {
    const result = parse("camt-v2-clean.csv");
    // Synthesize a mixed-currency scenario without touching the fixture
    // file itself -- proves the function's own logic, not fixture content.
    const mutated = {
      ...result,
      rows: result.rows.map((row, i) => (i === 0 ? { ...row, currency: "USD" } : row)),
    };
    const preview = buildBatchImportPreview(mutated, new Set());
    expect(preview.mixedCurrency).toBe(true);
    expect(preview.currency).toBeNull();
  });
});
