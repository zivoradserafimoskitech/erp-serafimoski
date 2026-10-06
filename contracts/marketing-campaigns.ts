// Е-пошта кампањи: блокови на шаблонот, рендерирање во email-safe HTML, UTM, сегменти, CSV увоз. Чиста логика (без база).
import { z } from "zod";
import { escapeHtml, renderTemplate } from "./marketing";

// ───────────── блокови ─────────────

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: z.string().max(300) }),
  z.object({ type: z.literal("text"), text: z.string().max(10000) }),
  z.object({ type: z.literal("button"), label: z.string().max(120), url: z.string().max(1000) }),
  z.object({ type: z.literal("image"), url: z.string().max(1000), alt: z.string().max(300).default(""), link: z.string().max(1000).optional() }),
  z.object({ type: z.literal("product"), productId: z.number().int(), cta: z.string().max(120).optional(), showPrice: z.boolean().default(true) }),
  z.object({ type: z.literal("offer"), title: z.string().max(300), text: z.string().max(3000).default(""), price: z.string().max(60).optional(), oldPrice: z.string().max(60).optional(), url: z.string().max(1000).optional(), cta: z.string().max(120).optional() }),
  z.object({ type: z.literal("divider") }),
]);
export type Block = z.infer<typeof blockSchema>;
export const BLOCK_LABEL: Record<Block["type"], string> = {
  heading: "Наслов", text: "Текст", button: "Копче", image: "Слика", product: "Производ", offer: "Понуда / акција", divider: "Линија",
};

/** Податоци за производ во блок (со цена за конкретниот примач, ако има). */
export type BlockProduct = { id: number; name: string; description: string | null; imageUrl: string | null; webUrl: string | null; price: number | null; priceNote?: string };

export type RenderCtx = {
  subject: string;
  preheader?: string | null;
  blocks: Block[];
  products: Record<number, BlockProduct>;
  vars: Record<string, string | number | null | undefined>;
  /** UTM + следење на клик (за тест-праќање може да е само UTM). */
  link: (url: string, content?: string) => string;
  unsubscribeUrl: string;
  openPixelUrl?: string | null;
  company: { name: string; address?: string | null; email?: string | null; phone?: string | null; logoUrl?: string | null };
  accent?: string;
};

const fmtPrice = (n: number) => `${n.toLocaleString("mk-MK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ден.`;

/** Обичен текст → HTML пасуси: празен ред = нов пасус, линкови стануваат кликливи (со следење), **задебелено**. */
export function textToHtml(text: string, link: (u: string) => string) {
  return text.split(/\n{2,}/).map((para) => {
    let h = escapeHtml(para.trim());
    h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, (u) => `<a href="${escapeHtml(link(u.replace(/&amp;/g, "&")))}" style="color:inherit;text-decoration:underline">${u}</a>`);
    return `<p style="margin:0 0 14px;line-height:1.55">${h.replace(/\n/g, "<br>")}</p>`;
  }).join("");
}

export function renderCampaign(ctx: RenderCtx): { html: string; text: string; subject: string } {
  const accent = ctx.accent ?? "#e8740c";
  const v = (s: string) => renderTemplate(s, ctx.vars);
  const vh = (s: string) => renderTemplate(s, ctx.vars, { html: true });
  const L = (u: string, content?: string) => escapeHtml(ctx.link(u, content));
  const parts: string[] = [];
  const text: string[] = [];
  let n = 0;
  for (const b of ctx.blocks) {
    n++;
    switch (b.type) {
      case "heading":
        parts.push(`<h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#111">${vh(b.text)}</h1>`);
        text.push(v(b.text).toUpperCase(), "");
        break;
      case "text":
        parts.push(`<div style="font-size:15px;color:#333">${textToHtml(v(b.text), (u) => ctx.link(u, `text${n}`))}</div>`);
        text.push(v(b.text), "");
        break;
      case "button":
        if (!b.url) break;
        parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px"><tr><td style="border-radius:6px;background:${accent}"><a href="${L(b.url, `button${n}`)}" style="display:inline-block;padding:12px 22px;color:#fff;font-weight:600;text-decoration:none;font-size:15px">${vh(b.label)}</a></td></tr></table>`);
        text.push(`${v(b.label)}: ${ctx.link(b.url, `button${n}`)}`, "");
        break;
      case "image": {
        if (!b.url) break;
        const img = `<img src="${escapeHtml(b.url)}" alt="${escapeHtml(b.alt ?? "")}" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:6px">`;
        parts.push(`<div style="margin:0 0 18px">${b.link ? `<a href="${L(b.link, `image${n}`)}">${img}</a>` : img}</div>`);
        break;
      }
      case "product": {
        const p = ctx.products[b.productId];
        if (!p) break;
        const url = p.webUrl ? ctx.link(p.webUrl, `product${p.id}`) : null;
        const price = b.showPrice && p.price != null ? `<div style="font-size:18px;font-weight:700;color:${accent};margin:6px 0">${fmtPrice(p.price)}${p.priceNote ? ` <span style="font-size:12px;font-weight:400;color:#666">${escapeHtml(p.priceNote)}</span>` : ""}</div>` : "";
        parts.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border:1px solid #eee;border-radius:8px"><tr>
${p.imageUrl ? `<td width="160" style="padding:12px;vertical-align:top"><img src="${escapeHtml(p.imageUrl)}" alt="" width="136" style="display:block;width:136px;height:auto;border-radius:6px"></td>` : ""}
<td style="padding:12px;vertical-align:top"><div style="font-size:16px;font-weight:700;color:#111">${escapeHtml(p.name)}</div>
${p.description ? `<div style="font-size:14px;color:#555;margin-top:4px;line-height:1.45">${escapeHtml(p.description.slice(0, 300))}</div>` : ""}${price}
${url ? `<a href="${escapeHtml(url)}" style="display:inline-block;margin-top:6px;color:${accent};font-weight:600;text-decoration:none">${escapeHtml(b.cta || "Повеќе →")}</a>` : ""}</td></tr></table>`);
        text.push(`${p.name}${b.showPrice && p.price != null ? ` — ${fmtPrice(p.price)}${p.priceNote ? ` ${p.priceNote}` : ""}` : ""}${url ? `\n${url}` : ""}`, "");
        break;
      }
      case "offer": {
        const url = b.url ? ctx.link(b.url, `offer${n}`) : null;
        parts.push(`<div style="margin:0 0 18px;padding:16px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa">
<div style="font-size:17px;font-weight:700;color:#111">${vh(b.title)}</div>
${b.text ? `<div style="font-size:14px;color:#444;margin-top:6px">${textToHtml(v(b.text), (u) => ctx.link(u, `offer${n}`))}</div>` : ""}
${b.price ? `<div style="margin-top:4px"><span style="font-size:20px;font-weight:700;color:${accent}">${escapeHtml(b.price)}</span>${b.oldPrice ? ` <s style="color:#888">${escapeHtml(b.oldPrice)}</s>` : ""}</div>` : ""}
${url ? `<a href="${escapeHtml(url)}" style="display:inline-block;margin-top:10px;padding:10px 18px;border-radius:6px;background:${accent};color:#fff;font-weight:600;text-decoration:none">${escapeHtml(b.cta || "Побарај понуда")}</a>` : ""}</div>`);
        text.push(`${v(b.title)}${b.price ? ` — ${b.price}` : ""}${b.text ? `\n${v(b.text)}` : ""}${url ? `\n${url}` : ""}`, "");
        break;
      }
      case "divider":
        parts.push(`<hr style="border:0;border-top:1px solid #eee;margin:18px 0">`);
        text.push("———", "");
        break;
    }
  }
  const c = ctx.company;
  const footer = [c.name, c.address, [c.phone, c.email].filter(Boolean).join(" · ")].filter(Boolean).map((x) => escapeHtml(String(x))).join("<br>");
  const pre = ctx.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${vh(ctx.preheader)}</div>` : "";
  const html = `<!doctype html><html lang="mk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(v(ctx.subject))}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border-radius:10px">
${c.logoUrl ? `<tr><td style="padding:20px 20px 0"><img src="${escapeHtml(c.logoUrl)}" alt="${escapeHtml(c.name)}" height="36" style="display:block;height:36px;width:auto;border:0"></td></tr>` : ""}
<tr><td style="padding:20px">${parts.join("\n")}</td></tr>
<tr><td style="padding:16px 20px;border-top:1px solid #eee;font-size:12px;line-height:1.5;color:#777">${footer}<br><br>
Ја добивате оваа порака бидејќи сте наш клиент или се пријавивте за новости. <a href="${escapeHtml(ctx.unsubscribeUrl)}" style="color:#777;text-decoration:underline">Одјава</a></td></tr>
</table></td></tr></table>${ctx.openPixelUrl ? `<img src="${escapeHtml(ctx.openPixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">` : ""}</body></html>`;
  const plain = [...text, "--", c.name, c.address ?? "", "", `Одјава: ${ctx.unsubscribeUrl}`].filter((x) => x !== null).join("\n").replace(/\n{3,}/g, "\n\n");
  return { html, text: plain, subject: v(ctx.subject) };
}

// ───────────── UTM ─────────────

export type Utm = { source: string; medium: string; campaign: string; content?: string };

/** Додава UTM само на линкови кон сопствените домени; постоечките utm_* не се менуваат. Поддржува hash рутирање (#/…). */
export function addUtm(url: string, utm: Utm, ownHosts: string[]): string {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  if (!/^https?:$/.test(u.protocol)) return url;
  const host = u.hostname.replace(/^www\./, "");
  if (!ownHosts.some((h) => host === h.replace(/^www\./, "") || host.endsWith(`.${h.replace(/^www\./, "")}`))) return url;
  const set = (k: string, val?: string) => { if (val && !u.searchParams.has(k)) u.searchParams.set(k, val); };
  set("utm_source", utm.source); set("utm_medium", utm.medium); set("utm_campaign", utm.campaign); set("utm_content", utm.content);
  return u.toString();
}

export const slugify = (s: string) => s.toLowerCase()
  .replace(/[а-шѓќљњџѕјѐѝ]/g, (ch) => CYR[ch] ?? ch)
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "kampanja";
const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", ѓ: "gj", е: "e", ж: "zh", з: "z", ѕ: "dz", и: "i", ј: "j", к: "k", л: "l", љ: "lj", м: "m", н: "n", њ: "nj",
  о: "o", п: "p", р: "r", с: "s", т: "t", ќ: "kj", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", џ: "dj", ш: "sh", ѐ: "e", ѝ: "i",
};

// ───────────── согласност / сегменти ─────────────

export const CONSENT_STATUSES = ["none", "pending", "granted", "withdrawn"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];
export const CONSENT_LABEL: Record<ConsentStatus, string> = { none: "Без согласност", pending: "Чека потврда", granted: "Согласен", withdrawn: "Одјавен" };
export const CONTACT_SOURCES = ["customer", "lead", "csv", "web", "manual"] as const;
export const CONTACT_SOURCE_LABEL: Record<(typeof CONTACT_SOURCES)[number], string> = { customer: "Клиент", lead: "Барање од веб", csv: "CSV увоз", web: "Пријава на веб", manual: "Рачно" };

export const segmentRulesSchema = z.object({
  /** granted = само со изречна согласност; granted_or_customer = + постоечки клиенти што не се одјавиле (soft opt-in) */
  consent: z.enum(["granted", "granted_or_customer"]).default("granted"),
  sources: z.array(z.enum(CONTACT_SOURCES)).max(5).optional(),
  cities: z.array(z.string().max(100)).max(50).optional(),
  countries: z.array(z.string().max(100)).max(50).optional(),
  /** купил производ од овие категории (нарачки) */
  categories: z.array(z.string().max(50)).max(30).optional(),
  lastOrderFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lastOrderTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** нема нарачка во последните N дена (реактивација) */
  noOrderDays: z.number().int().min(1).max(3650).optional(),
  /** вкупно фактурирано (без ДДВ, MKD) */
  minRevenue: z.number().min(0).optional(),
  maxRevenue: z.number().min(0).optional(),
});
export type SegmentRules = z.infer<typeof segmentRulesSchema>;

/** SQL WHERE за mkt_contacts c (со LATERAL статистики s: last_order, revenue). Параметрите се додаваат во p. */
export function segmentWhere(r: SegmentRules, p: unknown[]): string {
  const w: string[] = [
    "c.unsubscribed_at IS NULL",
    "NOT EXISTS (SELECT 1 FROM mkt_suppressions x WHERE x.email = lower(c.email))",
    r.consent === "granted_or_customer" ? "(c.consent_status = 'granted' OR (c.customer_id IS NOT NULL AND c.consent_status = 'none'))" : "c.consent_status = 'granted'",
  ];
  const add = (v: unknown) => { p.push(v); return `$${p.length}`; };
  if (r.sources?.length) w.push(`c.source = ANY(${add(r.sources)}::text[])`);
  if (r.cities?.length) w.push(`lower(COALESCE(c.city, '')) = ANY(${add(r.cities.map((x) => x.trim().toLowerCase()))}::text[])`);
  if (r.countries?.length) w.push(`lower(COALESCE(c.country, '')) = ANY(${add(r.countries.map((x) => x.trim().toLowerCase()))}::text[])`);
  if (r.categories?.length) w.push(`EXISTS (SELECT 1 FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products pr ON pr.id = oi.product_id
    WHERE o.customer_id = c.customer_id AND o.status <> 'cancelled' AND pr.category = ANY(${add(r.categories)}::text[]))`);
  if (r.lastOrderFrom) w.push(`s.last_order >= ${add(r.lastOrderFrom)}::date`);
  if (r.lastOrderTo) w.push(`s.last_order < ${add(r.lastOrderTo)}::date + 1`);
  if (r.noOrderDays) w.push(`(s.last_order IS NULL OR s.last_order < CURRENT_DATE - ${add(r.noOrderDays)}::int)`);
  if (r.minRevenue != null) w.push(`COALESCE(s.revenue, 0) >= ${add(r.minRevenue)}`);
  if (r.maxRevenue != null) w.push(`COALESCE(s.revenue, 0) <= ${add(r.maxRevenue)}`);
  return w.join(" AND ");
}

export const SEGMENT_STATS_JOIN = `LEFT JOIN LATERAL (
  SELECT (SELECT MAX(o.created_at)::date FROM orders o WHERE o.customer_id = c.customer_id AND o.status <> 'cancelled') AS last_order,
         (SELECT SUM(CASE WHEN i.invoice_type = 'credit_note' THEN -ABS(i.subtotal) ELSE i.subtotal END) FROM invoices i
           WHERE i.customer_id = c.customer_id AND i.invoice_type IN ('standard','credit_note') AND i.status NOT IN ('draft','cancelled')) AS revenue
) s ON c.customer_id IS NOT NULL`;

// ───────────── CSV ─────────────

/** Едноставен CSV парсер (запирка или точка-запирка, наводници, BOM). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const HEADER_MAP: Record<string, "email" | "name" | "company" | "city" | "country" | "phone" | "consent"> = {
  email: "email", "e-mail": "email", "е-пошта": "email", "епошта": "email", mail: "email", пошта: "email",
  name: "name", име: "name", "ime": "name", "име и презиме": "name", contact: "name", контакт: "name",
  company: "company", фирма: "company", firma: "company", компанија: "company", organization: "company",
  city: "city", град: "city", grad: "city", country: "country", држава: "country", drzava: "country",
  phone: "phone", телефон: "phone", telefon: "phone", consent: "consent", согласност: "consent", soglasnost: "consent",
};
export const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/i;

export type CsvContact = { email: string; name?: string; company?: string; city?: string; country?: string; phone?: string; consent?: boolean };

export function csvContacts(text: string): { contacts: CsvContact[]; errors: string[] } {
  const rows = parseCsv(text);
  if (!rows.length) return { contacts: [], errors: ["Празна датотека"] };
  const head = rows[0].map((h) => HEADER_MAP[h.trim().toLowerCase()]);
  const hasHeader = head.includes("email");
  const cols = hasHeader ? head : rows[0].map((_, i) => (i === 0 ? "email" : i === 1 ? "name" : i === 2 ? "company" : undefined));
  const errors: string[] = [];
  const seen = new Set<string>();
  const contacts: CsvContact[] = [];
  rows.slice(hasHeader ? 1 : 0).forEach((r, idx) => {
    const c: any = {};
    cols.forEach((k, i) => { if (k && r[i] != null && r[i].trim()) c[k] = r[i].trim(); });
    const line = idx + (hasHeader ? 2 : 1);
    const email = String(c.email ?? "").toLowerCase();
    if (!EMAIL_RE.test(email)) { errors.push(`Ред ${line}: неважечка е-пошта „${c.email ?? ""}“`); return; }
    if (seen.has(email)) return;
    seen.add(email);
    contacts.push({ ...c, email, consent: c.consent != null ? /^(1|да|da|yes|true|y|x)$/i.test(String(c.consent)) : undefined });
  });
  return { contacts, errors: errors.slice(0, 50) };
}

export const CAMPAIGN_STATUSES = ["draft", "scheduled", "sending", "paused", "sent", "cancelled"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Нацрт", scheduled: "Закажана", sending: "Се праќа", paused: "Паузирана", sent: "Пратена", cancelled: "Откажана",
};
