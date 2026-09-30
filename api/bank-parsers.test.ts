import { describe, it, expect } from "vitest";
import { numAny, parsePdfText, detectAndParse } from "./bank-parsers";

describe("износи од извод", () => {
  it("македонски и англиски запис", () => {
    expect(numAny("115.000,00")).toBe(115000);
    expect(numAny("1.234.567,89")).toBe(1234567.89);
    expect(numAny("115,000.00")).toBe(115000);
    expect(numAny("2500,5")).toBe(2500.5);
    expect(numAny("115.000")).toBe(115000);
    expect(numAny("99.95")).toBe(99.95);
  });

  it("PDF извод: заглавие и салда", () => {
    const text = "Извод за промените и состојбата на сметката за ден 29.09.2026, број на извод 187 Број на сметката: 300000000123456 100.000,00 20.000,00 35.000,00 115.000,00 3 5 0,00";
    const r = parsePdfText(text);
    expect(r.statements[0]).toMatchObject({ statementNo: "187", statementDate: "2026-09-29", accountNumber: "300000000123456", prevBalance: 100000, newBalance: 115000 });
    expect(detectAndParse("izvod.pdf", text).format).toBe("PDF");
  });
});
