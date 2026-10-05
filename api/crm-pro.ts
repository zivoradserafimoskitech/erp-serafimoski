// CRM (Odoo/HubSpot/Pipedrive стил): фирми (360°), контакт лица, зделки (pipeline), активности и задачи, CRM извештаи.
// Фирма = постоечкиот запис во `customers` (проширен со ознаки/одговорен продавач); зделка = `crm_opportunities`.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicQuery } from "./middleware";
import { getPool } from "./queries/connection";
import { iso } from "./rates-helper";
import { openDocs, manualPartnerBalances } from "./payment-status";
import { DEAL_STAGES, ACTIVITY_KINDS, OPEN_STAGES, stageChange, bucketTasks, dealMetrics, parseTags, DEAL_STAGE_LABEL } from "@contracts/crm";

const q = async (text: string, params: any[] = []) => (await getPool().query(text, params)).rows as any[];
const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const actorName = (ctx: any): string | null => ctx?.actor?.name ?? null;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const todayYmd = () => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Skopje", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p; // YYYY-MM-DD
};
const num = (v: any) => (v === null || v === undefined ? null : Number(v));

async function openBalance(customerId: number) {
  const docs = (await openDocs()).filter((d) => d.docType === "invoice" && d.partnerId === customerId);
  const man = (await manualPartnerBalances()).customers.get(customerId) ?? 0;
  return Math.round((docs.reduce((s, d) => s + d.openMkd, 0) + man) * 100) / 100;
}

const mapContact = (r: any) => ({
  id: Number(r.id), customerId: Number(r.customer_id), customer: r.customer ?? null, name: r.name, position: r.position, email: r.email, phone: r.phone,
  isPrimary: !!r.is_primary, notes: r.notes, lastActivity: r.last_activity ?? null, createdAt: r.created_at,
});

const mapActivity = (a: any) => ({
  id: Number(a.id), customerId: num(a.customer_id), customer: a.customer ?? null, contactId: num(a.contact_id), contact: a.contact ?? null,
  opportunityId: num(a.opportunity_id), opportunity: a.opportunity ?? null, quotationId: num(a.quotation_id),
  kind: a.kind as string, subject: a.subject as string, notes: a.notes as string | null, dueDate: a.due_date ? iso(a.due_date) : null,
  doneAt: a.done_at, assignee: a.assignee as string | null, createdBy: a.created_by as string | null, createdAt: a.created_at, auto: !!a.auto_key,
});

const ACT_SELECT = `SELECT a.*, COALESCE(c.company, c.name) AS customer, ct.name AS contact, o.title AS opportunity FROM crm_activities a
  LEFT JOIN customers c ON c.id = a.customer_id LEFT JOIN crm_contacts ct ON ct.id = a.contact_id LEFT JOIN crm_opportunities o ON o.id = a.opportunity_id`;

export const crmProProcedures = {
  // ═════════════ Фирми ═════════════
  firmList: publicQuery
    .input(z.object({ search: z.string().max(100).optional(), tag: z.string().max(60).optional(), owner: z.string().max(160).optional() }).optional())
    .query(async ({ input }) => {
      const w: string[] = [`COALESCE(c.is_active, 'active') <> 'deleted'`]; const p: any[] = [];
      if (input?.search) { p.push(`%${input.search}%`); w.push(`(c.name ILIKE $${p.length} OR c.company ILIKE $${p.length} OR c.edb ILIKE $${p.length} OR c.tax_number ILIKE $${p.length} OR c.city ILIKE $${p.length})`); }
      if (input?.tag) { p.push(`%${input.tag}%`); w.push(`c.tags ILIKE $${p.length}`); }
      if (input?.owner) { p.push(input.owner); w.push(`c.owner = $${p.length}`); }
      const rows = await q(`SELECT c.id, c.name, c.company, c.city, c.email, c.phone, c.edb, c.tax_number, c.tags, c.owner, c.is_active,
          (SELECT COUNT(*)::int FROM crm_contacts x WHERE x.customer_id = c.id) AS contacts,
          (SELECT COUNT(*)::int FROM crm_opportunities o WHERE o.customer_id = c.id AND o.stage NOT IN ('won','lost')) AS open_deals,
          (SELECT COALESCE(SUM(o.value), 0) FROM crm_opportunities o WHERE o.customer_id = c.id AND o.stage NOT IN ('won','lost')) AS open_value,
          (SELECT MAX(a.created_at) FROM crm_activities a WHERE a.customer_id = c.id) AS last_activity
        FROM customers c WHERE ${w.join(" AND ")} ORDER BY COALESCE(c.company, c.name) LIMIT 1000`, p);
      return rows.map((r) => ({
        id: Number(r.id), name: r.company || r.name, legalName: r.name, city: r.city, email: r.email, phone: r.phone, edb: r.edb, taxNumber: r.tax_number,
        tags: parseTags(r.tags), owner: r.owner, active: r.is_active !== "inactive", contacts: r.contacts, openDeals: r.open_deals, openValue: Number(r.open_value),
        lastActivity: r.last_activity,
      }));
    }),

  /** 360° преглед на фирма. */
  firmById: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const c = (await q(`SELECT * FROM customers WHERE id = $1`, [input.id]))[0];
    if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Фирмата не постои" });
    const deals = (await q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(value), 0) AS v FROM crm_opportunities WHERE customer_id = $1 AND stage NOT IN ('won','lost')`, [input.id]))[0];
    const quotes = (await q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(total_amount), 0) AS v FROM quotations WHERE customer_id = $1 AND status IN ('draft','sent','accepted')`, [input.id]))[0];
    const last = (await q(`${ACT_SELECT} WHERE a.customer_id = $1 AND (a.kind <> 'task' OR a.done_at IS NOT NULL) ORDER BY COALESCE(a.done_at, a.created_at) DESC LIMIT 1`, [input.id]))[0];
    const openTasks = (await q(`SELECT COUNT(*)::int AS n FROM crm_activities WHERE customer_id = $1 AND kind = 'task' AND done_at IS NULL`, [input.id]))[0];
    const prices = (await q(`SELECT COUNT(*)::int AS n FROM customer_prices WHERE customer_id = $1`, [input.id]).catch(() => [{ n: 0 }]))[0];
    const balance = await openBalance(input.id).catch(() => 0);
    return {
      id: Number(c.id), name: c.company || c.name, legalName: c.name, company: c.company, email: c.email, phone: c.phone, address: c.address, city: c.city, country: c.country,
      edb: c.edb, taxNumber: c.tax_number, website: c.website ?? null, notes: c.notes, tags: parseTags(c.tags), owner: c.owner ?? null, active: c.is_active !== "inactive",
      paymentDays: c.payment_days ?? null, creditLimit: num(c.credit_limit), discountPct: Number(c.discount_pct ?? 0), specialPrices: prices?.n ?? 0,
      overview: {
        openDeals: deals.n, openDealsValue: Number(deals.v), openQuotes: quotes.n, openQuotesValue: Number(quotes.v), unpaid: balance,
        openTasks: openTasks.n, lastActivity: last ? mapActivity(last) : null,
        overCredit: c.credit_limit !== null && c.credit_limit !== undefined && balance > Number(c.credit_limit),
      },
    };
  }),

  /** Нова фирма или измена на CRM полињата (ЕДБ, адреса, услови, ознаки, продавач). */
  firmSave: publicQuery
    .input(z.object({
      id: z.number().optional(),
      name: z.string().min(1).max(255),
      company: z.string().max(255).nullable().optional(),
      edb: z.string().max(20).nullable().optional(),
      taxNumber: z.string().max(50).nullable().optional(),
      email: z.union([z.literal(""), z.string().email()]).nullable().optional(),
      phone: z.string().max(50).nullable().optional(),
      address: z.string().max(500).nullable().optional(),
      city: z.string().max(100).nullable().optional(),
      country: z.string().max(100).nullable().optional(),
      website: z.string().max(255).nullable().optional(),
      paymentDays: z.number().int().min(0).max(365).nullable().optional(),
      creditLimit: z.number().min(0).nullable().optional(),
      tags: z.array(z.string().max(60)).max(20).optional(),
      owner: z.string().max(160).nullable().optional(),
      notes: z.string().max(5000).nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const tags = input.tags ? parseTags(input.tags.join(",")).join(", ") : null;
      const vals = [input.name, input.company ?? null, input.edb ?? null, input.taxNumber ?? null, input.email || null, input.phone ?? null, input.address ?? null,
        input.city ?? null, input.country ?? null, input.website ?? null, input.paymentDays ?? null, input.creditLimit ?? null, tags, input.owner ?? null, input.notes ?? null];
      if (input.id) {
        await q(`UPDATE customers SET name=$1, company=$2, edb=$3, tax_number=$4, email=$5, phone=$6, address=$7, city=$8, country=$9, website=$10,
          payment_days=$11, credit_limit=$12, tags=$13, owner=$14, notes=$15, updated_at=now() WHERE id=$16`, [...vals, input.id]);
        return { id: input.id };
      }
      const r = await q(`INSERT INTO customers (name, company, edb, tax_number, email, phone, address, city, country, website, payment_days, credit_limit, tags, owner, notes, is_active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'active') RETURNING id`, vals);
      return { id: Number(r[0].id) };
    }),

  /** Сите ознаки (за филтер). */
  firmTagsList: publicQuery.query(async () => {
    const rows = await q(`SELECT tags FROM customers WHERE tags IS NOT NULL AND tags <> ''`);
    const counts = new Map<string, number>();
    for (const r of rows) for (const t of parseTags(r.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
  }),

  /** Понуди / нарачки / фактури на фирмата. */
  firmDocsList: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const quotes = await q(`SELECT id, quote_number, status, total_amount, currency, created_at, valid_until FROM quotations WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 200`, [input.id]);
    const orders = await q(`SELECT id, order_number, status, total_amount, delivery_date, created_at FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 200`, [input.id]);
    const invoices = await q(`SELECT id, invoice_number, invoice_type, status, total_amount, currency, issue_date, due_date FROM invoices WHERE customer_id = $1 AND status <> 'cancelled' ORDER BY issue_date DESC NULLS LAST, id DESC LIMIT 200`, [input.id]);
    return {
      quotes: quotes.map((r) => ({ id: Number(r.id), number: r.quote_number, status: r.status, total: Number(r.total_amount), currency: r.currency ?? "MKD", date: iso(r.created_at), validUntil: r.valid_until ? iso(r.valid_until) : null })),
      orders: orders.map((r) => ({ id: Number(r.id), number: r.order_number, status: r.status, total: Number(r.total_amount), date: iso(r.created_at), deliveryDate: r.delivery_date ? iso(r.delivery_date) : null })),
      invoices: invoices.map((r) => ({ id: Number(r.id), number: r.invoice_number, type: r.invoice_type, status: r.status, total: Number(r.total_amount), currency: r.currency ?? "MKD", date: r.issue_date ? iso(r.issue_date) : null, dueDate: r.due_date ? iso(r.due_date) : null })),
    };
  }),

  /** Е-пошта на фирмата (излезна; влезна ќе дојде со IMAP синхронизација). */
  firmEmailsList: publicQuery.input(z.object({ id: z.number().optional(), contactId: z.number().optional(), opportunityId: z.number().optional() })).query(async ({ input }) => {
    const w: string[] = []; const p: any[] = [];
    if (input.id) { p.push(input.id); w.push(`e.customer_id = $${p.length}`); }
    if (input.contactId) { p.push(input.contactId); w.push(`e.contact_id = $${p.length}`); }
    if (input.opportunityId) { p.push(input.opportunityId); w.push(`e.opportunity_id = $${p.length}`); }
    if (!w.length) return [];
    const rows = await q(`SELECT e.*, qt.quote_number, ct.name AS contact FROM crm_email_log e LEFT JOIN quotations qt ON qt.id = e.quotation_id LEFT JOIN crm_contacts ct ON ct.id = e.contact_id
      WHERE ${w.join(" AND ")} ORDER BY e.sent_at DESC LIMIT 200`, p);
    return rows.map((r) => ({ id: Number(r.id), direction: r.direction, to: r.to_addr, cc: r.cc_addr, subject: r.subject, body: r.body, attachment: r.attachment,
      quotationId: num(r.quotation_id), quoteNumber: r.quote_number ?? null, contact: r.contact ?? null, sentBy: r.sent_by, sentAt: r.sent_at }));
  }),

  // ═════════════ Контакт лица ═════════════
  contactList: publicQuery.input(z.object({ customerId: z.number().optional(), search: z.string().max(100).optional() }).optional()).query(async ({ input }) => {
    const w: string[] = []; const p: any[] = [];
    if (input?.customerId) { p.push(input.customerId); w.push(`x.customer_id = $${p.length}`); }
    if (input?.search) { p.push(`%${input.search}%`); w.push(`(x.name ILIKE $${p.length} OR x.email ILIKE $${p.length} OR x.phone ILIKE $${p.length} OR c.company ILIKE $${p.length} OR c.name ILIKE $${p.length})`); }
    const rows = await q(`SELECT x.*, COALESCE(c.company, c.name) AS customer, (SELECT MAX(a.created_at) FROM crm_activities a WHERE a.contact_id = x.id) AS last_activity
      FROM crm_contacts x LEFT JOIN customers c ON c.id = x.customer_id ${w.length ? "WHERE " + w.join(" AND ") : ""}
      ORDER BY ${input?.customerId ? "x.is_primary DESC, x.name" : "x.name"} LIMIT 1000`, p);
    return rows.map(mapContact);
  }),
  contactById: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const r = (await q(`SELECT x.*, COALESCE(c.company, c.name) AS customer FROM crm_contacts x LEFT JOIN customers c ON c.id = x.customer_id WHERE x.id = $1`, [input.id]))[0];
    if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Контактот не постои" });
    const acts = await q(`${ACT_SELECT} WHERE a.contact_id = $1 ORDER BY COALESCE(a.due_date, a.created_at::date) DESC, a.id DESC LIMIT 200`, [input.id]);
    const deals = await q(`SELECT id, title, stage, value FROM crm_opportunities WHERE contact_id = $1 ORDER BY updated_at DESC LIMIT 50`, [input.id]);
    return { ...mapContact(r), activities: acts.map(mapActivity), deals: deals.map((d) => ({ id: Number(d.id), title: d.title, stage: d.stage, value: Number(d.value) })) };
  }),
  contactSave: publicQuery
    .input(z.object({
      id: z.number().optional(), customerId: z.number(), name: z.string().min(2).max(255), position: z.string().max(160).nullable().optional(),
      email: z.union([z.literal(""), z.string().email()]).nullable().optional(), phone: z.string().max(60).nullable().optional(), isPrimary: z.boolean().default(false), notes: z.string().max(5000).nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const cust = (await q(`SELECT id FROM customers WHERE id = $1`, [input.customerId]))[0];
      if (!cust) throw bad("Фирмата не постои");
      // прв контакт на фирмата е секогаш главен
      const has = (await q(`SELECT COUNT(*)::int AS n FROM crm_contacts WHERE customer_id = $1 AND ($2::int IS NULL OR id <> $2)`, [input.customerId, input.id ?? null]))[0].n;
      const primary = input.isPrimary || has === 0;
      if (primary) await q(`UPDATE crm_contacts SET is_primary = false WHERE customer_id = $1 AND ($2::int IS NULL OR id <> $2)`, [input.customerId, input.id ?? null]);
      const vals = [input.customerId, input.name, input.position ?? null, input.email || null, input.phone ?? null, primary, input.notes ?? null];
      if (input.id) {
        await q(`UPDATE crm_contacts SET customer_id=$1, name=$2, position=$3, email=$4, phone=$5, is_primary=$6, notes=$7, updated_at=now() WHERE id=$8`, [...vals, input.id]);
        return { id: input.id };
      }
      const r = await q(`INSERT INTO crm_contacts (customer_id, name, position, email, phone, is_primary, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, vals);
      return { id: Number(r[0].id) };
    }),
  contactDelete: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await q(`UPDATE crm_opportunities SET contact_id = NULL WHERE contact_id = $1`, [input.id]);
    await q(`UPDATE crm_activities SET contact_id = NULL WHERE contact_id = $1`, [input.id]);
    await q(`DELETE FROM crm_contacts WHERE id = $1`, [input.id]);
    return { success: true };
  }),

  // ═════════════ Зделки ═════════════
  /** Drag & drop во pipeline: смени фаза (изгубена бара причина). */
  dealMove: publicQuery
    .input(z.object({ id: z.number(), stage: z.enum(DEAL_STAGES), lostReason: z.string().max(40).nullable().optional(), lostNote: z.string().max(1000).nullable().optional() }))
    .mutation(async ({ input, ctx }) => {
      const d = (await q(`SELECT id, stage, probability, customer_id, quotation_id FROM crm_opportunities WHERE id = $1`, [input.id]))[0];
      if (!d) throw bad("Зделката не постои");
      const ch = stageChange(d.stage, input.stage, Number(d.probability));
      if (ch.needsLostReason && !input.lostReason) throw bad("Избери зошто е изгубена");
      await q(`UPDATE crm_opportunities SET stage = $2, probability = $3, lost_reason = $4, lost_note = $5,
          closed_at = CASE WHEN $6 THEN COALESCE(closed_at, now()) ELSE NULL END, updated_at = now() WHERE id = $1`,
        [input.id, input.stage, ch.probability, input.stage === "lost" ? input.lostReason : null, input.stage === "lost" ? input.lostNote ?? null : null, ch.closed]);
      if (input.stage === "lost" && d.quotation_id) {
        await q(`UPDATE quotations SET status = 'rejected', lost_reason = $2, lost_note = $3, updated_at = now() WHERE id = $1 AND status IN ('draft','sent')`, [d.quotation_id, input.lostReason, input.lostNote ?? null]);
      }
      if (d.stage !== input.stage) {
        await q(`INSERT INTO crm_activities (customer_id, opportunity_id, kind, subject, done_at, created_by) VALUES ($1,$2,'note',$3, now(), $4)`,
          [d.customer_id, input.id, `Фаза: ${DEAL_STAGE_LABEL[d.stage as keyof typeof DEAL_STAGE_LABEL] ?? d.stage} → ${DEAL_STAGE_LABEL[input.stage]}`, actorName(ctx)]);
      }
      return { success: true, probability: ch.probability };
    }),

  /** Сите продавачи/корисници (за избор на одговорен / извршител). */
  crmPeopleList: publicQuery.query(async () => {
    const rows = await q(`SELECT DISTINCT n FROM (
        SELECT name AS n FROM app_users WHERE COALESCE(is_active, 'active') = 'active'
        UNION SELECT owner FROM crm_opportunities UNION SELECT owner FROM customers UNION SELECT salesperson FROM quotations UNION SELECT assignee FROM crm_activities
      ) x WHERE n IS NOT NULL AND TRIM(n) <> '' ORDER BY n LIMIT 200`).catch(() => [] as any[]);
    return rows.map((r) => String(r.n));
  }),

  // ═════════════ Активности и задачи ═════════════
  activityFeedList: publicQuery
    .input(z.object({
      customerId: z.number().optional(), contactId: z.number().optional(), opportunityId: z.number().optional(),
      kind: z.enum(ACTIVITY_KINDS).optional(), assignee: z.string().max(160).optional(), openOnly: z.boolean().optional(), limit: z.number().int().min(1).max(500).default(200),
    }).optional())
    .query(async ({ input }) => {
      const w: string[] = []; const p: any[] = [];
      if (input?.customerId) { p.push(input.customerId); w.push(`a.customer_id = $${p.length}`); }
      if (input?.contactId) { p.push(input.contactId); w.push(`a.contact_id = $${p.length}`); }
      if (input?.opportunityId) { p.push(input.opportunityId); w.push(`a.opportunity_id = $${p.length}`); }
      if (input?.kind) { p.push(input.kind); w.push(`a.kind = $${p.length}`); }
      if (input?.assignee) { p.push(input.assignee); w.push(`COALESCE(a.assignee, a.created_by) = $${p.length}`); }
      if (input?.openOnly) w.push(`a.kind = 'task' AND a.done_at IS NULL`);
      p.push(input?.limit ?? 200);
      const rows = await q(`${ACT_SELECT} ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY COALESCE(a.due_date, a.created_at::date) DESC, a.id DESC LIMIT $${p.length}`, p);
      return rows.map(mapActivity);
    }),

  /** „Мои задачи / Денес“: доцнат, денес, наскоро, подоцна. */
  myTasksList: publicQuery.input(z.object({ all: z.boolean().default(false), assignee: z.string().max(160).optional() }).optional()).query(async ({ input, ctx }) => {
    // без вистински корисник (отворен режим без најава) нема „јас“ → сите задачи
    const me = ctx?.actor?.id ? actorName(ctx) : null;
    const who = input?.assignee ?? (input?.all ? null : me);
    const p: any[] = []; let w = `a.kind = 'task' AND a.done_at IS NULL`;
    if (who) { p.push(who); w += ` AND (a.assignee = $1 OR (a.assignee IS NULL AND (a.created_by = $1 OR a.created_by IS NULL)))`; }
    const rows = (await q(`${ACT_SELECT} WHERE ${w} ORDER BY a.due_date NULLS LAST, a.id LIMIT 500`, p)).map(mapActivity);
    const today = todayYmd();
    const b = bucketTasks(rows, today);
    return { date: today, who, overdue: b.overdue, today: b.today, upcoming: b.upcoming, later: b.later, counts: { overdue: b.overdue.length, today: b.today.length, upcoming: b.upcoming.length, later: b.later.length } };
  }),

  activityUpsert: publicQuery
    .input(z.object({
      id: z.number().optional(), customerId: z.number().nullable().optional(), contactId: z.number().nullable().optional(), opportunityId: z.number().nullable().optional(),
      quotationId: z.number().nullable().optional(), kind: z.enum(ACTIVITY_KINDS), subject: z.string().min(2).max(300), notes: z.string().max(5000).nullable().optional(),
      dueDate: dateStr.nullable().optional(), assignee: z.string().max(160).nullable().optional(), done: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      let customerId = input.customerId ?? null;
      // фирмата се зема од зделката / контактот ако не е дадена
      if (!customerId && input.opportunityId) customerId = num((await q(`SELECT customer_id FROM crm_opportunities WHERE id = $1`, [input.opportunityId]))[0]?.customer_id);
      if (!customerId && input.contactId) customerId = num((await q(`SELECT customer_id FROM crm_contacts WHERE id = $1`, [input.contactId]))[0]?.customer_id);
      if (!customerId && !input.opportunityId && !input.contactId) throw bad("Поврзи ја активноста со фирма, контакт или зделка");
      const doneAt = input.kind === "task" ? (input.done ? new Date() : null) : new Date();
      const assignee = input.assignee ?? (input.kind === "task" ? actorName(ctx) : null);
      if (input.id) {
        await q(`UPDATE crm_activities SET customer_id=$1, contact_id=$2, opportunity_id=$3, quotation_id=$4, kind=$5, subject=$6, notes=$7, due_date=$8, assignee=$9,
          done_at = CASE WHEN $5 <> 'task' THEN COALESCE(done_at, now()) WHEN $10::boolean THEN COALESCE(done_at, now()) ELSE NULL END WHERE id=$11`,
          [customerId, input.contactId ?? null, input.opportunityId ?? null, input.quotationId ?? null, input.kind, input.subject, input.notes ?? null, input.dueDate ?? null, assignee, !!input.done, input.id]);
        return { id: input.id };
      }
      const r = await q(`INSERT INTO crm_activities (customer_id, contact_id, opportunity_id, quotation_id, kind, subject, notes, due_date, done_at, assignee, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [customerId, input.contactId ?? null, input.opportunityId ?? null, input.quotationId ?? null, input.kind, input.subject, input.notes ?? null, input.dueDate ?? null, doneAt, assignee, actorName(ctx)]);
      if (input.opportunityId) await q(`UPDATE crm_opportunities SET updated_at = now(), stage = CASE WHEN stage = 'new' THEN 'contacted' ELSE stage END WHERE id = $1`, [input.opportunityId]);
      return { id: Number(r[0].id) };
    }),

  // ═════════════ CRM извештаи ═════════════
  crmReport: publicQuery.input(z.object({ from: dateStr, to: dateStr })).query(async ({ input }) => {
    const pipeline = await q(`SELECT stage, COUNT(*)::int AS n, COALESCE(SUM(value), 0) AS v, COALESCE(SUM(value * probability / 100.0), 0) AS w
      FROM crm_opportunities WHERE stage = ANY($1::text[]) GROUP BY stage`, [OPEN_STAGES]);
    const closed = await q(`SELECT stage, created_at, COALESCE(closed_at, updated_at) AS closed_at, value FROM crm_opportunities
      WHERE stage IN ('won','lost') AND COALESCE(closed_at, updated_at)::date BETWEEN $1 AND $2`, [input.from, input.to]);
    const m = dealMetrics(closed.map((r) => ({ stage: r.stage, createdAt: r.created_at, closedAt: r.closed_at, value: Number(r.value) })));
    const conv = (await q(`SELECT COUNT(*)::int AS quotes,
        COUNT(*) FILTER (WHERE qt.converted_order_id IS NOT NULL OR qt.status = 'converted' OR EXISTS (SELECT 1 FROM orders o WHERE o.quote_id = qt.id))::int AS converted
      FROM quotations qt WHERE qt.created_at::date BETWEEN $1 AND $2`, [input.from, input.to]))[0];
    const acts = await q(`SELECT COALESCE(NULLIF(TRIM(COALESCE(a.assignee, a.created_by)), ''), '—') AS who, a.kind, COUNT(*)::int AS n,
        COUNT(*) FILTER (WHERE a.kind = 'task' AND a.done_at IS NOT NULL)::int AS done
      FROM crm_activities a WHERE a.created_at::date BETWEEN $1 AND $2 AND a.auto_key IS NULL GROUP BY 1, 2`, [input.from, input.to]);
    const per = new Map<string, { who: string; total: number; tasksDone: number; byKind: Record<string, number> }>();
    for (const r of acts) {
      const x = per.get(r.who) ?? { who: r.who as string, total: 0, tasksDone: 0, byKind: {} as Record<string, number> };
      x.total += r.n; x.tasksDone += r.done; const k = String(r.kind); x.byKind[k] = (x.byKind[k] ?? 0) + r.n;
      per.set(r.who, x);
    }
    const byOwner = await q(`SELECT COALESCE(NULLIF(TRIM(owner), ''), '—') AS who, COUNT(*) FILTER (WHERE stage = 'won')::int AS won, COUNT(*) FILTER (WHERE stage = 'lost')::int AS lost,
        COALESCE(SUM(value) FILTER (WHERE stage = 'won'), 0) AS won_value
      FROM crm_opportunities WHERE stage IN ('won','lost') AND COALESCE(closed_at, updated_at)::date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 4 DESC`, [input.from, input.to]);
    return {
      pipeline: OPEN_STAGES.map((s) => {
        const r = pipeline.find((x) => x.stage === s);
        return { stage: s, label: DEAL_STAGE_LABEL[s], count: r?.n ?? 0, value: Number(r?.v ?? 0), weighted: Math.round(Number(r?.w ?? 0)) };
      }),
      deals: m,
      quoteToOrder: { quotes: conv?.quotes ?? 0, converted: conv?.converted ?? 0, rate: conv?.quotes ? conv.converted / conv.quotes : null },
      activitiesBySalesperson: [...per.values()].sort((a, b) => b.total - a.total),
      winBySalesperson: byOwner.map((r) => ({ who: r.who, won: r.won, lost: r.lost, wonValue: Number(r.won_value), winRate: r.won + r.lost ? r.won / (r.won + r.lost) : null })),
    };
  }),
};
