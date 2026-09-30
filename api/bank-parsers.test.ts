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

  it("PDF со долги редови не се чита како KB ставки", () => {
    const long = "Извод за промените и состојбата на сметката за ден 29.09.2026, број на извод 187 Број на сметката: 300000000123456 " + "x".repeat(400);
    expect(detectAndParse("izvod.pdf", long).format).toBe("PDF");
  });

  it("PDF: ставки од редови (колони должи | побарува | салдо)", () => {
    const text = [
      "Извод број 45 за ден 29.09.2026",
      "Сметка: 300-0000012345-67",
      "Претходно салдо 100.000,00",
      "29.09.2026  Градба ДООЕЛ  200-0000098765-43  Уплата по фактура 005/2026  0,00  11.800,00  111.800,00",
      "29.09.2026  Челик ДОО  300-0000055555-11  Плаќање фактура F-1  5.000,00  0,00  106.800,00",
      "29.09.2026  Провизија за налог  -45,00",
      "Ново салдо 106.755,00",
    ].join("\n");
    const r = detectAndParse("kb.pdf", text);
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0]).toMatchObject({ accountNumber: "300000001234567", statementNo: "45", statementDate: "2026-09-29", prevBalance: 100000, newBalance: 106755 });
    const t = r.statements[0].transactions;
    expect(t).toHaveLength(3);
    expect(t[0]).toMatchObject({ direction: "in", amount: 11800, counterpartyAccount: "200000009876543" });
    expect(t[1]).toMatchObject({ direction: "out", amount: 5000 });
    expect(t[2]).toMatchObject({ direction: "out", amount: 45 });
  });

  it("PDF без препознатлив формат: јасна порака", () => {
    const r = detectAndParse("nesto.pdf", "Некој текст без датуми");
    expect(r.statements).toHaveLength(0);
    expect(r.warnings.join(" ")).toMatch(/не е препознаен/);
  });

  it("PDF: текст во втор ред се додава кон ставката", () => {
    const text = [
      "Сметка: 300-0000012345-67 за ден 30.09.2026",
      "30.09.2026  Градба ДООЕЛ  Уплата по  0,00  11.800,00  111.800,00",
      "200-0000098765-43  фактура 005/2026",
      "Ново салдо 111.800,00",
    ].join("\n");
    const t = detectAndParse("x.pdf", text).statements[0].transactions;
    expect(t[0]).toMatchObject({ direction: "in", amount: 11800, counterpartyAccount: "200000009876543" });
    expect(t[0].purpose).toMatch(/фактура 005\/2026/);
  });
});

