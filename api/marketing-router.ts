// Маркетинг: барања од веб (leads), поставки за автоматски одговор, веб-каталог / feed.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { getPool } from "./queries/connection";
import { LEAD_STATUSES, CHANNELS, feedIssues, type FeedProduct } from "@contracts/marketing";
import {
  mapLead, leadEvent, convertLead, sendLeadAutoReply, getMarketingSettings, marketingSettingsSchema, kvSet, syncAttribution,
} from "./marketing-leads";
import { mailerStatus } from "./mail-transport";

const q = async (text: string, params: any[] = []) => (await getPool().query(text, params)).rows as any[];
const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const httpsUrl = z.string().trim().max(1000).refine((v) => !v || /^https:\/\/\S+$/i.test(v), "Линкот мора да почнува со https://").optional().nullable();

export function feedRow(r: any): FeedProduct & { defaultPrice: number; unit: string; isActive: boolean } {
  return {
    id: Number(r.id), code: r.code, name: r.name, description: r.description, category: r.category, unit: r.unit,
    showOnWeb: !!r.show_on_web, imageUrl: r.image_url, webUrl: r.web_url, publicPrice: r.public_price == null ? null : Number(r.public_price),
    defaultPrice: Number(r.default_price ?? 0), isActive: r.is_active === "active",
  };
}

export const publicBase = (ctx: any) => {
  const env = (process.env.PUBLIC_URL ?? process.env.APP_URL ?? "").replace(/\/$/, "");
  if (env) return env;
  try { const u = new URL(ctx?.req?.url ?? ""); return u.host && u.host !== "test" && u.host !== "internal" ? `${u.protocol}//${u.host}` : ""; } catch { return ""; }
};

export const marketingRouter = createRouter({
  // ───── барања ─────
  leadList: publicQuery.input(z.object({
    status: z.enum(LEAD_STATUSES).optional(), channel: z.enum(CHANNELS).optional(), campaign: z.string().max(160).optional(),
    search: z.string().max(200).optional(), from: dateStr.optional(), to: dateStr.optional(), includeSpam: z.boolean().optional(),
    limit: z.number().int().min(1).max(1000).default(300),
  }).optional()).query(async ({ input }) => {
    const w: string[] = []; const p: any[] = [];
    if (input?.status) { p.push(input.status); w.push(`l.status = $${p.length}`); }
    else if (!input?.includeSpam) w.push(`l.status <> 'spam'`);
    if (input?.channel) { p.push(input.channel); w.push(`l.channel = $${p.length}`); }
    if (input?.campaign) { p.push(input.campaign); w.push(`l.utm_campaign = $${p.length}`); }
    if (input?.from) { p.push(input.from); w.push(`l.created_at >= $${p.length}::date`); }
    if (input?.to) { p.push(input.to); w.push(`l.created_at < $${p.length}::date + 1`); }
    if (input?.search) { p.push(`%${input.search}%`); w.push(`(l.name ILIKE $${p.length} OR l.company ILIKE $${p.length} OR l.email ILIKE $${p.length} OR l.phone ILIKE $${p.length} OR l.product_type ILIKE $${p.length} OR l.message ILIKE $${p.length})`); }
    const rows = await q(`SELECT l.*, COALESCE(c.company, c.name) AS customer, qt.quote_number, (SELECT COUNT(*) FROM mkt_lead_files f WHERE f.lead_id = l.id) AS file_count
      FROM mkt_leads l LEFT JOIN customers c ON c.id = l.customer_id LEFT JOIN quotations qt ON qt.id = l.quotation_id
      ${w.length ? `WHERE ${w.join(" AND ")}` : ""} ORDER BY l.created_at DESC LIMIT ${input?.limit ?? 300}`, p);
    return rows.map(mapLead);
  }),

  leadCounts: publicQuery.query(async () => {
    const rows = await q(`SELECT status, COUNT(*)::int n FROM mkt_leads GROUP BY status`);
    const by: Record<string, number> = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    const campaigns = await q(`SELECT DISTINCT utm_campaign FROM mkt_leads WHERE utm_campaign IS NOT NULL ORDER BY 1 LIMIT 200`);
    return { byStatus: by, open: (by.new ?? 0) + (by.contacted ?? 0), campaigns: campaigns.map((r) => r.utm_campaign as string) };
  }),

  leadById: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const r = (await q(`SELECT l.*, COALESCE(c.company, c.name) AS customer, qt.quote_number FROM mkt_leads l
      LEFT JOIN customers c ON c.id = l.customer_id LEFT JOIN quotations qt ON qt.id = l.quotation_id WHERE l.id = $1`, [input.id]))[0];
    if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Барањето не постои" });
    const files = await q(`SELECT id, file_name, mime, size, created_at FROM mkt_lead_files WHERE lead_id = $1 ORDER BY id`, [input.id]);
    const events = await q(`SELECT * FROM mkt_lead_events WHERE lead_id = $1 ORDER BY created_at DESC, id DESC`, [input.id]);
    const other = await q(`SELECT id, created_at, product_type, status FROM mkt_leads WHERE lower(email) = lower($1) AND id <> $2 ORDER BY created_at DESC LIMIT 10`, [r.email, input.id]);
    return {
      ...mapLead(r),
      files: files.map((f) => ({ id: Number(f.id), name: f.file_name as string, mime: f.mime as string, size: Number(f.size), createdAt: f.created_at })),
      events: events.map((e) => ({ id: Number(e.id), kind: e.kind as string, note: e.note as string | null, by: e.created_by as string | null, at: e.created_at })),
      otherLeads: other.map((o) => ({ id: Number(o.id), createdAt: o.created_at, productType: o.product_type, status: o.status })),
    };
  }),

  leadFileGet: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const f = (await q(`SELECT file_name, mime, data FROM mkt_lead_files WHERE id = $1`, [input.id]))[0];
    if (!f) throw new TRPCError({ code: "NOT_FOUND", message: "Прилогот не постои" });
    return { name: f.file_name as string, mime: f.mime as string, data: f.data as string };
  }),

  leadUpdate: publicQuery.input(z.object({
    id: z.number(), status: z.enum(LEAD_STATUSES).optional(), assignedTo: z.string().max(160).nullable().optional(), notes: z.string().max(10000).nullable().optional(),
  })).mutation(async ({ input, ctx }) => {
    const cur = (await q(`SELECT status, assigned_to FROM mkt_leads WHERE id = $1`, [input.id]))[0];
    if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Барањето не постои" });
    const sets: string[] = []; const p: any[] = [input.id];
    if (input.status !== undefined) { p.push(input.status); sets.push(`status = $${p.length}`); }
    if (input.assignedTo !== undefined) { p.push(input.assignedTo || null); sets.push(`assigned_to = $${p.length}`); }
    if (input.notes !== undefined) { p.push(input.notes || null); sets.push(`notes = $${p.length}`); }
    if (!sets.length) return { success: true };
    await q(`UPDATE mkt_leads SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, p);
    const by = (ctx as any)?.actor?.name ?? null;
    if (input.status && input.status !== cur.status) await leadEvent(input.id, "status", `Статус: ${cur.status} → ${input.status}`, by);
    if (input.assignedTo !== undefined && (input.assignedTo || null) !== cur.assigned_to) await leadEvent(input.id, "assign", `Задолжен: ${input.assignedTo || "—"}`, by);
    return { success: true };
  }),

  leadNoteAdd: publicQuery.input(z.object({ id: z.number(), note: z.string().trim().min(1).max(5000) })).mutation(async ({ input, ctx }) => {
    await leadEvent(input.id, "note", input.note, (ctx as any)?.actor?.name ?? null);
    await q(`UPDATE mkt_leads SET updated_at = now(), status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END WHERE id = $1`, [input.id]);
    return { success: true };
  }),

  leadConvert: publicQuery.input(z.object({ id: z.number(), customerId: z.number().optional(), createQuote: z.boolean().default(true) })).mutation(async ({ input, ctx }) => {
    try { return await convertLead(input.id, ctx, { customerId: input.customerId, createQuote: input.createQuote }); }
    catch (e: any) { throw bad(e?.message ?? "Не успеа претворањето"); }
  }),

  leadAutoReplySend: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    if (!(await mailerStatus()).configured) throw bad("Е-поштата за праќање не е поставена (SMTP / MAIL_PROVIDER).");
    const ok = await sendLeadAutoReply(input.id, true);
    if (!ok) throw bad("Одговорот не е пратен (барањето е спам или не постои)");
    return { success: true };
  }),

  /** GDPR: целосно бришење на барањето и прилозите (само администратор — „delete“). */
  leadDelete: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await q(`UPDATE quotations SET mkt_lead_id = NULL WHERE mkt_lead_id = $1`, [input.id]);
    await q(`DELETE FROM mkt_leads WHERE id = $1`, [input.id]);
    return { success: true };
  }),

  // ───── поставки ─────
  marketingSettingsGet: publicQuery.query(async ({ ctx }) => ({ ...(await getMarketingSettings()), mail: await mailerStatus(), publicBase: publicBase(ctx) })),
  marketingSettingsSave: publicQuery.input(marketingSettingsSchema).mutation(async ({ input }) => {
    await kvSet("marketing", JSON.stringify(input));
    return { success: true };
  }),
  attributionSync: publicQuery.mutation(async () => syncAttribution()),

  // ───── веб-каталог / feed ─────
  feedProductList: publicQuery.input(z.object({ onlyWeb: z.boolean().optional() }).optional()).query(async ({ input }) => {
    const rows = await q(`SELECT * FROM products ${input?.onlyWeb ? "WHERE show_on_web" : ""} ORDER BY show_on_web DESC, name LIMIT 2000`);
    return rows.map((r) => { const p = feedRow(r); return { ...p, issues: feedIssues(p) }; });
  }),
  feedProductSave: publicQuery.input(z.object({
    id: z.number(), showOnWeb: z.boolean(), imageUrl: httpsUrl, webUrl: httpsUrl, publicPrice: z.number().min(0).max(1e9).nullable().optional(), description: z.string().max(5000).nullable().optional(),
  })).mutation(async ({ input }) => {
    const r = await q(`UPDATE products SET show_on_web = $2, image_url = $3, web_url = $4, public_price = $5, description = COALESCE($6, description) WHERE id = $1 RETURNING *`,
      [input.id, input.showOnWeb, input.imageUrl || null, input.webUrl || null, input.publicPrice ?? null, input.description ?? null]);
    if (!r[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Производот не постои" });
    const p = feedRow(r[0]);
    return { ...p, issues: feedIssues(p) };
  }),
  feedInfo: publicQuery.query(async ({ ctx }) => {
    const rows = await q(`SELECT * FROM products WHERE show_on_web`);
    const ready = rows.map(feedRow).filter((p) => !feedIssues(p).length).length;
    const base = publicBase(ctx);
    const key = process.env.FEED_TOKEN ? `?key=${encodeURIComponent(process.env.FEED_TOKEN)}` : "";
    return { onWeb: rows.length, ready, metaUrl: `${base}/api/public/feed/meta.csv${key}`, googleUrl: `${base}/api/public/feed/google.xml${key}`, protectedByToken: !!process.env.FEED_TOKEN };
  }),
});
