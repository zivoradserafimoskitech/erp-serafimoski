// Чиста логика за финансии: контен план, правила за книжење, книжења по документ,
// конверзија на валути и курсни разлики. Без база -- сè е тестирано со vitest.

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

/**
 * Почетен контен план (најчесто користени конта).
 * ВАЖНО: шифрите треба да ги потврди сметководителот -- може да се менуваат во апликацијата.
 */
export const DEFAULT_ACCOUNTS: { code: string; name: string; type: AccountType }[] = [
  { code: "100", name: "Жиро сметка (денарска)", type: "asset" },
  { code: "102", name: "Девизна сметка", type: "asset" },
  { code: "103", name: "Благајна", type: "asset" },
  { code: "120", name: "Купувачи во земјата", type: "asset" },
  { code: "121", name: "Купувачи во странство", type: "asset" },
  { code: "130", name: "ДДВ — претходен данок", type: "asset" },
  { code: "220", name: "Добавувачи во земјата", type: "liability" },
  { code: "221", name: "Добавувачи во странство", type: "liability" },
  { code: "230", name: "Обврски за ДДВ", type: "liability" },
  { code: "240", name: "Обврски за нето плати", type: "liability" },
  { code: "241", name: "Обврски за придонеси од плата", type: "liability" },
  { code: "242", name: "Обврски за персонален данок", type: "liability" },
  { code: "310", name: "Суровини и материјали", type: "asset" },
  { code: "019", name: "Исправка на вредноста на опрема (амортизација)", type: "asset" },
  { code: "400", name: "Трошоци за материјали", type: "expense" },
  { code: "430", name: "Трошоци за амортизација", type: "expense" },
  { code: "420", name: "Бруто плати", type: "expense" },
  { code: "449", name: "Други трошоци", type: "expense" },
  { code: "470", name: "Негативни курсни разлики", type: "expense" },
  { code: "740", name: "Приходи од продажба во земјата", type: "revenue" },
  { code: "741", name: "Приходи од продажба во странство", type: "revenue" },
  { code: "770", name: "Позитивни курсни разлики", type: "revenue" },
  { code: "900", name: "Капитал", type: "equity" },
];

export const POSTING_RULES: { key: string; label: string; defaultCode: string }[] = [
  { key: "bank_mkd", label: "Банка — денарска сметка", defaultCode: "100" },
  { key: "bank_fx", label: "Банка — девизна сметка", defaultCode: "102" },
  { key: "cash", label: "Благајна", defaultCode: "103" },
  { key: "customers_domestic", label: "Купувачи во земјата", defaultCode: "120" },
  { key: "customers_foreign", label: "Купувачи во странство", defaultCode: "121" },
  { key: "suppliers_domestic", label: "Добавувачи во земјата", defaultCode: "220" },
  { key: "suppliers_foreign", label: "Добавувачи во странство", defaultCode: "221" },
  { key: "vat_output", label: "ДДВ — обврска (излезни фактури)", defaultCode: "230" },
  { key: "vat_input", label: "ДДВ — претходен данок (влезни фактури)", defaultCode: "130" },
  { key: "revenue_domestic", label: "Приходи — продажба во земјата", defaultCode: "740" },
  { key: "revenue_foreign", label: "Приходи — продажба во странство", defaultCode: "741" },
  { key: "purchases", label: "Набавки по влезни фактури", defaultCode: "310" },
  { key: "fx_gain", label: "Позитивни курсни разлики", defaultCode: "770" },
  { key: "fx_loss", label: "Негативни курсни разлики", defaultCode: "470" },
  { key: "cash_other", label: "Благајна — друга промена (контра конто)", defaultCode: "449" },
  { key: "depreciation_expense", label: "Амортизација — трошок", defaultCode: "430" },
  { key: "depreciation_accumulated", label: "Амортизација — исправка на вредноста", defaultCode: "019" },
  { key: "salary_expense", label: "Плати — бруто трошок", defaultCode: "420" },
  { key: "salary_net", label: "Плати — обврска за нето", defaultCode: "240" },
  { key: "salary_contrib", label: "Плати — обврска за придонеси", defaultCode: "241" },
  { key: "salary_tax", label: "Плати — обврска за персонален данок", defaultCode: "242" },
];

export type Rules = Record<string, string>;

export function rulesWithDefaults(stored: Rules): Rules {
  const out: Rules = {};
  for (const r of POSTING_RULES) out[r.key] = stored[r.key] || r.defaultCode;
  return out;
}

export interface GlLine {
  account: string;
  debit: number;
  credit: number;
  partnerType?: "customer" | "supplier" | null;
  partnerId?: number | null;
  description?: string;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Отстрани нулти редови и сврти ги негативните износи на спротивната страна. */
export function normalizeLines(lines: GlLine[]): GlLine[] {
  const out: GlLine[] = [];
  for (const l of lines) {
    let d = round2(l.debit || 0), c = round2(l.credit || 0);
    if (d < 0) { c += -d; d = 0; }
    if (c < 0) { d += -c; c = 0; }
    const net = round2(d - c);
    if (net === 0) continue;
    out.push({ ...l, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 });
  }
  return out;
}

export function isBalanced(lines: GlLine[]): boolean {
  const d = round2(lines.reduce((a, l) => a + (l.debit || 0), 0));
  const c = round2(lines.reduce((a, l) => a + (l.credit || 0), 0));
  return d === c;
}

/** Рамнотежа по заокружување: разликата од денар-два оди на најголемиот ред. */
export function fixRounding(lines: GlLine[]): GlLine[] {
  const d = round2(lines.reduce((a, l) => a + l.debit, 0));
  const c = round2(lines.reduce((a, l) => a + l.credit, 0));
  const diff = round2(d - c);
  if (diff === 0 || Math.abs(diff) > 1) return lines;
  const copy = lines.map(l => ({ ...l }));
  if (diff > 0) {
    // должи > побарува: додај на најголемиот побарувачки ред
    const idx = copy.reduce((b, l, i) => (l.credit > copy[b].credit ? i : b), 0);
    copy[idx].credit = round2(copy[idx].credit + diff);
  } else {
    const idx = copy.reduce((b, l, i) => (l.debit > copy[b].debit ? i : b), 0);
    copy[idx].debit = round2(copy[idx].debit - diff);
  }
  return copy;
}

/** Излезна фактура (или книжно одобрување со негативни износи). Износите се веќе во денари. */
export function invoiceLines(p: {
  subtotalMkd: number; vatMkd: number; foreign: boolean; customerId: number; number: string; rules: Rules;
}): GlLine[] {
  const total = round2(p.subtotalMkd + p.vatMkd);
  return fixRounding(normalizeLines([
    { account: p.foreign ? p.rules.customers_foreign : p.rules.customers_domestic, debit: total, credit: 0, partnerType: "customer", partnerId: p.customerId, description: `Фактура ${p.number}` },
    { account: p.foreign ? p.rules.revenue_foreign : p.rules.revenue_domestic, debit: 0, credit: p.subtotalMkd, description: `Фактура ${p.number}` },
    { account: p.rules.vat_output, debit: 0, credit: p.vatMkd, description: `ДДВ ${p.number}` },
  ]));
}

/** Влезна фактура. */
export function incomingLines(p: {
  subtotalMkd: number; vatMkd: number; foreign: boolean; supplierId: number; number: string; rules: Rules;
}): GlLine[] {
  const total = round2(p.subtotalMkd + p.vatMkd);
  return fixRounding(normalizeLines([
    { account: p.rules.purchases, debit: p.subtotalMkd, credit: 0, description: `Влезна фактура ${p.number}` },
    { account: p.rules.vat_input, debit: p.vatMkd, credit: 0, description: `Претходен ДДВ ${p.number}` },
    { account: p.foreign ? p.rules.suppliers_foreign : p.rules.suppliers_domestic, debit: 0, credit: total, partnerType: "supplier", partnerId: p.supplierId, description: `Влезна фактура ${p.number}` },
  ]));
}

/**
 * Плаќање по фактура (од банка или благајна) со курсна разлика.
 * moneyMkd = колку денари влегле/излегле на сметката;
 * docMkd  = колку денари од побарувањето/обврската се затвораат (по курсот од датумот на фактурата).
 */
export function paymentLines(p: {
  direction: "in" | "out"; moneyAccount: string; partnerAccount: string;
  moneyMkd: number; docMkd: number; partnerType: "customer" | "supplier"; partnerId: number | null;
  ref: string; rules: Rules;
}): GlLine[] {
  const diff = round2(p.moneyMkd - p.docMkd);
  const lines: GlLine[] = [];
  if (p.direction === "in") {
    lines.push({ account: p.moneyAccount, debit: p.moneyMkd, credit: 0, description: `Наплата ${p.ref}` });
    lines.push({ account: p.partnerAccount, debit: 0, credit: p.docMkd, partnerType: p.partnerType, partnerId: p.partnerId, description: `Наплата ${p.ref}` });
    if (diff > 0) lines.push({ account: p.rules.fx_gain, debit: 0, credit: diff, description: `Курсна разлика ${p.ref}` });
    if (diff < 0) lines.push({ account: p.rules.fx_loss, debit: -diff, credit: 0, description: `Курсна разлика ${p.ref}` });
  } else {
    lines.push({ account: p.partnerAccount, debit: p.docMkd, credit: 0, partnerType: p.partnerType, partnerId: p.partnerId, description: `Плаќање ${p.ref}` });
    lines.push({ account: p.moneyAccount, debit: 0, credit: p.moneyMkd, description: `Плаќање ${p.ref}` });
    // платено повеќе денари отколку што вредеше обврската = загуба
    if (diff > 0) lines.push({ account: p.rules.fx_loss, debit: diff, credit: 0, description: `Курсна разлика ${p.ref}` });
    if (diff < 0) lines.push({ account: p.rules.fx_gain, debit: 0, credit: -diff, description: `Курсна разлика ${p.ref}` });
  }
  return normalizeLines(lines);
}

/** Благајна без документ: уплата/исплата против избрано конто. */
export function cashOtherLines(p: { direction: "in" | "out"; amount: number; cashAccount: string; contra: string; ref: string }): GlLine[] {
  return normalizeLines(p.direction === "in"
    ? [{ account: p.cashAccount, debit: p.amount, credit: 0, description: p.ref }, { account: p.contra, debit: 0, credit: p.amount, description: p.ref }]
    : [{ account: p.contra, debit: p.amount, credit: 0, description: p.ref }, { account: p.cashAccount, debit: 0, credit: p.amount, description: p.ref }]);
}

/** Потпис на книжењето -- ако се смени документот, се менува и потписот и книжењето се обновува. */
export function linesSignature(date: string, lines: GlLine[]): string {
  return date + "|" + lines.map(l => `${l.account}:${l.debit.toFixed(2)}:${l.credit.toFixed(2)}:${l.partnerType ?? ""}${l.partnerId ?? ""}`).join(";");
}

// ===== ВАЛУТИ =====

export type RateLookup = (currency: string, date: string) => number | null;

/** Денарска противвредност. MKD секогаш 1. Враќа null ако нема курс. */
export function toMkd(amount: number, currency: string | null | undefined, date: string, rate: RateLookup): number | null {
  const cur = (currency || "MKD").toUpperCase();
  if (cur === "MKD") return round2(amount);
  const r = rate(cur, date);
  return r ? round2(amount * r) : null;
}

/** Конверзија меѓу две валути преку денар. */
export function convert(amount: number, from: string, to: string, date: string, rate: RateLookup): number | null {
  const mkd = toMkd(amount, from, date, rate);
  if (mkd === null) return null;
  const t = (to || "MKD").toUpperCase();
  if (t === "MKD") return mkd;
  const r = rate(t, date);
  return r ? mkd / r : null;
}

/** Парсирање на одговор од НБРМ (JSON, различни верзии на полињата). */
export function parseNbrmRates(data: unknown): { date: string; currency: string; rate: number }[] {
  const arr: any[] = Array.isArray(data) ? data : Array.isArray((data as any)?.d) ? (data as any).d : [];
  const out: { date: string; currency: string; rate: number }[] = [];
  for (const r of arr) {
    const cur = String(r.valuta ?? r.Valuta ?? r.currency ?? r.oznaka ?? "").trim().toUpperCase();
    const mid = Number(r.sreden ?? r.Sreden ?? r.sredenKurs ?? r.middle ?? r.rate);
    const nomin = Number(r.nomin ?? r.Nomin ?? r.nominal ?? 1) || 1;
    const rawDate = String(r.datum ?? r.Datum ?? r.date ?? "");
    const m = rawDate.match(/(\d{4})-(\d{2})-(\d{2})/) || rawDate.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    let date = "";
    if (m) date = m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`;
    if (!/^[A-Z]{3}$/.test(cur) || !(mid > 0) || !date) continue;
    out.push({ date, currency: cur, rate: mid / nomin });
  }
  return out;
}

// ===== ПЛАТИ =====

export interface PayrollParams {
  contributionRate: number;   // % придонеси од бруто (ПИО + здравство + вработување + дополнително)
  incomeTaxRate: number;      // % персонален данок
  personalExemption: number;  // лично ослободување (денари месечно)
}

export const DEFAULT_PAYROLL: PayrollParams = { contributionRate: 28, incomeTaxRate: 10, personalExemption: 10270 };

export function calcPayroll(gross: number, p: PayrollParams) {
  const contributions = round2(gross * p.contributionRate / 100);
  const taxBase = Math.max(0, round2(gross - contributions - p.personalExemption));
  const incomeTax = round2(taxBase * p.incomeTaxRate / 100);
  const net = round2(gross - contributions - incomeTax);
  return { gross: round2(gross), contributions, taxBase, incomeTax, net };
}

export function payrollLines(p: { gross: number; contributions: number; incomeTax: number; net: number; period: string; rules: Rules }): GlLine[] {
  return fixRounding(normalizeLines([
    { account: p.rules.salary_expense, debit: p.gross, credit: 0, description: `Плати ${p.period}` },
    { account: p.rules.salary_net, debit: 0, credit: p.net, description: `Нето плати ${p.period}` },
    { account: p.rules.salary_contrib, debit: 0, credit: p.contributions, description: `Придонеси ${p.period}` },
    { account: p.rules.salary_tax, debit: 0, credit: p.incomeTax, description: `Персонален данок ${p.period}` },
  ]));
}

/** Годишна амортизација: трошок / исправка на вредноста. */
export function depreciationLines(p: { amount: number; year: number; rules: Rules }): GlLine[] {
  return normalizeLines([
    { account: p.rules.depreciation_expense, debit: p.amount, credit: 0, description: `Амортизација ${p.year}` },
    { account: p.rules.depreciation_accumulated, debit: 0, credit: p.amount, description: `Амортизација ${p.year}` },
  ]);
}
