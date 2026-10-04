// Колку е платено по фактура (банка + благајна, во валутата на документот) и статусот што оттаму следи.
// Заедничко за банка, благајна, побарувања/обврски -- секој модул го гледа истото салдо.
import { TRPCError } from "@trpc/server";
import { getPool } from "./queries/connection";
import { loadRates, iso } from "./rates-helper";
import { convert, round2, type RateLookup } from "@contracts/finance";

type DocType = "invoice" | "incoming_invoice";
const q = async (sql: string, params: any[] = []) => (await getPool().query(sql, params)).rows as any[];

/**
 * Сите уплати по документи: {docType:docId -> износ во валута на документот}.
 * Банка, благајна, книжно одобрување, аванс од про-фактура и компензација. `asOf` — само плаќањата до тој датум (за ИОС).
 */
export async function paidByDoc(rate?: RateLookup, only?: { docType: DocType; id: number }, asOf?: string): Promise<Map<string, number>> {
  const rt = rate ?? await loadRates();
  const docs = new Map<string, string>();
  const inv = !only || only.docType === "invoice", inc = !only || only.docType === "incoming_invoice";
  const idF = (col: string) => only ? ` WHERE ${col} = ${Number(only.id)}` : "";
  if (inv) for (const r of await q(`SELECT id, currency FROM invoices${idF("id")}`)) docs.set(`invoice:${r.id}`, String(r.currency || "MKD").toUpperCase());
  if (inc) for (const r of await q(`SELECT id, currency FROM incoming_invoices${idF("id")}`)) docs.set(`incoming_invoice:${r.id}`, String(r.currency || "MKD").toUpperCase());
  const out = new Map<string, number>();
  const add = (key: string, amount: number, cur: string, date: string) => {
    const docCur = docs.get(key);
    if (!docCur) return;
    // Без курс за тој ден: земи го износот како што е (подобро приближно отколку „неплатено“)
    const v = cur === docCur ? amount : (convert(amount, cur, docCur, date, rt) ?? amount);
    out.set(key, round2((out.get(key) ?? 0) + v));
  };
  const until = (col: string) => (asOf ? ` AND ${col} <= '${asOf.replace(/[^0-9-]/g, "")}'` : "");
  const allocs = await q(`SELECT a.doc_type, a.doc_id, a.amount, t.tx_date, COALESCE(s.currency, 'MKD') AS cur
    FROM payment_allocations a JOIN bank_transactions t ON t.id = a.tx_id LEFT JOIN bank_statements s ON s.id = t.statement_id
    WHERE true ${only ? `AND a.doc_type = '${only.docType}' AND a.doc_id = ${Number(only.id)}` : ""}${until("t.tx_date")}`);
  for (const a of allocs) add(`${a.doc_type}:${a.doc_id}`, Number(a.amount), String(a.cur).toUpperCase(), iso(a.tx_date));
  const cashWhere = !only ? "invoice_id IS NOT NULL OR incoming_invoice_id IS NOT NULL"
    : `${only.docType === "invoice" ? "invoice_id" : "incoming_invoice_id"} = ${Number(only.id)}`;
  const cash = await q(`SELECT invoice_id, incoming_invoice_id, amount, tx_date FROM cash_transactions WHERE (${cashWhere})${until("tx_date")}`);
  for (const c of cash) add(c.invoice_id ? `invoice:${c.invoice_id}` : `incoming_invoice:${c.incoming_invoice_id}`, Number(c.amount), "MKD", iso(c.tx_date));
  // Книжно одобрување поврзано со фактура ја намалува нејзината обврска (иста валута)
  const cn = await q(`SELECT original_invoice_id, total_amount, issue_date, currency FROM invoices
    WHERE invoice_type = 'credit_note' AND original_invoice_id IS NOT NULL AND status NOT IN ('draft','cancelled')
    ${only ? (only.docType === "invoice" ? `AND original_invoice_id = ${Number(only.id)}` : "AND false") : ""}${until("issue_date")}`);
  for (const c of cn) add(`invoice:${c.original_invoice_id}`, Math.abs(Number(c.total_amount)), String(c.currency || "MKD").toUpperCase(), iso(c.issue_date));
  // Компензација (пребивање побарување со обврска кон истиот партнер)
  const comp = await q(`SELECT ci.doc_type, ci.doc_id, ci.amount, c.comp_date FROM compensation_items ci JOIN compensations c ON c.id = ci.compensation_id
    WHERE c.status = 'active' ${only ? `AND ci.doc_type = '${only.docType}' AND ci.doc_id = ${Number(only.id)}` : ""}${until("c.comp_date")}`).catch(() => [] as any[]);
  for (const c of comp) add(`${c.doc_type}:${c.doc_id}`, Number(c.amount), docs.get(`${c.doc_type}:${c.doc_id}`) ?? "MKD", iso(c.comp_date));
  // Аванс платен по про-фактура се засметува во конечната фактура на нарачката (како затворањето на 235 во главната книга)
  if (!only || only.docType === "invoice") {
    const links = (await advanceLinks(only ? { invoiceId: only.id } : {})).filter((l) => !asOf || l.date <= asOf);
    for (const l of links) {
      const pfPaid = only ? ((await paidByDoc(rt, { docType: "invoice", id: l.pfId }, asOf)).get(`invoice:${l.pfId}`) ?? 0) : (out.get(`invoice:${l.pfId}`) ?? 0);
      if (pfPaid > 0.005) add(`invoice:${l.invId}`, pfPaid, l.pfCur, l.date);
    }
  }
  return out;
}

/** Про-фактура → прва конечна (книжена) фактура за нарачката од истата понуда. */
async function advanceLinks(f: { invoiceId?: number; proformaId?: number }) {
  const rows = await q(`SELECT pf.id pf_id, pf.currency pf_cur, fi.id inv_id, fi.issue_date
    FROM invoices pf JOIN quotations qt ON qt.id = pf.quotation_id
    JOIN LATERAL (SELECT id, issue_date FROM invoices i WHERE i.order_id = qt.converted_order_id AND i.invoice_type = 'standard'
      AND i.status NOT IN ('draft','cancelled') ORDER BY i.issue_date, i.id LIMIT 1) fi ON true
    WHERE pf.invoice_type = 'proforma' AND pf.status <> 'cancelled'
    ${f.invoiceId ? `AND fi.id = ${Number(f.invoiceId)}` : ""} ${f.proformaId ? `AND pf.id = ${Number(f.proformaId)}` : ""}`);
  return rows.map(r => ({ pfId: Number(r.pf_id), pfCur: String(r.pf_cur || "MKD").toUpperCase(), invId: Number(r.inv_id), date: iso(r.issue_date) }));
}

/** Статус по плаќање: платена / делумно / назад на отворена. Нацрт и откажана не се менуваат. */
export function paymentStatus(current: string, paid: number, total: number, docType: DocType): string {
  if (current === "draft" || current === "cancelled") return current;
  if (paid > 0.005 && paid >= total - 0.005) return "paid";
  if (paid > 0.005) return "partial";
  // ништо платено: врати на отворена само ако статусот бил од плаќање
  if (["paid", "partial", "pending"].includes(current)) return docType === "invoice" ? "issued" : "received";
  return current;
}

export async function refreshPaymentStatus(docType: DocType, docId: number) {
  const table = docType === "invoice" ? "invoices" : "incoming_invoices";
  const doc = (await q(`SELECT status, total_amount FROM ${table} WHERE id = $1`, [docId]))[0];
  if (!doc) return;
  const paid = (await paidByDoc(undefined, { docType, id: docId })).get(`${docType}:${docId}`) ?? 0;
  const status = paymentStatus(String(doc.status), paid, Number(doc.total_amount), docType);
  if (status !== doc.status) await q(`UPDATE ${table} SET status = $1${docType === "invoice" ? ", updated_at = now()" : ""} WHERE id = $2`, [status, docId]);
  // уплата по про-фактура ја менува и конечната фактура
  if (docType === "invoice") for (const l of await advanceLinks({ proformaId: docId })) await refreshPaymentStatus("invoice", l.invId);
}

export type OpenDoc = { docType: DocType; id: number; number: string; partnerId: number | null; partner: string | null; invoiceType?: string;
  status: string; date: string; dueDate: string | null; currency: string; total: number; paid: number; open: number; openMkd: number };

/**
 * Отворени (ненаплатени/неплатени) документи со вистинско салдо.
 * Излезни: конечни фактури што не се нацрт/откажани; про-фактури само ако includeProforma.
 */
export async function openDocs(opts: { includeProforma?: boolean } = {}): Promise<OpenDoc[]> {
  const rate = await loadRates();
  const paid = await paidByDoc(rate);
  const out: OpenDoc[] = [];
  const inv = await q(`SELECT i.id, i.invoice_number, i.invoice_type, i.status, i.issue_date, i.due_date, i.currency, i.total_amount, i.customer_id, c.name
    FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
    WHERE i.status NOT IN ('cancelled','paid') AND (i.invoice_type = 'standard' ${opts.includeProforma ? "OR i.invoice_type = 'proforma'" : ""})
      AND (i.invoice_type = 'proforma' OR i.status <> 'draft')`);
  for (const r of inv) out.push(row("invoice", r.id, r.invoice_number, r.customer_id, r.name, r.status, r.issue_date, r.due_date, r.currency, r.total_amount, r.invoice_type));
  // Книжно одобрување без поврзана фактура: негативно побарување кон клиентот
  const cnFree = await q(`SELECT i.id, i.invoice_number, i.status, i.issue_date, i.currency, i.total_amount, i.customer_id, c.name
    FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
    WHERE i.invoice_type = 'credit_note' AND i.original_invoice_id IS NULL AND i.status NOT IN ('draft','cancelled')`);
  const credits = cnFree.map(r => row("invoice", r.id, r.invoice_number, r.customer_id, r.name, r.status, r.issue_date, null, r.currency, -Math.abs(Number(r.total_amount)), "credit_note"));
  const inc = await q(`SELECT ii.id, ii.supplier_invoice_number, ii.status, ii.received_date, ii.due_date, ii.currency, ii.total_amount, ii.supplier_id, s.name
    FROM incoming_invoices ii LEFT JOIN suppliers s ON s.id = ii.supplier_id WHERE ii.status NOT IN ('cancelled','paid')`);
  for (const r of inc) out.push(row("incoming_invoice", r.id, r.supplier_invoice_number, r.supplier_id, r.name, r.status, r.received_date, r.due_date, r.currency, r.total_amount));
  return [...out.filter(d => d.open > 0.005), ...credits.filter(d => d.open < -0.005)];

  function row(docType: DocType, id: any, number: any, partnerId: any, partner: any, status: any, date: any, due: any, currency: any, total: any, invoiceType?: string): OpenDoc {
    const cur = String(currency || "MKD").toUpperCase();
    const t = Number(total), p = paid.get(`${docType}:${id}`) ?? 0, open = round2(t - p), d = iso(date);
    const openMkd = cur === "MKD" ? open : round2(convert(open, cur, "MKD", d, rate) ?? open);
    return { docType, id: Number(id), number: String(number ?? ""), partnerId: partnerId ? Number(partnerId) : null, partner: partner ?? null, invoiceType,
      status: String(status), date: d, dueDate: due ? iso(due) : null, currency: cur, total: t, paid: p, open, openMkd };
  }
}

/** Документ со уплати (банка/благајна) или книжно одобрување не смее да се брише -- прво се бришат тие. */
export async function assertNoPayments(docType: DocType, docId: number) {
  const bank = await q(`SELECT COUNT(*)::int n FROM payment_allocations WHERE doc_type = $1 AND doc_id = $2`, [docType, docId]);
  const cash = await q(`SELECT COUNT(*)::int n FROM cash_transactions WHERE ${docType === "invoice" ? "invoice_id" : "incoming_invoice_id"} = $1`, [docId]);
  const cn = docType === "invoice" ? await q(`SELECT COUNT(*)::int n FROM invoices WHERE original_invoice_id = $1`, [docId]) : [{ n: 0 }];
  const comp = await q(`SELECT COUNT(*)::int n FROM compensation_items ci JOIN compensations c ON c.id = ci.compensation_id WHERE c.status = 'active' AND ci.doc_type = $1 AND ci.doc_id = $2`, [docType, docId]).catch(() => [{ n: 0 }]);
  const parts = [bank[0].n && `${bank[0].n} банкарски уплати`, cash[0].n && `${cash[0].n} благајнички налози`, cn[0].n && `${cn[0].n} книжни одобренија`, comp[0].n && `${comp[0].n} компензации`].filter(Boolean);
  if (parts.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Документот има ${parts.join(", ")} — прво избриши ги нив, или откажи го документот наместо да го бришеш.` });
}

/** Сите статуси одеднаш (при стартување) -- едно читање на уплатите. */
export async function refreshAllPaymentStatuses() {
  const paid = await paidByDoc();
  let changed = 0;
  for (const [table, docType] of [["invoices", "invoice"], ["incoming_invoices", "incoming_invoice"]] as const) {
    for (const d of await q(`SELECT id, status, total_amount FROM ${table} WHERE status NOT IN ('draft','cancelled')`)) {
      const st = paymentStatus(String(d.status), paid.get(`${docType}:${d.id}`) ?? 0, Number(d.total_amount), docType);
      if (st !== d.status) { await q(`UPDATE ${table} SET status = $1 WHERE id = $2`, [st, d.id]); changed++; }
    }
  }
  return changed;
}

/**
 * Салда по партнер од рачните налози (налог/терк на 12x купувачи или 22x добавувачи со избран партнер).
 * Купувач: должи − побарува (тој ни должи); добавувач: побарува − должи (ние му должиме).
 */
export async function manualPartnerBalances(): Promise<{ customers: Map<number, number>; suppliers: Map<number, number> }> {
  const rows = (await getPool().query(`SELECT l.partner_type, l.partner_id, SUM(l.debit - l.credit) AS net
    FROM gl_lines l JOIN gl_entries e ON e.id = l.entry_id
    WHERE e.source_type = 'manual' AND l.partner_id IS NOT NULL AND (l.account_code LIKE '12%' OR l.account_code LIKE '22%')
    GROUP BY 1, 2`).catch(() => ({ rows: [] as any[] }))).rows as any[];
  const customers = new Map<number, number>(), suppliers = new Map<number, number>();
  for (const r of rows) {
    const net = round2(Number(r.net));
    if (!net) continue;
    if (r.partner_type === "customer") customers.set(Number(r.partner_id), net);
    else if (r.partner_type === "supplier") suppliers.set(Number(r.partner_id), -net);
  }
  return { customers, suppliers };
}
