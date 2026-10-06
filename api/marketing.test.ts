// Маркетинг (барања од веб): интеграциски тест на вистинска Postgres база, во посебна шема mkt_test
// (за да не се судира со api/integration.test.ts што ја брише public шемата).
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/erp_test npm test
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const SCHEMA = "mkt_test";

describe.skipIf(!url)("маркетинг: прием на барања, атрибуција, feed", () => {
  let caller: any;
  let app: any;
  let q: (sql: string, p?: any[]) => Promise<any[]>;
  const sent: any[] = [];
  let ipN = 0;
  const nextIp = () => `10.0.0.${++ipN}`;
  const post = (body: FormData | object, opts: { ip?: string; origin?: string; accept?: string } = {}) => {
    const headers: Record<string, string> = { "x-forwarded-for": opts.ip ?? nextIp() };
    if (opts.origin) headers.origin = opts.origin;
    if (opts.accept) headers.accept = opts.accept;
    if (body instanceof FormData) return app.request("/api/public/lead", { method: "POST", body, headers });
    return app.request("/api/public/lead", { method: "POST", body: JSON.stringify(body), headers: { ...headers, "content-type": "application/json" } });
  };
  const form = (fields: Record<string, string>, files: File[] = []) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    for (const file of files) f.append("files", file);
    return f;
  };
  const ago = (ms: number) => String(Date.now() - ms);

  beforeAll(async () => {
    const { Client } = await import("pg");
    const admin = new Client({ connectionString: url, ssl: false });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
    await admin.end();
    process.env.DATABASE_URL = `${url}${url!.includes("?") ? "&" : "?"}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;
    process.env.DATABASE_SSL = "false";
    delete process.env.APP_PASSWORD;
    process.env.DISABLE_USER_GATE = "true";
    process.env.DISABLE_AUTO_LEDGER = "true";
    process.env.ALLOWED_ORIGINS = "https://partner.example";
    delete process.env.FEED_TOKEN;
    const { getPool } = await import("./queries/connection");
    const pool = getPool();
    for (const k of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "MAIL_PROVIDER"]) delete process.env[k];
    const { getInitSql } = await import("./init-db-sql");
    for (const stmt of getInitSql()) {
      try { await pool.query(stmt); } catch (e: any) { if (!["42P07", "42710", "42701"].includes(e.code)) throw new Error(`${e.message}\n${stmt.slice(0, 200)}`); }
    }
    q = async (sql, p = []) => (await pool.query(sql, p)).rows;
    expect((await q(`SELECT current_schema() s`))[0].s).toBe(SCHEMA);
    const { __setTestMailer } = await import("./mail-transport");
    __setTestMailer({ provider: "test", source: "test", from: "Серафимоски <ponudi@serafimoski.tech>", send: async (m) => { sent.push(m); return { messageId: `t${sent.length}` }; } });
    const { appRouter } = await import("./router");
    caller = appRouter.createCaller({ req: new Request("http://test"), resHeaders: new Headers(), actor: { id: null, name: "test", role: "admin" } } as any);
    const { Hono } = await import("hono");
    const { registerMarketingPublic } = await import("./marketing-public");
    app = new Hono();
    registerMarketingPublic(app);
  });

  afterAll(async () => {
    const { __setTestMailer } = await import("./mail-transport");
    __setTestMailer(null);
  });

  it("CORS: serafimoski.tech, www и ALLOWED_ORIGINS — да; туѓ домен — не", async () => {
    const pre = (origin: string) => app.request("/api/public/lead", { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST" } });
    for (const o of ["https://serafimoski.tech", "https://www.serafimoski.tech", "https://partner.example"]) {
      expect((await pre(o)).headers.get("access-control-allow-origin")).toBe(o);
    }
    expect((await pre("https://evil.example")).headers.get("access-control-allow-origin")).toBeNull();
  });

  it("multipart барање со цртеж: UTM, согласност, прилог, известување и автоматски одговор", async () => {
    const dxf = new File(["0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n"], "nosac.dxf", { type: "application/dxf" });
    const res = await post(form({
      company: "Метал Про ДОО", name: "Марко Петровски", email: "Marko@MetalPro.mk", phone: "+389 70 111 222",
      product_type: "Ласерско сечење", quantity: "200 парчиња", message: "Ве молам понуда за носачи 3 мм.",
      marketing_consent: "on", utm_source: "google", utm_medium: "cpc", utm_campaign: "laser-oktomvri", utm_term: "laser secenje skopje",
      gclid: "Cj0KCQ", landing_page: "https://serafimoski.tech/?utm_source=google#/laser", referrer: "https://www.google.com/",
      website: "", _ts: ago(15_000),
    }, [dxf]), { origin: "https://serafimoski.tech" });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://serafimoski.tech");
    const body = await res.json();
    expect(body.ok).toBe(true);
    const lead = (await q(`SELECT * FROM mkt_leads WHERE id = $1`, [body.id]))[0];
    expect(lead).toMatchObject({ status: "new", email: "marko@metalpro.mk", channel: "google_ads", utm_campaign: "laser-oktomvri", utm_term: "laser secenje skopje", consent: true, gclid: "Cj0KCQ" });
    expect(lead.ip).toMatch(/^10\.0\.0\./);
    const files = await q(`SELECT file_name, size, data FROM mkt_lead_files WHERE lead_id = $1`, [body.id]);
    expect(files).toHaveLength(1);
    expect(files[0].file_name).toBe("nosac.dxf");
    expect(Buffer.from(files[0].data, "base64").toString()).toContain("ENTITIES");

    const notes = await caller.notifications.notificationList();
    expect(notes.unread).toBeGreaterThanOrEqual(1);
    expect(notes.items[0]).toMatchObject({ kind: "lead_new", link: `/marketing/baranja?id=${body.id}` });

    await vi.waitFor(() => expect(sent.some((m) => m.to === "marko@metalpro.mk")).toBe(true), { timeout: 5000 });
    const mail = sent.find((m) => m.to === "marko@metalpro.mk");
    expect(mail.subject).toContain("Серафимоски");
    expect(mail.text).toContain("Марко Петровски");
    expect(mail.text).toContain("„Ласерско сечење“");
    await vi.waitFor(async () => expect((await q(`SELECT auto_reply_at FROM mkt_leads WHERE id = $1`, [body.id]))[0].auto_reply_at).not.toBeNull());

    const detail = await caller.marketing.leadById({ id: body.id });
    expect(detail.files[0]).toMatchObject({ name: "nosac.dxf" });
    expect(detail.events.map((e: any) => e.kind)).toContain("created");
    const f = await caller.marketing.leadFileGet({ id: detail.files[0].id });
    expect(Buffer.from(f.data, "base64").toString()).toContain("EOF");
  });

  it("повторно праќање (двоен клик) не создава ново барање", async () => {
    const fields = { name: "Ана Ристова", email: "ana@example.mk", message: "Понуда за ограда", _ts: ago(9000) };
    const a = await (await post(form(fields))).json();
    const b = await (await post(form(fields))).json();
    expect(b.id).toBe(a.id);
    expect((await q(`SELECT COUNT(*)::int n FROM mkt_leads WHERE email = 'ana@example.mk'`))[0].n).toBe(1);
  });

  it("JSON со base64 прилог и referrer → Facebook", async () => {
    const res = await post({ name: "Јован", email: "jovan@x.mk", productType: "Ограда", consent: false, referrer: "https://l.facebook.com/", _ts: ago(5000),
      files: [{ name: "skica.pdf", mime: "application/pdf", data: `data:application/pdf;base64,${Buffer.from("%PDF-1.4 test").toString("base64")}` }] });
    const body = await res.json();
    expect(res.status).toBe(200);
    const lead = (await q(`SELECT channel, consent FROM mkt_leads WHERE id = $1`, [body.id]))[0];
    expect(lead).toEqual({ channel: "facebook", consent: false });
    expect((await q(`SELECT size FROM mkt_lead_files WHERE lead_id = $1`, [body.id]))[0].size).toBe(13);
  });

  it("валидација: недозволен прилог, без е-пошта", async () => {
    const r1 = await post(form({ name: "Тест Тест", email: "t@t.mk", _ts: ago(9000) }, [new File(["MZ"], "setup.exe")]));
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toMatch(/Недозволен/);
    const r2 = await post(form({ name: "Тест Тест", email: "ne-e-adresa", _ts: ago(9000) }));
    expect(r2.status).toBe(400);
    expect(await q(`SELECT 1 FROM mkt_leads WHERE name = 'Тест Тест'`)).toHaveLength(0);
  });

  it("honeypot: бот добива „ok“, ништо не се зачувува", async () => {
    const before = (await q(`SELECT COUNT(*)::int n FROM mkt_leads`))[0].n;
    const res = await post(form({ name: "Bot Bot", email: "bot@spam.io", website: "http://spam.io", _ts: ago(9000) }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect((await q(`SELECT COUNT(*)::int n FROM mkt_leads`))[0].n).toBe(before);
  });

  it("пребрзо пополнето → зачувано како спам, без известување и без одговор", async () => {
    const sentBefore = sent.length;
    const res = await post(form({ name: "Брз Бот", email: "fast@bot.io", message: "hi", _ts: ago(300) }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBeUndefined();
    const lead = (await q(`SELECT id, status, spam_reason FROM mkt_leads WHERE email = 'fast@bot.io'`))[0];
    expect(lead.status).toBe("spam");
    expect(lead.spam_reason).toMatch(/пребрзо/);
    expect(await q(`SELECT 1 FROM app_notifications WHERE dedupe_key = $1`, [`lead_new:${lead.id}`])).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 200));
    expect(sent.length).toBe(sentBefore);
    expect((await caller.marketing.leadList()).some((l: any) => l.id === lead.id)).toBe(false);
    expect((await caller.marketing.leadList({ status: "spam" })).some((l: any) => l.id === lead.id)).toBe(true);
  });

  it("_redirect: само кон дозволен домен (303), HTML без JS добива страница за благодарност", async () => {
    const r = await post(form({ name: "Елена", email: "elena@x.mk", _ts: ago(9000), _redirect: "https://www.serafimoski.tech/#/blagodarime" }));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toContain("lead=ok");
    const evil = await post(form({ name: "Елена2", email: "elena2@x.mk", _ts: ago(9000), _redirect: "https://evil.example/" }), { accept: "text/html" });
    expect(evil.status).toBe(200);
    expect(await evil.text()).toContain("Благодариме");
  });

  it("ограничување по IP: 6-тото барање за 10 мин → 429", async () => {
    const ip = "192.0.2.77";
    for (let i = 0; i < 5; i++) expect((await post(form({ name: "X", email: "x" }), { ip })).status).toBe(400);
    expect((await post(form({ name: "Лимит Тест", email: "limit@x.mk", _ts: ago(9000) }), { ip })).status).toBe(429);
    expect((await post(form({ name: "Лимит Тест", email: "limit@x.mk", _ts: ago(9000) }), { ip: "192.0.2.78" })).status).toBe(200);
  });

  it("претворање: купувач + понуда со извор → нарачка → фактура (атрибуција по тек)", async () => {
    await caller.quotation.productCreate({ name: "Ласерско сечење", code: "LS-1", category: "other", unit: "pcs", basis: "pcs", totalCost: "50" });
    await q(`UPDATE products SET public_price = 120 WHERE code = 'LS-1'`);
    const lead = (await q(`SELECT id FROM mkt_leads WHERE email = 'marko@metalpro.mk'`))[0];
    const r = await caller.marketing.leadConvert({ id: lead.id });
    expect(r.createdCustomer).toBe(true);
    expect(r.quotationId).toBeGreaterThan(0);
    const cust = (await q(`SELECT * FROM customers WHERE id = $1`, [r.customerId]))[0];
    expect(cust).toMatchObject({ name: "Метал Про ДОО", contact_person: "Марко Петровски", email: "marko@metalpro.mk" });
    const quote = await caller.quotation.quotationById({ id: r.quotationId });
    expect(quote).toMatchObject({ mktSource: "google_ads", mktMedium: "cpc", mktCampaign: "laser-oktomvri", mktLeadId: lead.id, status: "draft" });
    expect(quote.items).toHaveLength(1);
    expect(Number(quote.items[0].quantity)).toBe(200);
    expect(Number(quote.items[0].unitPrice)).toBe(120);
    expect((await caller.marketing.leadById({ id: lead.id })).status).toBe("quoted");
    // втор пат — нема втора понуда
    const again = await caller.marketing.leadConvert({ id: lead.id });
    expect(again.quotationId).toBe(r.quotationId);
    expect(again.createdCustomer).toBe(false);

    const conv = await caller.quotation.quotationConvert({ quotationId: r.quotationId, orderNumber: "НР-MKT-1" });
    const order = (await q(`SELECT * FROM orders WHERE id = $1`, [conv.orderId]))[0];
    expect(order).toMatchObject({ mkt_source: "google_ads", mkt_campaign: "laser-oktomvri", mkt_lead_id: lead.id });
    expect((await caller.marketing.leadById({ id: lead.id })).status).toBe("won");

    const next = await caller.accounting.nextInvoiceNumber();
    const inv = await caller.accounting.invoiceCreate({ invoiceNumber: next, customerId: r.customerId, orderId: conv.orderId, issueDate: new Date().toISOString().slice(0, 10),
      subtotal: "24000", vatRate: "18", vatAmount: "4320", totalAmount: "28320" });
    const invRow = (await q(`SELECT mkt_source, mkt_campaign, mkt_lead_id FROM invoices WHERE id = $1`, [inv.id]))[0];
    expect(invRow).toEqual({ mkt_source: "google_ads", mkt_campaign: "laser-oktomvri", mkt_lead_id: lead.id });
    // идемпотентно
    const { syncAttribution } = await import("./marketing-leads");
    expect(await syncAttribution()).toEqual({ orders: 0, invoices: 0, won: 0 });
  });

  it("спам барање не може да се претвори; постоечки купувач се поврзува по е-пошта", async () => {
    const spam = (await q(`SELECT id FROM mkt_leads WHERE email = 'fast@bot.io'`))[0];
    await expect(caller.marketing.leadConvert({ id: spam.id })).rejects.toThrow(/спам/);
    const ana = (await q(`SELECT id FROM mkt_leads WHERE email = 'ana@example.mk'`))[0];
    const c = await caller.customers.customerCreate({ name: "Ана Ристова", email: "ANA@example.mk" });
    const r = await caller.marketing.leadConvert({ id: ana.id, createQuote: false });
    expect(r.customerId).toBe(c.id ?? r.customerId);
    expect(r.createdCustomer).toBe(false);
    expect(r.quotationId).toBeNull();
  });

  it("статус, белешка, рачен одговор, бришење (GDPR)", async () => {
    const lead = (await q(`SELECT id FROM mkt_leads WHERE email = 'jovan@x.mk'`))[0];
    await caller.marketing.leadUpdate({ id: lead.id, status: "contacted", assignedTo: "Андреј" });
    await caller.marketing.leadNoteAdd({ id: lead.id, note: "Се јавив" });
    const n = sent.length;
    await caller.marketing.leadAutoReplySend({ id: lead.id });
    expect(sent.length).toBe(n + 1);
    const d = await caller.marketing.leadById({ id: lead.id });
    expect(d).toMatchObject({ status: "contacted", assignedTo: "Андреј" });
    expect(d.events.map((e: any) => e.kind)).toEqual(expect.arrayContaining(["status", "assign", "note", "auto_reply"]));
    await caller.marketing.leadDelete({ id: lead.id });
    expect(await q(`SELECT 1 FROM mkt_lead_files f WHERE f.lead_id = $1`, [lead.id])).toHaveLength(0);
  });

  it("поставки за автоматски одговор: исклучено → не се праќа", async () => {
    const s = await caller.marketing.marketingSettingsGet();
    expect(s.autoReply.enabled).toBe(true);
    expect(s.mail.configured).toBe(true);
    await caller.marketing.marketingSettingsSave({ ...s, autoReply: { ...s.autoReply, enabled: false }, notifyEmails: ["prodazba@serafimoski.tech"] });
    const n = sent.length;
    await post(form({ name: "Без Одговор", email: "noreply@x.mk", _ts: ago(9000) }));
    await vi.waitFor(() => expect(sent.some((m) => String(m.to).includes("prodazba@serafimoski.tech") && m.subject.includes("Без Одговор"))).toBe(true));
    expect(sent.slice(n).some((m) => m.to === "noreply@x.mk")).toBe(false);
  });

  it("feed: Meta CSV и Google XML само за исправни производи; FEED_TOKEN", async () => {
    const p = (await caller.marketing.feedProductList()).find((x: any) => x.code === "LS-1");
    expect(p.issues).toContain("не е означен за веб");
    const saved = await caller.marketing.feedProductSave({ id: p.id, showOnWeb: true, imageUrl: "https://serafimoski.tech/img/ls.jpg", webUrl: "https://serafimoski.tech/#/laser", publicPrice: 120, description: "Ласерско сечење лим до 20 мм" });
    expect(saved.issues).toEqual([]);
    await expect(caller.marketing.feedProductSave({ id: p.id, showOnWeb: true, imageUrl: "http://x/a.jpg", webUrl: null })).rejects.toThrow(/https/);
    const csv = await (await app.request("/api/public/feed/meta.csv")).text();
    expect(csv).toContain("LS-1,Ласерско сечење");
    expect(csv).toContain("120.00 MKD");
    const xml = await (await app.request("/api/public/feed/google.xml")).text();
    expect(xml).toContain("<g:id>LS-1</g:id>");
    expect((await caller.marketing.feedInfo()).ready).toBe(1);
    process.env.FEED_TOKEN = "tajna";
    try {
      expect((await app.request("/api/public/feed/meta.csv")).status).toBe(403);
      expect((await app.request("/api/public/feed/meta.csv?key=tajna")).status).toBe(200);
    } finally { delete process.env.FEED_TOKEN; }
  });
});
