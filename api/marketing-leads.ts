// Барања од веб-страницата (leads): прием, автоматски одговор, известување, претворање во купувач + понуда,
// и пренос на изворот/кампањата понуда → нарачка → фактура.
import { z } from "zod";
import { getPool } from "./queries/connection";
import { iso } from "./rates-helper";
import { notify } from "./notifications";
import { getMailer, parseAddress } from "./mail-transport";
import {
  leadInputSchema, normalizeLeadFields, spamReason, checkFiles, classifyChannel, safeFileName, renderTemplate,
  DEFAULT_AUTO_REPLY, attributionOf, type LeadStatus,
} from "@contracts/marketing";

const q = async (text: string, params: any[] = []) => (await getPool().query(text, params)).rows as any[];
const num = (v: any) => (v === null || v === undefined ? null : Number(v));

// ───────────── поставки ─────────────

export const marketingSettingsSchema = z.object({
  autoReply: z.object({
    enabled: z.boolean().default(true),
    subject: z.string().min(1).max(300).default(DEFAULT_AUTO_REPLY.subject),
    body: z.string().min(1).max(10000).default(DEFAULT_AUTO_REPLY.body),
  }).default({ enabled: true, subject: DEFAULT_AUTO_REPLY.subject, body: DEFAULT_AUTO_REPLY.body }),
  /** интерни адреси што добиваат е-пошта за секое ново барање */
  notifyEmails: z.array(z.string().email()).max(10).default([]),
});
export type MarketingSettings = z.infer<typeof marketingSettingsSchema>;

export async function kvGet(key: string): Promise<string | null> {
  return (await q(`SELECT value FROM app_kv WHERE key = $1`, [key]))[0]?.value ?? null;
}
export async function kvSet(key: string, value: string) {
  await q(`INSERT INTO app_kv (key, value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, value]);
}
export async function getMarketingSettings(): Promise<MarketingSettings> {
  const raw = await kvGet("marketing");
  try { return marketingSettingsSchema.parse(raw ? JSON.parse(raw) : {}); } catch { return marketingSettingsSchema.parse({}); }
}

// ───────────── прием ─────────────

export type IncomingFile = { name: string; mime: string; data: Buffer };
export type IntakeMeta = { ip?: string | null; userAgent?: string | null; elapsedMs?: number | null; ownHosts?: string[] };
export type IntakeResult = { ok: true; id: number; spam: boolean; duplicate?: boolean } | { ok: false; status: 400; error: string };

export async function intakeLead(raw: Record<string, unknown>, files: IncomingFile[], meta: IntakeMeta, opts: { awaitSideEffects?: boolean } = {}): Promise<IntakeResult> {
  const parsed = leadInputSchema.safeParse(normalizeLeadFields(raw));
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "Неважечки податоци" };
  const d = parsed.data;
  const fileErr = checkFiles(files.map((f) => ({ name: f.name, size: f.data.length })));
  if (fileErr) return { ok: false, status: 400, error: fileErr };

  // двоен клик / повторно праќање: истата порака од истата адреса во последните 10 минути
  const dup = (await q(`SELECT id FROM mkt_leads WHERE lower(email) = $1 AND COALESCE(message, '') = $2 AND created_at > now() - interval '10 minutes' ORDER BY id DESC LIMIT 1`,
    [d.email, d.message ?? ""]))[0];
  if (dup) return { ok: true, id: Number(dup.id), spam: false, duplicate: true };

  const spam = spamReason({ message: d.message, name: d.name, elapsedMs: meta.elapsedMs });
  const channel = classifyChannel({ utmSource: d.utmSource, utmMedium: d.utmMedium, gclid: d.gclid, fbclid: d.fbclid, referrer: d.referrer, ownHosts: meta.ownHosts });
  const cust = (await q(`SELECT id FROM customers WHERE lower(email) = $1 ORDER BY id LIMIT 1`, [d.email]))[0];
  const ins = await q(`INSERT INTO mkt_leads (status, company, name, email, phone, product_type, quantity, message, consent, channel,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid, landing_page, referrer, lang, ip, user_agent, spam_reason, customer_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING id`,
    [spam ? "spam" : "new", d.company ?? null, d.name, d.email, d.phone ?? null, d.productType ?? null, d.quantity ?? null, d.message ?? null, d.consent, channel,
      d.utmSource ?? null, d.utmMedium ?? null, d.utmCampaign ?? null, d.utmContent ?? null, d.utmTerm ?? null, d.gclid ?? null, d.fbclid ?? null,
      d.landingPage ?? null, d.referrer ?? null, d.lang ?? null, meta.ip?.slice(0, 64) ?? null, meta.userAgent?.slice(0, 400) ?? null, spam, cust?.id ?? null]);
  const id = Number(ins[0].id);
  for (const f of files) {
    await q(`INSERT INTO mkt_lead_files (lead_id, file_name, mime, size, data) VALUES ($1,$2,$3,$4,$5)`,
      [id, safeFileName(f.name), (f.mime || "application/octet-stream").slice(0, 120), f.data.length, f.data.toString("base64")]);
  }
  await leadEvent(id, "created", spam ? `Означено како спам: ${spam}` : `Ново барање од веб (${channel}${d.utmCampaign ? ` · ${d.utmCampaign}` : ""})`, "веб-страница");
  if (!spam) {
    await notify({ kind: "lead_new", title: `Ново барање: ${d.company || d.name}${d.productType ? ` — ${d.productType}` : ""}`, link: `/marketing/baranja?id=${id}`, dedupeKey: `lead_new:${id}` });
    const side = Promise.all([
      sendLeadAutoReply(id).catch((e) => console.error("[LEADS] auto-reply:", e?.message ?? e)),
      sendInternalNotice(id).catch((e) => console.error("[LEADS] notice:", e?.message ?? e)),
      afterIntakeHooks.length ? Promise.all(afterIntakeHooks.map((h) => h(id).catch((e) => console.error("[LEADS] hook:", e?.message ?? e)))) : null,
    ]);
    if (opts.awaitSideEffects) await side;
  }
  return { ok: true, id, spam: !!spam };
}

/** Други модули (на пр. кампањи / double opt-in) се закачуваат тука. */
export const afterIntakeHooks: ((leadId: number) => Promise<unknown>)[] = [];

export async function leadEvent(leadId: number, kind: string, note: string | null, by: string | null) {
  await q(`INSERT INTO mkt_lead_events (lead_id, kind, note, created_by) VALUES ($1,$2,$3,$4)`, [leadId, kind.slice(0, 30), note, by]);
}

/** Име на фирмата за потписот: Подесувања → име од адресата на испраќачот → „Serafimoski“. */
async function companyName(mailerFrom?: string) {
  const n = ((await q(`SELECT name FROM company_settings LIMIT 1`).catch(() => []))[0]?.name ?? "") as string;
  return n || (mailerFrom ? parseAddress(mailerFrom).name : "") || "Serafimoski";
}

export function autoReplyVars(lead: any, company: string) {
  return {
    name: lead.name, company: lead.company ?? "", company_name: company, product_type: lead.product_type ?? "", quantity: lead.quantity ?? "",
    product_line: lead.product_type ? ` за „${lead.product_type}“` : "",
  };
}

/** Автоматски одговор до клиентот. Без SMTP — тивко прескокнува (вратено false). */
export async function sendLeadAutoReply(leadId: number, force = false): Promise<boolean> {
  const s = await getMarketingSettings();
  if (!s.autoReply.enabled && !force) return false;
  const lead = (await q(`SELECT * FROM mkt_leads WHERE id = $1`, [leadId]))[0];
  if (!lead || lead.status === "spam" || (lead.auto_reply_at && !force)) return false;
  const mailer = await getMailer();
  if (!mailer) return false;
  const vars = autoReplyVars(lead, await companyName(mailer.from));
  await mailer.send({ to: lead.email, subject: renderTemplate(s.autoReply.subject, vars), text: renderTemplate(s.autoReply.body, vars) });
  await q(`UPDATE mkt_leads SET auto_reply_at = now() WHERE id = $1`, [leadId]);
  await leadEvent(leadId, "auto_reply", `Автоматски одговор пратен на ${lead.email}`, "систем");
  return true;
}

async function sendInternalNotice(leadId: number) {
  const s = await getMarketingSettings();
  if (!s.notifyEmails.length) return;
  const mailer = await getMailer();
  if (!mailer) return;
  const l = (await q(`SELECT * FROM mkt_leads WHERE id = $1`, [leadId]))[0];
  const files = await q(`SELECT file_name, size FROM mkt_lead_files WHERE lead_id = $1`, [leadId]);
  const base = (process.env.APP_URL ?? process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
  await mailer.send({
    to: s.notifyEmails, replyTo: l.email, subject: `Ново барање од веб: ${l.company || l.name}${l.product_type ? ` — ${l.product_type}` : ""}`,
    text: [`Име: ${l.name}`, l.company ? `Фирма: ${l.company}` : "", `Е-пошта: ${l.email}`, l.phone ? `Телефон: ${l.phone}` : "",
      l.product_type ? `Производ: ${l.product_type}` : "", l.quantity ? `Количина: ${l.quantity}` : "", `Извор: ${l.channel}${l.utm_campaign ? ` · ${l.utm_campaign}` : ""}`,
      files.length ? `Прилози: ${files.map((f: any) => f.file_name).join(", ")}` : "", "", l.message ?? "", "", base ? `${base}/marketing/baranja?id=${leadId}` : ""].filter((x) => x !== null).join("\n"),
  });
}

// ───────────── преглед ─────────────

export function mapLead(r: any) {
  return {
    id: Number(r.id), status: r.status as LeadStatus, company: r.company, name: r.name, email: r.email, phone: r.phone,
    productType: r.product_type, quantity: r.quantity, message: r.message, consent: !!r.consent, channel: r.channel,
    utmSource: r.utm_source, utmMedium: r.utm_medium, utmCampaign: r.utm_campaign, utmContent: r.utm_content, utmTerm: r.utm_term,
    gclid: r.gclid, fbclid: r.fbclid, landingPage: r.landing_page, referrer: r.referrer, lang: r.lang, spamReason: r.spam_reason,
    customerId: num(r.customer_id), customer: r.customer ?? null, quotationId: num(r.quotation_id), quoteNumber: r.quote_number ?? null,
    assignedTo: r.assigned_to, notes: r.notes, autoReplyAt: r.auto_reply_at, createdAt: r.created_at, updatedAt: r.updated_at,
    fileCount: r.file_count == null ? undefined : Number(r.file_count),
  };
}

// ───────────── претворање ─────────────

/** Барање → купувач (постоечки по е-пошта или нов) + нацрт-понуда со изворот/кампањата. */
export async function convertLead(leadId: number, ctx: any, opts: { customerId?: number | null; createQuote?: boolean } = {}) {
  const lead = (await q(`SELECT * FROM mkt_leads WHERE id = $1`, [leadId]))[0];
  if (!lead) throw new Error("Барањето не постои");
  if (lead.status === "spam") throw new Error("Барањето е означено како спам — прво смени го статусот");
  let customerId: number | null = opts.customerId ?? num(lead.customer_id);
  let createdCustomer = false;
  if (!customerId) customerId = num((await q(`SELECT id FROM customers WHERE lower(email) = lower($1) ORDER BY id LIMIT 1`, [lead.email]))[0]?.id);
  if (!customerId) {
    const r = await q(`INSERT INTO customers (name, company, contact_person, email, phone, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [lead.company || lead.name, lead.company ?? null, lead.company ? lead.name : null, lead.email, lead.phone ?? null, `Од барање од веб #${leadId} (${lead.channel})`]);
    customerId = Number(r[0].id);
    createdCustomer = true;
  }
  await q(`UPDATE mkt_leads SET customer_id = $2, updated_at = now() WHERE id = $1`, [leadId, customerId]);
  const by = ctx?.actor?.name ?? null;
  await leadEvent(leadId, "converted", createdCustomer ? `Создаден купувач #${customerId}` : `Поврзано со купувач #${customerId}`, by);

  let quotationId: number | null = num(lead.quotation_id);
  let quoteNumber: string | null = null;
  if ((opts.createQuote ?? true) && !quotationId) {
    const { peekNextDocNumber } = await import("./counters-helper");
    const { appRouter } = await import("./router");
    const caller = appRouter.createCaller({ ...(ctx ?? {}), req: ctx?.req ?? new Request("http://internal"), resHeaders: ctx?.resHeaders ?? new Headers() } as any);
    // ако барањето спомнува производ од каталогот — додај го како ставка со јавна/основна цена
    const prod = lead.product_type
      ? (await q(`SELECT id, name, unit, COALESCE(public_price, default_price) AS price FROM products WHERE is_active = 'active' AND (lower(name) = lower($1) OR lower(code) = lower($1)) LIMIT 1`, [lead.product_type]))[0]
      : null;
    const qty = Math.max(1, Number(String(lead.quantity ?? "").replace(",", ".").match(/[\d.]+/)?.[0] ?? 1) || 1);
    const items = prod ? [{ itemType: "product" as const, referenceId: Number(prod.id), description: prod.name, quantity: String(qty), unit: prod.unit,
      unitPrice: Number(prod.price).toFixed(2), totalPrice: (Number(prod.price) * qty).toFixed(2), sortOrder: 0 }] : undefined;
    const subtotal = items ? Number(items[0].totalPrice) : 0;
    const notes = [`Барање од веб #${leadId}${lead.product_type ? ` — ${lead.product_type}` : ""}${lead.quantity ? `, количина: ${lead.quantity}` : ""}`, lead.message ?? ""].filter(Boolean).join("\n").slice(0, 4000);
    const created: any = await caller.quotation.quotationCreate({
      quoteNumber: await peekNextDocNumber("quote"), customerId, status: "draft", notes, items,
      subtotal: subtotal.toFixed(2), vatAmount: (subtotal * 0.18).toFixed(2), totalAmount: (subtotal * 1.18).toFixed(2),
      salesperson: lead.assigned_to ?? by ?? undefined,
    });
    quotationId = Number(created.id);
    quoteNumber = created.quoteNumber;
    const a = attributionOf({ channel: lead.channel, utmMedium: lead.utm_medium, utmCampaign: lead.utm_campaign });
    await q(`UPDATE quotations SET mkt_lead_id = $2, mkt_source = $3, mkt_medium = $4, mkt_campaign = $5 WHERE id = $1`, [quotationId, leadId, a.source, a.medium, a.campaign]);
    await q(`UPDATE mkt_leads SET quotation_id = $2, status = CASE WHEN status IN ('new','contacted') THEN 'quoted' ELSE status END, updated_at = now() WHERE id = $1`, [leadId, quotationId]);
    await leadEvent(leadId, "quote", `Нацрт-понуда ${quoteNumber}`, by);
  }
  return { customerId, createdCustomer, quotationId, quoteNumber };
}

// ───────────── атрибуција ─────────────

/**
 * Пренеси извор/кампања понуда → нарачка → фактура (вклучително про-фактури и книжни одобренија).
 * Идемпотентно; ги пополнува само празните. Се повикува по конверзија, од извештаите и од планерот.
 */
export async function syncAttribution() {
  const pool = getPool();
  const a = await pool.query(`UPDATE orders o SET mkt_lead_id = qt.mkt_lead_id, mkt_source = qt.mkt_source, mkt_medium = qt.mkt_medium, mkt_campaign = qt.mkt_campaign
    FROM quotations qt WHERE o.quote_id = qt.id AND o.mkt_source IS NULL AND qt.mkt_source IS NOT NULL`);
  const b = await pool.query(`UPDATE invoices i SET mkt_lead_id = o.mkt_lead_id, mkt_source = o.mkt_source, mkt_medium = o.mkt_medium, mkt_campaign = o.mkt_campaign
    FROM orders o WHERE i.order_id = o.id AND i.mkt_source IS NULL AND o.mkt_source IS NOT NULL`);
  const c = await pool.query(`UPDATE invoices i SET mkt_lead_id = qt.mkt_lead_id, mkt_source = qt.mkt_source, mkt_medium = qt.mkt_medium, mkt_campaign = qt.mkt_campaign
    FROM quotations qt WHERE i.quotation_id = qt.id AND i.mkt_source IS NULL AND qt.mkt_source IS NOT NULL`);
  const d = await pool.query(`UPDATE invoices i SET mkt_lead_id = src.mkt_lead_id, mkt_source = src.mkt_source, mkt_medium = src.mkt_medium, mkt_campaign = src.mkt_campaign
    FROM invoices src WHERE i.original_invoice_id = src.id AND i.mkt_source IS NULL AND src.mkt_source IS NOT NULL`).catch(() => ({ rowCount: 0 }));
  // добиено: барање чија понуда стана нарачка
  const w = await pool.query(`UPDATE mkt_leads l SET status = 'won', updated_at = now() FROM quotations qt
    WHERE l.quotation_id = qt.id AND qt.status = 'converted' AND l.status IN ('new','contacted','quoted')`);
  return { orders: a.rowCount ?? 0, invoices: (b.rowCount ?? 0) + (c.rowCount ?? 0) + (d.rowCount ?? 0), won: w.rowCount ?? 0 };
}

export const leadDate = (v: any) => iso(v);
