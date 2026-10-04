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
  { code: "235", name: "Примени аванси од купувачи", type: "liability" },
  { code: "240", name: "Обврски за нето плати", type: "liability" },
  { code: "241", name: "Обврски за придонеси од плата", type: "liability" },
  { code: "242", name: "Обврски за персонален данок", type: "liability" },
  { code: "310", name: "Суровини и материјали", type: "asset" },
  { code: "019", name: "Исправка на вредноста на опрема (амортизација)", type: "asset" },
  { code: "400", name: "Трошоци за суровини и материјали (потрошени)", type: "expense" },
  { code: "401", name: "Трошоци за енергија (струја, гориво, гас)", type: "expense" },
  { code: "402", name: "Резервни делови и материјали за одржување", type: "expense" },
  { code: "410", name: "Транспортни услуги", type: "expense" },
  { code: "411", name: "Услуги за одржување и поправки", type: "expense" },
  { code: "412", name: "Закупнини", type: "expense" },
  { code: "413", name: "Други услуги (телефон, интернет, сметководство...)", type: "expense" },
  { code: "469", name: "Кусоци, кало и отпис на залихи", type: "expense" },
  { code: "430", name: "Трошоци за амортизација", type: "expense" },
  { code: "420", name: "Бруто плати", type: "expense" },
  { code: "449", name: "Други трошоци", type: "expense" },
  { code: "470", name: "Негативни курсни разлики", type: "expense" },
  { code: "740", name: "Приходи од продажба во земјата", type: "revenue" },
  { code: "741", name: "Приходи од продажба во странство", type: "revenue" },
  { code: "770", name: "Позитивни курсни разлики", type: "revenue" },
  { code: "769", name: "Вишоци на залихи", type: "revenue" },
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
  { key: "advances_received", label: "Примени аванси (уплати по про-фактура)", defaultCode: "235" },
  { key: "vat_output", label: "ДДВ — обврска (излезни фактури)", defaultCode: "230" },
  { key: "vat_input", label: "ДДВ — претходен данок (влезни фактури)", defaultCode: "130" },
  { key: "revenue_domestic", label: "Приходи — продажба во земјата", defaultCode: "740" },
  { key: "revenue_foreign", label: "Приходи — продажба во странство", defaultCode: "741" },
  { key: "purchases", label: "Набавки по влезни фактури (кога нема избрано конто)", defaultCode: "310" },
  { key: "material_expense", label: "Потрошен материјал во производство", defaultCode: "400" },
  { key: "inventory_shortage", label: "Кусок / отпис на залиха", defaultCode: "469" },
  { key: "inventory_surplus", label: "Вишок на залиха", defaultCode: "769" },
  { key: "fx_gain", label: "Позитивни курсни разлики", defaultCode: "770" },
  { key: "fx_loss", label: "Негативни курсни разлики", defaultCode: "470" },
  { key: "cash_other", label: "Благајна — друга промена (контра конто)", defaultCode: "449" },
  { key: "depreciation_expense", label: "Амортизација — трошок", defaultCode: "430" },
  { key: "depreciation_accumulated", label: "Амортизација — исправка на вредноста", defaultCode: "019" },
  { key: "salary_expense", label: "Плати — бруто трошок", defaultCode: "420" },
  { key: "salary_net", label: "Плати — обврска за нето", defaultCode: "240" },
  { key: "salary_contrib", label: "Плати — обврска за придонеси", defaultCode: "241" },
  { key: "salary_tax", label: "Плати — обврска за персонален данок", defaultCode: "242" },
  { key: "bank_fees", label: "Банкарска провизија (трошоци за платен промет)", defaultCode: "449" },
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
  /** трошочно/залихово конто избрано на фактурата (струја -> 401, закупнина -> 412...); инаку „набавки“ */
  account?: string | null;
  /** обратно оданочување (услуга од странски добавувач): ДДВ го пресметуваме ние — истовремено излезен и претходен */
  reverseChargeVatMkd?: number;
}): GlLine[] {
  const total = round2(p.subtotalMkd + p.vatMkd);
  const rc = round2(p.reverseChargeVatMkd ?? 0);
  return fixRounding(normalizeLines([
    { account: p.account || p.rules.purchases, debit: p.subtotalMkd, credit: 0, description: `Влезна фактура ${p.number}` },
    { account: p.rules.vat_input, debit: p.vatMkd, credit: 0, description: `Претходен ДДВ ${p.number}` },
    { account: p.foreign ? p.rules.suppliers_foreign : p.rules.suppliers_domestic, debit: 0, credit: total, partnerType: "supplier", partnerId: p.supplierId, description: `Влезна фактура ${p.number}` },
    ...(rc ? [
      { account: p.rules.vat_input, debit: rc, credit: 0, description: `ДДВ — обратно оданочување ${p.number}` },
      { account: p.rules.vat_output, debit: 0, credit: rc, description: `ДДВ — обратно оданочување ${p.number}` },
    ] : []),
  ]));
}

/**
 * Проверка: ДДВ = основица × стапка (по ставки ако има различни стапки).
 * Толеранција: 1 денар + 0,5 по ставка (заокружување по ставка). Враќа null ако е во ред.
 */
export function vatMismatch(p: { base: number; rate: number; vat: number; items?: { total: number; rate: number }[] }): { expected: number } | null {
  const items = (p.items ?? []).filter(i => Number.isFinite(i.total));
  const expected = round2(items.length && items.some(i => i.rate !== p.rate)
    ? items.reduce((a, i) => a + i.total * i.rate / 100, 0)
    : p.base * p.rate / 100);
  const tol = 1 + 0.5 * Math.max(0, items.length);
  return Math.abs(round2(p.vat) - expected) > tol ? { expected } : null;
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


// ── Движење на залиха (материјали) ──
/** consume: издавање во производство · shortage: кусок/отпис · surplus: вишок. Износот е по набавна цена. */
export function stockMoveLines(p: { kind: "consume" | "shortage" | "surplus"; amount: number; rules: Rules; ref: string }): GlLine[] {
  const a = round2(Math.abs(p.amount));
  if (!(a > 0)) return [];
  const stock = p.rules.purchases || "310";
  if (p.kind === "surplus") return normalizeLines([
    { account: stock, debit: a, credit: 0, description: `Вишок ${p.ref}` },
    { account: p.rules.inventory_surplus, debit: 0, credit: a, description: `Вишок ${p.ref}` },
  ]);
  const exp = p.kind === "consume" ? p.rules.material_expense : p.rules.inventory_shortage;
  const label = p.kind === "consume" ? "Потрошен материјал" : "Кусок/отпис";
  return normalizeLines([
    { account: exp, debit: a, credit: 0, description: `${label} ${p.ref}` },
    { account: stock, debit: 0, credit: a, description: `${label} ${p.ref}` },
  ]);
}

// ── Конто за влезна фактура: избор и предлог ──
export const EXPENSE_CHOICES: { code: string; label: string }[] = [
  { code: "310", label: "Материјали за залиха (лим, профили, бои...)" },
  { code: "400", label: "Материјал директно во трошок" },
  { code: "401", label: "Енергија — струја, гориво, гас" },
  { code: "402", label: "Резервни делови и одржување на опрема" },
  { code: "410", label: "Транспорт и шпедиција" },
  { code: "411", label: "Услуги за одржување и поправки" },
  { code: "412", label: "Закупнина" },
  { code: "413", label: "Други услуги (телефон, интернет, сметководство...)" },
  { code: "449", label: "Други трошоци" },
];

const EXPENSE_HINTS: [RegExp, string][] = [
  [/(евн|evn|електр|струја|елем|elem|топлан|мак\s*петрол|makpetrol|окта|okta|лукоил|lukoil|гориво|дизел|бензин|нафта|гас\b|плин)/i, "401"],
  [/(закуп|кирија|наем|rent)/i, "412"],
  [/(транспорт|превоз|шпедиц|карго|cargo|курир|dhl|ups|fedex|логистик)/i, "410"],
  [/(телеком|telekom|a1\b|а1\b|интернет|internet|телефон|мобил|сметковод|ревизи|адвокат|нотар|консалт|софтвер|лиценц|хостинг|банкарска провизија)/i, "413"],
  [/(сервис|поправк|одржување|ремонт)/i, "411"],
  [/(резервн|лежишт|ремен|филтер|масло|елект[ро]*д|диск за|сечило)/i, "402"],
  [/(лим|профил|цевк|шипк|арматур|челик|инокс|алуминиум|бој|прајмер|завртк|навртк|челична)/i, "310"],
];

/** Предлог конто од името на добавувачот и текстот на фактурата; null = нема јасен предлог. */
export function suggestExpenseAccount(text: string): string | null {
  const t = String(text ?? "");
  for (const [rx, code] of EXPENSE_HINTS) if (rx.test(t)) return code;
  return null;
}

/**
 * Конто за влезна фактура и дали е сигурно: запаметено кај добавувачот или јасно од текстот = сигурно;
 * инаку треба да се праша човекот (во меѓувреме се книжи на „набавки“ 310).
 */
export function guessExpenseAccount(supplierDefault: string | null | undefined, text: string): { account: string | null; sure: boolean; reason: string } {
  if (supplierDefault) return { account: supplierDefault, sure: true, reason: "запаметено кај добавувачот" };
  const s = suggestExpenseAccount(text);
  if (s) return { account: s, sure: true, reason: "препознаено од името / текстот" };
  return { account: null, sure: false, reason: "не е јасно што е купено" };
}

/** Избор со обични зборови за операторот (без шифри). */
export const PURCHASE_KINDS: { code: string; title: string; examples: string }[] = [
  { code: "310", title: "Материјал за производство", examples: "лим, профили, цевки, шипки, бои, завртки — оди на залиха" },
  { code: "402", title: "Резервни делови и алат", examples: "лежишта, дискови, сечила, електроди, масло за машини" },
  { code: "401", title: "Струја, гориво, гас", examples: "ЕВН, бензинска пумпа, плин за заварување" },
  { code: "412", title: "Закупнина", examples: "кирија за хала, канцеларија, изнајмена опрема" },
  { code: "410", title: "Транспорт", examples: "превоз, шпедиција, курир, царинско посредување" },
  { code: "411", title: "Поправка / сервис", examples: "сервис на машина, возило, поправки на објект" },
  { code: "413", title: "Услуги", examples: "телефон, интернет, сметководител, софтвер, адвокат" },
  { code: "449", title: "Нешто друго / не сум сигурен", examples: "сметководителот подоцна ќе го прегледа" },
];


/**
 * „Што е оваа ставка од изводот?“ — избор со обични зборови; позади секој одговор е конто.
 * Предлогот (match) е само помош: ако не е сигурно, операторот избира.
 */
export const BANK_KINDS: { key: string; title: string; examples: string; rule?: string; code?: string; dir?: "in" | "out"; match: RegExp }[] = [
  { key: "salary", title: "Исплата на плати", examples: "нето плата на вработени", rule: "salary_net", dir: "out", match: /плат|нето|salary|исплата на л/i },
  { key: "contrib", title: "Придонеси од плата", examples: "ПИОМ, здравство, вработување", rule: "salary_contrib", dir: "out", match: /придонес|пиом|фзо|здравствено|вработување/i },
  { key: "pit", title: "Персонален данок", examples: "данок на личен доход", rule: "salary_tax", dir: "out", match: /персонален|данок на лич|пдд/i },
  { key: "vat", title: "ДДВ (уплата или поврат)", examples: "уплата по ДДВ пријава, поврат од УЈП", rule: "vat_output", match: /ддв|данок на додадена|vat/i },
  { key: "fee", title: "Банкарска провизија", examples: "провизија, одржување сметка, е-банкарство", rule: "bank_fees", dir: "out", match: /провизи|надомест|одржување|е-банк|трошоци на банка|fee/i },
  { key: "cash", title: "Подигање / полагање готовина", examples: "од сметка во благајна и обратно", rule: "cash", match: /готовин|подигање|полагање|благајн/i },
  { key: "other", title: "Нешто друго", examples: "кредит, камата, капитал… — избери конто", match: /^$/ },
];

export function suggestBankKind(text: string, direction: "in" | "out"): { key: string; sure: boolean } | null {
  const hits = BANK_KINDS.filter(k => k.match.test(text) && (!k.dir || k.dir === direction));
  return hits.length === 1 ? { key: hits[0].key, sure: true } : hits.length > 1 ? { key: hits[0].key, sure: false } : null;
}
