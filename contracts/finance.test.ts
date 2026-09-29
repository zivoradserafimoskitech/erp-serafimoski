import { describe, it, expect } from "vitest";
import {
  invoiceLines, incomingLines, paymentLines, cashOtherLines, payrollLines, isBalanced, normalizeLines, fixRounding,
  toMkd, convert, parseNbrmRates, calcPayroll, rulesWithDefaults, linesSignature, DEFAULT_PAYROLL,
} from "./finance";

const rules = rulesWithDefaults({});
const rate = (cur: string, date: string) => (cur === "EUR" ? (date < "2026-06-01" ? 61.5 : 61.7) : cur === "USD" ? 55 : null);

describe("книжење на фактури", () => {
  it("домашна фактура: купувач = приход + ДДВ", () => {
    const l = invoiceLines({ subtotalMkd: 1000, vatMkd: 180, foreign: false, customerId: 1, number: "1/2026", rules });
    expect(isBalanced(l)).toBe(true);
    expect(l.find(x => x.account === "120")?.debit).toBe(1180);
    expect(l.find(x => x.account === "740")?.credit).toBe(1000);
    expect(l.find(x => x.account === "230")?.credit).toBe(180);
  });
  it("фактура за странство без ДДВ оди на 121/741 и нема ред за ДДВ", () => {
    const l = invoiceLines({ subtotalMkd: 61500, vatMkd: 0, foreign: true, customerId: 1, number: "2/2026", rules });
    expect(l.map(x => x.account).sort()).toEqual(["121", "741"]);
    expect(isBalanced(l)).toBe(true);
  });
  it("книжно одобрување (негативни износи) ги сврти страните", () => {
    const l = invoiceLines({ subtotalMkd: -100, vatMkd: -18, foreign: false, customerId: 1, number: "КН-1", rules });
    expect(l.find(x => x.account === "120")?.credit).toBe(118);
    expect(l.find(x => x.account === "740")?.debit).toBe(100);
    expect(isBalanced(l)).toBe(true);
  });
  it("влезна фактура: набавка + претходен ДДВ = добавувач", () => {
    const l = incomingLines({ subtotalMkd: 10000, vatMkd: 1800, foreign: false, supplierId: 2, number: "F-1", rules });
    expect(l.find(x => x.account === "220")?.credit).toBe(11800);
    expect(l.find(x => x.account === "130")?.debit).toBe(1800);
    expect(isBalanced(l)).toBe(true);
  });
});

describe("плаќања и курсни разлики", () => {
  it("наплата по повисок курс = позитивна курсна разлика", () => {
    const l = paymentLines({ direction: "in", moneyAccount: "102", partnerAccount: "121", moneyMkd: 61700, docMkd: 61500, partnerType: "customer", partnerId: 1, ref: "X", rules });
    expect(l.find(x => x.account === "770")?.credit).toBe(200);
    expect(isBalanced(l)).toBe(true);
  });
  it("наплата по понизок курс = негативна курсна разлика", () => {
    const l = paymentLines({ direction: "in", moneyAccount: "102", partnerAccount: "121", moneyMkd: 61300, docMkd: 61500, partnerType: "customer", partnerId: 1, ref: "X", rules });
    expect(l.find(x => x.account === "470")?.debit).toBe(200);
    expect(isBalanced(l)).toBe(true);
  });
  it("плаќање на добавувач по повисок курс = загуба", () => {
    const l = paymentLines({ direction: "out", moneyAccount: "102", partnerAccount: "221", moneyMkd: 6170, docMkd: 6150, partnerType: "supplier", partnerId: 3, ref: "Y", rules });
    expect(l.find(x => x.account === "470")?.debit).toBe(20);
    expect(isBalanced(l)).toBe(true);
  });
  it("благајна без документ оди на контра конто", () => {
    const l = cashOtherLines({ direction: "out", amount: 500, cashAccount: "103", contra: "449", ref: "ИП-1" });
    expect(l).toEqual([
      { account: "449", debit: 500, credit: 0, description: "ИП-1" },
      { account: "103", debit: 0, credit: 500, description: "ИП-1" },
    ]);
  });
});

describe("помошни", () => {
  it("normalizeLines ги спојува и отстранува нулите", () => {
    expect(normalizeLines([{ account: "1", debit: 0, credit: 0 }, { account: "2", debit: -5, credit: 0 }])).toEqual([{ account: "2", debit: 0, credit: 5 }]);
  });
  it("fixRounding ја затвора разликата од 1 денар", () => {
    const l = fixRounding([{ account: "1", debit: 100.01, credit: 0 }, { account: "2", debit: 0, credit: 100 }]);
    expect(isBalanced(l)).toBe(true);
    expect(l.every(x => !(x.debit && x.credit))).toBe(true);
  });
  it("конверзија на валути", () => {
    expect(toMkd(100, "MKD", "2026-01-01", rate)).toBe(100);
    expect(toMkd(100, "EUR", "2026-01-01", rate)).toBe(6150);
    expect(toMkd(100, "GBP", "2026-01-01", rate)).toBeNull();
    expect(convert(6150, "MKD", "EUR", "2026-01-01", rate)).toBeCloseTo(100);
  });
  it("потписот се менува кога се менува износот", () => {
    const a = linesSignature("2026-01-01", [{ account: "1", debit: 1, credit: 0 }]);
    const b = linesSignature("2026-01-01", [{ account: "1", debit: 2, credit: 0 }]);
    expect(a).not.toBe(b);
  });
  it("парсира курсна листа од НБРМ (повеќе формати)", () => {
    const r = parseNbrmRates([
      { datum: "2026-09-29T00:00:00", valuta: "EUR", sreden: 61.6953, nomin: 1 },
      { datum: "29.09.2026", oznaka: "JPY", sreden: 36.5, nomin: 100 },
      { datum: "", valuta: "XXX", sreden: 0 },
    ]);
    expect(r).toEqual([{ date: "2026-09-29", currency: "EUR", rate: 61.6953 }, { date: "2026-09-29", currency: "JPY", rate: 0.365 }]);
  });
});

describe("плати", () => {
  it("пресметка: придонеси, даночна основа, данок, нето", () => {
    const c = calcPayroll(60000, { contributionRate: 28, incomeTaxRate: 10, personalExemption: 10000 });
    expect(c).toEqual({ gross: 60000, contributions: 16800, taxBase: 33200, incomeTax: 3320, net: 39880 });
  });
  it("ниска плата нема негативна даночна основа", () => {
    expect(calcPayroll(12000, DEFAULT_PAYROLL).taxBase).toBe(0);
  });
  it("книжење на плати е во рамнотежа", () => {
    const c = calcPayroll(60000, DEFAULT_PAYROLL);
    expect(isBalanced(payrollLines({ ...c, period: "2026-09", rules }))).toBe(true);
  });
});
