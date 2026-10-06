// Јавни адреси за веб-страницата (без најава): прием на барања од формата и product feed за Meta / Google.
// Се регистрираат ПРЕД главниот CORS/tRPC во railway.ts, со свој CORS (ALLOWED_ORIGINS).
import type { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import {
  parseOrigins, hostsOf, HONEYPOT_FIELD, TIMESTAMP_FIELD, MAX_TOTAL_BYTES, buildMetaCsv, buildGoogleXml, escapeHtml,
} from "@contracts/marketing";
import type { IncomingFile } from "./marketing-leads";

export const publicOrigins = () => parseOrigins(process.env.ALLOWED_ORIGINS);
const ipOf = (c: any) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local";

/** Едноставен лимит по IP (во меморија — доволно за една инстанца). */
export function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return {
    hit(key: string, now = Date.now()) {
      const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (arr.length >= max) { hits.set(key, arr); return false; }
      arr.push(now); hits.set(key, arr);
      if (hits.size > 10_000) hits.clear();
      return true;
    },
    reset() { hits.clear(); },
  };
}
const leadLimit = () => Math.max(1, Number(process.env.LEAD_RATE_LIMIT ?? 5) || 5);
export const leadRate = rateLimiter(leadLimit(), 10 * 60_000);

function safeRedirect(target: unknown, origins: string[]): string | null {
  if (typeof target !== "string" || !target) return null;
  try { const u = new URL(target); return origins.includes(u.origin) ? u.toString() : null; } catch { return null; }
}
const withParam = (url: string, k: string, v: string) => { const u = new URL(url); u.searchParams.set(k, v); return u.toString(); };

function c0html(title: string, body: string) {
  return `<!doctype html><html lang="mk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<body style="font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;color:#222;line-height:1.5"><h1 style="font-size:22px">${escapeHtml(title)}</h1>${body}</body></html>`;
}

function thanksPage(ok: boolean, msg: string) {
  return `<!doctype html><html lang="mk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${ok ? "Благодариме" : "Грешка"}</title>
<body style="font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 20px;color:#222"><h1 style="font-size:22px">${ok ? "Благодариме!" : "Барањето не е испратено"}</h1><p>${escapeHtml(msg)}</p><p><a href="javascript:history.back()">← Назад</a></p></body></html>`;
}

async function readLeadBody(c: any): Promise<{ fields: Record<string, unknown>; files: IncomingFile[]; isForm: boolean }> {
  const ct = String(c.req.header("content-type") ?? "").toLowerCase();
  const files: IncomingFile[] = [];
  const fields: Record<string, unknown> = {};
  if (ct.includes("application/json")) {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return { fields, files, isForm: false };
    for (const [k, v] of Object.entries(body)) if (k !== "files") fields[k] = v;
    for (const f of Array.isArray((body as any).files) ? (body as any).files : []) {
      if (!f || typeof f.data !== "string" || typeof f.name !== "string") continue;
      const m = /^data:([^;]+);base64,(.*)$/s.exec(f.data);
      files.push({ name: f.name, mime: String(f.mime ?? m?.[1] ?? "application/octet-stream"), data: Buffer.from(m ? m[2] : f.data, "base64") });
    }
    return { fields, files, isForm: false };
  }
  const body = await c.req.parseBody({ all: true });
  for (const [k, v] of Object.entries(body)) {
    const vals = Array.isArray(v) ? v : [v];
    for (const x of vals) {
      if (typeof x === "string") { if (fields[k] === undefined) fields[k] = x; }
      else if (x && typeof (x as any).arrayBuffer === "function") {
        const file = x as File;
        if (!file.name || file.size === 0) continue; // празно поле за датотека
        files.push({ name: file.name, mime: file.type || "application/octet-stream", data: Buffer.from(await file.arrayBuffer()) });
      }
    }
  }
  return { fields, files, isForm: true };
}

export function registerMarketingPublic(app: Hono) {
  app.use("/api/public/*", cors({
    origin: (origin) => (publicOrigins().includes(origin) ? origin : null),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Accept"],
    maxAge: 86400,
  }));

  app.post("/api/public/lead",
    bodyLimit({ maxSize: Math.ceil(MAX_TOTAL_BYTES * 1.4) + 1_000_000, onError: (c) => c.json({ ok: false, error: "Прилозите се преголеми" }, 413) }),
    async (c) => {
      const origins = publicOrigins();
      const wantsHtml = (c.req.header("accept") ?? "").includes("text/html");
      const ip = ipOf(c);
      if (!leadRate.hit(ip)) return c.json({ ok: false, error: "Премногу барања. Обидете се повторно за неколку минути." }, 429);

      let parsed: Awaited<ReturnType<typeof readLeadBody>>;
      try { parsed = await readLeadBody(c); } catch { return c.json({ ok: false, error: "Неважечко барање" }, 400); }
      const { fields, files, isForm } = parsed;
      const redirect = safeRedirect(fields._redirect, origins);
      const respond = (ok: boolean, status: 200 | 400, body: Record<string, unknown>) => {
        if (redirect) return c.redirect(withParam(redirect, "lead", ok ? "ok" : "error"), 303);
        if (isForm && wantsHtml) return c.html(thanksPage(ok, ok ? "Вашето барање е примено. Ќе ве контактираме наскоро." : String(body.error ?? "")), status);
        return c.json(body, status);
      };

      // honeypot: ботот добива „успех“, ништо не се зачувува
      if (String(fields[HONEYPOT_FIELD] ?? "").trim()) return respond(true, 200, { ok: true });

      const ts = Number(fields[TIMESTAMP_FIELD]);
      const elapsedMs = Number.isFinite(ts) && ts > 1e12 && Date.now() - ts < 86_400_000 * 2 ? Date.now() - ts : null;
      const { intakeLead } = await import("./marketing-leads");
      const r = await intakeLead(fields, files, { ip, userAgent: c.req.header("user-agent") ?? null, elapsedMs, ownHosts: hostsOf(origins) });
      if (!r.ok) return respond(false, 400, { ok: false, error: r.error });
      return respond(true, 200, { ok: true, id: r.spam ? undefined : r.id });
    });

  // ───── е-пошта кампањи: пиксел за отворање, клик, одјава, double opt-in ─────
  const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  app.get("/api/m/o/:file", async (c) => {
    const token = c.req.param("file").replace(/\.gif$/, "");
    const { trackOpen } = await import("./marketing-campaigns");
    await trackOpen(token).catch(() => {});
    return c.body(GIF, 200, { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate, private" });
  });
  app.get("/api/m/c/:token", async (c) => {
    const token = c.req.param("token"), url = c.req.query("u") ?? "", sig = c.req.query("s") ?? "";
    const { verifyUrl, trackClick } = await import("./marketing-campaigns");
    const fallback = process.env.PUBLIC_SITE_URL || "https://serafimoski.tech";
    if (!/^https?:\/\//i.test(url) || !(await verifyUrl(token, url, sig).catch(() => false))) return c.redirect(fallback, 302);
    await trackClick(token, url, { ip: ipOf(c), userAgent: c.req.header("user-agent") ?? null }).catch(() => {});
    return c.redirect(url, 302);
  });
  const unsubPage = (title: string, body: string) => c0html(title, body);
  app.get("/api/m/u/:token", async (c) => {
    const token = c.req.param("token");
    if (token === "preview") return c.html(unsubPage("Одјава", "<p>Ова е преглед — линкот за одјава работи во вистинската порака.</p>"));
    return c.html(unsubPage("Одјава од е-пошта", `<p>Дали сакате да не добивате повеќе пораки со понуди и новости?</p>
<form method="POST"><button type="submit" style="padding:12px 20px;border:0;border-radius:8px;background:#0f172a;color:#fff;font:inherit;font-weight:600;cursor:pointer">Одјави ме</button></form>`));
  });
  app.post("/api/m/u/:token", async (c) => {
    const { unsubscribeByToken } = await import("./marketing-campaigns");
    // RFC 8058: поштенскиот клиент праќа List-Unsubscribe=One-Click; формата од страницата праќа празно тело
    const body = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    const oneClick = String((body as any)["List-Unsubscribe"] ?? "") === "One-Click";
    const r = await unsubscribeByToken(c.req.param("token"), { ip: ipOf(c), userAgent: c.req.header("user-agent") ?? null, via: oneClick ? "one_click" : "page" });
    if (oneClick) return c.text(r ? "unsubscribed" : "not found", r ? 200 : 404);
    return c.html(unsubPage("Одјавени сте", r ? `<p>Адресата <b>${escapeHtml(r.email)}</b> е одјавена. Нема повеќе да добивате маркетинг пораки од нас.</p><p style="font-size:13px;opacity:.7">Ако сте се одјавиле по грешка, пишете ни и ќе ве вратиме.</p>` : "<p>Линкот не важи.</p>"), r ? 200 : 404);
  });

  const subRate = rateLimiter(5, 10 * 60_000);
  app.post("/api/public/subscribe", async (c) => {
    if (!subRate.hit(ipOf(c))) return c.json({ ok: false, error: "Премногу обиди. Обидете се за неколку минути." }, 429);
    const ct = String(c.req.header("content-type") ?? "");
    const b: any = ct.includes("application/json") ? await c.req.json().catch(() => ({})) : await c.req.parseBody().catch(() => ({}));
    if (String(b?.[HONEYPOT_FIELD] ?? "").trim()) return c.json({ ok: true });
    const email = String(b?.email ?? "").trim().toLowerCase();
    const { EMAIL_RE } = await import("@contracts/marketing-campaigns");
    if (!EMAIL_RE.test(email) || email.length > 320) return c.json({ ok: false, error: "Неважечка е-пошта" }, 400);
    const { subscribe } = await import("./marketing-campaigns");
    try {
      const r = await subscribe({ email, name: b?.name ? String(b.name).slice(0, 160) : undefined, company: b?.company ? String(b.company).slice(0, 255) : undefined }, { ip: ipOf(c), userAgent: c.req.header("user-agent") ?? null });
      return c.json({ ok: true, confirmed: r.alreadyConfirmed, message: r.alreadyConfirmed ? "Веќе сте пријавени." : "Проверете ја е-поштата и потврдете ја пријавата." });
    } catch (e: any) {
      console.error("[MKT] subscribe:", e?.message ?? e);
      return c.json({ ok: false, error: "Пријавата моментално не е достапна. Обидете се подоцна." }, 503);
    }
  });
  app.get("/api/public/confirm/:token", async (c) => {
    const { confirmDoi } = await import("./marketing-campaigns");
    const ok = await confirmDoi(c.req.param("token"), { ip: ipOf(c), userAgent: c.req.header("user-agent") ?? null });
    return c.html(unsubPage(ok ? "Пријавата е потврдена" : "Линкот не важи", ok
      ? "<p>Благодариме! Ќе добивате понуди и новости по е-пошта. Може да се одјавите во секое време преку линкот во секоја порака.</p>"
      : "<p>Линкот за потврда не важи или е веќе искористен.</p>"), ok ? 200 : 404);
  });

  const feedAllowed = (c: any) => !process.env.FEED_TOKEN || c.req.query("key") === process.env.FEED_TOKEN;
  const feedData = async () => {
    const { getPool } = await import("./queries/connection");
    const { feedRow } = await import("./marketing-router");
    const rows = (await getPool().query(`SELECT * FROM products WHERE show_on_web AND COALESCE(is_active, 'active') = 'active' ORDER BY id`)).rows;
    const company = (await getPool().query(`SELECT name FROM company_settings LIMIT 1`).catch(() => ({ rows: [] as any[] }))).rows[0]?.name;
    return { products: rows.map(feedRow), brand: process.env.FEED_BRAND || company || "Serafimoski" };
  };
  app.get("/api/public/feed/meta.csv", async (c) => {
    if (!feedAllowed(c)) return c.text("Forbidden", 403);
    const { products, brand } = await feedData();
    return c.body(buildMetaCsv(products, { brand }), 200, { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "public, max-age=900" });
  });
  app.get("/api/public/feed/google.xml", async (c) => {
    if (!feedAllowed(c)) return c.text("Forbidden", 403);
    const { products, brand } = await feedData();
    const link = (process.env.PUBLIC_SITE_URL || "https://serafimoski.tech").replace(/\/$/, "");
    return c.body(buildGoogleXml(products, { brand, title: `${brand} — производи`, link }), 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=900" });
  });
}
