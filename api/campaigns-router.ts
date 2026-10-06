// Маркетинг М2: публика (контакти, согласност, одјава), сегменти, е-пошта кампањи, буџет за реклами, маркетинг извештај.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { getPool } from "./queries/connection";
import { getMailer } from "./mail-transport";
import { CHANNELS } from "@contracts/marketing";
import { blockSchema, segmentRulesSchema, csvContacts, slugify, CONSENT_STATUSES, CONTACT_SOURCES, EMAIL_RE } from "@contracts/marketing-campaigns";
import {
  syncAudience, importContacts, upsertContact, setConsent, suppress, sendDoi, audience, parseRules, queueCampaign, processCampaignQueue,
  campaignStats, renderForRecipient, appBase,
} from "./marketing-campaigns";
import { syncAttribution } from "./marketing-leads";

const q = async (text: string, params: any[] = []) => (await getPool().query(text, params)).rows as any[];
const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const actorName = (ctx: any) => (ctx?.actor?.name as string | undefined) ?? null;
const wrap = async <T>(f: () => Promise<T>) => { try { return await f(); } catch (e: any) { if (e instanceof TRPCError) throw e; throw bad(e?.message ?? String(e)); } };

const mapContact = (r: any) => ({
  id: Number(r.id), email: r.email as string, name: r.name as string | null, company: r.company as string | null, phone: r.phone as string | null,
  city: r.city as string | null, country: r.country as string | null, customerId: r.customer_id == null ? null : Number(r.customer_id), leadId: r.lead_id == null ? null : Number(r.lead_id),
  source: r.source as string, consentStatus: r.consent_status as (typeof CONSENT_STATUSES)[number], consentAt: r.consent_at, consentSource: r.consent_source as string | null,
  unsubscribedAt: r.unsubscribed_at, suppressed: !!r.suppressed, createdAt: r.created_at,
});

const campaignInput = z.object({
  id: z.number().optional(),
  name: z.string().trim().min(2).max(160),
  subject: z.string().trim().min(2).max(300),
  preheader: z.string().max(300).nullable().optional(),
  replyTo: z.string().trim().max(320).refine((v) => !v || EMAIL_RE.test(v), "Неважечка адреса за одговор").nullable().optional(),
  blocks: z.array(blockSchema).max(60),
  segmentId: z.number().nullable().optional(),
  rules: segmentRulesSchema.nullable().optional(),
  utmCampaign: z.string().trim().max(160).optional(),
  ratePerMinute: z.number().int().min(1).max(1000).default(30),
});

const mapCampaign = (r: any) => ({
  id: Number(r.id), name: r.name as string, subject: r.subject as string, preheader: r.preheader as string | null, replyTo: r.reply_to as string | null,
  blocks: (r.blocks ?? []) as z.infer<typeof blockSchema>[], segmentId: r.segment_id == null ? null : Number(r.segment_id), segmentName: (r.segment_name ?? null) as string | null,
  rules: r.rules ? segmentRulesSchema.parse(r.rules) : null, status: r.status as string, utmCampaign: r.utm_campaign as string, ratePerMinute: Number(r.rate_per_minute),
  scheduledAt: r.scheduled_at, startedAt: r.started_at, finishedAt: r.finished_at, recipients: Number(r.recipients ?? 0), lastError: r.last_error as string | null,
  createdBy: r.created_by as string | null, createdAt: r.created_at, updatedAt: r.updated_at,
  stats: r.st_total == null ? undefined : { total: Number(r.st_total), sent: Number(r.st_sent), opened: Number(r.st_opened), clicked: Number(r.st_clicked), unsubscribed: Number(r.st_unsub), failed: Number(r.st_failed) },
});

export const campaignsRouter = createRouter({
  // ───── публика ─────
  contactList: publicQuery.input(z.object({
    search: z.string().max(200).optional(), consent: z.enum(CONSENT_STATUSES).optional(), source: z.enum(CONTACT_SOURCES).optional(),
    limit: z.number().int().min(1).max(5000).default(500),
  }).optional()).query(async ({ input }) => {
    const w: string[] = []; const p: any[] = [];
    if (input?.search) { p.push(`%${input.search}%`); w.push(`(c.email ILIKE $${p.length} OR c.name ILIKE $${p.length} OR c.company ILIKE $${p.length} OR c.city ILIKE $${p.length})`); }
    if (input?.consent) { p.push(input.consent); w.push(`c.consent_status = $${p.length}`); }
    if (input?.source) { p.push(input.source); w.push(`c.source = $${p.length}`); }
    const rows = await q(`SELECT c.*, EXISTS (SELECT 1 FROM mkt_suppressions s WHERE s.email = lower(c.email)) AS suppressed FROM mkt_contacts c
      ${w.length ? `WHERE ${w.join(" AND ")}` : ""} ORDER BY c.updated_at DESC, c.id DESC LIMIT ${input?.limit ?? 500}`, p);
    return rows.map(mapContact);
  }),
  contactStats: publicQuery.query(async () => {
    const by = await q(`SELECT consent_status, COUNT(*)::int n FROM mkt_contacts GROUP BY 1`);
    const sup = (await q(`SELECT COUNT(*)::int n FROM mkt_suppressions`))[0].n;
    const total = by.reduce((a, r) => a + r.n, 0);
    return { total, byConsent: Object.fromEntries(by.map((r) => [r.consent_status, r.n])) as Record<string, number>, suppressed: Number(sup) };
  }),
  contactConsentLogList: publicQuery.input(z.object({ contactId: z.number() })).query(async ({ input }) => {
    const c = (await q(`SELECT email FROM mkt_contacts WHERE id = $1`, [input.contactId]))[0];
    if (!c) return [];
    return (await q(`SELECT * FROM mkt_consents WHERE contact_id = $1 OR lower(email) = lower($2) ORDER BY created_at DESC, id DESC LIMIT 100`, [input.contactId, c.email]))
      .map((r) => ({ id: Number(r.id), action: r.action as string, source: r.source as string | null, ip: r.ip as string | null, note: r.note as string | null, by: r.created_by as string | null, at: r.created_at }));
  }),
  audienceSync: publicQuery.mutation(async () => syncAudience()),
  contactImportCsv: publicQuery.input(z.object({ csv: z.string().max(5_000_000), consent: z.boolean(), note: z.string().max(200).optional() })).mutation(async ({ input, ctx }) => {
    const { contacts, errors } = csvContacts(input.csv);
    if (!contacts.length) throw bad(errors[0] ?? "Нема важечки адреси во датотеката");
    const r = await importContacts(contacts, { consent: input.consent, note: input.note, by: actorName(ctx) });
    return { ...r, errors };
  }),
  contactSave: publicQuery.input(z.object({
    id: z.number().optional(), email: z.string().trim().toLowerCase().regex(EMAIL_RE, "Неважечка е-пошта"), name: z.string().max(255).nullable().optional(),
    company: z.string().max(255).nullable().optional(), city: z.string().max(100).nullable().optional(), country: z.string().max(100).nullable().optional(),
  })).mutation(async ({ input }) => wrap(async () => {
    if (input.id) {
      await q(`UPDATE mkt_contacts SET name = $2, company = $3, city = $4, country = $5, updated_at = now() WHERE id = $1`, [input.id, input.name ?? null, input.company ?? null, input.city ?? null, input.country ?? null]);
      return { id: input.id };
    }
    const r = await upsertContact({ email: input.email, name: input.name, company: input.company, city: input.city, country: input.country, source: "manual" });
    return { id: r.id };
  })),
  contactConsentSet: publicQuery.input(z.object({ id: z.number(), status: z.enum(["granted", "withdrawn", "none"]), note: z.string().max(500).optional() })).mutation(async ({ input, ctx }) => wrap(async () => {
    if (input.status === "granted" && !input.note?.trim()) throw new Error("Наведи како е добиена согласноста (пр. „потпишана форма на саем 12.10.“)");
    await setConsent(input.id, input.status, { source: "manual", note: input.note, by: actorName(ctx) });
    return { success: true };
  })),
  contactDoiSend: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => wrap(() => sendDoi(input.id, { force: true }))),
  contactDelete: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    // GDPR бришење: контактот се брише, адресата останува во листата за одјава (за да не се врати при увоз)
    const c = (await q(`SELECT email FROM mkt_contacts WHERE id = $1`, [input.id]))[0];
    if (c) { await suppress(c.email, "manual", { note: "избришан контакт" }); await q(`DELETE FROM mkt_contacts WHERE id = $1`, [input.id]); }
    return { success: true };
  }),

  // ───── листа за одјава (suppression) ─────
  suppressionList: publicQuery.input(z.object({ search: z.string().max(200).optional() }).optional()).query(async ({ input }) => {
    const p: any[] = []; let w = "";
    if (input?.search) { p.push(`%${input.search.toLowerCase()}%`); w = `WHERE s.email LIKE $1`; }
    return (await q(`SELECT s.*, c.name AS campaign FROM mkt_suppressions s LEFT JOIN mkt_campaigns c ON c.id = s.campaign_id ${w} ORDER BY s.created_at DESC LIMIT 1000`, p))
      .map((r) => ({ email: r.email as string, reason: r.reason as string, campaign: r.campaign as string | null, note: r.note as string | null, createdAt: r.created_at }));
  }),
  suppressionAdd: publicQuery.input(z.object({ emails: z.string().max(200_000), reason: z.enum(["manual", "bounce", "complaint", "unsubscribe"]).default("manual"), note: z.string().max(300).optional() })).mutation(async ({ input }) => {
    const list = [...new Set(input.emails.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)))];
    for (const e of list) {
      await suppress(e, input.reason, { note: input.note });
      await q(`UPDATE mkt_contacts SET consent_status = 'withdrawn', unsubscribed_at = COALESCE(unsubscribed_at, now()) WHERE lower(email) = $1`, [e]);
    }
    return { added: list.length };
  }),
  /** враќање од листата за одјава — само администратор („delete“) */
  suppressionDelete: publicQuery.input(z.object({ email: z.string() })).mutation(async ({ input }) => {
    await q(`DELETE FROM mkt_suppressions WHERE email = lower($1)`, [input.email]);
    return { success: true };
  }),

  // ───── сегменти ─────
  segmentList: publicQuery.query(async () => {
    const rows = await q(`SELECT * FROM mkt_segments ORDER BY name`);
    const out = [];
    for (const r of rows) {
      const rules = parseRules(r.rules);
      out.push({ id: Number(r.id), name: r.name as string, rules, count: (await audience(rules, { countOnly: true })).count, updatedAt: r.updated_at });
    }
    return out;
  }),
  segmentSave: publicQuery.input(z.object({ id: z.number().optional(), name: z.string().trim().min(2).max(160), rules: segmentRulesSchema })).mutation(async ({ input }) => {
    if (input.id) { await q(`UPDATE mkt_segments SET name = $2, rules = $3, updated_at = now() WHERE id = $1`, [input.id, input.name, JSON.stringify(input.rules)]); return { id: input.id }; }
    const r = await q(`INSERT INTO mkt_segments (name, rules) VALUES ($1,$2) RETURNING id`, [input.name, JSON.stringify(input.rules)]);
    return { id: Number(r[0].id) };
  }),
  segmentDelete: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await q(`UPDATE mkt_campaigns SET rules = (SELECT rules FROM mkt_segments WHERE id = $1), segment_id = NULL WHERE segment_id = $1`, [input.id]);
    await q(`DELETE FROM mkt_segments WHERE id = $1`, [input.id]);
    return { success: true };
  }),
  segmentPreview: publicQuery.input(z.object({ rules: segmentRulesSchema })).query(async ({ input }) => {
    const { count } = await audience(input.rules, { countOnly: true });
    const { rows } = await audience(input.rules, { limit: 8 });
    return { count, sample: rows.map((r) => ({ email: r.email as string, name: r.name as string | null, company: r.company as string | null, city: r.city as string | null })) };
  }),
  segmentOptionsGet: publicQuery.query(async () => {
    const cities = await q(`SELECT DISTINCT city FROM mkt_contacts WHERE city IS NOT NULL AND city <> '' ORDER BY 1 LIMIT 300`);
    const countries = await q(`SELECT DISTINCT country FROM mkt_contacts WHERE country IS NOT NULL AND country <> '' ORDER BY 1 LIMIT 100`);
    const cats = await q(`SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY 1`);
    return { cities: cities.map((r) => r.city as string), countries: countries.map((r) => r.country as string), categories: cats.map((r) => r.category as string) };
  }),

  // ───── кампањи ─────
  campaignList: publicQuery.query(async () => {
    const rows = await q(`SELECT c.*, sg.name AS segment_name, st.* FROM mkt_campaigns c LEFT JOIN mkt_segments sg ON sg.id = c.segment_id
      LEFT JOIN LATERAL (SELECT COUNT(*) st_total, COUNT(*) FILTER (WHERE status = 'sent') st_sent, COUNT(*) FILTER (WHERE opened_at IS NOT NULL) st_opened,
        COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) st_clicked, COUNT(*) FILTER (WHERE unsubscribed_at IS NOT NULL) st_unsub, COUNT(*) FILTER (WHERE status = 'failed') st_failed
        FROM mkt_sends s WHERE s.campaign_id = c.id) st ON true
      ORDER BY c.created_at DESC LIMIT 300`);
    return rows.map(mapCampaign);
  }),
  campaignById: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const r = (await q(`SELECT c.*, sg.name AS segment_name FROM mkt_campaigns c LEFT JOIN mkt_segments sg ON sg.id = c.segment_id WHERE c.id = $1`, [input.id]))[0];
    if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Кампањата не постои" });
    const stats = await campaignStats(input.id);
    const links = await q(`SELECT k.url, COUNT(*)::int clicks, COUNT(DISTINCT k.send_id)::int people FROM mkt_clicks k JOIN mkt_sends s ON s.id = k.send_id WHERE s.campaign_id = $1 GROUP BY k.url ORDER BY 2 DESC LIMIT 20`, [input.id]);
    const revenue = (await q(`SELECT COUNT(DISTINCT l.id)::int leads,
        COALESCE((SELECT SUM(CASE WHEN i.invoice_type = 'credit_note' THEN -ABS(i.subtotal) ELSE i.subtotal END) FROM invoices i
          WHERE i.mkt_campaign = $1 AND i.invoice_type IN ('standard','credit_note') AND i.status NOT IN ('draft','cancelled')), 0) AS revenue
      FROM mkt_leads l WHERE l.utm_campaign = $1 AND l.status <> 'spam'`, [r.utm_campaign]))[0];
    return { ...mapCampaign(r), stats, links: links.map((l) => ({ url: l.url as string, clicks: l.clicks as number, people: l.people as number })), leads: Number(revenue.leads), revenue: Number(revenue.revenue) };
  }),
  campaignSave: publicQuery.input(campaignInput).mutation(async ({ input, ctx }) => {
    const utm = slugify(input.utmCampaign || input.name);
    const rules = input.segmentId ? null : JSON.stringify(input.rules ?? { consent: "granted" });
    if (input.id) {
      const cur = (await q(`SELECT status FROM mkt_campaigns WHERE id = $1`, [input.id]))[0];
      if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Кампањата не постои" });
      if (!["draft", "paused", "scheduled"].includes(cur.status)) throw bad("Пратена кампања не може да се менува — направи копија");
      await q(`UPDATE mkt_campaigns SET name=$2, subject=$3, preheader=$4, reply_to=$5, blocks=$6, segment_id=$7, rules=$8, utm_campaign=$9, rate_per_minute=$10, updated_at=now() WHERE id=$1`,
        [input.id, input.name, input.subject, input.preheader ?? null, input.replyTo || null, JSON.stringify(input.blocks), input.segmentId ?? null, rules, utm, input.ratePerMinute]);
      return { id: input.id, utmCampaign: utm };
    }
    const r = await q(`INSERT INTO mkt_campaigns (name, subject, preheader, reply_to, blocks, segment_id, rules, utm_campaign, rate_per_minute, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [input.name, input.subject, input.preheader ?? null, input.replyTo || null, JSON.stringify(input.blocks), input.segmentId ?? null, rules, utm, input.ratePerMinute, actorName(ctx)]);
    return { id: Number(r[0].id), utmCampaign: utm };
  }),
  campaignPreview: publicQuery.input(z.object({ id: z.number(), contactId: z.number().optional() })).query(async ({ input }) => {
    const c = (await q(`SELECT * FROM mkt_campaigns WHERE id = $1`, [input.id]))[0];
    if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Кампањата не постои" });
    const ct = input.contactId ? (await q(`SELECT * FROM mkt_contacts WHERE id = $1`, [input.contactId]))[0] : null;
    const m = await renderForRecipient(c, ct ? { email: ct.email, name: ct.name, company: ct.company, customerId: ct.customer_id } : { email: "primer@firma.mk", name: "Петар Петровски", company: "Пример ДОО" }, null);
    const { count } = await audience(c.segment_id ? parseRules((await q(`SELECT rules FROM mkt_segments WHERE id = $1`, [c.segment_id]))[0]?.rules) : parseRules(c.rules), { countOnly: true });
    return { subject: m.subject, html: m.html, text: m.text, audience: count, appUrlSet: !!appBase() };
  }),
  /** преглед на несочувана верзија од уредникот (mutation поради големината; името завршува на „preview“ = читање) */
  campaignDraftPreview: publicQuery.input(campaignInput.partial({ name: true, subject: true }).extend({ contactId: z.number().optional() })).mutation(async ({ input }) => {
    const c = { id: input.id ?? 0, name: input.name ?? "", subject: input.subject ?? "", preheader: input.preheader ?? null, reply_to: null, blocks: input.blocks, utm_campaign: slugify(input.utmCampaign || input.name || "kampanja") };
    const ct = input.contactId ? (await q(`SELECT * FROM mkt_contacts WHERE id = $1`, [input.contactId]))[0] : null;
    const m = await renderForRecipient(c, ct ? { email: ct.email, name: ct.name, company: ct.company, customerId: ct.customer_id } : { email: "primer@firma.mk", name: "Петар Петровски", company: "Пример ДОО" }, null);
    let rules = input.rules ? segmentRulesSchema.parse(input.rules) : parseRules({});
    if (input.segmentId) rules = parseRules((await q(`SELECT rules FROM mkt_segments WHERE id = $1`, [input.segmentId]))[0]?.rules);
    const { count } = await audience(rules, { countOnly: true });
    return { subject: m.subject, html: m.html, audience: count, utmCampaign: c.utm_campaign, appUrlSet: !!appBase() };
  }),
  campaignTestSend: publicQuery.input(z.object({ id: z.number(), to: z.array(z.string().trim().toLowerCase().regex(EMAIL_RE)).min(1).max(5) })).mutation(async ({ input }) => wrap(async () => {
    const c = (await q(`SELECT * FROM mkt_campaigns WHERE id = $1`, [input.id]))[0];
    if (!c) throw new Error("Кампањата не постои");
    const mailer = await getMailer();
    if (!mailer) throw new Error("Е-поштата за праќање не е поставена (SMTP / MAIL_PROVIDER)");
    for (const to of input.to) {
      const ct = (await q(`SELECT * FROM mkt_contacts WHERE lower(email) = $1`, [to]))[0];
      const m = await renderForRecipient(c, { email: to, name: ct?.name ?? null, company: ct?.company ?? null, customerId: ct?.customer_id ?? null }, null);
      await mailer.send({ to, subject: `[ТЕСТ] ${m.subject}`, html: m.html, text: m.text, replyTo: c.reply_to ?? undefined });
    }
    return { sent: input.to.length };
  })),
  campaignSchedule: publicQuery.input(z.object({ id: z.number(), at: z.string().datetime({ offset: true }).optional() })).mutation(async ({ input }) => wrap(async () => {
    if (!(await getMailer())) throw new Error("Е-поштата за праќање не е поставена (SMTP / MAIL_PROVIDER)");
    const r = await queueCampaign(input.id, input.at ? new Date(input.at) : null);
    if (!r.total) { await q(`UPDATE mkt_campaigns SET status = 'draft' WHERE id = $1`, [input.id]); throw new Error("Нема примачи — провери го сегментот и согласностите"); }
    return r;
  })),
  campaignPause: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await q(`UPDATE mkt_campaigns SET status = 'paused', updated_at = now() WHERE id = $1 AND status IN ('sending','scheduled')`, [input.id]);
    return { success: true };
  }),
  campaignResume: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await q(`UPDATE mkt_campaigns SET status = 'sending', updated_at = now() WHERE id = $1 AND status = 'paused'`, [input.id]);
    return { success: true };
  }),
  campaignCancel: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await q(`UPDATE mkt_sends SET status = 'skipped', error = 'откажано' WHERE campaign_id = $1 AND status = 'queued'`, [input.id]);
    await q(`UPDATE mkt_campaigns SET status = 'cancelled', finished_at = now(), updated_at = now() WHERE id = $1 AND status IN ('sending','scheduled','paused')`, [input.id]);
    return { success: true };
  }),
  campaignDuplicate: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const r = await q(`INSERT INTO mkt_campaigns (name, subject, preheader, reply_to, blocks, segment_id, rules, utm_campaign, rate_per_minute, created_by)
      SELECT name || ' (копија)', subject, preheader, reply_to, blocks, segment_id, rules, utm_campaign || '-2', rate_per_minute, $2 FROM mkt_campaigns WHERE id = $1 RETURNING id`, [input.id, actorName(ctx)]);
    if (!r[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Кампањата не постои" });
    return { id: Number(r[0].id) };
  }),
  campaignDelete: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const c = (await q(`SELECT status FROM mkt_campaigns WHERE id = $1`, [input.id]))[0];
    if (c && !["draft", "cancelled"].includes(c.status)) throw bad("Се бришат само нацрти и откажани кампањи");
    await q(`DELETE FROM mkt_campaigns WHERE id = $1`, [input.id]);
    return { success: true };
  }),
  /** рачно „турни“ ја редицата (истото го прави планерот секоја минута) */
  campaignQueueRun: publicQuery.mutation(async () => processCampaignQueue()),
  productPickList: publicQuery.query(async () => (await q(`SELECT id, code, name, category, image_url, web_url, public_price, default_price FROM products WHERE is_active = 'active' ORDER BY show_on_web DESC, name LIMIT 2000`))
    .map((r) => ({ id: Number(r.id), code: r.code as string, name: r.name as string, category: r.category as string, hasImage: !!r.image_url, hasUrl: !!r.web_url, price: Number(r.public_price ?? r.default_price ?? 0) }))),

  // ───── буџет за реклами ─────
  adSpendList: publicQuery.input(z.object({ from: dateStr.optional(), to: dateStr.optional() }).optional()).query(async ({ input }) => {
    const p: any[] = []; const w: string[] = [];
    if (input?.from) { p.push(input.from); w.push(`period_end >= $${p.length}::date`); }
    if (input?.to) { p.push(input.to); w.push(`period_start <= $${p.length}::date`); }
    return (await q(`SELECT * FROM mkt_ad_spend ${w.length ? `WHERE ${w.join(" AND ")}` : ""} ORDER BY period_start DESC, id DESC LIMIT 1000`, p))
      .map((r) => ({ id: Number(r.id), periodStart: r.period_start, periodEnd: r.period_end, channel: r.channel as string, campaign: r.campaign as string | null, amount: Number(r.amount), note: r.note as string | null, createdBy: r.created_by as string | null }));
  }),
  adSpendSave: publicQuery.input(z.object({
    id: z.number().optional(), periodStart: dateStr, periodEnd: dateStr, channel: z.enum(CHANNELS), campaign: z.string().trim().max(160).nullable().optional(),
    amount: z.number().min(0).max(1e9), note: z.string().max(500).nullable().optional(),
  })).mutation(async ({ input, ctx }) => {
    if (input.periodEnd < input.periodStart) throw bad("Крајот на периодот е пред почетокот");
    if (input.id) {
      await q(`UPDATE mkt_ad_spend SET period_start=$2, period_end=$3, channel=$4, campaign=$5, amount=$6, note=$7 WHERE id=$1`,
        [input.id, input.periodStart, input.periodEnd, input.channel, input.campaign || null, input.amount, input.note ?? null]);
      return { id: input.id };
    }
    const r = await q(`INSERT INTO mkt_ad_spend (period_start, period_end, channel, campaign, amount, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [input.periodStart, input.periodEnd, input.channel, input.campaign || null, input.amount, input.note ?? null, actorName(ctx)]);
    return { id: Number(r[0].id) };
  }),
  adSpendDelete: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await q(`DELETE FROM mkt_ad_spend WHERE id = $1`, [input.id]);
    return { success: true };
  }),

  // ───── маркетинг извештај ─────
  marketingReport: publicQuery.input(z.object({ from: dateStr, to: dateStr })).query(async ({ input }) => {
    await syncAttribution().catch(() => {});
    const P = [input.from, input.to];
    const inLeads = `l.created_at >= $1::date AND l.created_at < $2::date + 1 AND l.status <> 'spam'`;
    // барања по канал + понуди/нарачки/фактури од тие барања (кохорта по датум на барањето)
    const REV = `CASE WHEN i.invoice_type = 'credit_note' THEN -ABS(i.subtotal) ELSE i.subtotal END`;
    const cohort = (group: string) => `SELECT ${group} AS k, l.channel, COUNT(DISTINCT l.id)::int leads,
        COUNT(DISTINCT qt.id)::int quotes, COUNT(DISTINCT o.id)::int orders, COUNT(DISTINCT i.id)::int invoices
      FROM mkt_leads l
      LEFT JOIN quotations qt ON qt.mkt_lead_id = l.id
      LEFT JOIN orders o ON o.mkt_lead_id = l.id
      LEFT JOIN invoices i ON i.mkt_lead_id = l.id AND i.invoice_type IN ('standard','credit_note') AND i.status NOT IN ('draft','cancelled')
      WHERE ${inLeads}`;
    const bySource = await q(`${cohort("l.channel")} GROUP BY l.channel ORDER BY leads DESC`, P);
    const byCampaign = await q(`${cohort("COALESCE(l.utm_campaign, '')")} AND l.utm_campaign IS NOT NULL GROUP BY 1, l.channel ORDER BY leads DESC LIMIT 200`, P);
    // приход по кампања во периодот (по датум на фактура) — вклучува и подоцнежни фактури од стари барања
    const revenueByCampaign = await q(`SELECT i.mkt_campaign AS campaign, i.mkt_source AS channel, COUNT(DISTINCT i.id)::int invoices, COALESCE(SUM(${REV}), 0) AS revenue
      FROM invoices i WHERE i.mkt_source IS NOT NULL AND i.invoice_type IN ('standard','credit_note') AND i.status NOT IN ('draft','cancelled')
        AND i.issue_date >= $1::date AND i.issue_date < $2::date + 1 GROUP BY 1, 2 ORDER BY revenue DESC`, P);
    // трошок за реклами: пропорционално на деновите што се преклопуваат со периодот
    const spend = await q(`SELECT channel, campaign, SUM(amount * (LEAST(period_end, $2::date) - GREATEST(period_start, $1::date) + 1)::numeric / (period_end - period_start + 1)) AS amount
      FROM mkt_ad_spend WHERE period_end >= $1::date AND period_start <= $2::date GROUP BY 1, 2`, P);
    const funnel = (await q(`SELECT COUNT(DISTINCT l.id)::int leads, COUNT(DISTINCT l.id) FILTER (WHERE qt.id IS NOT NULL)::int quoted,
        COUNT(DISTINCT l.id) FILTER (WHERE o.id IS NOT NULL)::int ordered, COUNT(DISTINCT l.id) FILTER (WHERE i.id IS NOT NULL)::int invoiced
      FROM mkt_leads l LEFT JOIN quotations qt ON qt.mkt_lead_id = l.id LEFT JOIN orders o ON o.mkt_lead_id = l.id
      LEFT JOIN invoices i ON i.mkt_lead_id = l.id AND i.invoice_type IN ('standard','credit_note') AND i.status NOT IN ('draft','cancelled')
      WHERE ${inLeads}`, P))[0];
    const emails = await q(`SELECT c.id, c.name, c.utm_campaign, c.finished_at, c.started_at, COUNT(s.id) FILTER (WHERE s.status = 'sent')::int sent,
        COUNT(s.id) FILTER (WHERE s.opened_at IS NOT NULL)::int opened, COUNT(s.id) FILTER (WHERE s.clicked_at IS NOT NULL)::int clicked,
        COUNT(s.id) FILTER (WHERE s.unsubscribed_at IS NOT NULL)::int unsubscribed
      FROM mkt_campaigns c LEFT JOIN mkt_sends s ON s.campaign_id = c.id
      WHERE c.started_at >= $1::date AND c.started_at < $2::date + 1 GROUP BY c.id ORDER BY c.started_at DESC`, P);
    const n = (v: any) => Number(v ?? 0);
    const spendBy = (pred: (r: any) => boolean) => spend.filter(pred).reduce((a, r) => a + n(r.amount), 0);
    const revByCamp = new Map(revenueByCampaign.map((r) => [`${r.campaign ?? ""}|${r.channel}`, n(r.revenue)]));
    const campaigns = new Map<string, { campaign: string; channel: string; leads: number; quotes: number; orders: number; revenue: number; spend: number }>();
    for (const r of byCampaign) campaigns.set(`${r.k}|${r.channel}`, { campaign: r.k, channel: r.channel, leads: r.leads, quotes: r.quotes, orders: r.orders, revenue: 0, spend: 0 });
    for (const r of revenueByCampaign) if (r.campaign) { const k = `${r.campaign}|${r.channel}`; if (!campaigns.has(k)) campaigns.set(k, { campaign: r.campaign, channel: r.channel, leads: 0, quotes: 0, orders: 0, revenue: 0, spend: 0 }); }
    for (const s of spend) if (s.campaign) { const k = `${s.campaign}|${s.channel}`; if (!campaigns.has(k)) campaigns.set(k, { campaign: s.campaign, channel: s.channel, leads: 0, quotes: 0, orders: 0, revenue: 0, spend: 0 }); }
    const roi = (rev: number, sp: number) => (sp > 0 ? +(((rev - sp) / sp) * 100).toFixed(1) : null);
    const campaignRows = [...campaigns.entries()].map(([k, v]) => {
      const revenue = revByCamp.get(k) ?? 0;
      const sp = spendBy((s) => s.campaign === v.campaign && s.channel === v.channel);
      return { ...v, revenue, spend: +sp.toFixed(2), roi: roi(revenue, sp), costPerLead: v.leads && sp ? +(sp / v.leads).toFixed(2) : null };
    }).sort((a, b) => b.revenue - a.revenue || b.leads - a.leads);
    const channelRevenue = new Map<string, number>();
    for (const r of revenueByCampaign) channelRevenue.set(r.channel, (channelRevenue.get(r.channel) ?? 0) + n(r.revenue));
    const channels = new Set<string>([...bySource.map((r) => r.k), ...channelRevenue.keys(), ...spend.map((s) => s.channel)]);
    const sourceRows = [...channels].map((ch) => {
      const r = bySource.find((x) => x.k === ch);
      const revenue = channelRevenue.get(ch) ?? 0;
      const sp = spendBy((s) => s.channel === ch);
      return { channel: ch, leads: r?.leads ?? 0, quotes: r?.quotes ?? 0, orders: r?.orders ?? 0, invoices: r?.invoices ?? 0, revenue, spend: +sp.toFixed(2), roi: roi(revenue, sp), costPerLead: r?.leads && sp ? +(sp / r.leads).toFixed(2) : null };
    }).sort((a, b) => b.leads - a.leads || b.revenue - a.revenue);
    const totalSpend = spend.reduce((a, r) => a + n(r.amount), 0);
    const totalRevenue = [...channelRevenue.values()].reduce((a, b) => a + b, 0);
    return {
      funnel: { leads: n(funnel.leads), quoted: n(funnel.quoted), ordered: n(funnel.ordered), invoiced: n(funnel.invoiced) },
      bySource: sourceRows, byCampaign: campaignRows,
      emails: emails.map((e) => ({ id: Number(e.id), name: e.name as string, utmCampaign: e.utm_campaign as string, sent: e.sent, opened: e.opened, clicked: e.clicked, unsubscribed: e.unsubscribed, revenue: revByCamp.get(`${e.utm_campaign}|email`) ?? 0 })),
      totals: { spend: +totalSpend.toFixed(2), revenue: +totalRevenue.toFixed(2), roi: roi(totalRevenue, totalSpend) },
    };
  }),
});
