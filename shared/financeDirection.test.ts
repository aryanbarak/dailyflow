import { describe, expect, it } from "vitest";
import { parseFinanceDirection } from "./financeDirection";

describe("parseFinanceDirection", () => {
  it("resolves the PO's exact production phrasing (task 41-verify/task 42) to expense via the category+verb fallback", () => {
    // Copied byte-for-byte from task 42's own instructions -- never retyped.
    const PO_STRING = "مبلغ ۲۵ یورو در بخش مواد غذایی اضافه کن";
    expect(parseFinanceDirection(PO_STRING)).toBe("expense");
  });

  it("still resolves explicit expense wording (regression guard, unchanged behavior)", () => {
    expect(parseFinanceDirection("I spent 20 EUR on coffee")).toBe("expense");
    expect(parseFinanceDirection("هزینه ۴۵ یورو ثبت کن")).toBe("expense");
  });

  it("still resolves explicit income wording (regression guard, unchanged behavior)", () => {
    expect(parseFinanceDirection("I got paid 1200 EUR")).toBe("income");
    expect(parseFinanceDirection("درآمد ۵۰ یورو ثبت کن")).toBe("income");
  });

  it("an explicit income word always wins over the category+verb inference, never overridden by it", () => {
    // Contains BOTH an explicit income word (حقوق) AND the category+verb
    // shape (بخش ... ثبت کن) that would otherwise infer expense --
    // the explicit check must win because it runs first and returns early.
    expect(parseFinanceDirection("حقوق ۵۰ یورو در بخش درآمد ثبت کن")).toBe("income");
  });

  it("infers expense from a spending category named with بخش + a write verb, with no explicit expense word present", () => {
    expect(parseFinanceDirection("در بخش حمل و نقل ثبت کن")).toBe("expense");
    expect(parseFinanceDirection("در دسته قبض‌ها وارد کن")).toBe("expense");
    expect(parseFinanceDirection("بخش سرگرمی اضافه کن")).toBe("expense");
  });

  it("does not infer a direction from a category phrase alone, with no write verb present", () => {
    expect(parseFinanceDirection("بخش مواد غذایی")).toBeUndefined();
  });

  it("does not infer a direction from a write verb alone, with no category phrase present", () => {
    expect(parseFinanceDirection("اضافه کن")).toBeUndefined();
    expect(parseFinanceDirection("ثبت کن")).toBeUndefined();
  });

  it("never infers a direction from an amount alone", () => {
    expect(parseFinanceDirection("۲۵ یورو")).toBeUndefined();
    expect(parseFinanceDirection("25 EUR")).toBeUndefined();
  });

  it("returns undefined for a genuinely ambiguous finance message (amount + write verb, no category, no explicit word)", () => {
    expect(parseFinanceDirection("مبلغ ۲۰ یورو ثبت کن")).toBeUndefined();
  });

  it("the colloquial verb بزن (task 41's own over-triggering risk) is deliberately excluded from the category inference", () => {
    expect(parseFinanceDirection("در بخش مواد غذایی بزن")).toBeUndefined();
  });
});
