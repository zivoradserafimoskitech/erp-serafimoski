// Биланс на состојба, Биланс на успех и ДДВ-04 — составени од главната книга по класи на контниот план.
// Секое конто оди во редот со најдолгиот префикс што му одговара. Броевите на полињата (АОП / поле во
// ДДВ-04) ги внесува сметководителот еднаш (се чуваат во подесувањата) — програмата не ги измислува.

export type StatementLine = { key: string; label: string; prefixes: string[] };
export type StatementSection = { key: string; label: string; lines: StatementLine[] };

/** Актива: салдо должи − побарува. */
export const BS_ASSETS: StatementSection[] = [
  { key: "A", label: "А. Нетековни средства", lines: [
    { key: "a_intangible", label: "Нематеријални средства", prefixes: ["00"] },
    { key: "a_tangible", label: "Материјални средства (опрема, згради, возила), намалени за амортизацијата", prefixes: ["01", "02"] },
    { key: "a_fin_lt", label: "Долгорочни финансиски вложувања и побарувања", prefixes: ["03", "04", "05", "06", "07", "08", "09"] },
  ] },
  { key: "B", label: "Б. Тековни средства", lines: [
    { key: "a_inventory", label: "Залихи: материјал, недовршено производство, готови производи, стоки", prefixes: ["3", "6"] },
    { key: "a_receivables", label: "Побарувања од купувачи", prefixes: ["12"] },
    { key: "a_other_rec", label: "Други краткорочни побарувања (ДДВ, дадени аванси, вработени...)", prefixes: ["11", "13", "14", "15", "16", "17", "18"] },
    { key: "a_cash", label: "Парични средства (банка, благајна)", prefixes: ["10"] },
    { key: "a_prepaid", label: "Активни временски разграничувања", prefixes: ["19"] },
  ] },
];

/** Пасива: салдо побарува − должи. Тековниот резултат (класи 4, 5, 7) се додава во главнината. */
export const BS_LIABILITIES: StatementSection[] = [
  { key: "E", label: "А. Главнина и резерви", lines: [
    { key: "e_capital", label: "Запишан капитал", prefixes: ["90"] },
    { key: "e_reserves", label: "Резерви, пренесена добивка / загуба", prefixes: ["91", "92", "93", "94", "95"] },
    { key: "e_closed", label: "Резултат од затворени години", prefixes: ["8"] },
    { key: "e_current", label: "Добивка / загуба во тековниот период (незатворена)", prefixes: ["4", "5", "7"] },
  ] },
  { key: "L", label: "Б. Долгорочни резервирања и обврски", lines: [
    { key: "l_long", label: "Долгорочни резервирања, кредити и обврски", prefixes: ["96", "97", "98", "99"] },
  ] },
  { key: "S", label: "В. Краткорочни обврски", lines: [
    { key: "l_suppliers", label: "Обврски кон добавувачи", prefixes: ["22"] },
    { key: "l_advances", label: "Примени аванси од купувачи", prefixes: ["235"] },
    { key: "l_tax", label: "Обврски за даноци (ДДВ, данок на добивка)", prefixes: ["23"] },
    { key: "l_payroll", label: "Обврски кон вработените (плати, придонеси, персонален данок)", prefixes: ["24"] },
    { key: "l_loans", label: "Краткорочни кредити и други обврски", prefixes: ["20", "21", "25", "26", "27", "28"] },
    { key: "l_accrued", label: "Пасивни временски разграничувања", prefixes: ["29"] },
  ] },
];

/** Биланс на успех: приходи (побарува − должи) и расходи (должи − побарува) за периодот. */
export const IS_REVENUE: StatementLine[] = [
  { key: "r_sales", label: "Приходи од продажба на производи и услуги", prefixes: ["74"] },
  { key: "r_other", label: "Други приходи од работењето (вишоци, отписи на обврски...)", prefixes: ["70", "71", "72", "73", "75", "76", "78", "79"] },
  { key: "r_fin", label: "Финансиски приходи (позитивни курсни разлики, камати)", prefixes: ["77"] },
];
export const IS_EXPENSE: StatementLine[] = [
  { key: "x_inv_change", label: "Промена на залихите на недовршено производство и готови производи", prefixes: ["49"] },
  { key: "x_material", label: "Материјали, енергија и резервни делови", prefixes: ["40"] },
  { key: "x_services", label: "Услуги (транспорт, одржување, закуп, други)", prefixes: ["41"] },
  { key: "x_salaries", label: "Плати и надоместоци на вработените", prefixes: ["42"] },
  { key: "x_depr", label: "Амортизација", prefixes: ["43"] },
  { key: "x_other", label: "Други трошоци од работењето (провизии, кусоци, отписи)", prefixes: ["44", "45", "46", "48", "5"] },
  { key: "x_fin", label: "Финансиски расходи (негативни курсни разлики, камати)", prefixes: ["47"] },
];
export const IS_TAX: StatementLine = { key: "x_tax", label: "Данок на добивка", prefixes: ["81"] };

/** Ред за конто: најдолгиот префикс што одговара. */
export function lineFor(code: string, lines: StatementLine[]): StatementLine | null {
  let best: StatementLine | null = null, len = 0;
  for (const l of lines) for (const p of l.prefixes) if (code.startsWith(p) && p.length > len) { best = l; len = p.length; }
  return best;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export type AccountBalance = { code: string; name: string; balance: number }; // должи − побарува

export type StatementRow = { key: string; label: string; amount: number; accounts: { code: string; name: string; amount: number }[] };

function fill(lines: StatementLine[], balances: AccountBalance[], sign: 1 | -1, used: Set<string>): StatementRow[] {
  return lines.map((l) => {
    const accounts = balances
      .filter((b) => lineFor(b.code, lines) === l)
      .map((b) => { used.add(b.code); return { code: b.code, name: b.name, amount: r2(sign * b.balance) }; })
      .filter((a) => a.amount !== 0);
    return { key: l.key, label: l.label, amount: r2(accounts.reduce((s, a) => s + a.amount, 0)), accounts };
  });
}

/** Биланс на состојба на даден датум од салдата на контата (сите налози до датумот). */
export function buildBalanceSheet(balances: AccountBalance[]) {
  const used = new Set<string>();
  const allLiab = BS_LIABILITIES.flatMap((s) => s.lines);
  const assets = BS_ASSETS.map((s) => ({ key: s.key, label: s.label, rows: fill(s.lines, balances, 1, used) }));
  // пасива: секое конто во точно еден ред (префиксот 235 е подолг од 23)
  const liabRows = fill(allLiab, balances.filter((b) => !used.has(b.code)), -1, used);
  const liabilities = BS_LIABILITIES.map((s) => ({ key: s.key, label: s.label, rows: s.lines.map((l) => liabRows.find((r) => r.key === l.key)!) }));
  const unmapped = balances.filter((b) => !used.has(b.code) && r2(b.balance) !== 0);
  const total = (secs: { rows: StatementRow[] }[]) => r2(secs.reduce((s, x) => s + x.rows.reduce((a, r) => a + r.amount, 0), 0));
  const totalAssets = total(assets), totalLiabilities = total(liabilities);
  return { assets, liabilities, totalAssets, totalLiabilities, difference: r2(totalAssets - totalLiabilities), unmapped };
}

/** Биланс на успех за период од прометот на контата (без налогот за затворање на годината). */
export function buildIncomeStatement(movements: AccountBalance[]) {
  const used = new Set<string>();
  const revenue = fill(IS_REVENUE, movements, -1, used);
  const expense = fill(IS_EXPENSE, movements, 1, used);
  const [tax] = fill([IS_TAX], movements, 1, used);
  const totalRevenue = r2(revenue.reduce((s, r) => s + r.amount, 0));
  const totalExpense = r2(expense.reduce((s, r) => s + r.amount, 0));
  const beforeTax = r2(totalRevenue - totalExpense);
  return { revenue, expense, tax, totalRevenue, totalExpense, beforeTax, net: r2(beforeTax - tax.amount) };
}

// ───────────── ДДВ-04 ─────────────

export type VatRow = { vatRate: number; baseMkd: number; vatMkd: number; foreign: boolean; reverseCharge?: boolean };
export type Vat04Line = { key: string; label: string; side: "out" | "in" | "total"; base: number | null; vat: number | null; count: number };

export const VAT04_LINES: { key: string; label: string; side: "out" | "in" | "total"; hasBase: boolean; hasVat: boolean }[] = [
  { key: "o18", label: "Промет по општа стапка 18%", side: "out", hasBase: true, hasVat: true },
  { key: "o10", label: "Промет по стапка 10%", side: "out", hasBase: true, hasVat: true },
  { key: "o5", label: "Промет по повластена стапка 5%", side: "out", hasBase: true, hasVat: true },
  { key: "o_export", label: "Извоз и промет кон странство (0%, со ЕЦД)", side: "out", hasBase: true, hasVat: false },
  { key: "o_exempt", label: "Промет во земјата ослободен од ДДВ (0%)", side: "out", hasBase: true, hasVat: false },
  { key: "o_rc", label: "Услуги примени од странство — ДДВ го пресметуваме ние (обратно оданочување)", side: "out", hasBase: true, hasVat: true },
  { key: "i18", label: "Влезен промет по 18% — претходен данок", side: "in", hasBase: true, hasVat: true },
  { key: "i10", label: "Влезен промет по 10% — претходен данок", side: "in", hasBase: true, hasVat: true },
  { key: "i5", label: "Влезен промет по 5% — претходен данок", side: "in", hasBase: true, hasVat: true },
  { key: "i_rc", label: "Претходен данок од обратно оданочување (услуги од странство)", side: "in", hasBase: true, hasVat: true },
  { key: "i0", label: "Набавки без ДДВ (ослободени, од странство, без право на одбивка)", side: "in", hasBase: true, hasVat: false },
  { key: "t_out", label: "Вкупно излезен ДДВ (даночен долг)", side: "total", hasBase: false, hasVat: true },
  { key: "t_in", label: "Вкупно претходен данок за одбивање", side: "total", hasBase: false, hasVat: true },
  { key: "t_pay", label: "ДДВ за уплата (+) / за поврат (−)", side: "total", hasBase: false, hasVat: true },
];

function outKey(r: VatRow): string {
  if (r.reverseCharge) return "o_rc";
  const rate = Math.round(r.vatRate);
  if (rate === 0) return r.foreign ? "o_export" : "o_exempt";
  return rate === 5 ? "o5" : rate === 10 ? "o10" : "o18";
}
function inKey(r: VatRow): string {
  if (r.reverseCharge) return "i_rc";
  const rate = Math.round(r.vatRate);
  return rate === 0 ? "i0" : rate === 5 ? "i5" : rate === 10 ? "i10" : "i18";
}

/** Редови на ДДВ-04 од КИФ (излезни) и КУФ (влезни) за периодот. */
export function buildVat04(outgoing: VatRow[], incoming: VatRow[]): Vat04Line[] {
  const acc = new Map<string, { base: number; vat: number; count: number }>();
  const add = (k: string, r: VatRow) => {
    const g = acc.get(k) ?? { base: 0, vat: 0, count: 0 };
    g.base = r2(g.base + r.baseMkd); g.vat = r2(g.vat + r.vatMkd); g.count++;
    acc.set(k, g);
  };
  for (const r of outgoing) add(outKey(r), r);
  for (const r of incoming) add(inKey(r), r);
  // во збирот влегува и ДДВ погрешно искажан на 0% (за таа фактура има предупредување)
  const sum = (side: "out" | "in") => r2(VAT04_LINES.filter((l) => l.side === side).reduce((s, l) => s + (acc.get(l.key)?.vat ?? 0), 0));
  const tOut = sum("out"), tIn = sum("in");
  acc.set("t_out", { base: 0, vat: tOut, count: 0 });
  acc.set("t_in", { base: 0, vat: tIn, count: 0 });
  acc.set("t_pay", { base: 0, vat: r2(tOut - tIn), count: 0 });
  return VAT04_LINES.map((l) => {
    const g = acc.get(l.key) ?? { base: 0, vat: 0, count: 0 };
    return { key: l.key, label: l.label, side: l.side, base: l.hasBase ? g.base : null, vat: l.hasVat || g.vat !== 0 ? g.vat : null, count: g.count };
  });
}
