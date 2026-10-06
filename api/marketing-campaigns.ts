// Маркетинг М2: контакти и согласност, одјава / suppression, double opt-in, кампањи (рендер, редица, следење).
import crypto from "node:crypto";
import { getPool } from "./queries/connection";
import { getMailer } from "./mail-transport";
import { kvGet, afterIntakeHooks } from "./marketing-leads";
import { hostsOf, escapeHtml, DEFAULT_PUBLIC_ORIGINS } from "@contracts/marketing";
import { parseOrigins } from "@contracts/marketing";
import {
  renderCampaign, addUtm, segmentWhere, SEGMENT_STATS_JOIN, segmentRulesSchema, blockSchema,
  type Block, type BlockProduct, type SegmentRules, type CsvContact,
} from "@contracts/marketing-campaigns";

const q = async (text: string, params: any[] = []) => (await getPool().query(text, params)).rows as any[];
const num = (v: any) => (v == null ? null : Number(v));

// ───────────── тајна, токени, адреси ─────────────

let secretCache: string | null = null;
export async function marketingSecret(): Promise<string> {
  if (process.env.MARKETING_SECRET) return process.env.MARKETING_SECRET;
  if (secretCache) return secretCache;
  let s = await kvGet("marketing_secret");
  if (!s) {
    s = crypto.randomBytes(32).toString("hex");
    await q(`INSERT INTO app_kv (key, value, updated_at) VALUES ('marketing_secret', $1, now()) ON CONFLICT (key) DO NOTHING`, [s]);
    s = (await kvGet("marketing_secret")) ?? s;
  }
  secretCache = s;
  return s;
}
export const __resetSecretCache = () => { secretCache = null; };
export const newToken = () => crypto.randomBytes(18).toString("base64url");
export async function signUrl(token: string, url: string) {
  return crypto.createHmac("sha256", await marketingSecret()).update(`${token}|${url}`).digest("base64url").slice(0, 22);
}
export async function verifyUrl(token: string, url: string, sig: string) {
  const exp = Buffer.from(await signUrl(token, url));
  const got = Buffer.from(sig ?? "");
  return exp.length === got.length && crypto.timingSafeEqual(exp, got);
}
export function appBase(): string {
  return (process.env.APP_URL ?? process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
}
export const ownHosts = () => hostsOf(parseOrigins(process.env.ALLOWED_ORIGINS, DEFAULT_PUBLIC_ORIGINS));

// ───────────── контакти и согласност ─────────────

export type ConsentAction = "granted" | "pending" | "confirmed" | "withdrawn" | "imported";
export async function logConsent(e: { contactId?: number | null; email: string; action: ConsentAction; source?: string | null; ip?: string | null; userAgent?: string | null; note?: string | null; by?: string | null }) {
  await q(`INSERT INTO mkt_consents (contact_id, email, action, source, ip, user_agent, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [e.contactId ?? null, e.email.toLowerCase(), e.action, e.source ?? null, e.ip?.slice(0, 64) ?? null, e.userAgent?.slice(0, 400) ?? null, e.note ?? null, e.by ?? null]);
}

type ContactIn = { email: string; name?: string | null; company?: string | null; phone?: string | null; city?: string | null; country?: string | null; customerId?: number | null; leadId?: number | null; source: string };

/** Вметни или дополни контакт (празните полиња се пополнуваат; согласноста не се менува тука). */
export async function upsertContact(c: ContactIn): Promise<{ id: number; created: boolean; consent: string }> {
  const r = (await q(`INSERT INTO mkt_contacts (email, name, company, phone, city, country, customer_id, lead_id, source)
    VALUES (lower($1),$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT ((lower(email))) DO UPDATE SET
      name = COALESCE(mkt_contacts.name, EXCLUDED.name), company = COALESCE(mkt_contacts.company, EXCLUDED.company),
      phone = COALESCE(mkt_contacts.phone, EXCLUDED.phone), city = COALESCE(mkt_contacts.city, EXCLUDED.city),
      country = COALESCE(mkt_contacts.country, EXCLUDED.country), customer_id = COALESCE(mkt_contacts.customer_id, EXCLUDED.customer_id),
      lead_id = COALESCE(mkt_contacts.lead_id, EXCLUDED.lead_id), updated_at = now()
    RETURNING id, consent_status, (xmax = 0) AS created`,
    [c.email.trim(), c.name ?? null, c.company ?? null, c.phone ?? null, c.city ?? null, c.country ?? null, c.customerId ?? null, c.leadId ?? null, c.source]))[0];
  return { id: Number(r.id), created: !!r.created, consent: r.consent_status };
}

export async function setConsent(contactId: number, status: "none" | "pending" | "granted" | "withdrawn", meta: { source?: string; ip?: string | null; userAgent?: string | null; note?: string; by?: string | null } = {}) {
  const c = (await q(`SELECT id, email, consent_status FROM mkt_contacts WHERE id = $1`, [contactId]))[0];
  if (!c) throw new Error("Контактот не постои");
  if (status === "granted") {
    // изречна согласност ја отстранува одјавата (корисникот самиот се пријавил повторно)
    await q(`UPDATE mkt_contacts SET consent_status = 'granted', consent_at = now(), consent_source = $2, unsubscribed_at = NULL, doi_token = NULL, updated_at = now() WHERE id = $1`, [contactId, meta.source ?? null]);
    await q(`DELETE FROM mkt_suppressions WHERE email = lower($1) AND reason = 'unsubscribe'`, [c.email]);
  } else if (status === "withdrawn") {
    await q(`UPDATE mkt_contacts SET consent_status = 'withdrawn', unsubscribed_at = COALESCE(unsubscribed_at, now()), doi_token = NULL, updated_at = now() WHERE id = $1`, [contactId]);
    await suppress(c.email, "unsubscribe", { note: meta.note });
  } else {
    await q(`UPDATE mkt_contacts SET consent_status = $2, updated_at = now() WHERE id = $1`, [contactId, status]);
  }
  await logConsent({ contactId, email: c.email, action: status === "none" ? "imported" : status === "granted" ? "granted" : status, source: meta.source, ip: meta.ip, userAgent: meta.userAgent, note: meta.note, by: meta.by });
}

export async function suppress(email: string, reason: "unsubscribe" | "bounce" | "complaint" | "manual", o: { campaignId?: number | null; note?: string | null } = {}) {
  await q(`INSERT INTO mkt_suppressions (email, reason, campaign_id, note) VALUES (lower($1),$2,$3,$4) ON CONFLICT (email) DO NOTHING`, [email.trim(), reason, o.campaignId ?? null, o.note ?? null]);
}
export async function isSuppressed(email: string) {
  return (await q(`SELECT 1 FROM mkt_suppressions WHERE email = lower($1)`, [email])).length > 0;
}

/** Публика: клиенти со е-пошта и барања од веб → контакти. Идемпотентно. */
export async function syncAudience() {
  let customers = 0, leads = 0;
  for (const c of await q(`SELECT id, COALESCE(NULLIF(contact_person, ''), name) AS name, company, phone, city, country, email FROM customers
      WHERE email LIKE '%@%' AND COALESCE(is_active, 'active') = 'active'`)) {
    for (const email of String(c.email).split(/[,;\s]+/).filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)).slice(0, 3)) {
      if (await isSuppressed(email)) continue;
      const r = await upsertContact({ email, name: c.name, company: c.company, phone: c.phone, city: c.city, country: c.country, customerId: Number(c.id), source: "customer" });
      if (r.created) customers++;
    }
  }
  for (const l of await q(`SELECT id, name, company, phone, email, consent, customer_id, created_at FROM mkt_leads WHERE status <> 'spam' ORDER BY id`)) {
    if (!l.email || (await isSuppressed(l.email))) continue;
    const r = await upsertContact({ email: l.email, name: l.name, company: l.company, phone: l.phone, customerId: num(l.customer_id), leadId: Number(l.id), source: "lead" });
    if (r.created) leads++;
  }
  return { customers, leads };
}

/** CSV увоз. consent=true значи дека корисникот потврдува изречна согласност (се запишува како извор „csv“). */
export async function importContacts(rows: CsvContact[], o: { consent: boolean; note?: string; by?: string | null }) {
  let added = 0, updated = 0, consented = 0, skipped = 0;
  for (const r of rows) {
    if (await isSuppressed(r.email)) { skipped++; continue; }
    const u = await upsertContact({ ...r, source: "csv" });
    if (u.created) added++; else updated++;
    const give = r.consent ?? o.consent;
    if (give && u.consent !== "granted" && u.consent !== "withdrawn") {
      await setConsent(u.id, "granted", { source: `csv${o.note ? `: ${o.note}` : ""}`, by: o.by });
      consented++;
    } else if (u.created) await logConsent({ contactId: u.id, email: r.email, action: "imported", source: "csv", note: o.note, by: o.by });
  }
  return { added, updated, consented, skipped };
}

// ───────────── double opt-in ─────────────

export async function sendDoi(contactId: number, opts: { force?: boolean } = {}) {
  const c = (await q(`SELECT * FROM mkt_contacts WHERE id = $1`, [contactId]))[0];
  if (!c) throw new Error("Контактот не постои");
  if (c.consent_status === "granted") return { sent: false, reason: "веќе потврдено" };
  if (!opts.force && c.doi_sent_at && Date.now() - new Date(c.doi_sent_at).getTime() < 3600_000) return { sent: false, reason: "пратено пред помалку од 1 час" };
  const base = appBase();
  if (!base) throw new Error("Постави APP_URL (јавна адреса на ERP-то) за линкот за потврда");
  const mailer = await getMailer();
  if (!mailer) throw new Error("Е-поштата за праќање не е поставена");
  const token = c.doi_token ?? newToken();
  await q(`UPDATE mkt_contacts SET doi_token = $2, doi_sent_at = now(), consent_status = CASE WHEN consent_status IN ('none','withdrawn') THEN 'pending' ELSE consent_status END, updated_at = now() WHERE id = $1`, [contactId, token]);
  const company = await companyInfo();
  const url = `${base}/api/public/confirm/${token}`;
  await mailer.send({
    to: c.email,
    subject: `Потврдете ја пријавата за новости — ${company.name}`,
    text: `Почитувани${c.name ? ` ${c.name}` : ""},\n\nПотврдете дека сакате да добивате понуди и новости од ${company.name} по е-пошта:\n${url}\n\nАко не сте се пријавиле вие, игнорирајте ја оваа порака — нема да ви праќаме ништо.\n\n${company.name}`,
    html: `<p>Почитувани${c.name ? ` ${escapeHtml(c.name)}` : ""},</p><p>Потврдете дека сакате да добивате понуди и новости од ${escapeHtml(company.name)} по е-пошта:</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#e8740c;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Потврди пријава</a></p>
<p style="color:#777;font-size:13px">Ако не сте се пријавиле вие, игнорирајте ја оваа порака — нема да ви праќаме ништо.</p><p>${escapeHtml(company.name)}</p>`,
  });
  await logConsent({ contactId, email: c.email, action: "pending", source: "doi_email" });
  return { sent: true };
}

export async function confirmDoi(token: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const c = (await q(`SELECT id FROM mkt_contacts WHERE doi_token = $1`, [token]))[0];
  if (!c) return false;
  await setConsent(Number(c.id), "granted", { source: "double_opt_in", ip: meta.ip, userAgent: meta.userAgent });
  return true;
}

/** Пријава на веб (само е-пошта) → чека потврда. */
export async function subscribe(i: { email: string; name?: string; company?: string; source?: string }, meta: { ip?: string | null; userAgent?: string | null }) {
  const u = await upsertContact({ email: i.email, name: i.name, company: i.company, source: "web" });
  const c = (await q(`SELECT consent_status FROM mkt_contacts WHERE id = $1`, [u.id]))[0];
  if (c.consent_status === "granted") return { id: u.id, alreadyConfirmed: true };
  await logConsent({ contactId: u.id, email: i.email, action: "pending", source: i.source ?? "web_signup", ip: meta.ip, userAgent: meta.userAgent });
  await sendDoi(u.id, { force: true });
  return { id: u.id, alreadyConfirmed: false };
}

/** Барање од веб со штиклирана согласност → контакт + double opt-in (ако е вклучено во поставките). */
export async function leadConsentHook(leadId: number) {
  const l = (await q(`SELECT * FROM mkt_leads WHERE id = $1`, [leadId]))[0];
  if (!l) return;
  const u = await upsertContact({ email: l.email, name: l.name, company: l.company, phone: l.phone, customerId: num(l.customer_id), leadId, source: "lead" });
  if (!l.consent || u.consent === "granted" || (await isSuppressed(l.email))) return;
  const { getMarketingSettings } = await import("./marketing-leads");
  if (!(await getMarketingSettings()).doubleOptIn) {
    await setConsent(u.id, "granted", { source: "lead_form", ip: l.ip, userAgent: l.user_agent, note: `барање #${leadId}` });
    return;
  }
  await logConsent({ contactId: u.id, email: l.email, action: "pending", source: "lead_form", ip: l.ip, userAgent: l.user_agent });
  if (!appBase() || !(await getMailer())) { await q(`UPDATE mkt_contacts SET consent_status = 'pending' WHERE id = $1 AND consent_status = 'none'`, [u.id]); return; }
  await sendDoi(u.id, { force: true });
}
let hookInstalled = false;
export function installLeadConsentHook() {
  if (hookInstalled) return;
  hookInstalled = true;
  afterIntakeHooks.push(leadConsentHook);
}

// ───────────── одјава ─────────────

export async function unsubscribeByToken(token: string, meta: { ip?: string | null; userAgent?: string | null; via: "one_click" | "page" }) {
  const s = (await q(`SELECT id, campaign_id, contact_id, email FROM mkt_sends WHERE token = $1`, [token]))[0];
  if (!s) return null;
  await q(`UPDATE mkt_sends SET unsubscribed_at = COALESCE(unsubscribed_at, now()) WHERE id = $1`, [s.id]);
  await suppress(s.email, "unsubscribe", { campaignId: s.campaign_id });
  const contactId = num(s.contact_id) ?? num((await q(`SELECT id FROM mkt_contacts WHERE lower(email) = lower($1)`, [s.email]))[0]?.id);
  if (contactId) {
    await q(`UPDATE mkt_contacts SET consent_status = 'withdrawn', unsubscribed_at = COALESCE(unsubscribed_at, now()), doi_token = NULL, updated_at = now() WHERE id = $1`, [contactId]);
  }
  await logConsent({ contactId, email: s.email, action: "withdrawn", source: `unsubscribe_${meta.via}`, ip: meta.ip, userAgent: meta.userAgent, note: `кампања #${s.campaign_id}` });
  // известување во ERP (без дупликати по примач)
  const { notify } = await import("./notifications");
  await notify({ kind: "mkt_unsub", title: `Одјава од е-пошта: ${s.email}`, link: `/marketing/publika?q=${encodeURIComponent(s.email)}`, dedupeKey: `mkt_unsub:${s.email.toLowerCase()}` }).catch(() => {});
  return { email: s.email as string };
}

// ───────────── следење ─────────────

export async function trackOpen(token: string) {
  await q(`UPDATE mkt_sends SET open_count = open_count + 1, opened_at = COALESCE(opened_at, now()) WHERE token = $1`, [token]);
}
export async function trackClick(token: string, url: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const s = (await q(`UPDATE mkt_sends SET click_count = click_count + 1, clicked_at = COALESCE(clicked_at, now()), opened_at = COALESCE(opened_at, now()), open_count = GREATEST(open_count, 1)
    WHERE token = $1 RETURNING id`, [token]))[0];
  if (s) await q(`INSERT INTO mkt_clicks (send_id, url, ip, user_agent) VALUES ($1,$2,$3,$4)`, [s.id, url.slice(0, 4000), meta.ip?.slice(0, 64) ?? null, meta.userAgent?.slice(0, 400) ?? null]);
  return !!s;
}

// ───────────── рендерирање ─────────────

export async function companyInfo() {
  const s = (await q(`SELECT * FROM company_settings LIMIT 1`).catch(() => []))[0] ?? {};
  return { name: (s.name as string) || "Serafimoski", address: s.address ?? null, email: s.email ?? null, phone: s.phone ?? null, logoUrl: s.logo_url && /^https:\/\//.test(s.logo_url) ? s.logo_url : null };
}

/** Производи од блоковите, со цена за купувачот (customer_prices → попуст на купувачот → јавна/основна цена). */
export async function blockProducts(blocks: Block[], customerId: number | null): Promise<Record<number, BlockProduct>> {
  const ids = [...new Set(blocks.filter((b): b is Extract<Block, { type: "product" }> => b.type === "product").map((b) => b.productId))];
  if (!ids.length) return {};
  const rows = await q(`SELECT p.id, p.name, p.description, p.image_url, p.web_url, p.public_price, p.default_price,
      cp.price AS cp_price, cp.discount_pct AS cp_disc, cu.discount_pct AS cu_disc
    FROM products p
    LEFT JOIN customer_prices cp ON cp.item_type = 'product' AND cp.ref_id = p.id AND cp.customer_id = $2
    LEFT JOIN customers cu ON cu.id = $2
    WHERE p.id = ANY($1::int[])`, [ids, customerId]);
  const out: Record<number, BlockProduct> = {};
  for (const r of rows) {
    const base = Number(r.default_price ?? 0);
    let price: number | null = r.public_price != null ? Number(r.public_price) : base || null;
    let note = r.public_price != null ? "со ДДВ" : "без ДДВ";
    if (customerId) {
      if (r.cp_price != null) { price = Number(r.cp_price); note = "ваша цена, без ДДВ"; }
      else if (Number(r.cp_disc ?? 0) > 0 && base) { price = +(base * (1 - Number(r.cp_disc) / 100)).toFixed(2); note = "ваша цена, без ДДВ"; }
      else if (Number(r.cu_disc ?? 0) > 0 && base) { price = +(base * (1 - Number(r.cu_disc) / 100)).toFixed(2); note = "ваша цена, без ДДВ"; }
    }
    out[Number(r.id)] = { id: Number(r.id), name: r.name, description: r.description, imageUrl: r.image_url, webUrl: r.web_url, price, priceNote: note };
  }
  return out;
}

type CampaignRow = { id: number; name: string; subject: string; preheader: string | null; reply_to: string | null; blocks: unknown; utm_campaign: string };

/** Порака за еден примач. send=null → преглед / тест (UTM да, без следење). */
export async function renderForRecipient(c: CampaignRow, rcpt: { email: string; name?: string | null; company?: string | null; customerId?: number | null }, send: { token: string } | null) {
  const blocks = (Array.isArray(c.blocks) ? c.blocks : []).map((b) => blockSchema.parse(b));
  const base = appBase();
  const hosts = ownHosts();
  const utm = { source: "newsletter", medium: "email", campaign: c.utm_campaign };
  const signed: Record<string, string> = {};
  const urls: string[] = [];
  // прво ги собираме линковите (рендер без следење), потоа ги потпишуваме
  const link = (u: string, content?: string) => {
    const withUtm = addUtm(u, { ...utm, content }, hosts);
    if (!send || !base) return withUtm;
    urls.push(withUtm);
    return signed[withUtm] ?? withUtm;
  };
  const company = await companyInfo();
  const products = await blockProducts(blocks, rcpt.customerId ?? null);
  const first = (rcpt.name ?? "").trim().split(/\s+/)[0] ?? "";
  const vars = { name: rcpt.name ?? "", first_name: first, company: rcpt.company ?? "", email: rcpt.email, company_name: company.name };
  const unsub = send && base ? `${base}/api/m/u/${send.token}` : `${base || ""}/api/m/u/preview`;
  const ctx = { subject: c.subject, preheader: c.preheader, blocks, products, vars, link, unsubscribeUrl: unsub, company, openPixelUrl: send && base ? `${base}/api/m/o/${send.token}.gif` : null };
  let out = renderCampaign(ctx);
  if (send && base) {
    for (const u of new Set(urls)) signed[u] = `${base}/api/m/c/${send.token}?u=${encodeURIComponent(u)}&s=${await signUrl(send.token, u)}`;
    out = renderCampaign(ctx);
  }
  const headers: Record<string, string> = send && base
    ? { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click", "X-Campaign": `${c.id}` }
    : {};
  return { ...out, headers };
}

// ───────────── публика за кампања / сегмент ─────────────

export function parseRules(v: unknown): SegmentRules {
  return segmentRulesSchema.parse(v ?? {});
}

export async function audience(rules: SegmentRules, opts: { limit?: number; countOnly?: boolean } = {}) {
  const p: unknown[] = [];
  const where = segmentWhere(rules, p);
  if (opts.countOnly) return { count: Number((await q(`SELECT COUNT(*)::int n FROM mkt_contacts c ${SEGMENT_STATS_JOIN} WHERE ${where}`, p))[0].n), rows: [] as any[] };
  const rows = await q(`SELECT c.*, s.last_order, s.revenue FROM mkt_contacts c ${SEGMENT_STATS_JOIN} WHERE ${where} ORDER BY c.id ${opts.limit ? `LIMIT ${Number(opts.limit)}` : ""}`, p);
  return { count: rows.length, rows };
}

async function campaignRules(c: any): Promise<SegmentRules> {
  if (c.segment_id) {
    const s = (await q(`SELECT rules FROM mkt_segments WHERE id = $1`, [c.segment_id]))[0];
    if (s) return parseRules(s.rules);
  }
  return parseRules(c.rules);
}

/** Закажи / започни: ја пополнува редицата (без одјавени и потиснати). Идемпотентно по (кампања, е-пошта). */
export async function queueCampaign(campaignId: number, at?: Date | null) {
  const c = (await q(`SELECT * FROM mkt_campaigns WHERE id = $1`, [campaignId]))[0];
  if (!c) throw new Error("Кампањата не постои");
  if (!["draft", "paused", "scheduled"].includes(c.status)) throw new Error("Кампањата веќе се праќа или е завршена");
  if (!appBase()) throw new Error("Постави APP_URL (јавна адреса на ERP-то) — потребна е за линковите за одјава и следење");
  if (!(Array.isArray(c.blocks) && c.blocks.length)) throw new Error("Кампањата нема содржина");
  const { rows } = await audience(await campaignRules(c));
  let added = 0;
  for (const r of rows) {
    const ins = await q(`INSERT INTO mkt_sends (campaign_id, contact_id, email, token) VALUES ($1,$2,lower($3),$4) ON CONFLICT DO NOTHING RETURNING id`, [campaignId, r.id, r.email, newToken()]);
    if (ins.length) added++;
  }
  const total = Number((await q(`SELECT COUNT(*)::int n FROM mkt_sends WHERE campaign_id = $1`, [campaignId]))[0].n);
  const when = at && at.getTime() > Date.now() ? at : null;
  await q(`UPDATE mkt_campaigns SET status = $2, scheduled_at = $3, recipients = $4, last_error = NULL, updated_at = now() WHERE id = $1`,
    [campaignId, when ? "scheduled" : "sending", when ?? new Date(), total]);
  return { added, total, status: when ? "scheduled" : "sending" };
}

/**
 * Еден чекор од редицата (повикувано од планерот секоја минута).
 * Секоја кампања праќа најмногу rate_per_minute пораки по чекор; барањата се „земаат“ атомски (FOR UPDATE SKIP LOCKED).
 */
export async function processCampaignQueue(now = new Date()) {
  const pool = getPool();
  await q(`UPDATE mkt_campaigns SET status = 'sending', started_at = COALESCE(started_at, now()), updated_at = now() WHERE status = 'scheduled' AND scheduled_at <= $1`, [now]);
  // заглавени (пад на серверот додека праќал) → назад во редица
  await q(`UPDATE mkt_sends SET status = 'queued', claimed_at = NULL WHERE status = 'sending' AND claimed_at < now() - interval '10 minutes'`);
  const campaigns = await q(`SELECT * FROM mkt_campaigns WHERE status = 'sending' ORDER BY id`);
  const result = { sent: 0, failed: 0, skipped: 0, finished: 0 };
  if (!campaigns.length) return result;
  const mailer = await getMailer();
  for (const c of campaigns) {
    if (!c.started_at) await q(`UPDATE mkt_campaigns SET started_at = now() WHERE id = $1`, [c.id]);
    if (!mailer) { await q(`UPDATE mkt_campaigns SET last_error = $2 WHERE id = $1`, [c.id, "Е-поштата за праќање не е поставена"]); continue; }
    const batch = (await pool.query(`UPDATE mkt_sends SET status = 'sending', claimed_at = now(), attempts = attempts + 1
      WHERE id IN (SELECT id FROM mkt_sends WHERE campaign_id = $1 AND status = 'queued' ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED)
      RETURNING *`, [c.id, Math.max(1, Math.min(1000, Number(c.rate_per_minute) || 30))])).rows;
    for (const s of batch) {
      const ct = (await q(`SELECT * FROM mkt_contacts WHERE id = $1`, [s.contact_id]))[0];
      // одјавен / потиснат по закажувањето → прескокни
      if ((await isSuppressed(s.email)) || ct?.unsubscribed_at || ct?.consent_status === "withdrawn") {
        await q(`UPDATE mkt_sends SET status = 'skipped', error = 'одјавен' WHERE id = $1`, [s.id]);
        result.skipped++;
        continue;
      }
      try {
        const m = await renderForRecipient(c, { email: s.email, name: ct?.name, company: ct?.company, customerId: num(ct?.customer_id) }, { token: s.token });
        const r = await mailer.send({ to: s.email, subject: m.subject, html: m.html, text: m.text, headers: m.headers, replyTo: c.reply_to ?? undefined });
        await q(`UPDATE mkt_sends SET status = 'sent', sent_at = now(), message_id = $2, error = NULL WHERE id = $1`, [s.id, r.messageId?.slice(0, 300) ?? null]);
        result.sent++;
      } catch (e: any) {
        const msg = String(e?.message ?? e).slice(0, 500);
        await q(`UPDATE mkt_sends SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END, error = $2, claimed_at = NULL WHERE id = $1`, [s.id, msg]);
        await q(`UPDATE mkt_campaigns SET last_error = $2 WHERE id = $1`, [c.id, msg]);
        result.failed++;
      }
    }
    const left = Number((await q(`SELECT COUNT(*)::int n FROM mkt_sends WHERE campaign_id = $1 AND status IN ('queued','sending')`, [c.id]))[0].n);
    if (!left) {
      await q(`UPDATE mkt_campaigns SET status = 'sent', finished_at = now(), updated_at = now() WHERE id = $1 AND status = 'sending'`, [c.id]);
      result.finished++;
    }
  }
  return result;
}

export async function campaignStats(id: number) {
  const r = (await q(`SELECT COUNT(*)::int total,
      COUNT(*) FILTER (WHERE status = 'queued' OR status = 'sending')::int queued,
      COUNT(*) FILTER (WHERE status = 'sent')::int sent,
      COUNT(*) FILTER (WHERE status = 'failed')::int failed,
      COUNT(*) FILTER (WHERE status = 'skipped')::int skipped,
      COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::int opened,
      COUNT(*) FILTER (WHERE clicked_at IS NOT NULL)::int clicked,
      COUNT(*) FILTER (WHERE unsubscribed_at IS NOT NULL)::int unsubscribed
    FROM mkt_sends WHERE campaign_id = $1`, [id]))[0];
  return r as { total: number; queued: number; sent: number; failed: number; skipped: number; opened: number; clicked: number; unsubscribed: number };
}

installLeadConsentHook();
