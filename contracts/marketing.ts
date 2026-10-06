// Маркетинг — чиста логика (без база): канали/UTM, барања од веб-страницата, спам, прилози, CORS, feed-ови.
import { z } from "zod";

// ───────────── барања (leads) ─────────────

export const LEAD_STATUSES = ["new", "contacted", "quoted", "won", "lost", "spam"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: "Ново", contacted: "Контактирано", quoted: "Понуда", won: "Добиено", lost: "Изгубено", spam: "Спам",
};

export const CHANNELS = ["google_ads", "google", "facebook_ads", "facebook", "instagram_ads", "instagram", "linkedin", "email", "referral", "direct", "other"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<Channel, string> = {
  google_ads: "Google Ads", google: "Google (органско)", facebook_ads: "Facebook реклами", facebook: "Facebook",
  instagram_ads: "Instagram реклами", instagram: "Instagram", linkedin: "LinkedIn", email: "Е-пошта",
  referral: "Друга страница", direct: "Директно", other: "Друго",
};

const PAID = /^(cpc|ppc|paid|paidsocial|paid_social|paid-social|cpm|display|ads?)$/i;

/** Од кој канал дошол посетителот: UTM → gclid/fbclid → referrer. */
export function classifyChannel(i: { utmSource?: string | null; utmMedium?: string | null; gclid?: string | null; fbclid?: string | null; referrer?: string | null; ownHosts?: string[] }): Channel {
  const src = (i.utmSource ?? "").trim().toLowerCase();
  const med = (i.utmMedium ?? "").trim().toLowerCase();
  const paid = PAID.test(med);
  if (i.gclid || (/google|adwords/.test(src) && paid)) return "google_ads";
  if (med === "email" || med === "newsletter" || /newsletter|mailchimp|brevo|e-?mail/.test(src)) return "email";
  if (/^(ig|instagram)/.test(src)) return paid ? "instagram_ads" : "instagram";
  // fbclid го додава Facebook на СЕКОЈ надворешен линк (и органски) — рекламите се препознаваат по utm_medium
  if (/^(fb|facebook|meta)/.test(src)) return paid ? "facebook_ads" : "facebook";
  if (/linkedin|^li$/.test(src)) return "linkedin";
  if (/google/.test(src)) return "google";
  if (src) return paid ? "other" : "referral";
  if (i.fbclid) return "facebook";
  const ref = (i.referrer ?? "").trim();
  if (!ref) return "direct";
  let host = "";
  try { host = new URL(ref).hostname.toLowerCase().replace(/^www\./, ""); } catch { return "other"; }
  if ((i.ownHosts ?? []).some((h) => host === h.replace(/^www\./, ""))) return "direct";
  if (/(^|\.)google\./.test(host)) return "google";
  if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(host) || host === "l.facebook.com" || host === "lm.facebook.com") return "facebook";
  if (/(^|\.)(linkedin\.com|lnkd\.in)$/.test(host)) return "linkedin";
  if (/(mail\.|outlook\.|gmail)/.test(host)) return "email";
  return "referral";
}

const str = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

/** Влез од формуларот на веб-страницата (сите полиња текст — multipart или JSON). */
export const leadInputSchema = z.object({
  company: str(255),
  name: z.string().trim().min(2, "Внесете име").max(160),
  email: z.string().trim().toLowerCase().email("Неважечка е-пошта").max(320),
  phone: str(60),
  productType: str(160),
  quantity: str(60),
  message: str(5000),
  consent: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "true" || v === "1" || v === "on" || v === "yes"),
  utmSource: str(160), utmMedium: str(160), utmCampaign: str(160), utmContent: str(160), utmTerm: str(160),
  gclid: str(255), fbclid: str(255),
  landingPage: str(1000), referrer: str(1000),
  lang: str(10),
});
export type LeadInput = z.output<typeof leadInputSchema>;

/** Имиња на полињата во формуларот (snake_case како во UTM) → полиња во шемата. */
export const LEAD_FIELD_ALIASES: Record<string, keyof LeadInput> = {
  company: "company", name: "name", email: "email", phone: "phone",
  product_type: "productType", productType: "productType", quantity: "quantity", message: "message",
  consent: "consent", marketing_consent: "consent",
  utm_source: "utmSource", utm_medium: "utmMedium", utm_campaign: "utmCampaign", utm_content: "utmContent", utm_term: "utmTerm",
  gclid: "gclid", fbclid: "fbclid", landing_page: "landingPage", landingPage: "landingPage", referrer: "referrer", lang: "lang",
};

export function normalizeLeadFields(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = LEAD_FIELD_ALIASES[k];
    if (key && (typeof v === "string" || typeof v === "boolean")) out[key] = v;
  }
  return out;
}

/** Имиња на скриените полиња против ботови. */
export const HONEYPOT_FIELD = "website";
export const TIMESTAMP_FIELD = "_ts";
export const MIN_FILL_MS = 2500;

/** Хеуристики за спам (меко — се чува со статус „spam“). Honeypot се одбива уште пред ова. */
export function spamReason(i: { message?: string; name?: string; elapsedMs?: number | null }): string | null {
  if (i.elapsedMs != null && i.elapsedMs >= 0 && i.elapsedMs < MIN_FILL_MS) return "пополнето пребрзо";
  const links = ((i.message ?? "").match(/https?:\/\/|www\./gi) ?? []).length;
  if (links > 3) return "премногу линкови";
  if (/https?:\/\//i.test(i.name ?? "")) return "линк во името";
  if (/\b(viagra|casino|crypto ?invest|seo services|backlinks?)\b/i.test(i.message ?? "")) return "спам содржина";
  return null;
}

// ───────────── прилози ─────────────

export const ALLOWED_FILE_EXT = ["pdf", "dxf", "dwg", "step", "stp", "igs", "iges", "png", "jpg", "jpeg"] as const;
export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

export function checkFiles(files: { name: string; size: number }[]): string | null {
  if (files.length > MAX_FILES) return `Најмногу ${MAX_FILES} прилози`;
  let total = 0;
  for (const f of files) {
    const ext = (f.name.split(".").pop() ?? "").toLowerCase();
    if (!(ALLOWED_FILE_EXT as readonly string[]).includes(ext)) return `Недозволен тип датотека: ${f.name} (дозволени: ${ALLOWED_FILE_EXT.join(", ")})`;
    if (f.size > MAX_FILE_BYTES) return `Датотеката ${f.name} е поголема од ${MAX_FILE_BYTES / 1048576} MB`;
    if (f.size <= 0) return `Празна датотека: ${f.name}`;
    total += f.size;
  }
  if (total > MAX_TOTAL_BYTES) return `Прилозите заедно се поголеми од ${MAX_TOTAL_BYTES / 1048576} MB`;
  return null;
}

export const safeFileName = (n: string) => n.replace(/[\\/]+/g, "_").replace(/[^\w\-. ()а-шА-Ш]+/g, "_").slice(0, 200) || "file";

// ───────────── CORS ─────────────

export const DEFAULT_PUBLIC_ORIGINS = ["https://serafimoski.tech", "https://www.serafimoski.tech"];

/** ALLOWED_ORIGINS=„https://a.mk,https://www.a.mk“ (+ стандардно serafimoski.tech и www). */
export function parseOrigins(env?: string | null, defaults: string[] = DEFAULT_PUBLIC_ORIGINS): string[] {
  const list = (env ?? "").split(/[,\s]+/).map((s) => s.trim().replace(/\/+$/, "")).filter((s) => /^https?:\/\/[^/]+$/i.test(s));
  return [...new Set([...defaults, ...list])];
}

export const hostsOf = (origins: string[]) => [...new Set(origins.map((o) => { try { return new URL(o).hostname.replace(/^www\./, ""); } catch { return ""; } }).filter(Boolean))];

// ───────────── атрибуција ─────────────

export type Attribution = { source: Channel; medium: string | null; campaign: string | null };

export function attributionOf(lead: { channel?: string | null; utmMedium?: string | null; utmCampaign?: string | null }): Attribution {
  const ch = (CHANNELS as readonly string[]).includes(lead.channel ?? "") ? (lead.channel as Channel) : "other";
  return { source: ch, medium: lead.utmMedium ?? null, campaign: lead.utmCampaign ?? null };
}

// ───────────── шаблони ─────────────

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

/** {{name}}, {{company}}… Непознатите се бришат. */
export function renderTemplate(tpl: string, vars: Record<string, string | number | null | undefined>, opts: { html?: boolean } = {}) {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    const s = v === null || v === undefined ? "" : String(v);
    return opts.html ? escapeHtml(s) : s;
  });
}

export const DEFAULT_AUTO_REPLY = {
  subject: "Го примивме вашето барање — {{company_name}}",
  body: "Почитувани {{name}},\n\nВи благодариме за барањето{{product_line}}. Ќе ви одговориме со понуда во најкраток рок (обично во рок од 1 работен ден).\n\nАко имате цртежи или дополнителни информации, одговорете на оваа порака.\n\nСо почит,\n{{company_name}}",
};

// ───────────── feed-ови за производи ─────────────

export type FeedProduct = {
  id: number; code: string; name: string; description: string | null; category: string | null;
  showOnWeb: boolean; imageUrl: string | null; webUrl: string | null; publicPrice: number | null; currency?: string;
};

/** Што недостига за производот да влезе во Meta/Google feed. */
export function feedIssues(p: FeedProduct): string[] {
  const out: string[] = [];
  if (!p.showOnWeb) out.push("не е означен за веб");
  if (!p.webUrl || !/^https:\/\//i.test(p.webUrl)) out.push("нема https линк до страница");
  if (!p.imageUrl || !/^https:\/\//i.test(p.imageUrl)) out.push("нема https слика");
  if (!(p.publicPrice && p.publicPrice > 0)) out.push("нема јавна цена");
  if (!(p.description ?? "").trim()) out.push("нема опис");
  return out;
}

const feedPrice = (p: FeedProduct) => `${(p.publicPrice ?? 0).toFixed(2)} ${p.currency ?? "MKD"}`;
const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const xmlEsc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
const oneLine = (s: string | null, max: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Meta (Facebook/Instagram) каталог — CSV. Само производи без проблеми. */
export function buildMetaCsv(products: FeedProduct[], opts: { brand: string }): string {
  const head = ["id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand", "product_type"];
  const rows = products.filter((p) => !feedIssues(p).length).map((p) => [
    p.code, oneLine(p.name, 150), oneLine(p.description, 5000), "in stock", "new", feedPrice(p), p.webUrl!, p.imageUrl!, opts.brand, oneLine(p.category, 750),
  ].map((v) => csvCell(String(v))).join(","));
  return [head.join(","), ...rows].join("\n") + "\n";
}

/** Google Merchant Center — RSS 2.0 со g: полиња. */
export function buildGoogleXml(products: FeedProduct[], opts: { brand: string; title: string; link: string }): string {
  const items = products.filter((p) => !feedIssues(p).length).map((p) => [
    "<item>",
    `<g:id>${xmlEsc(p.code)}</g:id>`,
    `<title>${xmlEsc(oneLine(p.name, 150))}</title>`,
    `<description>${xmlEsc(oneLine(p.description, 5000))}</description>`,
    `<link>${xmlEsc(p.webUrl!)}</link>`,
    `<g:image_link>${xmlEsc(p.imageUrl!)}</g:image_link>`,
    `<g:availability>in_stock</g:availability>`,
    `<g:condition>new</g:condition>`,
    `<g:price>${xmlEsc(feedPrice(p))}</g:price>`,
    `<g:brand>${xmlEsc(opts.brand)}</g:brand>`,
    `<g:identifier_exists>no</g:identifier_exists>`,
    p.category ? `<g:product_type>${xmlEsc(oneLine(p.category, 750))}</g:product_type>` : "",
    "</item>",
  ].filter(Boolean).join(""));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>${xmlEsc(opts.title)}</title><link>${xmlEsc(opts.link)}</link><description>${xmlEsc(opts.title)}</description>\n${items.join("\n")}\n</channel></rss>\n`;
}
