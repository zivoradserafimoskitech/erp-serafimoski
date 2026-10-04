// Финансии: курсна листа (НБРМ), благајна, главна книга (автоматско книжење), бруто биланс,
// картица на конто, книги на излезни/влезни фактури и рекапитулација за ДДВ.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { getPool } from "./queries/connection";
import { logAudit } from "./audit-helper";
import {
  DEFAULT_ACCOUNTS, POSTING_RULES, rulesWithDefaults, invoiceLines, incomingLines, paymentLines,
  cashOtherLines, payrollLines, depreciationLines, stockMoveLines, linesSignature, isBalanced, normalizeLines, toMkd, convert, round2,
  parseNbrmRates, vatMismatch, type GlLine, type Rules, type RateLookup,
} from "@contracts/finance";
import { isDomesticCountry } from "@contracts/country";
import { loadRates, iso } from "./rates-helper";
import { refreshPaymentStatus, openDocs, type OpenDoc } from "./payment-status";
import { lockedUntil, isLocked, assertOpen, glAudit, fmtMk, setLockedUntil } from "./period-lock";
import { buildBalanceSheet, buildIncomeStatement, buildVat04, type AccountBalance } from "@contracts/statements";

const q = async (text: string, params: any[] = []) => (await getPool().query(text, params)).rows as any[];
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ───────────────────────── курсна листа ─────────────────────────

const ddmmyyyy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

export async function fetchNbrmRates(from: string, to: string): Promise<number> {
  const url = `https://www.nbrm.mk/KLServiceNOV/GetExchangeRate?StartDate=${ddmmyyyy(from)}&EndDate=${ddmmyyyy(to)}&format=json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let data: unknown;
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`НБРМ одговори со ${res.status}`);
    data = await res.json();
  } finally {
    clearTimeout(timer);
  }
  const rows = parseNbrmRates(data);
  for (const r of rows) {
    await q(`INSERT INTO exchange_rates (rate_date, currency, rate, source) VALUES ($1,$2,$3,'nbrm')
             ON CONFLICT (rate_date, currency) DO UPDATE SET rate = EXCLUDED.rate, source = 'nbrm'`, [r.date, r.currency, r.rate]);
  }
  return rows.length;
}

// ───────────────────────── главна книга: подготовка ─────────────────────────

async function ensureChart() {
  for (const a of DEFAULT_ACCOUNTS) {
    await q(`INSERT INTO gl_accounts (code, name, type) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING`, [a.code, a.name, a.type]);
  }
}

async function loadRules(): Promise<Rules> {
  const rows = await q(`SELECT key, account_code FROM gl_posting_rules`);
  const stored: Rules = {};
  for (const r of rows) stored[r.key] = r.account_code;
  return rulesWithDefaults(stored);
}

/** Од која година амортизацијата се книжи месечно (претходните години остануваат со годишен налог). */
const MONTHLY_DEPRECIATION_FROM = 2026;

interface Desired { sourceType: string; sourceId: number; date: string; description: string; lines: GlLine[] }
interface Problem { sourceType: string; sourceId: number; ref: string; reason: string }

/** Сите автоматски книжења што треба да постојат според документите во моментов. */
async function buildDesired(rules: Rules, rate: RateLookup): Promise<{ desired: Desired[]; problems: Problem[] }> {
  const desired: Desired[] = [];
  const problems: Problem[] = [];

  // 1) Излезни фактури и книжни одобрувања
  const invs = await q(`SELECT i.id, i.invoice_number, i.invoice_type, i.issue_date, i.subtotal, i.vat_amount, i.currency,
      i.customer_id, c.country, c.name AS cname
    FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
    WHERE i.invoice_type IN ('standard','credit_note') AND i.status NOT IN ('draft','cancelled')`);
  const invInfo = new Map<number, { cur: string; date: string; foreign: boolean; number: string; customerId: number }>();
  for (const i of invs) {
    const date = iso(i.issue_date);
    const cur = String(i.currency || "MKD").toUpperCase();
    const foreign = cur !== "MKD" || !isDomesticCountry(i.country);
    invInfo.set(i.id, { cur, date, foreign, number: i.invoice_number, customerId: i.customer_id });
    const sign = i.invoice_type === "credit_note" ? -1 : 1;
    const sub = toMkd(sign * Math.abs(Number(i.subtotal)), cur, date, rate);
    const vat = toMkd(sign * Math.abs(Number(i.vat_amount)), cur, date, rate);
    if (sub === null || vat === null) { problems.push({ sourceType: "invoice", sourceId: i.id, ref: i.invoice_number, reason: `Нема курс ${cur} за ${date}` }); continue; }
    desired.push({ sourceType: "invoice", sourceId: i.id, date, description: `${i.invoice_type === "credit_note" ? "Книжно одобрување" : "Фактура"} ${i.invoice_number} · ${i.cname ?? ""}`,
      lines: invoiceLines({ subtotalMkd: sub, vatMkd: vat, foreign, customerId: i.customer_id, number: i.invoice_number, rules }) });
  }

  // 1б) Про-фактури: не се книжат, но уплатите по нив се аванс
  const pfs = await q(`SELECT i.id, i.invoice_number, i.issue_date, i.currency, i.customer_id, i.quotation_id, i.vat_rate, c.country
    FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.invoice_type = 'proforma' AND i.status <> 'cancelled'`);
  // ДДВ на аванс: обврската настанува со приемот на авансот (домашен промет); извоз — без ДДВ
  const proformaInfo = new Map<number, { cur: string; date: string; customerId: number; number: string; quotationId: number | null; vatRate: number }>();
  for (const p of pfs) {
    const cur = String(p.currency || "MKD").toUpperCase();
    const domestic = cur === "MKD" && isDomesticCountry(p.country);
    proformaInfo.set(p.id, { cur, date: iso(p.issue_date), customerId: p.customer_id, number: p.invoice_number, quotationId: p.quotation_id ? Number(p.quotation_id) : null,
      vatRate: domestic ? Number(p.vat_rate ?? 18) || 0 : 0 });
  }
  const advanceMkd = new Map<number, { mkd: number; vat: number; lastDate: string }>(); // по про-фактура

  // 2) Влезни фактури
  const incs = await q(`SELECT ii.id, ii.supplier_invoice_number, ii.issue_date, ii.received_date, ii.vat_date, ii.reverse_charge, ii.vat_rate, ii.subtotal, ii.vat_amount,
      ii.currency, ii.supplier_id, ii.expense_account, s.country, s.name AS sname
    FROM incoming_invoices ii LEFT JOIN suppliers s ON s.id = ii.supplier_id WHERE ii.status <> 'cancelled'`);
  const incInfo = new Map<number, { cur: string; date: string; foreign: boolean; number: string; supplierId: number }>();
  for (const i of incs) {
    // курс: на датумот на прометот (издавање); книжење и ДДВ: во ДДВ периодот (прием)
    const rateDate = iso(i.issue_date || i.received_date);
    const date = iso(i.vat_date || i.received_date || i.issue_date);
    const cur = String(i.currency || "MKD").toUpperCase();
    const foreign = cur !== "MKD" || !isDomesticCountry(i.country);
    incInfo.set(i.id, { cur, date: rateDate, foreign, number: i.supplier_invoice_number, supplierId: i.supplier_id });
    const sub = toMkd(Number(i.subtotal), cur, rateDate, rate);
    const vat = toMkd(Number(i.vat_amount), cur, rateDate, rate);
    if (sub === null || vat === null) { problems.push({ sourceType: "incoming_invoice", sourceId: i.id, ref: i.supplier_invoice_number, reason: `Нема курс ${cur} за ${rateDate}` }); continue; }
    const rcVat = i.reverse_charge ? round2(sub * (Number(i.vat_rate) || 18) / 100) : 0;
    desired.push({ sourceType: "incoming_invoice", sourceId: i.id, date, description: `Влезна фактура ${i.supplier_invoice_number} · ${i.sname ?? ""}${i.reverse_charge ? " · обратно оданочување" : ""}`,
      lines: incomingLines({ subtotalMkd: sub, vatMkd: vat, foreign, supplierId: i.supplier_id, number: i.supplier_invoice_number, rules, account: i.expense_account, reverseChargeVatMkd: rcVat }) });
  }

  // 2б) Залиха на материјали: потрошено во производство, кусок/отпис, вишок (по набавна цена)
  const moves = await q(`SELECT t.id, t.type, t.quantity, t.unit_cost, t.total_cost, t.reference, t.notes, t.created_at, t.source_doc_type, t.material_id,
      m.code, m.name, m.unit, m.avg_cost
    FROM inventory_transactions t LEFT JOIN materials m ON m.id = t.material_id
    WHERE t.type IN ('issue', 'scrap', 'adjustment') AND COALESCE(t.reference, '') <> 'Почетна залиха'`);
  for (const t of moves) {
    const qty = Number(t.quantity) || 0;
    const unit = Number(t.unit_cost) || Number(t.avg_cost) || 0;
    const total = Number(t.total_cost);
    let kind: "consume" | "shortage" | "surplus";
    if (t.type === "issue") kind = "consume";
    else if (t.type === "scrap") kind = "shortage";
    else {
      const note = String(t.notes ?? "");
      const m = note.match(/Корекција од (-?[\d.]+) на (-?[\d.]+)/);
      const sign = /Кусок/i.test(note) ? -1 : /Вишок/i.test(note) ? 1 : m ? Math.sign(Number(m[2]) - Number(m[1])) : Math.sign(total || 0);
      if (!sign) continue;
      kind = sign < 0 ? "shortage" : "surplus";
    }
    const amount = Number.isFinite(total) && Math.abs(total) > 0.005 ? Math.abs(total) : round2(qty * unit);
    const lines = stockMoveLines({ kind, amount, rules, ref: `${t.code ?? ""} ${t.reference ?? ""}`.trim() });
    if (!lines.length) continue;
    const label = kind === "consume" ? "Потрошен материјал" : kind === "shortage" ? "Кусок/отпис" : "Вишок";
    // „Потрошен материјал: Лим 2мм — 50 kg · РН-001“ (количината секогаш позитивна, насоката е во зборот)
    const what = t.name || t.code || `избришан материјал #${t.material_id}`;
    const q3 = Math.abs(qty).toLocaleString("mk-MK", { maximumFractionDigits: 3 });
    desired.push({ sourceType: "stock_move", sourceId: t.id, date: iso(t.created_at),
      description: `${label}: ${what} — ${q3}${t.unit ? " " + t.unit : ""}${t.reference ? " · " + t.reference : ""}`, lines });
  }

  // Плаќање по документ (банка или благајна) со курсна разлика
  const payFor = (p: { sourceType: string; sourceId: number; docType: string; docId: number; amount: number; moneyCur: string; date: string; moneyAccount: string; ref: string }) => {
    // Уплата по про-фактура = примен аванс (без курсна разлика -- се затвора при конечната фактура)
    const pf = p.docType === "invoice" ? proformaInfo.get(p.docId) : undefined;
    if (pf) {
      const moneyMkd = toMkd(p.amount, p.moneyCur, p.date, rate);
      if (moneyMkd === null) { problems.push({ sourceType: p.sourceType, sourceId: p.sourceId, ref: p.ref, reason: `Нема курс за ${p.moneyCur}` }); return; }
      // ДДВ во авансот: износ × стапка / (100 + стапка)
      const advVat = pf.vatRate > 0 ? round2(moneyMkd * pf.vatRate / (100 + pf.vatRate)) : 0;
      const a = advanceMkd.get(p.docId) ?? { mkd: 0, vat: 0, lastDate: p.date };
      a.mkd = round2(a.mkd + moneyMkd); a.vat = round2(a.vat + advVat); if (p.date > a.lastDate) a.lastDate = p.date;
      advanceMkd.set(p.docId, a);
      desired.push({ sourceType: p.sourceType, sourceId: p.sourceId, date: p.date, description: `Аванс по ${pf.number}${p.ref ? " · " + p.ref : ""}`,
        lines: normalizeLines([
          { account: p.moneyAccount, debit: moneyMkd, credit: 0, description: `Аванс ${pf.number}` },
          { account: rules.advances_received, debit: 0, credit: round2(moneyMkd - advVat), partnerType: "customer", partnerId: pf.customerId, description: `Аванс ${pf.number}` },
          { account: rules.vat_output, debit: 0, credit: advVat, description: `ДДВ на аванс ${pf.number} (${pf.vatRate}%)` },
        ]) });
      return;
    }
    const doc = p.docType === "invoice" ? invInfo.get(p.docId) : incInfo.get(p.docId);
    if (!doc) return; // документот не е книжен (нацрт/откажан) -- нема што да се затвора
    const moneyMkd = toMkd(p.amount, p.moneyCur, p.date, rate);
    const inDocCur = convert(p.amount, p.moneyCur, doc.cur, p.date, rate);
    const docMkd = inDocCur === null ? null : toMkd(inDocCur, doc.cur, doc.date, rate);
    if (moneyMkd === null || docMkd === null) { problems.push({ sourceType: p.sourceType, sourceId: p.sourceId, ref: p.ref, reason: `Нема курс за ${p.moneyCur}/${doc.cur}` }); return; }
    const isIn = p.docType === "invoice";
    const partnerAccount = isIn
      ? (doc.foreign ? rules.customers_foreign : rules.customers_domestic)
      : (doc.foreign ? rules.suppliers_foreign : rules.suppliers_domestic);
    desired.push({ sourceType: p.sourceType, sourceId: p.sourceId, date: p.date,
      description: `${isIn ? "Наплата" : "Плаќање"} ${doc.number}${p.ref ? " · " + p.ref : ""}`,
      lines: paymentLines({ direction: isIn ? "in" : "out", moneyAccount: p.moneyAccount, partnerAccount, moneyMkd, docMkd: round2(docMkd),
        partnerType: isIn ? "customer" : "supplier", partnerId: isIn ? (doc as any).customerId : (doc as any).supplierId, ref: doc.number, rules }) });
  };

  // 3) Банка: распоредени уплати
  const allocs = await q(`SELECT a.id, a.doc_type, a.doc_id, a.amount, t.tx_date, t.counterparty_name, COALESCE(s.currency, 'MKD') AS cur
    FROM payment_allocations a JOIN bank_transactions t ON t.id = a.tx_id LEFT JOIN bank_statements s ON s.id = t.statement_id`);
  for (const a of allocs) {
    const cur = String(a.cur || "MKD").toUpperCase();
    payFor({ sourceType: "bank_alloc", sourceId: a.id, docType: a.doc_type, docId: Number(a.doc_id), amount: Number(a.amount), moneyCur: cur,
      date: iso(a.tx_date), moneyAccount: cur === "MKD" ? rules.bank_mkd : rules.bank_fx, ref: a.counterparty_name ?? "" });
  }

  // 3б) Ставки од извод без фактура (или остаток по фактурите) — на избраното конто; и провизијата на банката
  const btx = await q(`SELECT t.id, t.tx_date, t.direction, t.amount, t.provision, t.account_code, t.partner_type, t.partner_id, t.counterparty_name, t.purpose,
      COALESCE(s.currency, 'MKD') AS cur, COALESCE((SELECT SUM(a.amount) FROM payment_allocations a WHERE a.tx_id = t.id), 0) AS allocated
    FROM bank_transactions t LEFT JOIN bank_statements s ON s.id = t.statement_id
    WHERE t.match_status <> 'ignored' AND (t.account_code IS NOT NULL OR COALESCE(t.provision, 0) > 0)`);
  for (const t of btx) {
    const cur = String(t.cur || "MKD").toUpperCase();
    const date = iso(t.tx_date);
    const bank = cur === "MKD" ? rules.bank_mkd : rules.bank_fx;
    const who = [t.counterparty_name, t.purpose].filter(Boolean).join(" · ").slice(0, 120);
    const rest = round2(Number(t.amount) - Number(t.allocated));
    if (t.account_code && rest > 0.005) {
      const mkd = toMkd(rest, cur, date, rate);
      if (mkd === null) { problems.push({ sourceType: "bank_other", sourceId: t.id, ref: who, reason: `Нема курс ${cur} за ${date}` }); }
      else {
        const partner = t.partner_id && /^(12|22)/.test(t.account_code) ? { partnerType: (t.account_code.startsWith("12") ? "customer" : "supplier") as "customer" | "supplier", partnerId: Number(t.partner_id) } : {};
        desired.push({ sourceType: "bank_other", sourceId: t.id, date, description: `Извод: ${who}`,
          lines: normalizeLines(t.direction === "in"
            ? [{ account: bank, debit: mkd, credit: 0, description: who }, { account: t.account_code, debit: 0, credit: mkd, description: who, ...partner }]
            : [{ account: t.account_code, debit: mkd, credit: 0, description: who, ...partner }, { account: bank, debit: 0, credit: mkd, description: who }]) });
      }
    }
    const fee = Number(t.provision) || 0;
    if (fee > 0.005) {
      const feeMkd = toMkd(fee, cur, date, rate);
      if (feeMkd !== null) desired.push({ sourceType: "bank_fee", sourceId: t.id, date, description: `Банкарска провизија · ${who}`,
        lines: normalizeLines([{ account: rules.bank_fees, debit: feeMkd, credit: 0, description: "Провизија" }, { account: bank, debit: 0, credit: feeMkd, description: "Провизија" }]) });
    }
  }

  // 4) Благајна
  const cash = await q(`SELECT * FROM cash_transactions`);
  for (const c of cash) {
    const date = iso(c.tx_date);
    if (c.invoice_id || c.incoming_invoice_id) {
      payFor({ sourceType: "cash", sourceId: c.id, docType: c.invoice_id ? "invoice" : "incoming_invoice", docId: Number(c.invoice_id || c.incoming_invoice_id),
        amount: Number(c.amount), moneyCur: "MKD", date, moneyAccount: rules.cash, ref: c.doc_number });
    } else {
      desired.push({ sourceType: "cash", sourceId: c.id, date, description: `Благајна ${c.doc_number}${c.description ? " · " + c.description : ""}`,
        lines: cashOtherLines({ direction: c.direction === "in" ? "in" : "out", amount: Number(c.amount), cashAccount: rules.cash, contra: c.account_code || rules.cash_other, ref: c.doc_number }) });
    }
  }

  // 4б) Затворање на аванс: конечна фактура за нарачката од понудата на про-фактурата
  if (advanceMkd.size) {
    const links = await q(`SELECT qt.id AS qid, i.id AS inv_id, i.issue_date, i.invoice_number, c.country, i.currency
      FROM quotations qt JOIN invoices i ON i.order_id = qt.converted_order_id AND i.invoice_type = 'standard' AND i.status NOT IN ('draft','cancelled')
      LEFT JOIN customers c ON c.id = i.customer_id`);
    for (const [pfId, a] of advanceMkd) {
      const pf = proformaInfo.get(pfId)!;
      const inv = links.filter(l => Number(l.qid) === pf.quotationId).sort((x, y) => iso(x.issue_date).localeCompare(iso(y.issue_date)))[0];
      if (!inv || !(a.mkd > 0)) continue;
      const foreign = String(inv.currency || "MKD").toUpperCase() !== "MKD" || !isDomesticCountry(inv.country);
      const date = iso(inv.issue_date) > a.lastDate ? iso(inv.issue_date) : a.lastDate;
      desired.push({ sourceType: "advance_settle", sourceId: pfId, date, description: `Затворање аванс ${pf.number} со фактура ${inv.invoice_number}`,
        // фактурата го пресметува целиот ДДВ — ДДВ од авансот се враќа (не се плаќа двапати)
        lines: normalizeLines([
          { account: rules.advances_received, debit: round2(a.mkd - a.vat), credit: 0, partnerType: "customer", partnerId: pf.customerId, description: `Аванс ${pf.number}` },
          { account: rules.vat_output, debit: a.vat, credit: 0, description: `ДДВ на аванс ${pf.number} → ${inv.invoice_number}` },
          { account: foreign ? rules.customers_foreign : rules.customers_domestic, debit: 0, credit: a.mkd, partnerType: "customer", partnerId: pf.customerId, description: `Аванс ${pf.number} → ${inv.invoice_number}` },
        ]) });
    }
  }

  // 4б) Компензации: обврската кон добавувачот се пребива со побарувањето од купувачот
  const { compensationPostings } = await import("./settle-router");
  const compRows = await compensationPostings();
  const compIds = [...new Set(compRows.map((r: any) => Number(r.id)))];
  for (const cid of compIds) {
    const items = compRows.filter((r: any) => Number(r.id) === cid);
    const date = iso(items[0].comp_date), number = items[0].number;
    const lines: GlLine[] = [];
    let ok = true;
    for (const it of items) {
      const isInv = it.doc_type === "invoice";
      const doc: any = isInv ? invInfo.get(Number(it.doc_id)) : incInfo.get(Number(it.doc_id));
      if (!doc) { ok = false; problems.push({ sourceType: "compensation", sourceId: cid, ref: number, reason: "Фактурата во компензацијата не е книжена (нацрт/откажана)" }); break; }
      const mkd = toMkd(Number(it.amount), doc.cur, doc.date, rate);
      if (mkd === null) { ok = false; problems.push({ sourceType: "compensation", sourceId: cid, ref: number, reason: `Нема курс ${doc.cur}` }); break; }
      lines.push(isInv
        ? { account: doc.foreign ? rules.customers_foreign : rules.customers_domestic, debit: 0, credit: mkd, partnerType: "customer", partnerId: doc.customerId, description: `Компензација ${number} · ${doc.number}` }
        : { account: doc.foreign ? rules.suppliers_foreign : rules.suppliers_domestic, debit: mkd, credit: 0, partnerType: "supplier", partnerId: doc.supplierId, description: `Компензација ${number} · ${doc.number}` });
    }
    if (ok) desired.push({ sourceType: "compensation", sourceId: cid, date, description: `Компензација ${number}`, lines: normalizeLines(lines) });
  }

  // 5) Плати (само потврдени пресметки)
  const runs = await q(`SELECT r.id, r.period, SUM(l.gross) g, SUM(l.contributions) c, SUM(l.income_tax) t, SUM(l.net) n
    FROM payroll_runs r JOIN payroll_lines l ON l.run_id = r.id WHERE r.status = 'posted' GROUP BY r.id, r.period`);
  for (const r of runs) {
    const [y, m] = String(r.period).split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    desired.push({ sourceType: "payroll", sourceId: r.id, date: last, description: `Плати за ${r.period}`,
      lines: payrollLines({ gross: Number(r.g), contributions: Number(r.c), incomeTax: Number(r.t), net: Number(r.n), period: r.period, rules }) });
  }

  // 6) Амортизација: до 2025 — едно книжење на 31.12; од 2026 — месечно (1/12), до тековниот месец,
  //    за месечните извештаи да го содржат трошокот (декември го зема заокружувањето)
  const dep = await q(`SELECT year, SUM(amount) s FROM depreciation_entries GROUP BY year`);
  const nowD = new Date();
  for (const d of dep) {
    const amount = round2(Number(d.s));
    const year = Number(d.year);
    if (!(amount > 0)) continue;
    if (year < MONTHLY_DEPRECIATION_FROM) {
      desired.push({ sourceType: "depreciation", sourceId: year, date: `${year}-12-31`, description: `Амортизација за ${year}`,
        lines: depreciationLines({ amount, year, rules }) });
      continue;
    }
    const lastMonth = year < nowD.getFullYear() ? 12 : year === nowD.getFullYear() ? nowD.getMonth() + 1 : 0;
    const monthly = round2(amount / 12);
    for (let m = 1; m <= lastMonth; m++) {
      const amt = m === 12 ? round2(amount - monthly * 11) : monthly;
      const end = new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
      desired.push({ sourceType: "depreciation_m", sourceId: year * 100 + m, date: end, description: `Амортизација ${String(m).padStart(2, "0")}/${year}`,
        lines: depreciationLines({ amount: amt, year, rules }) });
    }
  }

  // 7) Залихи на недовршено производство и готови производи на крајот на периодот (по пресметка)
  //    — книжи се промената од претходната пресметка: Должи 600/630 / Побарува 490 (или обратно)
  const vals = await q(`SELECT id, period_end, wip, fg FROM inventory_valuations ORDER BY period_end`).catch(() => [] as any[]);
  let prevW = 0, prevF = 0;
  for (const v of vals) {
    const w = round2(Number(v.wip)), f = round2(Number(v.fg));
    const dw = round2(w - prevW), df = round2(f - prevF);
    prevW = w; prevF = f;
    if (!dw && !df) continue;
    const date = iso(v.period_end);
    desired.push({ sourceType: "inventory_value", sourceId: Number(v.id), date, description: `Залихи на производи на ${date.split("-").reverse().join(".")}`,
      lines: normalizeLines([
        { account: rules.wip_inventory, debit: dw, credit: 0, description: "Недовршено производство" },
        { account: rules.fg_inventory, debit: df, credit: 0, description: "Готови производи" },
        { account: rules.inventory_change, debit: 0, credit: round2(dw + df), description: "Промена на залихите на производи" },
      ]) });
  }

  return { desired, problems };
}

async function nextEntryNumber(client: any, date: string): Promise<string> {
  const y = date.slice(0, 4);
  const r = await client.query(`SELECT COUNT(*)::int n FROM gl_entries WHERE entry_number LIKE $1`, [`НК-${y}-%`]);
  let n = r.rows[0].n + 1;
  // заштита од дупликат ако некое книжење е избришано
  for (;;) {
    const num = `НК-${y}-${String(n).padStart(5, "0")}`;
    const ex = await client.query(`SELECT 1 FROM gl_entries WHERE entry_number = $1`, [num]);
    if (ex.rowCount === 0) return num;
    n++;
  }
}

async function insertLines(client: any, entryId: number, lines: GlLine[]) {
  for (const l of lines) {
    await client.query(`INSERT INTO gl_lines (entry_id, account_code, debit, credit, partner_type, partner_id, description) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [entryId, l.account, l.debit.toFixed(2), l.credit.toFixed(2), l.partnerType ?? null, l.partnerId ?? null, l.description ?? null]);
  }
}

/** Усогласи ја главната книга со документите: ново -> книжи, сменето -> прекнижи, избришано -> тргни. */
export async function syncLedger(actor = "автоматски") {
  await ensureChart();
  const rules = await loadRules();
  const rate = await loadRates();
  const { desired, problems } = await buildDesired(rules, rate);
  // Заклучен период: налозите до тој датум не се менуваат, бришат ниту додаваат — само се пријавува
  const lock = await lockedUntil();
  const lockedMsg = "Документот е сменет по заклучувањето на периодот — налогот останува каков што беше; исправи со сторно/книжно одобрување во тековниот период";
  const client = await getPool().connect();
  let created = 0, updated = 0, removed = 0;
  const who = actor === "автоматски" ? "автоматски" : `автоматски (по измена од ${actor})`;
  try {
    await client.query("BEGIN");
    const existing = (await client.query(`SELECT id, entry_number, entry_date, description, source_type, source_id, signature FROM gl_entries WHERE source_type <> 'manual'`)).rows;
    const byKey = new Map<string, any>(existing.map((e: any) => [`${e.source_type}:${e.source_id}`, e]));
    const keep = new Set<string>();
    for (const d of desired) {
      if (!isBalanced(d.lines) || d.lines.length === 0) {
        if (d.lines.length) problems.push({ sourceType: d.sourceType, sourceId: d.sourceId, ref: d.description, reason: "Книжењето не е во рамнотежа" });
        continue;
      }
      const key = `${d.sourceType}:${d.sourceId}`;
      keep.add(key);
      const sig = linesSignature(d.date, d.lines) + "|" + d.description; // и описот: подобрен опис се пренесува и на старите налози
      const ex = byKey.get(key);
      if (ex && ex.signature === sig) continue;
      const exLocked = ex && isLocked(ex.entry_date, lock);
      if (exLocked || (!ex && isLocked(d.date, lock)) || (ex && isLocked(d.date, lock))) {
        problems.push({ sourceType: d.sourceType, sourceId: d.sourceId, ref: d.description, reason: ex ? lockedMsg : "Документ со датум во заклучен период — не е книжен; внеси го со датум во тековниот период" });
        continue;
      }
      if (ex) {
        const before = (await client.query(`SELECT account_code, debit, credit FROM gl_lines WHERE entry_id = $1 ORDER BY id`, [ex.id])).rows;
        await client.query(`DELETE FROM gl_lines WHERE entry_id = $1`, [ex.id]);
        await client.query(`UPDATE gl_entries SET entry_date = $2, description = $3, signature = $4 WHERE id = $1`, [ex.id, d.date, d.description, sig]);
        await insertLines(client, ex.id, d.lines);
        await glAudit(client, { actor: who, action: "update", entryNumber: ex.entry_number, entryDate: d.date, sourceType: d.sourceType, description: d.description,
          detail: { before: { date: iso(ex.entry_date), description: ex.description, lines: before.map((l: any) => ({ a: l.account_code, d: Number(l.debit), c: Number(l.credit) })) },
            after: { date: d.date, lines: d.lines.map(l => ({ a: l.account, d: l.debit, c: l.credit })) } } });
        updated++;
      } else {
        const num = await nextEntryNumber(client, d.date);
        const r = await client.query(`INSERT INTO gl_entries (entry_number, entry_date, description, source_type, source_id, signature) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [num, d.date, d.description, d.sourceType, d.sourceId, sig]);
        await insertLines(client, r.rows[0].id, d.lines);
        await glAudit(client, { actor: who, action: "create", entryNumber: num, entryDate: d.date, sourceType: d.sourceType, description: d.description,
          detail: { lines: d.lines.map(l => ({ a: l.account, d: l.debit, c: l.credit })) } });
        created++;
      }
    }
    // Затворање на година: класите 4 и 7 на резултат (800), од моменталната главна книга (без самото затворање)
    const closes = await client.query(`SELECT year FROM year_closes ORDER BY year`).then((r: any) => r.rows).catch(() => [] as any[]);
    for (const c of closes) {
      const year = Number(c.year), date = `${year}-12-31`;
      const bal = (await client.query(`SELECT l.account_code, SUM(l.debit - l.credit) n FROM gl_lines l JOIN gl_entries e ON e.id = l.entry_id
        WHERE e.entry_date BETWEEN $1 AND $2 AND e.source_type <> 'year_close' AND (l.account_code LIKE '4%' OR l.account_code LIKE '7%')
        GROUP BY 1 HAVING ROUND(SUM(l.debit - l.credit), 2) <> 0 ORDER BY 1`, [`${year}-01-01`, date])).rows;
      const lines: GlLine[] = bal.map((b: any) => { const n = round2(Number(b.n)); return { account: b.account_code, debit: n < 0 ? -n : 0, credit: n > 0 ? n : 0, description: `Затворање ${year}` }; });
      // net > 0: приходите се поголеми од расходите (добивка) — разликата оди на Побарува 800
      const net = round2(lines.reduce((a, l) => a + l.debit - l.credit, 0));
      if (lines.length) lines.push({ account: rules.year_result, debit: net < 0 ? -net : 0, credit: net > 0 ? net : 0, description: net > 0 ? `Добивка ${year}` : `Загуба ${year}` });
      keep.add(`year_close:${year}`);
      const key = `year_close:${year}`, ex = byKey.get(key);
      const dl = normalizeLines(lines);
      if (!dl.length) continue;
      const sig = linesSignature(date, dl) + "|close";
      if (ex && ex.signature === sig) continue;
      if (isLocked(date, lock)) { problems.push({ sourceType: "year_close", sourceId: year, ref: `${year}`, reason: lockedMsg }); continue; }
      if (ex) {
        await client.query(`DELETE FROM gl_lines WHERE entry_id = $1`, [ex.id]);
        await client.query(`UPDATE gl_entries SET signature = $2 WHERE id = $1`, [ex.id, sig]);
        await insertLines(client, ex.id, dl);
        await glAudit(client, { actor: who, action: "update", entryNumber: ex.entry_number, entryDate: date, sourceType: "year_close", description: `Затворање на ${year}` });
        updated++;
      } else {
        const num = await nextEntryNumber(client, date);
        const r = await client.query(`INSERT INTO gl_entries (entry_number, entry_date, description, source_type, source_id, signature) VALUES ($1,$2,$3,'year_close',$4,$5) RETURNING id`,
          [num, date, `Затворање на ${year} — приходи и расходи на резултат`, year, sig]);
        await insertLines(client, r.rows[0].id, dl);
        await glAudit(client, { actor: who, action: "create", entryNumber: num, entryDate: date, sourceType: "year_close", description: `Затворање на ${year}` });
        created++;
      }
    }

    for (const e of existing) {
      if (keep.has(`${e.source_type}:${e.source_id}`)) continue;
      if (isLocked(e.entry_date, lock)) {
        problems.push({ sourceType: e.source_type, sourceId: Number(e.source_id), ref: `${e.entry_number} ${e.description ?? ""}`, reason: "Документот е избришан/откажан по заклучувањето — налогот останува; исправи во тековниот период" });
        continue;
      }
      const before = (await client.query(`SELECT account_code, debit, credit FROM gl_lines WHERE entry_id = $1 ORDER BY id`, [e.id])).rows;
      await client.query(`DELETE FROM gl_lines WHERE entry_id = $1`, [e.id]);
      await client.query(`DELETE FROM gl_entries WHERE id = $1`, [e.id]);
      await glAudit(client, { actor: who, action: "delete", entryNumber: e.entry_number, entryDate: iso(e.entry_date), sourceType: e.source_type, description: e.description,
        detail: { lines: before.map((l: any) => ({ a: l.account_code, d: Number(l.debit), c: Number(l.credit) })) } });
      removed++;
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return { created, updated, removed, problems };
}


/** КИФ/КУФ и рекапитулација за ДДВ — единствен извор (ДДВ таб, извештај за сметководител, Excel). */
export async function vatBooksData(input: { from: string; to: string }) {
      const rate = await loadRates();
      const out = await q(`SELECT i.id, i.invoice_number, i.invoice_type, i.issue_date, i.subtotal, i.vat_amount, i.vat_rate, i.currency, i.customs_declaration, i.customs_date,
          c.name, c.company, c.edb, c.tax_number, c.country
        FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.invoice_type IN ('standard','credit_note') AND i.status NOT IN ('draft','cancelled') AND i.issue_date BETWEEN $1 AND $2
        ORDER BY i.issue_date, i.invoice_number`, [input.from, input.to]);
      const inc = await q(`SELECT ii.id, ii.supplier_invoice_number, ii.issue_date, ii.received_date, ii.vat_date, ii.reverse_charge, ii.subtotal, ii.vat_amount, ii.vat_rate, ii.currency,
          s.name, s.edb, s.country
        FROM incoming_invoices ii LEFT JOIN suppliers s ON s.id = ii.supplier_id
        WHERE ii.status <> 'cancelled' AND COALESCE(ii.vat_date, ii.received_date, ii.issue_date) BETWEEN $1 AND $2
        ORDER BY COALESCE(ii.vat_date, ii.received_date, ii.issue_date)`, [input.from, input.to]);
      const missing: string[] = [];
      const warnings: string[] = [];
      const row = (r: any, kind: "out" | "in") => {
        const rateDate = iso(kind === "out" ? r.issue_date : (r.issue_date || r.received_date));
        const date = kind === "out" ? rateDate : iso(r.vat_date || r.received_date || r.issue_date);
        const cur = String(r.currency || "MKD").toUpperCase();
        const sign = r.invoice_type === "credit_note" ? -1 : 1;
        const base = toMkd(sign * Math.abs(Number(r.subtotal)), cur, rateDate, rate);
        let vat = toMkd(sign * Math.abs(Number(r.vat_amount)), cur, rateDate, rate);
        const number = kind === "out" ? r.invoice_number : r.supplier_invoice_number;
        if (base === null || vat === null) missing.push(`${number} (${cur} ${rateDate})`);
        const rc = kind === "in" && !!r.reverse_charge;
        if (rc && base !== null) vat = round2(base * (Number(r.vat_rate) || 18) / 100);
        // ДДВ што не одговара на стапката (на пр. 0% со износ на ДДВ) — да се исправи пред пријавата
        if (!rc && base !== null && vat !== null) {
          const bad = vatMismatch({ base: Math.abs(base), rate: Number(r.vat_rate) || 0, vat: Math.abs(vat) });
          if (bad) warnings.push(`${kind === "out" ? "Излезна" : "Влезна"} ${number}: ДДВ ${Math.abs(vat).toLocaleString("mk-MK")} не одговара на ${Number(r.vat_rate)}% од ${Math.abs(base).toLocaleString("mk-MK")} (треба ${bad.expected.toLocaleString("mk-MK")})`);
        }
        const foreign = cur !== "MKD" || !isDomesticCountry(r.country);
        // извоз со 0% ДДВ: потребна е царинска декларација (ЕЦД) како доказ
        if (kind === "out" && foreign && Number(r.vat_rate) === 0 && r.invoice_type !== "credit_note" && !r.customs_declaration)
          warnings.push(`Излезна ${number}: извоз со 0% ДДВ без број на царинска декларација (ЕЦД) — внеси го во фактурата`);
        return { id: r.id, number, date, partner: r.company || r.name, taxId: r.edb || r.tax_number || "", country: r.country || "", customsDeclaration: r.customs_declaration ?? null,
          currency: cur, vatRate: rc ? (Number(r.vat_rate) || 18) : Number(r.vat_rate), baseMkd: base ?? 0, vatMkd: vat ?? 0, totalMkd: round2((base ?? 0) + (vat ?? 0)), foreign, creditNote: sign < 0, reverseCharge: rc };
      };
      const incoming = inc.map(r => row(r, "in"));
      // обратно оданочување: истиот ДДВ е и излезен (КИФ) — пресметан од нас
      const outgoing = [...out.map(r => row(r, "out")), ...incoming.filter(r => r.reverseCharge).map(r => ({ ...r, number: `${r.number} (обратно оданочување)` }))];
      // аванси (ДДВ при прием на авансот) и нивно затворање со фактурата — од налозите во главната книга
      const R = await loadRules();
      const adv = await q(`SELECT e.id, e.entry_date, e.description,
          SUM(CASE WHEN l.account_code = $3 THEN l.credit - l.debit ELSE 0 END) AS vat,
          SUM(CASE WHEN l.account_code = $4 THEN l.credit - l.debit ELSE 0 END) AS base
        FROM gl_entries e JOIN gl_lines l ON l.entry_id = e.id
        WHERE e.entry_date BETWEEN $1 AND $2 AND e.source_type IN ('bank_alloc','cash','advance_settle') AND (e.description LIKE 'Аванс %' OR e.description LIKE 'Затворање аванс %')
        GROUP BY e.id, e.entry_date, e.description HAVING SUM(CASE WHEN l.account_code = $3 THEN l.credit - l.debit ELSE 0 END) <> 0`,
        [input.from, input.to, R.vat_output, R.advances_received]);
      for (const a of adv) {
        const v = round2(Number(a.vat)), b = round2(Number(a.base));
        outgoing.push({ id: -Number(a.id), number: a.description, date: iso(a.entry_date), partner: "", taxId: "", country: "", currency: "MKD",
          vatRate: b ? Math.round(Math.abs(v / b) * 100) : 0, baseMkd: b, vatMkd: v, totalMkd: round2(b + v), foreign: false, creditNote: v < 0, reverseCharge: false } as any);
      }
      outgoing.sort((a, b) => a.date.localeCompare(b.date));
      // Рекапитулација по стапки (помош за пополнување на ДДВ пријавата)
      const group = (rows: any[]) => {
        const m = new Map<string, { base: number; vat: number; count: number }>();
        for (const r of rows) {
          const key = r.vatRate === 0 ? (r.foreign ? "0-export" : "0-exempt") : String(r.vatRate);
          const g = m.get(key) ?? { base: 0, vat: 0, count: 0 };
          g.base = round2(g.base + r.baseMkd); g.vat = round2(g.vat + r.vatMkd); g.count++;
          m.set(key, g);
        }
        return [...m.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => a.key.localeCompare(b.key));
      };
      const outVat = round2(outgoing.reduce((a, r) => a + r.vatMkd, 0));
      const inVat = round2(incoming.reduce((a, r) => a + r.vatMkd, 0));
      return { outgoing, incoming, summary: { output: group(outgoing), input: group(incoming), outVat, inVat, payable: round2(outVat - inVat) }, missingRates: missing, warnings };
}


// ───────────────────────── БИЛАНСИ ─────────────────────────

/** Салда по конто (должи − побарува) за сите налози до датумот. */
async function balancesAt(date: string): Promise<AccountBalance[]> {
  const rows = await q(`SELECT l.account_code AS code, COALESCE(MAX(a.name), '') AS name, SUM(l.debit - l.credit) AS bal
    FROM gl_lines l JOIN gl_entries e ON e.id = l.entry_id LEFT JOIN gl_accounts a ON a.code = l.account_code
    WHERE e.entry_date <= $1 GROUP BY l.account_code ORDER BY l.account_code`, [date]);
  return rows.map(r => ({ code: r.code, name: r.name, balance: round2(Number(r.bal)) }));
}
/** Промет по конто за периодот, без налогот за затворање на годината (тој ги нулира приходите и расходите). */
async function movementsBetween(from: string, to: string): Promise<AccountBalance[]> {
  const rows = await q(`SELECT l.account_code AS code, COALESCE(MAX(a.name), '') AS name, SUM(l.debit - l.credit) AS bal
    FROM gl_lines l JOIN gl_entries e ON e.id = l.entry_id LEFT JOIN gl_accounts a ON a.code = l.account_code
    WHERE e.entry_date BETWEEN $1 AND $2 AND e.source_type <> 'year_close' GROUP BY l.account_code ORDER BY l.account_code`, [from, to]);
  return rows.map(r => ({ code: r.code, name: r.name, balance: round2(Number(r.bal)) }));
}
const minusYear = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`.replace(/-02-29$/, "-02-28");

async function kvJson(key: string): Promise<Record<string, string>> {
  const r = (await q(`SELECT value FROM app_kv WHERE key = $1`, [key]))[0];
  try { return r?.value ? JSON.parse(r.value) : {}; } catch { return {}; }
}

// ───────────────────────── рутер ─────────────────────────

const cashInput = z.object({
  txDate: dateStr,
  direction: z.enum(["in", "out"]),
  amount: z.number().positive(),
  description: z.string().optional(),
  partnerName: z.string().optional(),
  invoiceId: z.number().optional(),
  incomingInvoiceId: z.number().optional(),
  accountCode: z.string().optional(),
});

export const financeRouter = createRouter({
  // ===== КУРСНА ЛИСТА =====
  ratesList: publicQuery
    .input(z.object({ from: dateStr.optional(), to: dateStr.optional(), currency: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const to = input?.to ?? new Date().toISOString().slice(0, 10);
      const from = input?.from ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const rows = await q(`SELECT rate_date, currency, rate, source FROM exchange_rates WHERE rate_date BETWEEN $1 AND $2 ${input?.currency ? "AND currency = $3" : ""}
        ORDER BY rate_date DESC, currency LIMIT 1000`, input?.currency ? [from, to, input.currency.toUpperCase()] : [from, to]);
      return rows.map(r => ({ date: iso(r.rate_date), currency: r.currency, rate: Number(r.rate), source: r.source }));
    }),

  rateFor: publicQuery
    .input(z.object({ currency: z.string(), date: dateStr }))
    .query(async ({ input }) => {
      const rate = await loadRates();
      return { rate: rate(input.currency, input.date) };
    }),

  ratesFetchNbrm: publicQuery
    .input(z.object({ from: dateStr, to: dateStr }))
    .mutation(async ({ input }) => {
      try {
        const n = await fetchNbrmRates(input.from, input.to);
        return { success: true, count: n };
      } catch (e: any) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: `Не можам да ја преземам курсната листа од НБРМ (${e?.message ?? e}). Внеси го курсот рачно.` });
      }
    }),

  rateSet: publicQuery
    .input(z.object({ date: dateStr, currency: z.string().length(3), rate: z.number().positive() }))
    .mutation(async ({ input }) => {
      await q(`INSERT INTO exchange_rates (rate_date, currency, rate, source) VALUES ($1,$2,$3,'manual')
               ON CONFLICT (rate_date, currency) DO UPDATE SET rate = EXCLUDED.rate, source = 'manual'`, [input.date, input.currency.toUpperCase(), input.rate]);
      return { success: true };
    }),

  // ===== БЛАГАЈНА =====
  cashList: publicQuery
    .input(z.object({ from: dateStr, to: dateStr }))
    .query(async ({ input }) => {
      const open = await q(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) b FROM cash_transactions WHERE tx_date < $1`, [input.from]);
      const rows = await q(`SELECT c.*, i.invoice_number, ii.supplier_invoice_number FROM cash_transactions c
        LEFT JOIN invoices i ON i.id = c.invoice_id LEFT JOIN incoming_invoices ii ON ii.id = c.incoming_invoice_id
        WHERE c.tx_date BETWEEN $1 AND $2 ORDER BY c.tx_date, c.id`, [input.from, input.to]);
      let bal = Number(open[0].b);
      const opening = round2(bal);
      let ins = 0, outs = 0;
      const items = rows.map(r => {
        const a = Number(r.amount);
        if (r.direction === "in") { bal += a; ins += a; } else { bal -= a; outs += a; }
        return { id: r.id, docNumber: r.doc_number, date: iso(r.tx_date), direction: r.direction, amount: a, description: r.description,
          partnerName: r.partner_name, invoiceNumber: r.invoice_number, incomingNumber: r.supplier_invoice_number, accountCode: r.account_code, balance: round2(bal) };
      });
      return { opening, ins: round2(ins), outs: round2(outs), closing: round2(bal), items };
    }),

  cashCreate: publicQuery
    .input(cashInput)
    .mutation(async ({ input, ctx }) => {
      await assertOpen(input.txDate, "Благајна");
      if (input.invoiceId && input.direction !== "in") throw new TRPCError({ code: "BAD_REQUEST", message: "Наплата по излезна фактура е прием во благајна" });
      if (input.incomingInvoiceId && input.direction !== "out") throw new TRPCError({ code: "BAD_REQUEST", message: "Плаќање на влезна фактура е исплата од благајна" });
      if (input.invoiceId && input.incomingInvoiceId) throw new TRPCError({ code: "BAD_REQUEST", message: "Избери само еден документ" });
      if (input.direction === "out") {
        const b = await q(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) b FROM cash_transactions WHERE tx_date <= $1`, [input.txDate]);
        if (Number(b[0].b) - input.amount < -0.005) throw new TRPCError({ code: "BAD_REQUEST", message: `Во благајната нема доволно пари (салдо ${round2(Number(b[0].b))} ден.)` });
      }
      const y = input.txDate.slice(0, 4);
      const prefix = input.direction === "in" ? "УП" : "ИП";
      const cnt = await q(`SELECT COUNT(*)::int n FROM cash_transactions WHERE doc_number LIKE $1`, [`${prefix}-%/${y}`]);
      let n = cnt[0].n + 1, docNumber = "";
      for (;;) {
        docNumber = `${prefix}-${String(n).padStart(3, "0")}/${y}`;
        if ((await q(`SELECT 1 FROM cash_transactions WHERE doc_number = $1`, [docNumber])).length === 0) break;
        n++;
      }
      const r = await q(`INSERT INTO cash_transactions (doc_number, tx_date, direction, amount, description, partner_name, invoice_id, incoming_invoice_id, account_code, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [docNumber, input.txDate, input.direction, input.amount.toFixed(2), input.description ?? null, input.partnerName ?? null,
         input.invoiceId ?? null, input.incomingInvoiceId ?? null, input.accountCode ?? null, (ctx as any)?.actor?.name ?? null]);
      await logAudit({ action: "CREATE", entityType: "cash", entityId: r[0].id, description: `Благајна ${docNumber} ${input.amount}` }).catch(() => {});
      if (input.invoiceId) await refreshPaymentStatus("invoice", input.invoiceId);
      if (input.incomingInvoiceId) await refreshPaymentStatus("incoming_invoice", input.incomingInvoiceId);
      return { success: true, id: r[0].id, docNumber };
    }),

  cashDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const c0 = (await q(`SELECT tx_date, doc_number FROM cash_transactions WHERE id = $1`, [input.id]))[0];
      if (c0) await assertOpen(c0.tx_date, `Благајна ${c0.doc_number}`);
      const del = await q(`DELETE FROM cash_transactions WHERE id = $1 RETURNING invoice_id, incoming_invoice_id`, [input.id]);
      if (del[0]?.invoice_id) await refreshPaymentStatus("invoice", Number(del[0].invoice_id));
      if (del[0]?.incoming_invoice_id) await refreshPaymentStatus("incoming_invoice", Number(del[0].incoming_invoice_id));
      return { success: true };
    }),

  cashOpenDocs: publicQuery.query(async () => {
    // Истото салдо како во банка/побарувања: платеното се пресметува во валутата на документот
    const docs = await openDocs({ includeProforma: true });
    const map = (d: OpenDoc) => ({ id: d.id, number: d.number, partner: d.partner, total: d.total, currency: d.currency, open: d.open });
    const byDate = (a: OpenDoc, b: OpenDoc) => b.date.localeCompare(a.date);
    return { invoices: docs.filter(d => d.docType === "invoice").sort(byDate).slice(0, 300).map(map),
      incoming: docs.filter(d => d.docType === "incoming_invoice").sort(byDate).slice(0, 300).map(map) };
  }),

  // ===== КОНТЕН ПЛАН И ПРАВИЛА =====
  accountsList: publicQuery.query(async () => {
    await ensureChart();
    return (await q(`SELECT code, name, type, is_active FROM gl_accounts ORDER BY code`)).map(r => ({ code: r.code, name: r.name, type: r.type, isActive: r.is_active }));
  }),

  accountUpsert: publicQuery
    .input(z.object({ code: z.string().regex(/^\d{1,10}$/), name: z.string().min(2), type: z.enum(["asset", "liability", "equity", "revenue", "expense"]) }))
    .mutation(async ({ input }) => {
      await q(`INSERT INTO gl_accounts (code, name, type) VALUES ($1,$2,$3) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type`, [input.code, input.name, input.type]);
      return { success: true };
    }),

  postingRulesGet: publicQuery.query(async () => {
    const rules = await loadRules();
    return POSTING_RULES.map(r => ({ key: r.key, label: r.label, accountCode: rules[r.key], defaultCode: r.defaultCode }));
  }),

  postingRulesSet: publicQuery
    .input(z.array(z.object({ key: z.string(), accountCode: z.string().regex(/^\d{1,10}$/) })))
    .mutation(async ({ input }) => {
      await ensureChart();
      for (const r of input) {
        if (!POSTING_RULES.some(p => p.key === r.key)) continue;
        const ex = await q(`SELECT 1 FROM gl_accounts WHERE code = $1`, [r.accountCode]);
        if (!ex.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Контото ${r.accountCode} не постои во контниот план` });
        await q(`INSERT INTO gl_posting_rules (key, account_code) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET account_code = EXCLUDED.account_code`, [r.key, r.accountCode]);
      }
      return { success: true };
    }),

  // ===== КНИЖЕЊЕ =====
  ledgerSync: publicQuery.mutation(async ({ ctx }) => syncLedger((ctx as any).actor?.name ?? "автоматски")),

  // ===== ЗАКЛУЧУВАЊЕ НА ПЕРИОД И ДНЕВНИК =====
  periodLockGet: publicQuery.query(async () => {
    const lock = await lockedUntil();
    const hist = await q(`SELECT at, actor, action, description FROM gl_audit WHERE action IN ('lock','unlock') ORDER BY at DESC LIMIT 20`).catch(() => []);
    return { lockedUntil: lock, history: hist.map(h => ({ at: h.at, actor: h.actor, action: h.action, description: h.description })) };
  }),

  periodLockSet: publicQuery
    .input(z.object({ date: dateStr.nullable(), reason: z.string().max(300).optional() }))
    .mutation(async ({ input, ctx }) => {
      const actor = (ctx as any).actor;
      const cur = await lockedUntil();
      // враќање назад (отклучување) смее само администратор
      if ((input.date ?? "") < (cur ?? "") && actor && actor.role !== "admin")
        throw new TRPCError({ code: "FORBIDDEN", message: "Отклучување на период смее само администратор" });
      if (input.date && input.date > new Date().toISOString().slice(0, 10))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Не може да се заклучи иден период" });
      await setLockedUntil(input.date);
      const unlocking = (input.date ?? "") < (cur ?? "");
      await glAudit(null, { actor: actor?.name ?? "непознат", action: unlocking ? "unlock" : "lock",
        description: `${input.date ? `Заклучено до ${fmtMk(input.date)}` : "Заклучувањето е тргнато"}${cur ? ` (претходно до ${fmtMk(cur)})` : ""}${input.reason ? ` · ${input.reason}` : ""}` });
      return { success: true, lockedUntil: input.date };
    }),

  glAuditList: publicQuery
    .input(z.object({ search: z.string().optional(), limit: z.number().max(500).default(100), offset: z.number().default(0) }).optional())
    .query(async ({ input }) => {
      const p: any[] = [];
      let where = "TRUE";
      if (input?.search) { p.push(`%${input.search}%`); where = `(entry_number ILIKE $1 OR description ILIKE $1 OR actor ILIKE $1)`; }
      const total = (await q(`SELECT COUNT(*)::int n FROM gl_audit WHERE ${where}`, p))[0].n;
      p.push(input?.limit ?? 100, input?.offset ?? 0);
      const rows = await q(`SELECT * FROM gl_audit WHERE ${where} ORDER BY at DESC, id DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p);
      return { total, rows: rows.map(r => ({ id: Number(r.id), at: r.at, actor: r.actor, action: r.action, entryNumber: r.entry_number, entryDate: r.entry_date ? iso(r.entry_date) : null, sourceType: r.source_type, description: r.description, detail: r.detail })) };
    }),

  journalList: publicQuery
    .input(z.object({ from: dateStr, to: dateStr, search: z.string().optional(), limit: z.number().max(500).default(200), offset: z.number().default(0) }))
    .query(async ({ input }) => {
      const params: any[] = [input.from, input.to];
      let where = `e.entry_date BETWEEN $1 AND $2`;
      if (input.search) { params.push(`%${input.search}%`); where += ` AND (e.description ILIKE $${params.length} OR e.entry_number ILIKE $${params.length})`; }
      const total = (await q(`SELECT COUNT(*)::int n FROM gl_entries e WHERE ${where}`, params))[0].n;
      params.push(input.limit, input.offset);
      const entries = await q(`SELECT e.* FROM gl_entries e WHERE ${where} ORDER BY e.entry_date DESC, e.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
      const ids = entries.map(e => e.id);
      const lines = ids.length ? await q(`SELECT l.*, a.name AS account_name, COALESCE(c.company, c.name, s.name) AS partner_name FROM gl_lines l
        LEFT JOIN gl_accounts a ON a.code = l.account_code
        LEFT JOIN customers c ON l.partner_type = 'customer' AND c.id = l.partner_id
        LEFT JOIN suppliers s ON l.partner_type = 'supplier' AND s.id = l.partner_id
        WHERE l.entry_id = ANY($1) ORDER BY l.id`, [ids]) : [];
      // Од каде е налогот: за залиха -- самото движење (материјал, количина, цена, налог), за другите -- документот
      const lockDate = await lockedUntil();
      const moveIds = entries.filter(e => e.source_type === "stock_move" && e.source_id != null).map(e => Number(e.source_id));
      const moves = moveIds.length ? await q(`SELECT t.id, t.type, t.quantity, t.unit_cost, t.total_cost, t.reference, t.notes, t.created_at,
          t.material_id, t.source_doc_type, t.source_doc_id, m.id AS mid, m.code, m.name, m.unit, w.wo_number, u.name AS user_name
        FROM inventory_transactions t LEFT JOIN materials m ON m.id = t.material_id
        LEFT JOIN work_orders w ON t.source_doc_type = 'work_order' AND w.id = t.source_doc_id
        LEFT JOIN app_users u ON u.id = t.created_by
        WHERE t.id = ANY($1)`, [moveIds]).catch(() => [] as any[]) : [];
      const moveById = new Map(moves.map((m: any) => [Number(m.id), m]));
      const MOVE_KIND: Record<string, string> = { issue: "Издавање од магацин", scrap: "Отпис / кусок", adjustment: "Корекција на залиха" };
      const sourceOf = (e: any) => {
        if (e.source_type !== "stock_move") return null;
        const m: any = moveById.get(Number(e.source_id));
        if (!m) return { kind: "stock", missing: true, text: "Движењето на залиха повеќе не постои" };
        return {
          kind: "stock", missing: false, moveId: Number(m.id), orphan: m.mid == null, materialId: Number(m.material_id),
          text: [MOVE_KIND[m.type] ?? m.type, m.mid == null ? `избришан материјал (#${m.material_id})` : `${m.code ? m.code + " " : ""}${m.name}`,
            `${Math.abs(Number(m.quantity)).toLocaleString("mk-MK", { maximumFractionDigits: 3 })}${m.unit ? " " + m.unit : ""} × ${Number(m.unit_cost || 0).toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ден`,
            m.wo_number ? `налог ${m.wo_number}` : m.reference || null, m.user_name ? `внел ${m.user_name}` : null, iso(m.created_at).split("-").reverse().join(".")].filter(Boolean).join(" · "),
          workOrderId: m.source_doc_type === "work_order" && m.source_doc_id ? Number(m.source_doc_id) : null,
        };
      };
      return {
        total,
        entries: entries.map(e => ({
          id: Number(e.id), number: e.entry_number, date: iso(e.entry_date), description: e.description, sourceType: e.source_type, sourceId: e.source_id == null ? null : Number(e.source_id),
          source: sourceOf(e), templateName: (e.template_name ?? null) as string | null,
          locked: isLocked(e.entry_date, lockDate), stornoOf: e.storno_of == null ? null : Number(e.storno_of),
          lines: lines.filter(l => Number(l.entry_id) === Number(e.id)).map(l => ({ account: l.account_code, accountName: l.account_name, debit: Number(l.debit), credit: Number(l.credit), description: l.description, partner: (l.partner_name ?? null) as string | null })),
        })),
      };
    }),

  // Движење на залиха чиј материјал е избришан (најчесто проба): се отстранува, а со него и налогот
  orphanStockMoveDelete: publicQuery
    .input(z.object({ moveId: z.number() }))
    .mutation(async ({ input }) => {
      const r = (await q(`SELECT t.id, m.id AS mid FROM inventory_transactions t LEFT JOIN materials m ON m.id = t.material_id WHERE t.id = $1`, [input.moveId]))[0];
      if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Движењето не постои" });
      if (r.mid != null) throw new TRPCError({ code: "BAD_REQUEST", message: "Материјалот постои — ова движење е вистинско и не се брише одовде. Исправи го преку Склад." });
      await q(`DELETE FROM inventory_transactions WHERE id = $1`, [input.moveId]);
      const sync = await syncLedger();
      return { success: true, removed: sync.removed };
    }),

  // ===== КРАЈ НА ПЕРИОД =====
  /** Предлог-пресметка: недовршено производство (отворени налози) и готови производи (на залиха) */
  inventoryValuationCalc: publicQuery
    .input(z.object({ date: dateStr }))
    .query(async () => {
      const wip = await q(`SELECT w.id, w.wo_number, w.status,
          COALESCE((SELECT SUM(m.total_cost) FROM work_order_materials m WHERE m.work_order_id = w.id AND m.is_actual = 'actual'), 0) AS mat,
          COALESCE((SELECT SUM(o.cost_amount) FROM work_order_operations o WHERE o.work_order_id = w.id AND (o.status = 'completed' OR COALESCE(o.actual_time, 0) > 0)), 0) AS ops
        FROM work_orders w WHERE w.status IN ('in_progress', 'on_hold', 'pending')`);
      const wipRows = wip.map(r => ({ id: Number(r.id), number: r.wo_number, status: r.status, material: round2(Number(r.mat)), operations: round2(Number(r.ops)), total: round2(Number(r.mat) + Number(r.ops)) }))
        .filter(r => r.total > 0);
      const fg = await q(`SELECT f.product_id, p.name, SUM(f.quantity) q, SUM(f.quantity * COALESCE(f.unit_cost, 0)) v
        FROM finished_goods_stock f LEFT JOIN products p ON p.id = f.product_id GROUP BY 1, 2 HAVING SUM(f.quantity) > 0`).catch(() => [] as any[]);
      const fgRows = fg.map(r => ({ productId: Number(r.product_id), name: r.name ?? `#${r.product_id}`, quantity: Number(r.q), value: round2(Number(r.v)) }));
      const last = (await q(`SELECT period_end, wip, fg FROM inventory_valuations ORDER BY period_end DESC LIMIT 1`).catch(() => []))[0];
      return {
        wip: round2(wipRows.reduce((a, r) => a + r.total, 0)), fg: round2(fgRows.reduce((a, r) => a + r.value, 0)), wipRows, fgRows,
        previous: last ? { date: iso(last.period_end), wip: Number(last.wip), fg: Number(last.fg) } : null,
      };
    }),

  inventoryValuationList: publicQuery.query(async () =>
    (await q(`SELECT * FROM inventory_valuations ORDER BY period_end DESC`).catch(() => [])).map(r => ({ id: Number(r.id), date: iso(r.period_end), wip: Number(r.wip), fg: Number(r.fg), note: r.note, createdBy: r.created_by }))),

  inventoryValuationSave: publicQuery
    .input(z.object({ date: dateStr, wip: z.number().min(0), fg: z.number().min(0), note: z.string().max(500).optional() }))
    .mutation(async ({ input, ctx }) => {
      await assertOpen(input.date, "Залихи на производи");
      const later = await q(`SELECT period_end FROM inventory_valuations WHERE period_end > $1 LIMIT 1`, [input.date]);
      if (later.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Веќе постои пресметка на ${fmtMk(iso(later[0].period_end))} — внесувај по ред` });
      await q(`INSERT INTO inventory_valuations (period_end, wip, fg, note, created_by) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (period_end) DO UPDATE SET wip = EXCLUDED.wip, fg = EXCLUDED.fg, note = EXCLUDED.note, created_by = EXCLUDED.created_by`,
        [input.date, input.wip, input.fg, input.note ?? null, (ctx as any).actor?.name ?? null]);
      return { success: true };
    }),

  inventoryValuationRemove: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const v = (await q(`SELECT period_end FROM inventory_valuations WHERE id = $1`, [input.id]))[0];
      if (!v) return { success: true };
      await assertOpen(v.period_end, "Залихи на производи");
      const later = await q(`SELECT 1 FROM inventory_valuations WHERE period_end > $1 LIMIT 1`, [v.period_end]);
      if (later.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Може да се избрише само последната пресметка" });
      await q(`DELETE FROM inventory_valuations WHERE id = $1`, [input.id]);
      return { success: true };
    }),

  yearCloseList: publicQuery.query(async () => {
    const closed = await q(`SELECT year, closed_by, closed_at FROM year_closes ORDER BY year DESC`).catch(() => []);
    const years = await q(`SELECT DISTINCT EXTRACT(YEAR FROM entry_date)::int y FROM gl_entries ORDER BY 1 DESC`);
    const rules = await loadRules();
    const out = [];
    for (const yr of years) {
      const y = Number(yr.y);
      const r = (await q(`SELECT
          COALESCE(SUM(CASE WHEN l.account_code LIKE '7%' THEN l.credit - l.debit END), 0) AS rev,
          COALESCE(SUM(CASE WHEN l.account_code LIKE '4%' THEN l.debit - l.credit END), 0) AS exp
        FROM gl_lines l JOIN gl_entries e ON e.id = l.entry_id WHERE e.entry_date BETWEEN $1 AND $2 AND e.source_type <> 'year_close'`, [`${y}-01-01`, `${y}-12-31`]))[0];
      const c = closed.find(x => Number(x.year) === y);
      out.push({ year: y, revenue: round2(Number(r.rev)), expense: round2(Number(r.exp)), result: round2(Number(r.rev) - Number(r.exp)),
        closed: !!c, closedBy: c?.closed_by ?? null, closedAt: c?.closed_at ?? null });
    }
    return { years: out, resultAccount: rules.year_result };
  }),

  yearClose: publicQuery
    .input(z.object({ year: z.number().int().min(2000).max(2100) }))
    .mutation(async ({ input, ctx }) => {
      await assertOpen(`${input.year}-12-31`, `Затворање на ${input.year}`);
      if (new Date().getFullYear() <= input.year) throw new TRPCError({ code: "BAD_REQUEST", message: `${input.year} уште не е завршена` });
      await q(`INSERT INTO year_closes (year, closed_by) VALUES ($1,$2) ON CONFLICT (year) DO NOTHING`, [input.year, (ctx as any).actor?.name ?? null]);
      return syncLedger((ctx as any).actor?.name ?? "автоматски");
    }),

  yearReopen: publicQuery
    .input(z.object({ year: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const a = (ctx as any).actor;
      if (a && a.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Отворање затворена година смее само администратор" });
      await assertOpen(`${input.year}-12-31`, `Затворање на ${input.year}`);
      await q(`DELETE FROM year_closes WHERE year = $1`, [input.year]);
      return syncLedger(a?.name ?? "автоматски");
    }),

  // ===== ТЕРК: шеми на книжење (конта + страна, без износи) =====
  terkList: publicQuery.query(async () => {
    const t = await q(`SELECT id, name, description, updated_at FROM gl_templates ORDER BY lower(name)`);
    const l = t.length ? await q(`SELECT tl.template_id, tl.account_code, tl.side, tl.note, a.name AS account_name
      FROM gl_template_lines tl LEFT JOIN gl_accounts a ON a.code = tl.account_code ORDER BY tl.template_id, tl.position, tl.id`) : [];
    return t.map(x => ({
      id: Number(x.id), name: x.name as string, description: (x.description ?? "") as string, updatedAt: x.updated_at,
      lines: l.filter(r => Number(r.template_id) === Number(x.id)).map(r => ({ account: r.account_code as string, accountName: (r.account_name ?? "") as string, side: r.side as "D" | "P", note: (r.note ?? "") as string })),
    }));
  }),

  terkSave: publicQuery
    .input(z.object({
      id: z.number().optional(),
      name: z.string().trim().min(2, "Внеси назив на теркот").max(120),
      description: z.string().max(2000).optional(),
      lines: z.array(z.object({ account: z.string().min(1), side: z.enum(["D", "P"]), note: z.string().max(200).optional() })).min(2, "Теркот треба најмалку два реда"),
    }))
    .mutation(async ({ input }) => {
      if (!input.lines.some(l => l.side === "D") || !input.lines.some(l => l.side === "P"))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Теркот треба да има барем едно конто на Должи и едно на Побарува" });
      const codes = [...new Set(input.lines.map(l => l.account))];
      const ex = await q(`SELECT code FROM gl_accounts WHERE code = ANY($1)`, [codes]);
      const missing = codes.filter(c => !ex.some(e => e.code === c));
      if (missing.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Непостоечки конта: ${missing.join(", ")} — додади ги во Контен план` });
      const dup = await q(`SELECT id FROM gl_templates WHERE lower(name) = lower($1) AND id <> $2`, [input.name, input.id ?? 0]);
      if (dup.length) throw new TRPCError({ code: "CONFLICT", message: `Веќе постои терк „${input.name}“` });
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        let id = input.id;
        if (id) {
          const r = await client.query(`UPDATE gl_templates SET name = $2, description = $3, updated_at = now() WHERE id = $1`, [id, input.name, input.description ?? null]);
          if (!r.rowCount) throw new TRPCError({ code: "NOT_FOUND", message: "Теркот не постои" });
          await client.query(`DELETE FROM gl_template_lines WHERE template_id = $1`, [id]);
        } else {
          id = (await client.query(`INSERT INTO gl_templates (name, description) VALUES ($1, $2) RETURNING id`, [input.name, input.description ?? null])).rows[0].id;
        }
        for (const [i, l] of input.lines.entries())
          await client.query(`INSERT INTO gl_template_lines (template_id, position, account_code, side, note) VALUES ($1,$2,$3,$4,$5)`, [id, i, l.account, l.side, l.note || null]);
        await client.query("COMMIT");
        return { success: true, id: Number(id) };
      } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    }),

  // шема, не книжење — бришењето не допира налози, па не бара администратор
  terkRemove: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await q(`DELETE FROM gl_templates WHERE id = $1`, [input.id]);
      return { success: true };
    }),

  manualEntryCreate: publicQuery
    .input(z.object({
      date: dateStr, description: z.string().min(2),
      templateName: z.string().max(120).optional(),
      lines: z.array(z.object({ account: z.string(), debit: z.number().min(0), credit: z.number().min(0), description: z.string().optional(),
        partnerType: z.enum(["customer", "supplier"]).optional(), partnerId: z.number().optional() })).min(2),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertOpen(input.date, "Налог");
      // Партнер: на конта на купувачи (12x) -> купувач, на добавувачи (22x) -> добавувач; на главните конта е задолжителен
      const rules = await loadRules();
      const mustPartner: Record<string, "customer" | "supplier"> = {
        [rules.customers_domestic]: "customer", [rules.customers_foreign]: "customer",
        [rules.suppliers_domestic]: "supplier", [rules.suppliers_foreign]: "supplier",
      };
      const kindOf = (acc: string): "customer" | "supplier" | null => mustPartner[acc] ?? (acc.startsWith("12") ? "customer" : acc.startsWith("22") ? "supplier" : null);
      for (const l of input.lines) {
        const kind = kindOf(l.account);
        if (l.partnerId && kind && l.partnerType && l.partnerType !== kind)
          throw new TRPCError({ code: "BAD_REQUEST", message: `На конто ${l.account} оди ${kind === "customer" ? "купувач" : "добавувач"}` });
        if (!l.partnerId && mustPartner[l.account] && (l.debit || l.credit))
          throw new TRPCError({ code: "BAD_REQUEST", message: `Избери ${mustPartner[l.account] === "customer" ? "купувач" : "добавувач"} за конто ${l.account}` });
      }
      for (const kind of ["customer", "supplier"] as const) {
        const ids = [...new Set(input.lines.filter(l => l.partnerId && kindOf(l.account) === kind).map(l => l.partnerId!))];
        if (!ids.length) continue;
        const found = await q(`SELECT id FROM ${kind === "customer" ? "customers" : "suppliers"} WHERE id = ANY($1)`, [ids]);
        if (found.length !== ids.length) throw new TRPCError({ code: "BAD_REQUEST", message: kind === "customer" ? "Непостоечки купувач" : "Непостоечки добавувач" });
      }
      const lines = normalizeLines(input.lines.map(l => {
        const kind = l.partnerId ? kindOf(l.account) : null;
        return { account: l.account, debit: l.debit, credit: l.credit, description: l.description, partnerType: kind ?? undefined, partnerId: kind ? l.partnerId : undefined };
      }));
      if (!isBalanced(lines)) throw new TRPCError({ code: "BAD_REQUEST", message: "Должи и побарува не се еднакви" });
      const codes = [...new Set(lines.map(l => l.account))];
      const ex = await q(`SELECT code FROM gl_accounts WHERE code = ANY($1)`, [codes]);
      const missing = codes.filter(c => !ex.some(e => e.code === c));
      if (missing.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Непостоечки конта: ${missing.join(", ")}` });
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        const num = await nextEntryNumber(client, input.date);
        const r = await client.query(`INSERT INTO gl_entries (entry_number, entry_date, description, source_type, template_name) VALUES ($1,$2,$3,'manual',$4) RETURNING id`, [num, input.date, input.description, input.templateName ?? null]);
        await insertLines(client, r.rows[0].id, lines);
        await glAudit(client, { actor: (ctx as any).actor?.name ?? "непознат", action: "create", entryNumber: num, entryDate: input.date, sourceType: "manual",
          description: input.description, detail: { template: input.templateName ?? null, lines: lines.map(l => ({ a: l.account, d: l.debit, c: l.credit })) } });
        await client.query("COMMIT");
        return { success: true, number: num };
      } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    }),

  manualEntryDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const e = await q(`SELECT * FROM gl_entries WHERE id = $1`, [input.id]);
      if (!e.length) return { success: true };
      if (e[0].source_type !== "manual") throw new TRPCError({ code: "BAD_REQUEST", message: "Автоматските книжења се менуваат преку документот, не рачно" });
      await assertOpen(e[0].entry_date, `Налог ${e[0].entry_number}`);
      const before = await q(`SELECT account_code, debit, credit FROM gl_lines WHERE entry_id = $1 ORDER BY id`, [input.id]);
      await q(`DELETE FROM gl_lines WHERE entry_id = $1`, [input.id]);
      await q(`DELETE FROM gl_entries WHERE id = $1`, [input.id]);
      await glAudit(null, { actor: (ctx as any).actor?.name ?? "непознат", action: "delete", entryNumber: e[0].entry_number, entryDate: iso(e[0].entry_date), sourceType: "manual",
        description: e[0].description, detail: { lines: before.map(l => ({ a: l.account_code, d: Number(l.debit), c: Number(l.credit) })) } });
      return { success: true };
    }),

  // Сторно: нов налог со обратни износи, со датум во отворен период — оригиналот останува
  manualEntryStorno: publicQuery
    .input(z.object({ id: z.number(), date: dateStr }))
    .mutation(async ({ input, ctx }) => {
      const e = (await q(`SELECT * FROM gl_entries WHERE id = $1`, [input.id]))[0];
      if (!e) throw new TRPCError({ code: "NOT_FOUND", message: "Налогот не постои" });
      if (e.source_type !== "manual") throw new TRPCError({ code: "BAD_REQUEST", message: "Автоматските налози се исправаат преку документот (книжно одобрување)" });
      if (e.storno_of) throw new TRPCError({ code: "BAD_REQUEST", message: "Ова е веќе сторно налог" });
      const done = await q(`SELECT entry_number FROM gl_entries WHERE storno_of = $1`, [input.id]);
      if (done.length) throw new TRPCError({ code: "CONFLICT", message: `Налогот е веќе сторниран со ${done[0].entry_number}` });
      await assertOpen(input.date, "Сторно налог");
      const lines = await q(`SELECT * FROM gl_lines WHERE entry_id = $1 ORDER BY id`, [input.id]);
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        const num = await nextEntryNumber(client, input.date);
        const desc = `Сторно ${e.entry_number} · ${e.description ?? ""}`.trim();
        const r = await client.query(`INSERT INTO gl_entries (entry_number, entry_date, description, source_type, storno_of, template_name) VALUES ($1,$2,$3,'manual',$4,$5) RETURNING id`,
          [num, input.date, desc, input.id, e.template_name ?? null]);
        await insertLines(client, r.rows[0].id, lines.map(l => ({ account: l.account_code, debit: Number(l.credit), credit: Number(l.debit),
          partnerType: l.partner_type ?? undefined, partnerId: l.partner_id == null ? undefined : Number(l.partner_id), description: l.description ?? undefined })));
        await glAudit(client, { actor: (ctx as any).actor?.name ?? "непознат", action: "storno", entryNumber: num, entryDate: input.date, sourceType: "manual", description: desc });
        await client.query("COMMIT");
        return { success: true, number: num };
      } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
    }),

  // ===== ИЗВЕШТАИ =====
  trialBalance: publicQuery
    .input(z.object({ from: dateStr, to: dateStr }))
    .query(async ({ input }) => {
      const rows = await q(`SELECT a.code, a.name, a.type,
          COALESCE(SUM(CASE WHEN e.entry_date < $1 THEN l.debit - l.credit END),0) AS opening,
          COALESCE(SUM(CASE WHEN e.entry_date BETWEEN $1 AND $2 THEN l.debit END),0) AS debit,
          COALESCE(SUM(CASE WHEN e.entry_date BETWEEN $1 AND $2 THEN l.credit END),0) AS credit
        FROM gl_accounts a
        LEFT JOIN gl_lines l ON l.account_code = a.code
        LEFT JOIN gl_entries e ON e.id = l.entry_id AND e.entry_date <= $2
        GROUP BY a.code, a.name, a.type ORDER BY a.code`, [input.from, input.to]);
      const accounts = rows.map(r => {
        const opening = round2(Number(r.opening)), debit = round2(Number(r.debit)), credit = round2(Number(r.credit));
        return { code: r.code, name: r.name, type: r.type, opening, debit, credit, closing: round2(opening + debit - credit) };
      }).filter(a => a.opening !== 0 || a.debit !== 0 || a.credit !== 0);
      const totals = accounts.reduce((t, a) => ({ debit: round2(t.debit + a.debit), credit: round2(t.credit + a.credit) }), { debit: 0, credit: 0 });
      const unposted = await q(`SELECT
          (SELECT COUNT(*)::int FROM invoices i WHERE i.invoice_type IN ('standard','credit_note') AND i.status NOT IN ('draft','cancelled')
             AND NOT EXISTS (SELECT 1 FROM gl_entries e WHERE e.source_type='invoice' AND e.source_id=i.id)) AS inv,
          (SELECT COUNT(*)::int FROM incoming_invoices ii WHERE ii.status <> 'cancelled'
             AND NOT EXISTS (SELECT 1 FROM gl_entries e WHERE e.source_type='incoming_invoice' AND e.source_id=ii.id)) AS inc`);
      return { accounts, totals, unposted: { invoices: unposted[0].inv, incoming: unposted[0].inc } };
    }),

  accountCard: publicQuery
    .input(z.object({ code: z.string(), from: dateStr, to: dateStr }))
    .query(async ({ input }) => {
      const open = await q(`SELECT COALESCE(SUM(l.debit - l.credit),0) b FROM gl_lines l JOIN gl_entries e ON e.id = l.entry_id WHERE l.account_code = $1 AND e.entry_date < $2`, [input.code, input.from]);
      const rows = await q(`SELECT e.entry_number, e.entry_date, e.description AS edesc, l.debit, l.credit, l.description, l.partner_type, l.partner_id,
          COALESCE(c.name, s.name) AS partner
        FROM gl_lines l JOIN gl_entries e ON e.id = l.entry_id
        LEFT JOIN customers c ON l.partner_type = 'customer' AND c.id = l.partner_id
        LEFT JOIN suppliers s ON l.partner_type = 'supplier' AND s.id = l.partner_id
        WHERE l.account_code = $1 AND e.entry_date BETWEEN $2 AND $3 ORDER BY e.entry_date, e.id, l.id LIMIT 5000`, [input.code, input.from, input.to]);
      let bal = Number(open[0].b);
      const opening = round2(bal);
      const items = rows.map(r => {
        bal += Number(r.debit) - Number(r.credit);
        return { number: r.entry_number, date: iso(r.entry_date), description: r.description || r.edesc, partner: r.partner, debit: Number(r.debit), credit: Number(r.credit), balance: round2(bal) };
      });
      return { opening, closing: round2(bal), items };
    }),

  vatBooks: publicQuery
    .input(z.object({ from: dateStr, to: dateStr }))
    .query(async ({ input }) => vatBooksData(input)),

  /** Биланс на состојба на датум + Биланс на успех од почетокот на годината (или од `from`), со претходната година за споредба. */
  financialStatements: publicQuery
    .input(z.object({ date: dateStr, from: dateStr.optional() }))
    .query(async ({ input }) => {
      const from = input.from ?? `${input.date.slice(0, 4)}-01-01`;
      const prevDate = `${Number(input.date.slice(0, 4)) - 1}-12-31`;
      const [bs, bsPrev, is, isPrev, codes] = await Promise.all([
        balancesAt(input.date), balancesAt(prevDate),
        movementsBetween(from, input.date), movementsBetween(minusYear(from), minusYear(input.date)),
        kvJson("statement_codes"),
      ]);
      const unposted = (await q(`SELECT
          (SELECT COUNT(*)::int FROM invoices i WHERE i.invoice_type IN ('standard','credit_note') AND i.status NOT IN ('draft','cancelled') AND i.issue_date <= $1
             AND NOT EXISTS (SELECT 1 FROM gl_entries e WHERE e.source_type='invoice' AND e.source_id=i.id)) AS inv,
          (SELECT COUNT(*)::int FROM incoming_invoices ii WHERE ii.status <> 'cancelled' AND COALESCE(ii.vat_date, ii.received_date, ii.issue_date) <= $1
             AND NOT EXISTS (SELECT 1 FROM gl_entries e WHERE e.source_type='incoming_invoice' AND e.source_id=ii.id)) AS inc`, [input.date]))[0];
      const lastValuation = (await q(`SELECT MAX(period_end) AS d FROM inventory_valuations WHERE period_end <= $1`, [input.date]))[0]?.d;
      // набавна вредност на основните средства: регистар наспроти главна книга (класа 0 без исправките x9)
      const reg = Number((await q(`SELECT COALESCE(SUM(acquisition_value),0) AS v FROM fixed_assets
        WHERE acquisition_date <= $1 AND (status <> 'disposed' OR disposal_date IS NULL OR disposal_date > $1)`, [input.date]).catch(() => [{ v: 0 }]))[0].v);
      const glCost = round2(bs.filter(b => b.code.startsWith("0") && b.code[2] !== "9").reduce((a, b) => a + b.balance, 0));
      return {
        date: input.date, from, prevDate, prevFrom: minusYear(from), prevTo: minusYear(input.date),
        balanceSheet: buildBalanceSheet(bs), balanceSheetPrev: buildBalanceSheet(bsPrev),
        incomeStatement: buildIncomeStatement(is), incomeStatementPrev: buildIncomeStatement(isPrev),
        codes,
        notes: {
          unpostedInvoices: Number(unposted.inv), unpostedIncoming: Number(unposted.inc),
          lastInventoryValuation: lastValuation ? iso(lastValuation) : null,
          assetRegister: round2(reg), assetGl: glCost,
        },
      };
    }),

  /** ДДВ-04 по полиња од КИФ/КУФ за периодот. */
  vat04: publicQuery
    .input(z.object({ from: dateStr, to: dateStr }))
    .query(async ({ input }) => {
      const vb = await vatBooksData(input);
      return { lines: buildVat04(vb.outgoing, vb.incoming), codes: await kvJson("vat04_codes"), warnings: vb.warnings, missingRates: vb.missingRates };
    }),

  /** Броеви на полиња (АОП во билансите, поле во ДДВ-04) — ги внесува сметководителот еднаш. */
  statementCodesSave: publicQuery
    .input(z.object({ kind: z.enum(["statement", "vat04"]), codes: z.record(z.string(), z.string().max(20)) }))
    .mutation(async ({ input }) => {
      const key = input.kind === "statement" ? "statement_codes" : "vat04_codes";
      const clean = Object.fromEntries(Object.entries(input.codes).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
      await q(`INSERT INTO app_kv (key, value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, JSON.stringify(clean)]);
      return { success: true };
    }),
});
