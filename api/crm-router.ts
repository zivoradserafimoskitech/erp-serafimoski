// CRM и продажба:
//  • зделки (crm_opportunities): барање → контакт → понуда → добиена/изгубена (со причина), веројатност, вредност
//  • активности по клиент: повик, средба, е-пошта, посета, белешка, задача со рок
//  • причина за изгубена понуда
//  • портал за клиенти: таен линк (токен) — нарачки, фактури, сертификати, барање за понуда со цртеж
//  • продажни услови: попуст, посебни цени, кредитен лимит
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createHash, randomBytes } from "crypto";
import { createRouter, publicQuery } from "./middleware";
import { getPool } from "./queries/connection";
import { iso } from "./rates-helper";
import { openDocs, manualPartnerBalances } from "./payment-status";
import { nextStepFromTimeline } from "./crm-next-step";
import { crmProProcedures } from "./crm-pro";
import { crmReminderProcedures } from "./crm-reminders";

const q = async (text: string, params: any[] = []) => (await getPool().query(text, params)).rows as any[];
const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const actor = (ctx: any) => ctx?.actor?.name ?? null;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export const STAGES = ["new", "contacted", "quoting", "quoted", "won", "lost"] as const;
export const LOST_REASONS: Record<string, string> = {
  price: "Цена", delivery: "Рок на испорака", competitor: "Отиде кај конкурент", spec: "Не можеме технички",
  no_response: "Нема одговор", cancelled: "Клиентот се откажа", other: "Друго",
};
const ACTIVITY = ["call", "meeting", "email", "visit", "note", "task"] as const;

const mapOpp = (r: any) => ({
  id: r.id, customerId: r.customer_id, customer: r.customer ?? r.company ?? null, company: r.company, contactName: r.contact_name, email: r.email, phone: r.phone,
  title: r.title, value: Number(r.value), currency: r.currency, probability: r.probability, stage: r.stage, expectedClose: r.expected_close ? iso(r.expected_close) : null,
  source: r.source, lostReason: r.lost_reason, quotationId: r.quotation_id, quoteNumber: r.quote_number ?? null, owner: r.owner, notes: r.notes, products: r.products ?? null,
  files: Number(r.files ?? 0), createdAt: r.created_at, updatedAt: r.updated_at,
  contactId: r.contact_id ? Number(r.contact_id) : null, contact: r.contact ?? null, contactEmail: r.contact_email ?? null,
  lostNote: r.lost_note ?? null, closedAt: r.closed_at ?? null, quoteStatus: r.quote_status ?? null,
});

/** Отворено салдо на купувачот во денари (фактури + рачни налози). */
export async function customerOpenBalance(customerId: number): Promise<number> {
  const docs = (await openDocs()).filter((d) => d.docType === "invoice" && d.partnerId === customerId);
  const man = (await manualPartnerBalances()).customers.get(customerId) ?? 0;
  return Math.round((docs.reduce((s, d) => s + d.openMkd, 0) + man) * 100) / 100;
}

export const crmRouter = createRouter({
  ...crmProProcedures,
  ...crmReminderProcedures,
  // ===== Зделки (crm_opportunities) =====
  oppList: publicQuery.input(z.object({ includeClosed: z.boolean().default(false), customerId: z.number().optional(), contactId: z.number().optional(), id: z.number().optional() }).optional()).query(async ({ input }) => {
    const w: string[] = [input?.includeClosed || input?.id ? "true" : "o.stage NOT IN ('won','lost')"]; const p: any[] = [];
    if (input?.customerId) { p.push(input.customerId); w.push(`o.customer_id = $${p.length}`); }
    if (input?.contactId) { p.push(input.contactId); w.push(`o.contact_id = $${p.length}`); }
    if (input?.id) { p.push(input.id); w.push(`o.id = $${p.length}`); }
    const rows = await q(`SELECT o.*, COALESCE(c.company, c.name) AS customer, qt.quote_number, qt.status AS quote_status, ct.name AS contact, ct.email AS contact_email,
        (SELECT COUNT(*) FROM crm_files f WHERE f.opportunity_id = o.id) AS files
      FROM crm_opportunities o LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN quotations qt ON qt.id = o.quotation_id LEFT JOIN crm_contacts ct ON ct.id = o.contact_id
      WHERE ${w.join(" AND ")} ORDER BY o.updated_at DESC LIMIT 1000`, p);
    return rows.map(mapOpp);
  }),
  oppSave: publicQuery
    .input(z.object({
      id: z.number().optional(),
      customerId: z.number(),
      company: z.string().max(255).optional(),
      contactName: z.string().max(255).optional(),
      email: z.string().max(320).optional(),
      phone: z.string().max(60).optional(),
      title: z.string().min(2).max(300),
      value: z.number().min(0).default(0),
      currency: z.string().max(10).default("MKD"),
      probability: z.number().int().min(0).max(100).default(30),
      stage: z.enum(STAGES).default("new"),
      expectedClose: dateStr.nullable().optional(),
      source: z.string().max(30).optional(),
      lostReason: z.string().max(40).nullable().optional(),
      quotationId: z.number().nullable().optional(),
      owner: z.string().max(160).optional(),
      notes: z.string().optional(),
      products: z.string().max(2000).optional(),
      contactId: z.number().nullable().optional(),
      lostNote: z.string().max(1000).nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!input.customerId) throw bad("Избери фирма (или креирај нова од формуларот)");
      if (input.contactId) {
        const ct = (await q(`SELECT customer_id FROM crm_contacts WHERE id = $1`, [input.contactId]))[0];
        if (!ct || Number(ct.customer_id) !== input.customerId) throw bad("Контактот не е од избраната фирма");
      }
      const closed = input.stage === "won" || input.stage === "lost";
      if (input.stage === "lost" && !input.lostReason) throw bad("Избери зошто е изгубена");
      const cust = (await q(`SELECT id, name, company FROM customers WHERE id = $1`, [input.customerId]))[0];
      if (!cust) throw bad("Клиентот не постои");
      const company = input.company || cust.company || cust.name;
      if (input.id) {
        await q(`UPDATE crm_opportunities SET customer_id=$1, company=$2, contact_name=$3, email=$4, phone=$5, title=$6, value=$7, currency=$8, probability=$9, stage=$10,
          expected_close=$11, source=$12, lost_reason=$13, quotation_id=$14, owner=$15, notes=$16, products=$17, contact_id=$19, lost_note=$20,
          closed_at = CASE WHEN $21 THEN COALESCE(closed_at, now()) ELSE NULL END, updated_at=now() WHERE id=$18`,
          [input.customerId, company, input.contactName ?? null, input.email ?? null, input.phone ?? null, input.title, input.value, input.currency, input.probability, input.stage,
           input.expectedClose ?? null, input.source ?? null, input.lostReason ?? null, input.quotationId ?? null, input.owner ?? null, input.notes ?? null, input.products ?? null, input.id,
           input.contactId ?? null, input.stage === "lost" ? input.lostNote ?? null : null, closed]);
        return { id: input.id };
      }
      const r = await q(`INSERT INTO crm_opportunities (customer_id, company, contact_name, email, phone, title, value, currency, probability, stage, expected_close, source, lost_reason, quotation_id, owner, notes, products, contact_id, lost_note, closed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, CASE WHEN $20 THEN now() ELSE NULL END) RETURNING id`,
        [input.customerId, company, input.contactName ?? null, input.email ?? null, input.phone ?? null, input.title, input.value, input.currency, input.probability, input.stage,
         input.expectedClose ?? null, input.source ?? null, input.lostReason ?? null, input.quotationId ?? null, input.owner ?? actor(ctx), input.notes ?? null, input.products ?? null,
         input.contactId ?? null, input.stage === "lost" ? input.lostNote ?? null : null, closed]);
      return { id: Number(r[0].id) };
    }),
  oppDelete: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await q(`DELETE FROM crm_opportunities WHERE id = $1`, [input.id]);
    return { success: true };
  }),
  oppFiles: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) =>
    (await q(`SELECT id, file_name, mime, data, created_at FROM crm_files WHERE opportunity_id = $1 ORDER BY id`, [input.id]))
      .map((f) => ({ id: f.id, fileName: f.file_name, mime: f.mime, data: f.data, createdAt: f.created_at }))),
  /** Од можност → понуда: само врска (понудата се прави во Понуди со предполнет клиент). */
  oppLinkQuotation: publicQuery.input(z.object({ id: z.number(), quotationId: z.number() })).mutation(async ({ input }) => {
    await q(`UPDATE crm_opportunities SET quotation_id = $2, stage = CASE WHEN stage IN ('new','contacted','quoting') THEN 'quoted' ELSE stage END, updated_at = now() WHERE id = $1`, [input.id, input.quotationId]);
    return { success: true };
  }),

  /** Изгубена понуда: причина (и можноста, ако е поврзана, станува изгубена). */
  quotationLost: publicQuery
    .input(z.object({ quotationId: z.number(), reason: z.enum(Object.keys(LOST_REASONS) as [string, ...string[]]), note: z.string().max(1000).optional() }))
    .mutation(async ({ input }) => {
      await q(`UPDATE quotations SET status = 'rejected', lost_reason = $2, lost_note = $3, updated_at = now() WHERE id = $1`, [input.quotationId, input.reason, input.note ?? null]);
      await q(`UPDATE crm_opportunities SET stage = 'lost', lost_reason = $2, probability = 0, closed_at = COALESCE(closed_at, now()), updated_at = now() WHERE quotation_id = $1`, [input.quotationId, input.reason]);
      return { success: true };
    }),

  /** Статистика: вредност во тек (пондерирана), добиени/изгубени, причини за губење (понуди + можности). */
  crmStats: publicQuery.input(z.object({ from: dateStr, to: dateStr })).query(async ({ input }) => {
    const pipe = (await q(`SELECT stage, COUNT(*)::int AS n, COALESCE(SUM(value), 0) AS v, COALESCE(SUM(value * probability / 100.0), 0) AS w FROM crm_opportunities
      WHERE stage NOT IN ('won','lost') GROUP BY stage`));
    const quotes = (await q(`SELECT status, COUNT(*)::int AS n FROM quotations WHERE created_at::date BETWEEN $1 AND $2 GROUP BY status`, [input.from, input.to]));
    const lost = (await q(`SELECT reason, SUM(n)::int AS n FROM (
        SELECT lost_reason AS reason, COUNT(*) AS n FROM quotations WHERE lost_reason IS NOT NULL AND updated_at::date BETWEEN $1 AND $2 GROUP BY 1
        UNION ALL
        SELECT lost_reason, COUNT(*) FROM crm_opportunities WHERE stage = 'lost' AND quotation_id IS NULL AND lost_reason IS NOT NULL AND updated_at::date BETWEEN $1 AND $2 GROUP BY 1
      ) x GROUP BY reason ORDER BY 2 DESC`, [input.from, input.to]));
    const won = quotes.filter((r) => ["accepted", "converted"].includes(r.status)).reduce((s, r) => s + r.n, 0);
    const lostN = quotes.filter((r) => r.status === "rejected").reduce((s, r) => s + r.n, 0);
    return {
      pipeline: pipe.map((r) => ({ stage: r.stage, count: r.n, value: Number(r.v), weighted: Math.round(Number(r.w)) })),
      quotes: { total: quotes.reduce((s, r) => s + r.n, 0), won, lost: lostN, winRate: won + lostN ? won / (won + lostN) : null },
      lostReasons: lost.map((r) => ({ reason: r.reason, label: LOST_REASONS[r.reason] ?? r.reason, count: r.n })),
    };
  }),

  // ===== Активности =====
  activityList: publicQuery.input(z.object({ customerId: z.number().optional(), opportunityId: z.number().optional(), openTasks: z.boolean().optional() }).optional()).query(async ({ input }) => {
    const w: string[] = []; const p: any[] = [];
    if (input?.customerId) { p.push(input.customerId); w.push(`a.customer_id = $${p.length}`); }
    if (input?.opportunityId) { p.push(input.opportunityId); w.push(`a.opportunity_id = $${p.length}`); }
    if (input?.openTasks) w.push(`a.kind = 'task' AND a.done_at IS NULL`);
    const rows = await q(`SELECT a.*, COALESCE(c.company, c.name) AS customer, o.title AS opportunity FROM crm_activities a
      LEFT JOIN customers c ON c.id = a.customer_id LEFT JOIN crm_opportunities o ON o.id = a.opportunity_id
      ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY COALESCE(a.due_date, a.created_at::date) ${input?.openTasks ? "ASC" : "DESC"}, a.id DESC LIMIT 300`, p);
    return rows.map((a) => ({ id: a.id, customerId: a.customer_id, customer: a.customer, opportunityId: a.opportunity_id, opportunity: a.opportunity, quotationId: a.quotation_id,
      kind: a.kind, subject: a.subject, notes: a.notes, dueDate: a.due_date ? iso(a.due_date) : null, doneAt: a.done_at, createdBy: a.created_by, createdAt: a.created_at }));
  }),
  activitySave: publicQuery
    .input(z.object({ id: z.number().optional(), customerId: z.number().nullable().optional(), opportunityId: z.number().nullable().optional(), quotationId: z.number().nullable().optional(),
      kind: z.enum(ACTIVITY), subject: z.string().min(2).max(300), notes: z.string().optional(), dueDate: dateStr.nullable().optional(), done: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      if (!input.customerId && !input.opportunityId) throw bad("Активноста мора да е за фирма или зделка");
      const done = input.kind === "task" ? (input.done ? new Date() : null) : new Date();
      if (input.id) {
        await q(`UPDATE crm_activities SET kind=$1, subject=$2, notes=$3, due_date=$4, done_at=$5 WHERE id=$6`, [input.kind, input.subject, input.notes ?? null, input.dueDate ?? null, done, input.id]);
        return { id: input.id };
      }
      const r = await q(`INSERT INTO crm_activities (customer_id, opportunity_id, quotation_id, kind, subject, notes, due_date, done_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [input.customerId ?? null, input.opportunityId ?? null, input.quotationId ?? null, input.kind, input.subject, input.notes ?? null, input.dueDate ?? null, done, actor(ctx)]);
      if (input.opportunityId) await q(`UPDATE crm_opportunities SET updated_at = now(), stage = CASE WHEN stage = 'new' THEN 'contacted' ELSE stage END WHERE id = $1`, [input.opportunityId]);
      return { id: r[0].id };
    }),
  activityDone: publicQuery.input(z.object({ id: z.number(), done: z.boolean() })).mutation(async ({ input }) => {
    await q(`UPDATE crm_activities SET done_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1`, [input.id, input.done]);
    return { success: true };
  }),
  activityDelete: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await q(`DELETE FROM crm_activities WHERE id = $1`, [input.id]);
    return { success: true };
  }),

  // ===== Портал за клиенти =====
  portalLinks: publicQuery.input(z.object({ customerId: z.number() })).query(async ({ input }) =>
    (await q(`SELECT id, created_by, created_at, expires_at, revoked_at, last_used_at FROM customer_portal_tokens WHERE customer_id = $1 ORDER BY created_at DESC`, [input.customerId]))
      .map((t) => ({ id: t.id, createdBy: t.created_by, createdAt: t.created_at, expiresAt: t.expires_at, revokedAt: t.revoked_at, lastUsedAt: t.last_used_at }))),
  /** Нов таен линк. Токенот се покажува само сега (во базата е само хеш). */
  portalLinkCreate: publicQuery.input(z.object({ customerId: z.number(), days: z.number().int().min(1).max(3650).default(365) })).mutation(async ({ input, ctx }) => {
    const token = randomBytes(24).toString("base64url");
    await q(`INSERT INTO customer_portal_tokens (customer_id, token_hash, created_by, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' days')::interval)`, [input.customerId, sha(token), actor(ctx), String(input.days)]);
    return { token, path: `/portal/${token}` };
  }),
  portalLinkRevoke: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await q(`UPDATE customer_portal_tokens SET revoked_at = now() WHERE id = $1`, [input.id]);
    return { success: true };
  }),


  /** Еден клик: можност → нацрт понуда (предпополнет клиент/наслов/вредност). */
  oppToQuotation: publicQuery
    .input(z.object({ opportunityId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const opp = (await q(`SELECT * FROM crm_opportunities WHERE id = $1`, [input.opportunityId]))[0];
      if (!opp) throw bad("Зделката не постои");
      if (opp.quotation_id) {
        await q(`UPDATE quotations SET opportunity_id = COALESCE(opportunity_id, $2) WHERE id = $1`, [opp.quotation_id, input.opportunityId]).catch(() => {});
        const qn = (await q(`SELECT quote_number FROM quotations WHERE id = $1`, [opp.quotation_id]))[0];
        return { id: Number(opp.quotation_id), quoteNumber: qn?.quote_number ?? null, existing: true };
      }
      let customerId = opp.customer_id ? Number(opp.customer_id) : null;
      if (!customerId) {
        if (!opp.company && !opp.contact_name) throw bad("Избери клиент или внеси име на фирма пред понуда");
        const name = (opp.company || opp.contact_name || "Нов клиент").slice(0, 255);
        const ins = await q(
          `INSERT INTO customers (name, company, contact_person, email, phone, is_active) VALUES ($1,$2,$3,$4,$5,'active') RETURNING id`,
          [name, opp.company ?? name, opp.contact_name ?? null, opp.email ?? null, opp.phone ?? null],
        );
        customerId = Number(ins[0].id);
        await q(`UPDATE crm_opportunities SET customer_id = $2 WHERE id = $1`, [input.opportunityId, customerId]);
      }
      const { getNextDocNumber } = await import("./counters-helper");
      const quoteNumber = await getNextDocNumber("quote");
      const vatRate = 18;
      const sub = Number(opp.value) || 0;
      const vat = Math.round(sub * vatRate) / 100;
      const notes = [opp.notes, opp.title ? `Од зделка: ${opp.title}` : null].filter(Boolean).join("\n") || null;
      const r = await q(
        `INSERT INTO quotations (quote_number, customer_id, status, subtotal, vat_rate, vat_amount, total_amount, currency, notes, payment_terms, created_by, salesperson, opportunity_id)
         VALUES ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [quoteNumber, customerId, sub.toFixed(2), vatRate, vat.toFixed(2), (sub + vat).toFixed(2), opp.currency || "MKD", notes, "14 дена", ctx?.actor?.id ?? null, opp.owner ?? actor(ctx), input.opportunityId],
      );
      const id = Number(r[0].id);
      if (sub > 0) {
        await q(
          `INSERT INTO quotation_items (quotation_id, item_type, description, quantity, unit, unit_price, total_price, vat_rate, sort_order)
           VALUES ($1,'service',$2,1,'ком',$3,$3,$4,0)`,
          [id, (opp.title || "Услуга").slice(0, 500), sub.toFixed(2), vatRate],
        );
      }
      await q(`UPDATE crm_opportunities SET quotation_id = $2, stage = 'quoted', updated_at = now() WHERE id = $1`, [input.opportunityId, id]);
      await q(`INSERT INTO crm_activities (customer_id, opportunity_id, quotation_id, kind, subject, created_by)
        VALUES ($1,$2,$3,'note',$4,$5)`, [customerId, input.opportunityId, id, `Креирана понуда ${quoteNumber}`, actor(ctx)]);
      return { id, quoteNumber, existing: false };
    }),


  /** Поврзани документи: понуда → нарачка → испратници → фактури. */
  oppTimeline: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const opp = (await q(`SELECT * FROM crm_opportunities WHERE id = $1`, [input.id]))[0];
    if (!opp) throw bad("Зделката не постои");
    let quoteId = opp.quotation_id ? Number(opp.quotation_id) : null;
    if (!quoteId) {
      const via = (await q(`SELECT id FROM quotations WHERE opportunity_id = $1 ORDER BY id DESC LIMIT 1`, [input.id]).catch(() => []))[0];
      if (via) quoteId = Number(via.id);
    }
    const quote = quoteId
      ? (await q(`SELECT id, quote_number, status, total_amount, currency, converted_order_id FROM quotations WHERE id = $1`, [quoteId]))[0]
      : null;
    let orderId = quote?.converted_order_id ? Number(quote.converted_order_id) : null;
    if (!orderId && quoteId) {
      const o = (await q(`SELECT id FROM orders WHERE quote_id = $1 ORDER BY id DESC LIMIT 1`, [quoteId]).catch(() => []))[0];
      if (o) orderId = Number(o.id);
    }
    const order = orderId
      ? (await q(`SELECT id, order_number, status, total_amount FROM orders WHERE id = $1`, [orderId]))[0]
      : null;
    const dns = orderId
      ? await q(`SELECT id, dn_number, status, issue_date FROM delivery_notes WHERE order_id = $1 AND status <> 'cancelled' ORDER BY id`, [orderId]).catch(() => [])
      : [];
    const invoices = orderId
      ? await q(`SELECT id, invoice_number, status, invoice_type, total_amount FROM invoices WHERE order_id = $1 AND status <> 'cancelled' ORDER BY id`, [orderId]).catch(() => [])
      : (quoteId
        ? await q(`SELECT id, invoice_number, status, invoice_type, total_amount FROM invoices WHERE quotation_id = $1 AND status <> 'cancelled' ORDER BY id`, [quoteId]).catch(() => [])
        : []);
    const steps = [
      quote ? { kind: "quote" as const, id: Number(quote.id), number: quote.quote_number, status: quote.status, href: `/ponudi?open=${quote.id}` } : null,
      order ? { kind: "order" as const, id: Number(order.id), number: order.order_number, status: order.status, href: `/klienti?order=${order.id}` } : null,
      ...dns.map((d: any) => ({ kind: "delivery" as const, id: Number(d.id), number: d.dn_number, status: d.status, href: `/ispratnici?open=${d.id}` })),
      ...invoices.map((i: any) => ({ kind: "invoice" as const, id: Number(i.id), number: i.invoice_number, status: i.status, href: `/smetkovodstvo?open=${i.id}`, invoiceType: i.invoice_type })),
    ].filter(Boolean);
    return {
      opportunityId: input.id,
      customerId: opp.customer_id ? Number(opp.customer_id) : null,
      quotationId: quoteId,
      orderId,
      steps,
      next: nextStepFromTimeline({ stage: opp.stage, quote: quote ? { id: Number(quote.id), status: quote.status } : null, order: order ? { id: Number(order.id), status: order.status } : null, hasDn: dns.length > 0, hasInvoice: invoices.length > 0 }),
    };
  }),

  // ===== Продажни услови =====
  customerTerms: publicQuery.input(z.object({ customerId: z.number() })).query(async ({ input }) => {
    const c = (await q(`SELECT id, COALESCE(company, name) AS name, discount_pct, credit_limit, payment_days FROM customers WHERE id = $1`, [input.customerId]))[0];
    if (!c) throw bad("Клиентот не постои");
    const prices = await q(`SELECT cp.*, CASE cp.item_type WHEN 'material' THEN m.name WHEN 'service' THEN s.name ELSE p.name END AS item
      FROM customer_prices cp LEFT JOIN materials m ON cp.item_type = 'material' AND m.id = cp.ref_id LEFT JOIN services s ON cp.item_type = 'service' AND s.id = cp.ref_id
      LEFT JOIN products p ON cp.item_type = 'product' AND p.id = cp.ref_id WHERE cp.customer_id = $1 ORDER BY item`, [input.customerId]);
    const balance = await customerOpenBalance(input.customerId);
    // однесување при плаќање: просечно доцнење на платените фактури (последни 12 месеци)
    const late = (await q(`SELECT AVG(GREATEST(0, (pd - i.due_date)))::numeric(10,1) AS avg_late, COUNT(*)::int AS n FROM invoices i
      JOIN LATERAL (SELECT MAX(t.tx_date) AS pd FROM payment_allocations a JOIN bank_transactions t ON t.id = a.tx_id WHERE a.doc_type = 'invoice' AND a.doc_id = i.id) x ON x.pd IS NOT NULL
      WHERE i.customer_id = $1 AND i.status = 'paid' AND i.due_date IS NOT NULL AND i.issue_date >= CURRENT_DATE - 365`, [input.customerId]))[0];
    return {
      customerId: c.id, name: c.name, discountPct: Number(c.discount_pct ?? 0), creditLimit: c.credit_limit === null ? null : Number(c.credit_limit), paymentDays: c.payment_days,
      openBalance: balance, avgDaysLate: late?.n ? Number(late.avg_late) : null, paidInvoices: late?.n ?? 0,
      prices: prices.map((r) => ({ id: r.id, itemType: r.item_type, refId: r.ref_id, item: r.item, price: r.price === null ? null : Number(r.price), discountPct: r.discount_pct === null ? null : Number(r.discount_pct), note: r.note })),
    };
  }),
  customerTermsSave: publicQuery
    .input(z.object({ customerId: z.number(), discountPct: z.number().min(0).max(100).default(0), creditLimit: z.number().min(0).nullable(), paymentDays: z.number().int().min(0).max(365).nullable() }))
    .mutation(async ({ input }) => {
      await q(`UPDATE customers SET discount_pct = $2, credit_limit = $3, payment_days = $4, updated_at = now() WHERE id = $1`, [input.customerId, input.discountPct, input.creditLimit, input.paymentDays]);
      return { success: true };
    }),
  customerPriceSave: publicQuery
    .input(z.object({ customerId: z.number(), itemType: z.enum(["material", "service", "product"]), refId: z.number(), price: z.number().min(0).nullable(), discountPct: z.number().min(0).max(100).nullable(), note: z.string().max(300).optional() }))
    .mutation(async ({ input }) => {
      if (input.price === null && input.discountPct === null) throw bad("Внеси цена или попуст");
      await q(`INSERT INTO customer_prices (customer_id, item_type, ref_id, price, discount_pct, note) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (customer_id, item_type, ref_id) DO UPDATE SET price = EXCLUDED.price, discount_pct = EXCLUDED.discount_pct, note = EXCLUDED.note`,
        [input.customerId, input.itemType, input.refId, input.price, input.discountPct, input.note ?? null]);
      return { success: true };
    }),
  customerPriceDelete: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await q(`DELETE FROM customer_prices WHERE id = $1`, [input.id]);
    return { success: true };
  }),
  /** Цена за купувачот: посебна цена → посебен попуст на ставката → општ попуст на купувачот. */
  priceFor: publicQuery.input(z.object({ customerId: z.number(), itemType: z.enum(["material", "service", "product"]), refId: z.number(), basePrice: z.number() })).query(async ({ input }) => {
    const c = (await q(`SELECT discount_pct FROM customers WHERE id = $1`, [input.customerId]))[0];
    const sp = (await q(`SELECT price, discount_pct FROM customer_prices WHERE customer_id = $1 AND item_type = $2 AND ref_id = $3`, [input.customerId, input.itemType, input.refId]))[0];
    if (sp?.price !== null && sp?.price !== undefined) return { price: Number(sp.price), rule: "посебна цена за купувачот" };
    const d = sp?.discount_pct !== null && sp?.discount_pct !== undefined ? Number(sp.discount_pct) : Number(c?.discount_pct ?? 0);
    return { price: Math.round(input.basePrice * (1 - d / 100) * 100) / 100, rule: d ? `попуст ${d}%` : null };
  }),
  /** Кредитен лимит: отворено + нов износ наспроти лимитот. Само предупредува — не блокира. */
  creditCheck: publicQuery.input(z.object({ customerId: z.number(), amount: z.number().default(0) })).query(async ({ input }) => {
    const c = (await q(`SELECT credit_limit FROM customers WHERE id = $1`, [input.customerId]))[0];
    const limit = c?.credit_limit === null || c?.credit_limit === undefined ? null : Number(c.credit_limit);
    const open = await customerOpenBalance(input.customerId);
    const overdue = (await openDocs()).filter((d) => d.docType === "invoice" && d.partnerId === input.customerId && d.dueDate && d.dueDate < new Date().toISOString().slice(0, 10));
    const overdueMkd = Math.round(overdue.reduce((s, d) => s + d.openMkd, 0) * 100) / 100;
    const after = Math.round((open + input.amount) * 100) / 100;
    const over = limit !== null && after > limit;
    const strict = process.env.CREDIT_LIMIT_STRICT === "true";
    return { limit, open, after, over, blocked: strict && over, overdueMkd, overdueCount: overdue.length, strict };
  }),
});

// ───────────── Портал (јавни адреси без најава — само со таен токен) ─────────────

export async function portalCustomer(token: string): Promise<number | null> {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const r = (await q(`SELECT id, customer_id FROM customer_portal_tokens WHERE token_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`, [sha(token)]))[0];
  if (!r) return null;
  q(`UPDATE customer_portal_tokens SET last_used_at = now() WHERE id = $1`, [r.id]).catch(() => {});
  return Number(r.customer_id);
}

export async function portalData(customerId: number) {
  const c = (await q(`SELECT id, COALESCE(company, name) AS name, email FROM customers WHERE id = $1`, [customerId]))[0];
  const company = (await q(`SELECT name, address, phone, email, bank_account, bank_name, iban, swift, edb, logo_url IS NOT NULL AS has_logo FROM company_settings LIMIT 1`))[0] ?? {};
  const orders = await q(`SELECT o.id, o.order_number, o.status, o.delivery_date, o.total_amount, o.created_at, qt.currency,
      (SELECT string_agg(DISTINCT w.status, ',') FROM work_orders w WHERE w.order_id = o.id AND w.status <> 'cancelled') AS wo_status,
      (SELECT MAX(d.delivery_date) FROM delivery_notes d WHERE d.order_id = o.id AND d.status <> 'cancelled') AS delivered
    FROM orders o LEFT JOIN quotations qt ON qt.id = o.quote_id WHERE o.customer_id = $1 AND o.status <> 'cancelled' ORDER BY o.created_at DESC LIMIT 100`, [customerId]).catch(() => []);
  const open = new Map((await openDocs({ includeProforma: true })).filter((d) => d.docType === "invoice" && d.partnerId === customerId).map((d) => [d.id, d]));
  const invoices = await q(`SELECT id, invoice_number, invoice_type, issue_date, due_date, total_amount, currency, status FROM invoices
    WHERE customer_id = $1 AND status NOT IN ('draft','cancelled') AND invoice_type IN ('standard','proforma','credit_note') ORDER BY issue_date DESC, id DESC LIMIT 200`, [customerId]);
  const certs = await q(`SELECT c.id, c.material_name, c.heat_number, c.cert_number, c.cert_standard, c.cert_url, c.created_at, dn.dn_number FROM dn_certificates c
    JOIN delivery_notes dn ON dn.id = c.delivery_note_id WHERE dn.customer_id = $1 ORDER BY c.created_at DESC LIMIT 200`, [customerId]).catch(() => []);
  return {
    customer: { id: c?.id, name: c?.name },
    company: { name: company.name, address: company.address, phone: company.phone, email: company.email, bankAccount: company.bank_account, bankName: company.bank_name, iban: company.iban, swift: company.swift },
    orders: orders.map((o) => ({ id: o.id, number: o.order_number, status: o.status, deliveryDate: o.delivery_date ? iso(o.delivery_date) : null, total: Number(o.total_amount), currency: o.currency ?? "MKD",
      created: iso(o.created_at), production: o.wo_status, delivered: o.delivered ? iso(o.delivered) : null })),
    invoices: invoices.map((i) => ({ id: i.id, number: i.invoice_number, type: i.invoice_type, date: iso(i.issue_date), dueDate: i.due_date ? iso(i.due_date) : null,
      total: Number(i.total_amount), currency: i.currency, status: i.status, open: open.get(i.id)?.open ?? 0 })),
    certificates: certs.map((x) => ({ id: x.id, material: x.material_name, heat: x.heat_number, number: x.cert_number, standard: x.cert_standard,
      url: x.cert_url && /^https?:\/\//.test(x.cert_url) ? x.cert_url : null, hasFile: !!x.cert_url, dn: x.dn_number, date: iso(x.created_at) })),
  };
}

/** Барање за понуда од порталот: нова можност со прикачени цртежи. */
export async function portalRfq(customerId: number, input: { title: string; message: string; contact?: string; files: { name: string; mime: string; data: string }[] }) {
  const c = (await q(`SELECT COALESCE(company, name) AS name, email, phone FROM customers WHERE id = $1`, [customerId]))[0];
  const r = await q(`INSERT INTO crm_opportunities (customer_id, company, contact_name, email, phone, title, stage, source, notes, probability) VALUES ($1,$2,$3,$4,$5,$6,'new','portal',$7,40) RETURNING id`,
    [customerId, c?.name ?? null, input.contact ?? null, c?.email ?? null, c?.phone ?? null, input.title.slice(0, 300), input.message.slice(0, 5000)]);
  const id = Number(r[0].id);
  for (const f of input.files.slice(0, 10)) await q(`INSERT INTO crm_files (opportunity_id, file_name, mime, data) VALUES ($1,$2,$3,$4)`, [id, f.name.slice(0, 255), f.mime.slice(0, 120), f.data]);
  await q(`INSERT INTO crm_activities (customer_id, opportunity_id, kind, subject, notes, due_date, created_by) VALUES ($1,$2,'task',$3,$4, CURRENT_DATE + 1, 'портал')`,
    [customerId, id, `Одговори на барање за понуда: ${input.title}`.slice(0, 300), input.message.slice(0, 2000)]);
  return { id };
}
