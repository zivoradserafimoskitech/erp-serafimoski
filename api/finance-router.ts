// Финансии: курсна листа (НБРМ), благајна, главна книга (автоматско книжење), бруто биланс,
// картица на конто, книги на излезни/влезни фактури и рекапитулација за ДДВ.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { getPool } from "./queries/connection";
import { logAudit } from "./audit-helper";
import {
  DEFAULT_ACCOUNTS, POSTING_RULES, rulesWithDefaults, invoiceLines, incomingLines, paymentLines,
  cashOtherLines, payrollLines, depreciationLines, linesSignature, isBalanced, normalizeLines, toMkd, convert, round2,
  parseNbrmRates, type GlLine, type Rules, type RateLookup,
} from "@contracts/finance";
import { isDomesticCountry } from "@contracts/country";
import { loadRates, iso } from "./rates-helper";
import { refreshPaymentStatus, openDocs, type OpenDoc } from "./payment-status";

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
  const pfs = await q(`SELECT i.id, i.invoice_number, i.issue_date, i.currency, i.customer_id, i.quotation_id, c.country
    FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.invoice_type = 'proforma' AND i.status <> 'cancelled'`);
  const proformaInfo = new Map<number, { cur: string; date: string; customerId: number; number: string; quotationId: number | null }>();
  for (const p of pfs) proformaInfo.set(p.id, { cur: String(p.currency || "MKD").toUpperCase(), date: iso(p.issue_date), customerId: p.customer_id, number: p.invoice_number, quotationId: p.quotation_id ? Number(p.quotation_id) : null });
  const advanceMkd = new Map<number, { mkd: number; lastDate: string }>(); // по про-фактура

  // 2) Влезни фактури
  const incs = await q(`SELECT ii.id, ii.supplier_invoice_number, ii.issue_date, ii.received_date, ii.subtotal, ii.vat_amount,
      ii.currency, ii.supplier_id, s.country, s.name AS sname
    FROM incoming_invoices ii LEFT JOIN suppliers s ON s.id = ii.supplier_id WHERE ii.status <> 'cancelled'`);
  const incInfo = new Map<number, { cur: string; date: string; foreign: boolean; number: string; supplierId: number }>();
  for (const i of incs) {
    const date = iso(i.issue_date || i.received_date);
    const cur = String(i.currency || "MKD").toUpperCase();
    const foreign = cur !== "MKD" || !isDomesticCountry(i.country);
    incInfo.set(i.id, { cur, date, foreign, number: i.supplier_invoice_number, supplierId: i.supplier_id });
    const sub = toMkd(Number(i.subtotal), cur, date, rate);
    const vat = toMkd(Number(i.vat_amount), cur, date, rate);
    if (sub === null || vat === null) { problems.push({ sourceType: "incoming_invoice", sourceId: i.id, ref: i.supplier_invoice_number, reason: `Нема курс ${cur} за ${date}` }); continue; }
    desired.push({ sourceType: "incoming_invoice", sourceId: i.id, date, description: `Влезна фактура ${i.supplier_invoice_number} · ${i.sname ?? ""}`,
      lines: incomingLines({ subtotalMkd: sub, vatMkd: vat, foreign, supplierId: i.supplier_id, number: i.supplier_invoice_number, rules }) });
  }

  // Плаќање по документ (банка или благајна) со курсна разлика
  const payFor = (p: { sourceType: string; sourceId: number; docType: string; docId: number; amount: number; moneyCur: string; date: string; moneyAccount: string; ref: string }) => {
    // Уплата по про-фактура = примен аванс (без курсна разлика -- се затвора при конечната фактура)
    const pf = p.docType === "invoice" ? proformaInfo.get(p.docId) : undefined;
    if (pf) {
      const moneyMkd = toMkd(p.amount, p.moneyCur, p.date, rate);
      if (moneyMkd === null) { problems.push({ sourceType: p.sourceType, sourceId: p.sourceId, ref: p.ref, reason: `Нема курс за ${p.moneyCur}` }); return; }
      const a = advanceMkd.get(p.docId) ?? { mkd: 0, lastDate: p.date };
      a.mkd = round2(a.mkd + moneyMkd); if (p.date > a.lastDate) a.lastDate = p.date;
      advanceMkd.set(p.docId, a);
      desired.push({ sourceType: p.sourceType, sourceId: p.sourceId, date: p.date, description: `Аванс по ${pf.number}${p.ref ? " · " + p.ref : ""}`,
        lines: normalizeLines([
          { account: p.moneyAccount, debit: moneyMkd, credit: 0, description: `Аванс ${pf.number}` },
          { account: rules.advances_received, debit: 0, credit: moneyMkd, partnerType: "customer", partnerId: pf.customerId, description: `Аванс ${pf.number}` },
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
        lines: normalizeLines([
          { account: rules.advances_received, debit: a.mkd, credit: 0, partnerType: "customer", partnerId: pf.customerId, description: `Аванс ${pf.number}` },
          { account: foreign ? rules.customers_foreign : rules.customers_domestic, debit: 0, credit: a.mkd, partnerType: "customer", partnerId: pf.customerId, description: `Аванс ${pf.number} → ${inv.invoice_number}` },
        ]) });
    }
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

  // 6) Амортизација (проведена по години) -- едно книжење по година, на 31.12
  const dep = await q(`SELECT year, SUM(amount) s FROM depreciation_entries GROUP BY year`);
  for (const d of dep) {
    const amount = Number(d.s);
    if (!(amount > 0)) continue;
    desired.push({ sourceType: "depreciation", sourceId: Number(d.year), date: `${d.year}-12-31`, description: `Амортизација за ${d.year}`,
      lines: depreciationLines({ amount: round2(amount), year: Number(d.year), rules }) });
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
export async function syncLedger() {
  await ensureChart();
  const rules = await loadRules();
  const rate = await loadRates();
  const { desired, problems } = await buildDesired(rules, rate);
  const client = await getPool().connect();
  let created = 0, updated = 0, removed = 0;
  try {
    await client.query("BEGIN");
    const existing = (await client.query(`SELECT id, source_type, source_id, signature FROM gl_entries WHERE source_type <> 'manual'`)).rows;
    const byKey = new Map<string, any>(existing.map((e: any) => [`${e.source_type}:${e.source_id}`, e]));
    const keep = new Set<string>();
    for (const d of desired) {
      if (!isBalanced(d.lines) || d.lines.length === 0) {
        if (d.lines.length) problems.push({ sourceType: d.sourceType, sourceId: d.sourceId, ref: d.description, reason: "Книжењето не е во рамнотежа" });
        continue;
      }
      const key = `${d.sourceType}:${d.sourceId}`;
      keep.add(key);
      const sig = linesSignature(d.date, d.lines);
      const ex = byKey.get(key);
      if (ex && ex.signature === sig) continue;
      if (ex) {
        await client.query(`DELETE FROM gl_lines WHERE entry_id = $1`, [ex.id]);
        await client.query(`UPDATE gl_entries SET entry_date = $2, description = $3, signature = $4 WHERE id = $1`, [ex.id, d.date, d.description, sig]);
        await insertLines(client, ex.id, d.lines);
        updated++;
      } else {
        const num = await nextEntryNumber(client, d.date);
        const r = await client.query(`INSERT INTO gl_entries (entry_number, entry_date, description, source_type, source_id, signature) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [num, d.date, d.description, d.sourceType, d.sourceId, sig]);
        await insertLines(client, r.rows[0].id, d.lines);
        created++;
      }
    }
    for (const e of existing) {
      if (!keep.has(`${e.source_type}:${e.source_id}`)) {
        await client.query(`DELETE FROM gl_lines WHERE entry_id = $1`, [e.id]);
        await client.query(`DELETE FROM gl_entries WHERE id = $1`, [e.id]);
        removed++;
      }
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
  ledgerSync: publicQuery.mutation(async () => syncLedger()),

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
      const lines = ids.length ? await q(`SELECT l.*, a.name AS account_name FROM gl_lines l LEFT JOIN gl_accounts a ON a.code = l.account_code WHERE l.entry_id = ANY($1) ORDER BY l.id`, [ids]) : [];
      return {
        total,
        entries: entries.map(e => ({
          id: Number(e.id), number: e.entry_number, date: iso(e.entry_date), description: e.description, sourceType: e.source_type, sourceId: e.source_id == null ? null : Number(e.source_id),
          lines: lines.filter(l => Number(l.entry_id) === Number(e.id)).map(l => ({ account: l.account_code, accountName: l.account_name, debit: Number(l.debit), credit: Number(l.credit), description: l.description })),
        })),
      };
    }),

  manualEntryCreate: publicQuery
    .input(z.object({
      date: dateStr, description: z.string().min(2),
      lines: z.array(z.object({ account: z.string(), debit: z.number().min(0), credit: z.number().min(0), description: z.string().optional() })).min(2),
    }))
    .mutation(async ({ input }) => {
      const lines = normalizeLines(input.lines.map(l => ({ account: l.account, debit: l.debit, credit: l.credit, description: l.description })));
      if (!isBalanced(lines)) throw new TRPCError({ code: "BAD_REQUEST", message: "Должи и побарува не се еднакви" });
      const codes = [...new Set(lines.map(l => l.account))];
      const ex = await q(`SELECT code FROM gl_accounts WHERE code = ANY($1)`, [codes]);
      const missing = codes.filter(c => !ex.some(e => e.code === c));
      if (missing.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Непостоечки конта: ${missing.join(", ")}` });
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        const num = await nextEntryNumber(client, input.date);
        const r = await client.query(`INSERT INTO gl_entries (entry_number, entry_date, description, source_type) VALUES ($1,$2,$3,'manual') RETURNING id`, [num, input.date, input.description]);
        await insertLines(client, r.rows[0].id, lines);
        await client.query("COMMIT");
        return { success: true, number: num };
      } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    }),

  manualEntryDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const e = await q(`SELECT source_type FROM gl_entries WHERE id = $1`, [input.id]);
      if (!e.length) return { success: true };
      if (e[0].source_type !== "manual") throw new TRPCError({ code: "BAD_REQUEST", message: "Автоматските книжења се менуваат преку документот, не рачно" });
      await q(`DELETE FROM gl_lines WHERE entry_id = $1`, [input.id]);
      await q(`DELETE FROM gl_entries WHERE id = $1`, [input.id]);
      return { success: true };
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
    .query(async ({ input }) => {
      const rate = await loadRates();
      const out = await q(`SELECT i.id, i.invoice_number, i.invoice_type, i.issue_date, i.subtotal, i.vat_amount, i.vat_rate, i.currency,
          c.name, c.company, c.edb, c.tax_number, c.country
        FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.invoice_type IN ('standard','credit_note') AND i.status NOT IN ('draft','cancelled') AND i.issue_date BETWEEN $1 AND $2
        ORDER BY i.issue_date, i.invoice_number`, [input.from, input.to]);
      const inc = await q(`SELECT ii.id, ii.supplier_invoice_number, ii.issue_date, ii.received_date, ii.subtotal, ii.vat_amount, ii.vat_rate, ii.currency,
          s.name, s.edb, s.country
        FROM incoming_invoices ii LEFT JOIN suppliers s ON s.id = ii.supplier_id
        WHERE ii.status <> 'cancelled' AND COALESCE(ii.issue_date, ii.received_date) BETWEEN $1 AND $2
        ORDER BY COALESCE(ii.issue_date, ii.received_date)`, [input.from, input.to]);
      const missing: string[] = [];
      const row = (r: any, kind: "out" | "in") => {
        const date = iso(kind === "out" ? r.issue_date : (r.issue_date || r.received_date));
        const cur = String(r.currency || "MKD").toUpperCase();
        const sign = r.invoice_type === "credit_note" ? -1 : 1;
        const base = toMkd(sign * Math.abs(Number(r.subtotal)), cur, date, rate);
        const vat = toMkd(sign * Math.abs(Number(r.vat_amount)), cur, date, rate);
        const number = kind === "out" ? r.invoice_number : r.supplier_invoice_number;
        if (base === null || vat === null) missing.push(`${number} (${cur} ${date})`);
        const foreign = cur !== "MKD" || !isDomesticCountry(r.country);
        return { id: r.id, number, date, partner: r.company || r.name, taxId: r.edb || r.tax_number || "", country: r.country || "",
          currency: cur, vatRate: Number(r.vat_rate), baseMkd: base ?? 0, vatMkd: vat ?? 0, totalMkd: round2((base ?? 0) + (vat ?? 0)), foreign, creditNote: sign < 0 };
      };
      const outgoing = out.map(r => row(r, "out"));
      const incoming = inc.map(r => row(r, "in"));
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
      return { outgoing, incoming, summary: { output: group(outgoing), input: group(incoming), outVat, inVat, payable: round2(outVat - inVat) }, missingRates: missing };
    }),
});
