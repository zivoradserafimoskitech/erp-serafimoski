// Маркетинг М2 (кампањи): публика, согласност, одјава/suppression, double opt-in, редица со ограничување, следење, ROI.
// Посебна шема mkt_test2 (паралелно со другите DB тестови).
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const SCHEMA = "mkt_test2";

describe.skipIf(!url)("маркетинг кампањи (интеграциски)", () => {
  let caller: any;
  let app: any;
  let q: (sql: string, p?: any[]) => Promise<any[]>;
  let mc: typeof import("./marketing-campaigns");
  const sent: any[] = [];
  let failNext = 0;
  const ids: Record<string, number> = {};
  const today = new Date().toISOString().slice(0, 10);

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
    delete process.env.APP_URL; delete process.env.PUBLIC_URL; delete process.env.MARKETING_SECRET;
    const { getPool } = await import("./queries/connection");
    const pool = getPool();
    const { getInitSql } = await import("./init-db-sql");
    for (const stmt of getInitSql()) {
      try { await pool.query(stmt); } catch (e: any) { if (!["42P07", "42710", "42701"].includes(e.code)) throw new Error(`${e.message}\n${stmt.slice(0, 200)}`); }
    }
    q = async (sql, p = []) => (await pool.query(sql, p)).rows;
    const { __setTestMailer } = await import("./mail-transport");
    __setTestMailer({ provider: "test", source: "test", from: "Серафимоски <ponudi@serafimoski.tech>", send: async (m) => {
      if (failNext > 0) { failNext--; throw new Error("SMTP 421 привремено"); }
      sent.push(m); return { messageId: `<m${sent.length}@test>` };
    } });
    const { appRouter } = await import("./router");
    caller = appRouter.createCaller({ req: new Request("http://test"), resHeaders: new Headers(), actor: { id: null, name: "Андреј", role: "admin" } } as any);
    const { Hono } = await import("hono");
    const { registerMarketingPublic } = await import("./marketing-public");
    app = new Hono();
    registerMarketingPublic(app);
    mc = await import("./marketing-campaigns");
  });
  afterAll(async () => { (await import("./mail-transport")).__setTestMailer(null); delete process.env.APP_URL; });

  it("публика: клиенти + барања → контакти (идемпотентно)", async () => {
    const ins = async (name: string, email: string | null, city: string | null, contact: string | null = null) =>
      (await q(`INSERT INTO customers (name, email, city, country, contact_person) VALUES ($1, $2, $3, 'Македонија', $4) RETURNING id`, [name, email, city, contact]))[0].id;
    ids.c1 = await ins("Метал Про ДОО", "nabavka@metalpro.mk", "Скопје", "Марко Јовановски");
    ids.c2 = await ins("Градба Битола", "info@gradba.mk; sef@gradba.mk", "Битола");
    await ins("Без пошта", null, "Скопје");
    await ins("Лоша пошта", "nema", "Скопје");
    await q(`INSERT INTO mkt_leads (name, email, consent, channel) VALUES ('Веб Купувач', 'web@kupuvac.mk', true, 'google'), ('Спам', 'spam@x.io', false, 'direct')`);
    await q(`UPDATE mkt_leads SET status = 'spam' WHERE email = 'spam@x.io'`);
    expect(await caller.campaigns.audienceSync()).toEqual({ customers: 3, leads: 1 });
    expect(await caller.campaigns.audienceSync()).toEqual({ customers: 0, leads: 0 });
    const list = await caller.campaigns.contactList();
    expect(list.map((c: any) => c.email).sort()).toEqual(["info@gradba.mk", "nabavka@metalpro.mk", "sef@gradba.mk", "web@kupuvac.mk"]);
    expect(list.every((c: any) => c.consentStatus === "none")).toBe(true);
  });

  it("CSV увоз со согласност; рачна согласност бара извор", async () => {
    await mc.suppress("blokiran@x.mk", "manual");
    const r = await caller.campaigns.contactImportCsv({ csv: "email;име;фирма;град\nnov@kupuvac.mk;Нов Купувач;Нова ДОО;Скопје\nNABAVKA@metalpro.mk;Марко;;\nblokiran@x.mk;Б;;\nlosa;x;;", consent: true, note: "саем Техномама 2026" });
    expect(r).toMatchObject({ added: 1, updated: 1, consented: 2, skipped: 1 });
    expect(r.errors).toHaveLength(1);
    const metal = (await q(`SELECT * FROM mkt_contacts WHERE email = 'nabavka@metalpro.mk'`))[0];
    expect(metal).toMatchObject({ consent_status: "granted", customer_id: ids.c1 });
    expect(metal.consent_source).toContain("саем Техномама");
    expect(await q(`SELECT 1 FROM mkt_contacts WHERE email = 'blokiran@x.mk'`)).toHaveLength(0);
    const info = (await q(`SELECT id FROM mkt_contacts WHERE email = 'info@gradba.mk'`))[0];
    await expect(caller.campaigns.contactConsentSet({ id: info.id, status: "granted" })).rejects.toThrow(/Наведи/);
    await caller.campaigns.contactConsentSet({ id: info.id, status: "granted", note: "писмена согласност по е-пошта 01.10." });
    const log = await caller.campaigns.contactConsentLogList({ contactId: info.id });
    expect(log[0]).toMatchObject({ action: "granted", source: "manual", by: "Андреј" });
  });

  it("сегменти: град, купена категорија, промет, без нарачка; режим на согласност", async () => {
    await q(`INSERT INTO products (name, code, category, unit, basis, default_price) VALUES ('Ограда А', 'OG-A', 'fence', 'm', 'pcs', 1000), ('Полица', 'PL-1', 'shelf', 'pcs', 'pcs', 3000)`);
    const og = (await q(`SELECT id FROM products WHERE code = 'OG-A'`))[0].id;
    ids.og = og;
    const o = (await q(`INSERT INTO orders (order_number, customer_id, status, created_at) VALUES ('Н-1', $1, 'delivered', now() - interval '200 days') RETURNING id`, [ids.c1]))[0].id;
    await q(`INSERT INTO order_items (order_id, description, quantity, product_id) VALUES ($1, 'Ограда', 10, $2)`, [o, og]);
    await q(`INSERT INTO invoices (invoice_number, customer_id, invoice_type, issue_date, status, subtotal, total_amount) VALUES ('1/2026', $1, 'standard', now() - interval '190 days', 'paid', 50000, 59000)`, [ids.c1]);
    const prev = (rules: any) => caller.campaigns.segmentPreview({ rules });
    expect((await prev({})).count).toBe(3); // nabavka, nov, info (granted)
    expect((await prev({ cities: ["скопје"] })).count).toBe(2);
    expect((await prev({ categories: ["fence"] })).sample.map((s: any) => s.email)).toEqual(["nabavka@metalpro.mk"]);
    expect((await prev({ minRevenue: 40000 })).count).toBe(1);
    expect((await prev({ noOrderDays: 180, categories: ["fence"] })).count).toBe(1);
    expect((await prev({ noOrderDays: 365, categories: ["fence"] })).count).toBe(0);
    expect((await prev({ consent: "granted_or_customer" })).count).toBe(4); // + sef@gradba.mk (клиент без согласност)
    expect((await prev({ sources: ["csv"] })).count).toBe(1);
    const s = await caller.campaigns.segmentSave({ name: "Скопје", rules: { consent: "granted", cities: ["Скопје"] } });
    ids.seg = s.id;
    expect((await caller.campaigns.segmentList())[0]).toMatchObject({ name: "Скопје", count: 2 });
  });

  it("кампања: тест, без APP_URL не се праќа; редица по брзина; заглавја за одјава; цена по клиент", async () => {
    await q(`INSERT INTO customer_prices (customer_id, item_type, ref_id, price) VALUES ($1, 'product', $2, 850)`, [ids.c1, ids.og]);
    await q(`UPDATE products SET web_url = 'https://serafimoski.tech/#/ograda', public_price = 1180 WHERE id = $1`, [ids.og]);
    const c = await caller.campaigns.campaignSave({
      name: "Есенска акција огради", subject: "{{first_name}}, огради по акциска цена", preheader: "До 31.10.", segmentId: null, rules: { consent: "granted" }, ratePerMinute: 2,
      blocks: [{ type: "heading", text: "Здраво {{first_name}}" }, { type: "text", text: "Погледнете https://serafimoski.tech/#/ograda" }, { type: "product", productId: ids.og, showPrice: true }, { type: "button", label: "Побарај понуда", url: "https://serafimoski.tech/#/kontakt" }],
    });
    ids.camp = c.id;
    expect(c.utmCampaign).toBe("esenska-akcija-ogradi");
    await caller.campaigns.campaignTestSend({ id: c.id, to: ["test@serafimoski.tech"] });
    expect(sent.at(-1).subject).toMatch(/^\[ТЕСТ\] /);
    expect(sent.at(-1).headers).toBeUndefined();
    expect(sent.at(-1).html).toContain("utm_campaign=esenska-akcija-ogradi");
    await expect(caller.campaigns.campaignSchedule({ id: c.id })).rejects.toThrow(/APP_URL/);

    process.env.APP_URL = "https://erp.serafimoski.tech";
    const r = await caller.campaigns.campaignSchedule({ id: c.id });
    expect(r).toMatchObject({ total: 3, status: "sending" });
    await expect(caller.campaigns.campaignSave({ id: c.id, name: "x x", subject: "y y", blocks: [] })).rejects.toThrow(/Пратена кампања/);

    const before = sent.length;
    const r1 = await mc.processCampaignQueue();
    expect(r1).toMatchObject({ sent: 2, finished: 0 });
    const batch = sent.slice(before);
    expect(batch).toHaveLength(2);
    for (const m of batch) {
      expect(m.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/erp\.serafimoski\.tech\/api\/m\/u\/[\w-]+>$/);
      expect(m.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      expect(m.html).toContain("/api/m/o/");
      expect(m.html).toMatch(/\/api\/m\/c\/[\w-]+\?u=https%3A%2F%2Fserafimoski\.tech%2F%3Futm_source%3Dnewsletter/);
      expect(m.text).toContain("Одјава: https://erp.serafimoski.tech/api/m/u/");
    }
    const metalMail = sent.find((m) => m.to === "nabavka@metalpro.mk");
    expect(metalMail.subject).toBe("Марко, огради по акциска цена");
    expect(metalMail.html).toContain("850 ден.");
    expect(metalMail.html).toContain("ваша цена");
    const other = batch.find((m) => m.to !== "nabavka@metalpro.mk");
    expect(other.html).toContain("1.180 ден.");
    expect((await caller.campaigns.campaignById({ id: c.id })).stats).toMatchObject({ total: 3, sent: 2, queued: 1 });
  });

  it("клик (потпишан) и отворање; лажен потпис не пренасочува кон туѓа адреса", async () => {
    const m = sent.find((x) => x.to === "nabavka@metalpro.mk");
    const href = /href="(https:\/\/erp\.serafimoski\.tech\/api\/m\/c\/[^"]+)"/.exec(m.html)![1].replace(/&amp;/g, "&");
    const path = href.replace("https://erp.serafimoski.tech", "");
    const res = await app.request(path);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^https:\/\/serafimoski\.tech\/\?utm_source=newsletter&utm_medium=email&utm_campaign=esenska-akcija-ogradi/);
    const token = /\/api\/m\/c\/([\w-]+)\?/.exec(path)![1];
    const evil = await app.request(`/api/m/c/${token}?u=${encodeURIComponent("https://evil.example/")}&s=abc`);
    expect(evil.headers.get("location")).toBe("https://serafimoski.tech");
    const pix = await app.request(`/api/m/o/${token}.gif`);
    expect(pix.headers.get("content-type")).toBe("image/gif");
    const row = (await q(`SELECT click_count, open_count, clicked_at FROM mkt_sends WHERE token = $1`, [token]))[0];
    expect(row.click_count).toBe(1);
    expect(row.open_count).toBeGreaterThanOrEqual(2);
    expect((await q(`SELECT COUNT(*)::int n FROM mkt_clicks`))[0].n).toBe(1);
  });

  it("одјава еден клик (RFC 8058) → suppression, согласност повлечена, следниот примач прескокнат", async () => {
    // примачот што уште чека во редица се одјавува преку линк од претходна порака → треба да се прескокне
    const pending = (await q(`SELECT s.token, s.email FROM mkt_sends s WHERE s.campaign_id = $1 AND s.status = 'queued'`, [ids.camp]))[0];
    const page = await app.request(`/api/m/u/${pending.token}`);
    expect(await page.text()).toContain("Одјави ме");
    expect(await q(`SELECT 1 FROM mkt_suppressions WHERE email = $1`, [pending.email])).toHaveLength(0); // GET не одјавува
    const fd = new URLSearchParams({ "List-Unsubscribe": "One-Click" });
    const res = await app.request(`/api/m/u/${pending.token}`, { method: "POST", body: fd, headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("unsubscribed");
    expect((await q(`SELECT reason, campaign_id FROM mkt_suppressions WHERE email = $1`, [pending.email]))[0]).toEqual({ reason: "unsubscribe", campaign_id: ids.camp });
    expect((await q(`SELECT consent_status FROM mkt_contacts WHERE email = $1`, [pending.email]))[0].consent_status).toBe("withdrawn");
    expect((await q(`SELECT action, source FROM mkt_consents WHERE email = $1 ORDER BY id DESC LIMIT 1`, [pending.email]))[0]).toEqual({ action: "withdrawn", source: "unsubscribe_one_click" });

    const before = sent.length;
    const r = await mc.processCampaignQueue();
    expect(r).toMatchObject({ sent: 0, skipped: 1, finished: 1 });
    expect(sent.length).toBe(before);
    const camp = await caller.campaigns.campaignById({ id: ids.camp });
    expect(camp.status).toBe("sent");
    expect(camp.stats).toMatchObject({ sent: 2, skipped: 1, unsubscribed: 1, clicked: 1 });
    // повторен увоз со „согласност“ не го враќа одјавениот
    const imp = await caller.campaigns.contactImportCsv({ csv: `email\n${pending.email}`, consent: true, note: "повторно" });
    expect(imp.skipped).toBe(1);
    expect((await caller.campaigns.segmentPreview({ rules: {} })).sample.map((s: any) => s.email)).not.toContain(pending.email);
  });

  it("неуспешно праќање: повторен обид, по 3 обиди „failed“; пауза ја запира редицата", async () => {
    await q(`UPDATE mkt_contacts SET consent_status = 'granted' WHERE email = 'sef@gradba.mk'`);
    const c = await caller.campaigns.campaignSave({ name: "Втора", subject: "Тест 2", blocks: [{ type: "text", text: "Здраво" }], segmentId: ids.seg, ratePerMinute: 10 });
    await caller.campaigns.campaignSchedule({ id: c.id });
    await caller.campaigns.campaignPause({ id: c.id });
    expect(await mc.processCampaignQueue()).toMatchObject({ sent: 0 });
    await caller.campaigns.campaignResume({ id: c.id });
    failNext = 100;
    for (let i = 0; i < 3; i++) await mc.processCampaignQueue();
    failNext = 0;
    const st = await mc.campaignStats(c.id);
    expect(st.failed).toBe(st.total);
    const camp = (await q(`SELECT status, last_error FROM mkt_campaigns WHERE id = $1`, [c.id]))[0];
    expect(camp.status).toBe("sent");
    expect(camp.last_error).toMatch(/421/);
  });

  it("закажана кампања почнува во зададеното време", async () => {
    const c = await caller.campaigns.campaignSave({ name: "Закажана", subject: "Подоцна", blocks: [{ type: "text", text: "x" }], rules: { consent: "granted", cities: ["Битола"] }, ratePerMinute: 5 });
    const at = new Date(Date.now() + 3600_000);
    expect((await caller.campaigns.campaignSchedule({ id: c.id, at: at.toISOString() })).status).toBe("scheduled");
    expect((await mc.processCampaignQueue()).sent).toBe(0);
    const r = await mc.processCampaignQueue(new Date(at.getTime() + 1000));
    expect(r.sent).toBe(2);
    expect(sent.slice(-2).map((m) => m.to).sort()).toEqual(["info@gradba.mk", "sef@gradba.mk"]);
  });

  it("double opt-in: пријава на веб → е-пошта за потврда → потврда; барање од веб со согласност", async () => {
    const res = await app.request("/api/public/subscribe", { method: "POST", headers: { "content-type": "application/json", origin: "https://serafimoski.tech", "x-forwarded-for": "10.9.9.9" }, body: JSON.stringify({ email: "Pretplata@Example.MK", name: "Ана" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://serafimoski.tech");
    const c = (await q(`SELECT * FROM mkt_contacts WHERE email = 'pretplata@example.mk'`))[0];
    expect(c).toMatchObject({ consent_status: "pending", source: "web" });
    const mail = sent.at(-1);
    expect(mail.to).toBe("pretplata@example.mk");
    const link = /(https:\/\/erp\.serafimoski\.tech\/api\/public\/confirm\/[\w-]+)/.exec(mail.text)![1];
    // без потврда не влегува во кампањи
    expect((await caller.campaigns.segmentPreview({ rules: {} })).sample.map((s: any) => s.email)).not.toContain("pretplata@example.mk");
    const conf = await app.request(link.replace("https://erp.serafimoski.tech", ""));
    expect(conf.status).toBe(200);
    expect(await conf.text()).toContain("потврдена");
    const after = (await q(`SELECT consent_status, consent_source, doi_token FROM mkt_contacts WHERE id = $1`, [c.id]))[0];
    expect(after).toEqual({ consent_status: "granted", consent_source: "double_opt_in", doi_token: null });
    expect((await app.request(link.replace("https://erp.serafimoski.tech", ""))).status).toBe(404);
    expect((await app.request("/api/public/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "x@y.mk", website: "spam" }) })).status).toBe(200);
    expect(await q(`SELECT 1 FROM mkt_contacts WHERE email = 'x@y.mk'`)).toHaveLength(0);

    // барање од формата со штиклирана согласност → контакт „чека потврда“ + е-пошта за потврда
    const { intakeLead } = await import("./marketing-leads");
    const n = sent.length;
    const lr = await intakeLead({ name: "Петар Веб", email: "petar@web.mk", marketing_consent: "on" }, [], { elapsedMs: 9000 }, { awaitSideEffects: true });
    expect(lr.ok).toBe(true);
    const pc = (await q(`SELECT consent_status, lead_id FROM mkt_contacts WHERE email = 'petar@web.mk'`))[0];
    expect(pc.consent_status).toBe("pending");
    expect(sent.slice(n).some((m) => m.to === "petar@web.mk" && /confirm/.test(m.text))).toBe(true);
  });

  it("маркетинг извештај: извори, кампањи, трошок и ROI", async () => {
    // барање од Google Ads → понуда → фактура со изворот
    await q(`INSERT INTO mkt_leads (name, email, channel, utm_source, utm_medium, utm_campaign, status) VALUES ('Г', 'g@ads.mk', 'google_ads', 'google', 'cpc', 'laser-oktomvri', 'won')`);
    const lead = (await q(`SELECT id FROM mkt_leads WHERE email = 'g@ads.mk'`))[0].id;
    await q(`INSERT INTO quotations (quote_number, customer_id, status, mkt_lead_id, mkt_source, mkt_medium, mkt_campaign) VALUES ('П-1', $1, 'converted', $2, 'google_ads', 'cpc', 'laser-oktomvri')`, [ids.c1, lead]);
    await q(`INSERT INTO invoices (invoice_number, customer_id, invoice_type, issue_date, status, subtotal, total_amount, mkt_lead_id, mkt_source, mkt_medium, mkt_campaign)
      VALUES ('2/2026', $1, 'standard', CURRENT_DATE, 'issued', 30000, 35400, $2, 'google_ads', 'cpc', 'laser-oktomvri')`, [ids.c1, lead]);
    const month0 = `${today.slice(0, 8)}01`;
    await caller.campaigns.adSpendSave({ periodStart: month0, periodEnd: today, channel: "google_ads", campaign: "laser-oktomvri", amount: 10000 });
    const rep = await caller.campaigns.marketingReport({ from: month0, to: today });
    const g = rep.byCampaign.find((r: any) => r.campaign === "laser-oktomvri");
    expect(g).toMatchObject({ channel: "google_ads", leads: 1, quotes: 1, revenue: 30000, spend: 10000, roi: 200, costPerLead: 10000 });
    expect(rep.bySource.find((r: any) => r.channel === "google_ads")).toMatchObject({ leads: 1, revenue: 30000, roi: 200 });
    expect(rep.funnel.leads).toBeGreaterThanOrEqual(2);
    expect(rep.funnel.invoiced).toBe(1);
    expect(rep.emails.find((e: any) => e.name === "Есенска акција огради")).toMatchObject({ sent: 2, clicked: 1, unsubscribed: 1 });
    expect(rep.totals).toMatchObject({ spend: 10000, revenue: 30000, roi: 200 });
  });

  it("бришење контакт (GDPR) ја задржува адресата во листата за одјава", async () => {
    const c = (await q(`SELECT id FROM mkt_contacts WHERE email = 'web@kupuvac.mk'`))[0];
    await caller.campaigns.contactDelete({ id: c.id });
    expect(await q(`SELECT 1 FROM mkt_contacts WHERE id = $1`, [c.id])).toHaveLength(0);
    expect((await q(`SELECT reason FROM mkt_suppressions WHERE email = 'web@kupuvac.mk'`))[0].reason).toBe("manual");
    await caller.campaigns.audienceSync(); // барањето сè уште постои, но одјавената адреса не се враќа во публиката
    expect(await q(`SELECT 1 FROM mkt_contacts WHERE email = 'web@kupuvac.mk'`)).toHaveLength(0);
  });
});
