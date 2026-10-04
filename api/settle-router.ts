// Порамнување со партнерите:
//  • компензација — побарување од купувач се пребива со обврска кон добавувач (истата фирма); книжење Д 22x / П 12x
//  • ИОС — извод на отворени ставки за партнер на датум, за усогласување (се праќа, партнерот потврдува или оспорува)
//  • налози за плаќање — од неплатените влезни фактури се подготвува список за е-банкарство (ПП30 полиња)
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { getPool } from "./queries/connection";
import { logAudit } from "./audit-helper";
import { loadRates, iso } from "./rates-helper";
import { convert, round2 } from "@contracts/finance";
import { openDocs, paidByDoc, refreshPaymentStatus, manualPartnerBalances } from "./payment-status";
import { assertOpen } from "./period-lock";

const q = async (text: string, params: any[] = []) => (await getPool().query(text, params)).rows as any[];
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const today = () => new Date().toISOString().slice(0, 10);
const actorName = (ctx: any) => ctx?.actor?.name ?? null;
const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });

/** Жиро-сметка во Македонија: 15 цифри. */
export const isMkAccount = (s: string | null | undefined) => /^\d{15}$/.test(String(s ?? "").replace(/[\s-]/g, ""));
const normName = (s: string) => s.toLowerCase().replace(/["'„“”.,]/g, " ").replace(/\b(доо|дооел|ад|dooel|doo|ad|увоз|извоз|експорт|импорт)\b/g, " ").replace(/\s+/g, " ").trim();

async function nextCompNumber(date: string) {
  const y = date.slice(0, 4);
  const rows = await q(`SELECT number FROM compensations WHERE number LIKE $1`, [`КОМП-%/${y}`]);
  const max = rows.reduce((m, r) => Math.max(m, Number(String(r.number).match(/^КОМП-0*(\d+)\//)?.[1] ?? 0)), 0);
  return `КОМП-${String(max + 1).padStart(3, "0")}/${y}`;
}

/** Последна позната жиро-сметка на добавувачот: од неговиот картон, или од изводите (одлив кон него). */
async function supplierAccounts(): Promise<Map<number, string>> {
  const m = new Map<number, string>();
  const fromTx = await q(`SELECT DISTINCT ON (sid) sid, acc FROM (
      SELECT t.partner_id AS sid, t.counterparty_account AS acc, t.tx_date FROM bank_transactions t
        WHERE t.direction = 'out' AND t.partner_type = 'supplier' AND t.partner_id IS NOT NULL AND COALESCE(t.counterparty_account, '') <> ''
      UNION ALL
      SELECT ii.supplier_id AS sid, t.counterparty_account AS acc, t.tx_date FROM payment_allocations a
        JOIN bank_transactions t ON t.id = a.tx_id JOIN incoming_invoices ii ON ii.id = a.doc_id
        WHERE a.doc_type = 'incoming_invoice' AND COALESCE(t.counterparty_account, '') <> ''
    ) x ORDER BY sid, tx_date DESC`);
  for (const r of fromTx) m.set(Number(r.sid), String(r.acc).replace(/[\s-]/g, ""));
  for (const r of await q(`SELECT id, bank_account FROM suppliers WHERE COALESCE(bank_account, '') <> ''`)) m.set(Number(r.id), String(r.bank_account).replace(/[\s-]/g, ""));
  return m;
}

export const settleRouter = createRouter({
  // ───────────── КОМПЕНЗАЦИИ ─────────────

  /** Отворени фактури на купувачот и влезни фактури на добавувачот (во денари) + предлог кој добавувач е истата фирма. */
  compensationCandidates: publicQuery
    .input(z.object({ customerId: z.number(), supplierId: z.number().nullable().optional() }))
    .query(async ({ input }) => {
      const cust = (await q(`SELECT id, name, company, edb, tax_number FROM customers WHERE id = $1`, [input.customerId]))[0];
      if (!cust) throw bad("Купувачот не постои");
      const sups = await q(`SELECT id, name, edb FROM suppliers WHERE COALESCE(is_active, 'active') = 'active'`);
      const cEdb = String(cust.edb || cust.tax_number || "").replace(/\D/g, "");
      const cName = normName(String(cust.company || cust.name || ""));
      const suggestions = sups
        .map((s) => ({ id: Number(s.id), name: s.name as string, sameEdb: !!cEdb && String(s.edb ?? "").replace(/\D/g, "") === cEdb, sameName: !!cName && normName(String(s.name)) === cName }))
        .filter((s) => s.sameEdb || s.sameName);
      const docs = await openDocs();
      const receivables = docs.filter((d) => d.docType === "invoice" && d.partnerId === input.customerId && d.open > 0.005);
      const payables = input.supplierId ? docs.filter((d) => d.docType === "incoming_invoice" && d.partnerId === input.supplierId && d.open > 0.005) : [];
      const pick = (d: any) => ({ docType: d.docType, id: d.id, number: d.number, date: d.date, dueDate: d.dueDate, currency: d.currency, total: d.total, open: d.open, usable: d.currency === "MKD" });
      return { suggestions, receivables: receivables.map(pick), payables: payables.map(pick) };
    }),

  compensationCreate: publicQuery
    .input(z.object({
      date: dateStr,
      customerId: z.number(),
      supplierId: z.number(),
      items: z.array(z.object({ docType: z.enum(["invoice", "incoming_invoice"]), docId: z.number(), amount: z.number().positive() })).min(2),
      note: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertOpen(input.date, "Компензација");
      const docs = await openDocs();
      const recv = input.items.filter((i) => i.docType === "invoice"), pay = input.items.filter((i) => i.docType === "incoming_invoice");
      if (!recv.length || !pay.length) throw bad("Компензацијата бара барем една излезна и барем една влезна фактура");
      for (const it of input.items) {
        const d = docs.find((x) => x.docType === it.docType && x.id === it.docId);
        if (!d) throw bad("Фактурата веќе е платена или не постои");
        if (d.partnerId !== (it.docType === "invoice" ? input.customerId : input.supplierId)) throw bad(`${d.number} не е од избраниот партнер`);
        if (d.currency !== "MKD") throw bad(`${d.number} е во ${d.currency} — компензација се прави само во денари`);
        if (it.amount > d.open + 0.005) throw bad(`За ${d.number} останува ${d.open.toFixed(2)} ден — не може да се компензира повеќе`);
        if (d.date > input.date) throw bad(`${d.number} е со датум по датумот на компензацијата`);
      }
      const sR = round2(recv.reduce((s, i) => s + i.amount, 0)), sP = round2(pay.reduce((s, i) => s + i.amount, 0));
      if (Math.abs(sR - sP) > 0.005) throw bad(`Двете страни мора да се еднакви: побарувања ${sR.toFixed(2)}, обврски ${sP.toFixed(2)}`);
      const client = await getPool().connect();
      let id = 0, number = "";
      try {
        await client.query("BEGIN");
        await client.query("LOCK TABLE compensations IN SHARE ROW EXCLUSIVE MODE");
        number = await nextCompNumber(input.date);
        id = (await client.query(`INSERT INTO compensations (number, comp_date, customer_id, supplier_id, amount, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [number, input.date, input.customerId, input.supplierId, sR.toFixed(2), input.note ?? null, actorName(ctx)])).rows[0].id;
        for (const it of input.items)
          await client.query(`INSERT INTO compensation_items (compensation_id, doc_type, doc_id, amount) VALUES ($1,$2,$3,$4)`, [id, it.docType, it.docId, round2(it.amount).toFixed(2)]);
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
      for (const it of input.items) await refreshPaymentStatus(it.docType, it.docId);
      await logAudit({ action: "CREATE", entityType: "compensation", entityId: id, description: `Компензација ${number}: ${sR.toFixed(2)} ден` }).catch(() => {});
      return { success: true, id, number };
    }),

  compensationList: publicQuery.query(async () => {
    const rows = await q(`SELECT c.*, cu.name AS customer, cu.company, cu.address AS c_address, cu.edb AS c_edb, s.name AS supplier, s.address AS s_address, s.edb AS s_edb
      FROM compensations c LEFT JOIN customers cu ON cu.id = c.customer_id LEFT JOIN suppliers s ON s.id = c.supplier_id ORDER BY c.comp_date DESC, c.id DESC LIMIT 300`);
    const items = rows.length ? await q(`SELECT ci.*, CASE WHEN ci.doc_type = 'invoice' THEN i.invoice_number ELSE ii.supplier_invoice_number END AS number,
        CASE WHEN ci.doc_type = 'invoice' THEN i.issue_date ELSE COALESCE(ii.issue_date, ii.received_date) END AS doc_date
      FROM compensation_items ci LEFT JOIN invoices i ON ci.doc_type = 'invoice' AND i.id = ci.doc_id
      LEFT JOIN incoming_invoices ii ON ci.doc_type = 'incoming_invoice' AND ii.id = ci.doc_id
      WHERE ci.compensation_id = ANY($1::int[]) ORDER BY ci.id`, [rows.map((r) => r.id)]) : [];
    return rows.map((r) => ({
      id: r.id, number: r.number, date: iso(r.comp_date), amount: Number(r.amount), status: r.status, note: r.note, createdBy: r.created_by,
      customer: { id: r.customer_id, name: r.company || r.customer, address: r.c_address, edb: r.c_edb },
      supplier: { id: r.supplier_id, name: r.supplier, address: r.s_address, edb: r.s_edb },
      items: items.filter((i) => i.compensation_id === r.id).map((i) => ({ docType: i.doc_type, docId: i.doc_id, number: i.number, date: i.doc_date ? iso(i.doc_date) : "", amount: Number(i.amount) })),
    }));
  }),

  /** Поништување (на пр. партнерот не ја потпишал): фактурите повторно се отворени, книжењето се тргнува. */
  compensationCancel: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const c = (await q(`SELECT * FROM compensations WHERE id = $1`, [input.id]))[0];
      if (!c) throw bad("Не постои");
      if (c.status !== "active") return { success: true };
      await assertOpen(iso(c.comp_date), "Компензација");
      await q(`UPDATE compensations SET status = 'cancelled' WHERE id = $1`, [input.id]);
      for (const it of await q(`SELECT doc_type, doc_id FROM compensation_items WHERE compensation_id = $1`, [input.id])) await refreshPaymentStatus(it.doc_type, Number(it.doc_id));
      await logAudit({ action: "UPDATE", entityType: "compensation", entityId: input.id, description: `Поништена компензација ${c.number}` }).catch(() => {});
      return { success: true };
    }),

  // ───────────── ИОС ─────────────

  /** Извод на отворени ставки: сите документи на партнерот до датумот со она што останало неплатено на тој датум. */
  iosData: publicQuery
    .input(z.object({ partnerType: z.enum(["customer", "supplier"]), partnerId: z.number(), asOf: dateStr }))
    .query(async ({ input }) => {
      const rate = await loadRates();
      const paid = await paidByDoc(rate, undefined, input.asOf);
      const isC = input.partnerType === "customer";
      const p = (await q(isC ? `SELECT id, COALESCE(company, name) AS name, address, city, edb, tax_number, email FROM customers WHERE id = $1`
        : `SELECT id, name, address, city, edb, email FROM suppliers WHERE id = $1`, [input.partnerId]))[0];
      if (!p) throw bad("Партнерот не постои");
      const docs = isC
        ? await q(`SELECT id, invoice_number AS number, invoice_type, original_invoice_id, issue_date AS date, due_date, currency, total_amount FROM invoices
            WHERE customer_id = $1 AND invoice_type IN ('standard','credit_note') AND status NOT IN ('draft','cancelled') AND issue_date <= $2 ORDER BY issue_date, id`, [input.partnerId, input.asOf])
        : await q(`SELECT id, supplier_invoice_number AS number, 'incoming' AS invoice_type, COALESCE(issue_date, received_date) AS date, due_date, currency, total_amount FROM incoming_invoices
            WHERE supplier_id = $1 AND status <> 'cancelled' AND COALESCE(issue_date, received_date) <= $2 ORDER BY COALESCE(issue_date, received_date), id`, [input.partnerId, input.asOf]);
      const items: { number: string; date: string; dueDate: string | null; currency: string; total: number; paid: number; open: number; openMkd: number }[] = [];
      for (const d of docs) {
        const cur = String(d.currency || "MKD").toUpperCase();
        const sign = d.invoice_type === "credit_note" ? -1 : 1;
        const key = `${isC ? "invoice" : "incoming_invoice"}:${d.id}`;
        const total = round2(sign * Math.abs(Number(d.total_amount)));
        // книжното одобрување врзано за фактура е веќе одземено кај фактурата (во paid)
        if (sign < 0 && d.original_invoice_id) continue;
        const pd = sign < 0 ? 0 : (paid.get(key) ?? 0);
        const open = round2(total - pd);
        if (Math.abs(open) < 0.005) continue;
        const date = iso(d.date);
        items.push({ number: d.number, date, dueDate: d.due_date ? iso(d.due_date) : null, currency: cur, total, paid: round2(pd), open,
          openMkd: cur === "MKD" ? open : round2(convert(open, cur, "MKD", date, rate) ?? open) });
      }
      // салдо од рачни налози (почетна состојба и сл.) до датумот
      const man = (await q(`SELECT COALESCE(SUM(l.debit - l.credit), 0) AS net FROM gl_lines l JOIN gl_entries e ON e.id = l.entry_id
        WHERE e.source_type = 'manual' AND l.partner_type = $1 AND l.partner_id = $2 AND e.entry_date <= $3
          AND (l.account_code LIKE '12%' OR l.account_code LIKE '22%')`, [input.partnerType, input.partnerId, input.asOf]))[0];
      const manual = round2(isC ? Number(man.net) : -Number(man.net));
      const balance = round2(items.reduce((s, i) => s + i.openMkd, 0) + manual);
      const log = await q(`SELECT * FROM ios_log WHERE partner_type = $1 AND partner_id = $2 ORDER BY created_at DESC LIMIT 10`, [input.partnerType, input.partnerId]);
      return {
        partner: { id: p.id, name: p.name, address: [p.address, p.city].filter(Boolean).join(", "), edb: p.edb || p.tax_number || "", email: p.email || "" },
        asOf: input.asOf, items, manual, balance,
        log: log.map((l) => ({ id: l.id, asOf: iso(l.as_of), balance: Number(l.balance), sentTo: l.sent_to, status: l.status, note: l.note, at: l.created_at, answeredAt: l.answered_at })),
      };
    }),

  /** Партнери со отворено салдо — за праќање ИОС на сите одеднаш (крај на година). */
  iosPartners: publicQuery.query(async () => {
    const docs = await openDocs();
    const manual = await manualPartnerBalances();
    const m = new Map<string, { partnerType: "customer" | "supplier"; partnerId: number; name: string; balance: number; count: number }>();
    for (const d of docs) {
      if (!d.partnerId) continue;
      const t = d.docType === "invoice" ? "customer" : "supplier";
      const k = `${t}:${d.partnerId}`;
      const g = m.get(k) ?? { partnerType: t, partnerId: d.partnerId, name: d.partner ?? "", balance: 0, count: 0 };
      g.balance = round2(g.balance + d.openMkd); g.count++; m.set(k, g);
    }
    for (const [t, mm] of [["customer", manual.customers], ["supplier", manual.suppliers]] as const)
      for (const [id, v] of mm) { const k = `${t}:${id}`; const g = m.get(k) ?? { partnerType: t, partnerId: id, name: "", balance: 0, count: 0 }; g.balance = round2(g.balance + v); m.set(k, g); }
    const names = await q(`SELECT 'customer' AS t, id, COALESCE(company, name) AS name, email FROM customers UNION ALL SELECT 'supplier', id, name, email FROM suppliers`);
    const last = await q(`SELECT DISTINCT ON (partner_type, partner_id) partner_type, partner_id, status, as_of, created_at FROM ios_log ORDER BY partner_type, partner_id, created_at DESC`);
    return [...m.values()].filter((g) => Math.abs(g.balance) >= 0.01).map((g) => {
      const n = names.find((x) => x.t === g.partnerType && Number(x.id) === g.partnerId);
      const l = last.find((x) => x.partner_type === g.partnerType && Number(x.partner_id) === g.partnerId);
      return { ...g, name: n?.name ?? g.name, email: n?.email ?? "", lastIos: l ? { status: l.status, asOf: iso(l.as_of) } : null };
    }).sort((a, b) => a.partnerType.localeCompare(b.partnerType) || Math.abs(b.balance) - Math.abs(a.balance));
  }),

  iosRecord: publicQuery
    .input(z.object({ partnerType: z.enum(["customer", "supplier"]), partnerId: z.number(), asOf: dateStr, balance: z.number(), sentTo: z.string().max(500).optional() }))
    .mutation(async ({ input, ctx }) => {
      const r = await q(`INSERT INTO ios_log (partner_type, partner_id, as_of, balance, sent_to, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [input.partnerType, input.partnerId, input.asOf, input.balance.toFixed(2), input.sentTo ?? null, actorName(ctx)]);
      return { id: r[0].id };
    }),

  /** Одговор од партнерот: потврдено или оспорено (со причина). */
  iosAnswer: publicQuery
    .input(z.object({ id: z.number(), status: z.enum(["confirmed", "disputed", "sent"]), note: z.string().max(1000).optional() }))
    .mutation(async ({ input }) => {
      if (input.status === "disputed" && !input.note?.trim()) throw bad("Напиши што оспорува партнерот");
      await q(`UPDATE ios_log SET status = $1::varchar, note = $2, answered_at = CASE WHEN $1::varchar = 'sent' THEN NULL ELSE now() END WHERE id = $3`, [input.status, input.note ?? null, input.id]);
      return { success: true };
    }),

  // ───────────── НАЛОЗИ ЗА ПЛАЌАЊЕ ─────────────

  /** Неплатени влезни фактури во денари што доспеваат до датумот (и без рок), со жиро-сметка на добавувачот. */
  paymentOrderCandidates: publicQuery
    .input(z.object({ dueBy: dateStr }))
    .query(async ({ input }) => {
      const docs = (await openDocs()).filter((d) => d.docType === "incoming_invoice" && d.open > 0.005);
      const accounts = await supplierAccounts();
      const inBatch = await q(`SELECT i.incoming_invoice_id AS id, MAX(b.pay_date) AS d, SUM(i.amount) AS amt FROM payment_order_items i JOIN payment_order_batches b ON b.id = i.batch_id
        WHERE i.incoming_invoice_id IS NOT NULL GROUP BY 1`);
      const rows = docs.map((d) => {
        const b = inBatch.find((x) => Number(x.id) === d.id);
        const acc = d.partnerId ? accounts.get(d.partnerId) ?? "" : "";
        return { id: d.id, number: d.number, supplierId: d.partnerId, supplier: d.partner ?? "", date: d.date, dueDate: d.dueDate,
          currency: d.currency, open: d.open, account: acc, accountOk: isMkAccount(acc),
          overdue: !!d.dueDate && d.dueDate < today(), inBatch: b ? { date: iso(b.d), amount: Number(b.amt) } : null,
          dueSoon: !d.dueDate || d.dueDate <= input.dueBy };
      });
      return {
        domestic: rows.filter((r) => r.currency === "MKD" && r.dueSoon),
        foreign: rows.filter((r) => r.currency !== "MKD" && r.dueSoon),
      };
    }),

  paymentOrderCreate: publicQuery
    .input(z.object({
      payDate: dateStr,
      items: z.array(z.object({
        incomingInvoiceId: z.number(), amount: z.number().positive(),
        payeeAccount: z.string().max(40), purpose: z.string().max(140), reference: z.string().max(40).optional(), paymentCode: z.string().max(10).optional(),
      })).min(1),
      rememberAccounts: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const docs = await openDocs();
      const rows: any[] = [];
      for (const it of input.items) {
        const d = docs.find((x) => x.docType === "incoming_invoice" && x.id === it.incomingInvoiceId);
        if (!d) throw bad("Фактурата веќе е платена или не постои");
        if (d.currency !== "MKD") throw bad(`${d.number} е во ${d.currency} — за девизно плаќање се користи налог на банката за странство`);
        if (it.amount > d.open + 0.005) throw bad(`${d.number}: останува ${d.open.toFixed(2)} ден`);
        const acc = it.payeeAccount.replace(/[\s-]/g, "");
        if (!isMkAccount(acc)) throw bad(`${d.partner ?? d.number}: жиро-сметката мора да има 15 цифри`);
        rows.push({ ...it, payeeAccount: acc, supplierId: d.partnerId, payee: d.partner ?? "" });
      }
      const total = round2(rows.reduce((s, r) => s + r.amount, 0));
      const client = await getPool().connect();
      let batchId = 0;
      try {
        await client.query("BEGIN");
        batchId = (await client.query(`INSERT INTO payment_order_batches (pay_date, total, count, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
          [input.payDate, total.toFixed(2), rows.length, actorName(ctx)])).rows[0].id;
        for (const r of rows) {
          await client.query(`INSERT INTO payment_order_items (batch_id, incoming_invoice_id, supplier_id, payee, payee_account, amount, purpose, reference, payment_code)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [batchId, r.incomingInvoiceId, r.supplierId, r.payee, r.payeeAccount, round2(r.amount).toFixed(2), r.purpose, r.reference ?? null, r.paymentCode ?? null]);
          if (input.rememberAccounts && r.supplierId) await client.query(`UPDATE suppliers SET bank_account = $1 WHERE id = $2 AND COALESCE(bank_account, '') = ''`, [r.payeeAccount, r.supplierId]);
        }
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
      await logAudit({ action: "CREATE", entityType: "payment_order", entityId: batchId, description: `Налози за плаќање: ${rows.length}, ${total.toFixed(2)} ден` }).catch(() => {});
      return { success: true, batchId, total, count: rows.length };
    }),

  paymentOrderList: publicQuery.query(async () => {
    const b = await q(`SELECT * FROM payment_order_batches ORDER BY created_at DESC LIMIT 50`);
    const items = b.length ? await q(`SELECT i.*, ii.supplier_invoice_number AS number FROM payment_order_items i LEFT JOIN incoming_invoices ii ON ii.id = i.incoming_invoice_id
      WHERE i.batch_id = ANY($1::int[]) ORDER BY i.id`, [b.map((x) => x.id)]) : [];
    const company = (await q(`SELECT name, address, bank_name, bank_account, edb FROM company_settings LIMIT 1`))[0] ?? {};
    return {
      company: { name: company.name ?? "", address: company.address ?? "", bankName: company.bank_name ?? "", account: String(company.bank_account ?? "").replace(/[\s-]/g, ""), edb: company.edb ?? "" },
      batches: b.map((x) => ({
        id: x.id, payDate: iso(x.pay_date), total: Number(x.total), count: x.count, createdBy: x.created_by, createdAt: x.created_at,
        items: items.filter((i) => i.batch_id === x.id).map((i) => ({ id: i.id, incomingInvoiceId: i.incoming_invoice_id, number: i.number, payee: i.payee, account: i.payee_account,
          amount: Number(i.amount), purpose: i.purpose, reference: i.reference, paymentCode: i.payment_code })),
      })),
    };
  }),

  /** Список што не е пратен во банка може да се тргне (фактурите се враќаат во предлозите). */
  paymentOrderRemove: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await q(`DELETE FROM payment_order_batches WHERE id = $1`, [input.id]);
      return { success: true };
    }),

  /** Жиро-сметка на добавувач (од екранот за налози). */
  supplierBankSet: publicQuery
    .input(z.object({ supplierId: z.number(), account: z.string().max(40) }))
    .mutation(async ({ input }) => {
      const acc = input.account.replace(/[\s-]/g, "");
      if (acc && !isMkAccount(acc)) throw bad("Жиро-сметката мора да има 15 цифри");
      await q(`UPDATE suppliers SET bank_account = $1 WHERE id = $2`, [acc || null, input.supplierId]);
      return { success: true };
    }),
});

/** Книжење на компензациите (за главната книга): Д добавувачи / П купувачи, по партнер. */
export async function compensationPostings() {
  return q(`SELECT c.id, c.number, c.comp_date, ci.doc_type, ci.doc_id, ci.amount FROM compensations c JOIN compensation_items ci ON ci.compensation_id = c.id
    WHERE c.status = 'active' ORDER BY c.id, ci.id`).catch(() => [] as any[]);
}
