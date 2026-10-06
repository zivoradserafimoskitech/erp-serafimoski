import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { createOAuthCallbackHandler } from "./kimi/auth";
import { Paths } from "@contracts/constants";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";
import { registerMarketingPublic } from "./marketing-public";
import { parseOrigins } from "@contracts/marketing";

const app = new Hono();

// Сервисни адреси (миграција, seed, debug): кога е поставена APP_PASSWORD, бараат ?key=... или x-app-key
const ADMIN_PATHS = ["/api/init-db", "/api/debug", "/api/test-db", "/api/seed-services", "/api/seed-materials"];
app.use("/api/*", async (c, next) => {
  if (!ADMIN_PATHS.includes(c.req.path)) return await next();
  const { resolveActor, gateActive } = await import("./context");
  if (!(await gateActive())) return await next();
  const key = c.req.header("x-app-key") ?? c.req.query("key") ?? "";
  const actor = await resolveActor(key);
  if (!actor || actor.role !== "admin") return c.json({ error: "Потребна е администраторска лозинка (?key=...)" }, 401);
  await next();
});

// ── Заштита со лозинка: активна ако е поставена APP_PASSWORD или постои администратор со код ──
const clientIp = (c: any) => (c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local");

// Најава: кодот се проверува еднаш и се заменува со сесија со рок (прелистувачот го чува токенот, не кодот)
app.post("/api/auth-check", async (c) => {
  const { gateActive, needsSetup, resolveActor } = await import("./context");
  if (!(await gateActive())) return c.json({ ok: true, gate: false, name: "Отворен пристап", role: "admin" });
  if (await needsSetup()) {
    return c.json({
      ok: false,
      gate: true,
      needsSetup: true,
      message: "Системот е затворен. Создај прв администратор или постави APP_PASSWORD во опкружувањето.",
    });
  }
  const auth = await import("./auth");
  const body = await c.req.json().catch(() => ({}));
  const provided = String(body?.password ?? c.req.header("x-app-key") ?? "");
  if (!provided) return c.json({ ok: false, gate: true });
  // постоечка сесија — само провери
  if (provided.startsWith(auth.SESSION_PREFIX)) {
    const a = await resolveActor(provided);
    return a ? c.json({ ok: true, gate: true, name: a.name, role: a.role, token: provided }) : c.json({ ok: false, gate: true });
  }
  const ip = clientIp(c);
  const wait = auth.loginWait(ip);
  if (wait > 0) return c.json({ ok: false, gate: true, wait, message: `Премногу погрешни обиди. Обиди се повторно за ${wait} секунди.` }, 429);
  const actor = await auth.actorFromCode(provided).catch(() => undefined);
  if (!actor) { auth.loginFailed(ip); return c.json({ ok: false, gate: true }); }
  auth.loginOk(ip);
  const token = await auth.createSession(actor, { ip, userAgent: c.req.header("user-agent") });
  return c.json({ ok: true, gate: true, name: actor.name, role: actor.role, token });
});

/** Првичен setup: создај прв администратор кога нема APP_PASSWORD ниту админ. */
app.post("/api/setup-admin", async (c) => {
  const { needsSetup, clearActorCache } = await import("./context");
  if (!(await needsSetup())) {
    return c.json({ ok: false, message: "Setup веќе е завршен — најави се нормално." }, 403);
  }
  const body = await c.req.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim();
  const passcode = String(body?.passcode ?? "");
  if (name.length < 2) return c.json({ ok: false, message: "Името е премногу кратко" }, 400);
  if (passcode.length < 4 || passcode.includes("$") || passcode.startsWith("st_")) {
    return c.json({ ok: false, message: "Невалиден код (мин. 4 знаци, без $ / st_)" }, 400);
  }
  const { appRouter } = await import("./router");
  try {
    const caller = appRouter.createCaller({
      req: c.req.raw,
      resHeaders: c.res.headers,
      actor: undefined,
    } as any);
    const r = await caller.appUsers.appUsersCreate({ name, passcode, role: "admin" });
    clearActorCache();
    return c.json({ ok: true, id: r.id, gateActivated: r.gateActivated });
  } catch (e: any) {
    return c.json({ ok: false, message: e?.message ?? "Неуспешно создавање" }, 400);
  }
});
app.post("/api/logout", async (c) => {
  const key = c.req.header("x-app-key") ?? "";
  const { deleteSession } = await import("./auth");
  const { clearActorCache } = await import("./context");
  await deleteSession(key).catch(() => {});
  clearActorCache();
  return c.json({ ok: true });
});

// ── Јавни адреси за веб-страницата (форма за барање, product feed) — свој CORS (ALLOWED_ORIGINS) ──
registerMarketingPublic(app);

// ── Портал за клиенти: без најава, само со таен токен (секој клиент го гледа само своето) ──
const portalHits = new Map<string, { n: number; at: number }>();
app.use("/api/portal/*", async (c, next) => {
  // ограничување: најмногу 120 барања во минута од една адреса (заштита од погодување токени)
  const ip = clientIp(c);
  const h = portalHits.get(ip);
  const now = Date.now();
  if (h && now - h.at < 60_000) { if (++h.n > 120) return c.json({ error: "Премногу барања" }, 429); }
  else portalHits.set(ip, { n: 1, at: now });
  if (portalHits.size > 5000) portalHits.clear();
  await next();
});
const portalCaller = async () => {
  const mod: any = await import("./router");
  return mod.appRouter.createCaller({ req: new Request("http://portal"), resHeaders: new Headers(), actor: { id: null, name: "портал", role: "admin" } });
};
app.get("/api/portal/:token", async (c) => {
  const { portalCustomer, portalData } = await import("./crm-router");
  const cid = await portalCustomer(c.req.param("token"));
  if (!cid) return c.json({ error: "Линкот не важи или е истечен. Побарајте нов од вашиот контакт." }, 404);
  return c.json(await portalData(cid));
});
app.get("/api/portal/:token/invoice/:id", async (c) => {
  const { portalCustomer } = await import("./crm-router");
  const cid = await portalCustomer(c.req.param("token"));
  if (!cid) return c.json({ error: "Линкот не важи" }, 404);
  const caller = await portalCaller();
  const inv: any = await caller.accounting.invoiceById({ id: Number(c.req.param("id")) }).catch(() => null);
  if (!inv || Number(inv.customerId) !== cid || ["draft", "cancelled"].includes(inv.status)) return c.json({ error: "Не постои" }, 404);
  const settings = await caller.settings.settingsGet();
  return c.json({ invoice: inv, settings });
});
app.get("/api/portal/:token/cert/:id", async (c) => {
  const { portalCustomer } = await import("./crm-router");
  const cid = await portalCustomer(c.req.param("token"));
  if (!cid) return c.json({ error: "Линкот не важи" }, 404);
  const { getPool } = await import("./queries/connection");
  const r = (await getPool().query(`SELECT c.cert_url, c.cert_number FROM dn_certificates c JOIN delivery_notes dn ON dn.id = c.delivery_note_id WHERE c.id = $1 AND dn.customer_id = $2`,
    [Number(c.req.param("id")), cid])).rows[0];
  if (!r?.cert_url) return c.json({ error: "Не постои" }, 404);
  const m = /^data:([^;]+);base64,(.*)$/s.exec(r.cert_url);
  if (!m) return c.redirect(r.cert_url);
  return c.body(Buffer.from(m[2], "base64"), 200, { "Content-Type": m[1], "Content-Disposition": `inline; filename="sertifikat-${String(r.cert_number ?? c.req.param("id")).replace(/[^\w-]+/g, "_")}"` });
});
app.post("/api/portal/:token/rfq", async (c) => {
  const { portalCustomer, portalRfq } = await import("./crm-router");
  const cid = await portalCustomer(c.req.param("token"));
  if (!cid) return c.json({ error: "Линкот не важи" }, 404);
  const body = await c.req.json().catch(() => null);
  const title = String(body?.title ?? "").trim(), message = String(body?.message ?? "").trim();
  if (title.length < 3) return c.json({ error: "Напишете наслов на барањето" }, 400);
  const files = Array.isArray(body?.files) ? body.files.filter((f: any) => f && typeof f.data === "string" && f.data.length < 14_000_000) : [];
  const r = await portalRfq(cid, { title, message, contact: body?.contact ? String(body.contact).slice(0, 255) : undefined, files });
  return c.json({ ok: true, id: r.id });
});

// Бекап: преземање (JSON.gz), проверка на враќање во привремена шема, враќање — само администратор
app.use("/api/admin/*", async (c, next) => {
  const { resolveActor, gateActive } = await import("./context");
  if (!(await gateActive())) return await next();
  const actor = await resolveActor(c.req.header("x-app-key") ?? c.req.query("key") ?? "");
  if (!actor || actor.role !== "admin") return c.json({ error: "Само администратор" }, 401);
  await next();
});
app.get("/api/admin/backup", async (c) => {
  const { backupStream, backupFileName, markBackup } = await import("./backup");
  const { Readable } = await import("stream");
  const { stream, done } = backupStream();
  done.then((s) => markBackup("download", s)).catch((e) => console.error("[BACKUP]", e?.message ?? e));
  return c.body(Readable.toWeb(stream) as any, 200, {
    "Content-Type": "application/gzip",
    "Content-Disposition": `attachment; filename="${backupFileName()}"`,
    "Cache-Control": "no-store",
  });
});
app.post("/api/admin/backup/check", async (c) => {
  const { checkRestore } = await import("./backup");
  const buf = Buffer.from(await c.req.arrayBuffer());
  try { return c.json(await checkRestore(buf)); }
  catch (e: any) { return c.json({ ok: false, error: e?.message ?? String(e) }, 400); }
});
app.post("/api/admin/backup/restore", async (c) => {
  if (c.req.query("confirm") !== "ВРАТИ") return c.json({ ok: false, error: "Потребна е потврда" }, 400);
  const { restoreBackup } = await import("./backup");
  const buf = Buffer.from(await c.req.arrayBuffer());
  try {
    const r = await restoreBackup(buf);
    const { clearActorCache } = await import("./context");
    clearActorCache();
    return c.json(r);
  } catch (e: any) { return c.json({ ok: false, error: e?.message ?? String(e) }, 400); }
});
app.use("/api/trpc/*", async (c, next) => {
  const { resolveActor, gateActive } = await import("./context");
  if (!(await gateActive())) return await next();
  const key = c.req.header("x-app-key") ?? "";
  const actor = await resolveActor(key);
  if (!actor) {
    return c.json({ error: { json: { message: "Најави се повторно (погрешен код)", code: -32001, data: { code: "UNAUTHORIZED", httpStatus: 401 } } } }, 401);
  }
  await next();
});

const port = parseInt(process.env.PORT || "3000");

// 1. Health check
app.get("/health", (c) => c.json({ ok: true, time: Date.now(), port }));

// 2. DB test + init
app.get("/api/test-db", async (c) => {
  try {
    const { getDb } = await import("./queries/connection");
    const db = getDb();
    const result = await db.execute("SELECT 1 as test, NOW() as time");
    return c.json({ db: "connected", result });
  } catch (e: any) {
    return c.json({ db: "error", message: e.message }, 500);
  }
});

// 3. Init database tables (SQL method — reliable in production)
type MigrationResult = { created: number; skipped: number; errors: string[] };

async function runMigrations(): Promise<MigrationResult> {
  const { getInitSql } = await import("./init-db-sql");
  const { Pool } = await import("pg");
  const ssl = process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl });
  const statements: string[] = getInitSql();
  let created = 0, skipped = 0;
  const errors: string[] = [];
  for (const stmt of statements) {
    try {
      await pool.query(stmt);
      created++;
    } catch (e: any) {
      // 42P07 duplicate_table, 42710 duplicate_object, 42701 duplicate_column — веќе постои
      if (["42P07", "42710", "42701"].includes(e.code)) skipped++;
      else errors.push(`${e.code}: ${String(e.message).slice(0, 160)}`);
    }
  }
  await pool.end();
  return { created, skipped, errors };
}

app.get("/api/init-db", async (c) => {
  try {
    const r = await runMigrations();
    if (r.errors.length) return c.json({ status: "partial", ...r }, 500);
    return c.json({ status: "tables created", created: r.created, skipped: r.skipped });
  } catch (e: any) {
    return c.json({ status: "error", message: e.message }, 500);
  }
});

// Debug: test db
app.get("/api/debug", async (c) => {
  try {
    const pgModule = await import("pg");
    const Pool = pgModule.default?.Pool || pgModule.Pool;
    const ssl = process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false };
    const pool = new Pool({ 
      connectionString: process.env.DATABASE_URL,
      ssl
    });
    
    const t1 = await pool.query("SELECT 1 as test");
    const t2 = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
    const t3 = await pool.query("SELECT count(*) as cnt FROM customers");
    await pool.end();
    
    return c.json({ 
      ok: true, 
      db_url_set: !!process.env.DATABASE_URL,
      test1: t1.rows[0],
      tables: t2.rows.map((r: any) => r.tablename),
      customer_count: t3.rows[0]?.cnt
    });
  } catch (e: any) {
    return c.json({ ok: false, error: e.message, stack: e.stack?.substring(0, 500) }, 500);
  }
});

// 3. CORS + tRPC API
app.use("/api/*", cors({
  origin: ["https://web-production-dceb8.up.railway.app", "http://localhost:5173", "https://erp-serafimoski.onrender.com", ...parseOrigins(process.env.ALLOWED_ORIGINS, [])],
  credentials: true,
}));

// Debug: catch all tRPC errors
app.use("/api/trpc/*", async (c, next) => {
  try {
    return await next();
  } catch (err: any) {
    console.error("[tRPC ERROR]", err.message, err.stack?.substring(0, 300));
    return c.json({ error: err.message, stack: err.stack?.substring(0, 500) }, 500);
  }
});
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});

// 4. Static files (frontend) — LAST!
const STATIC_ROOT = process.cwd() + "/dist/public";

// Helper: serve static files with correct content-type
app.get("/assets/:filename{.+}", async (c) => {
  const fs = await import("fs");
  const path = await import("path");
  const filename = c.req.param("filename");
  const filePath = path.join(STATIC_ROOT, "assets", filename);
  
  // Security: ensure file is within static root
  if (!filePath.startsWith(path.join(STATIC_ROOT, "assets"))) {
    return c.notFound();
  }
  
  try {
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    // .mjs мора да е JavaScript: PDF читачот (pdf.worker.mjs) се вчитува како модул,
    // а прелистувачот одбива модул со тип application/octet-stream
    const mimeTypes: Record<string, string> = {
      ".js": "application/javascript",
      ".mjs": "application/javascript",
      ".wasm": "application/wasm",
      ".json": "application/json",
      ".map": "application/json",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".ttf": "font/ttf",
      ".bcmap": "application/octet-stream",
      ".css": "text/css",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".woff2": "font/woff2",
      ".woff": "font/woff",
    };
    return c.body(content, 200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000",
    });
  } catch {
    return c.notFound();
  }
});

app.get("/favicon.ico", async (c) => {
  const fs = await import("fs");
  try {
    const content = fs.readFileSync(STATIC_ROOT + "/favicon.ico");
    return c.body(content, 200, { "Content-Type": "image/x-icon" });
  } catch {
    return c.notFound();
  }
});

// Seed на стандардни услуги — идемпотентно
app.get("/api/seed-services", async (c) => {
  try {
    const { Pool } = await import("pg");
    const ssl = process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false };
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl });
    const seed = [
      { code: "ЛС-01", name: "Ласерско сечење", type: "laser_cutting", unit: "m_cut", saleRate: "60", costRate: "30" },
      { code: "ПС-01", name: "Плазма сечење", type: "plasma_cutting", unit: "m_cut", saleRate: "50", costRate: "25" },
      { code: "ВТ-01", name: "Виткање", type: "bending", unit: "bend", saleRate: "40", costRate: "20" },
      { code: "МИГ-01", name: "МИГ заварување", type: "mig_welding", unit: "hour", saleRate: "900", costRate: "450" },
      { code: "ТИГ-01", name: "ТИГ заварување", type: "tig_welding", unit: "hour", saleRate: "1100", costRate: "550" },
      { code: "БР-01", name: "Брусење", type: "grinding", unit: "hour", saleRate: "700", costRate: "350" },
      { code: "ДП-01", name: "Дупчење", type: "drilling", unit: "hour", saleRate: "700", costRate: "350" },
      { code: "ЕФ-01", name: "Електростатско фарбање", type: "electrostatic_paint", unit: "m2", saleRate: "350", costRate: "180" },
      { code: "МФ-01", name: "Мокро фарбање", type: "wet_paint", unit: "m2", saleRate: "300", costRate: "150" },
      { code: "ЦНЦ-01", name: "ЦНЦ обработка", type: "cnc_machining", unit: "hour", saleRate: "1500", costRate: "750" },
      { code: "МН-01", name: "Монтажа", type: "installation", unit: "hour", saleRate: "800", costRate: "400" },
      { code: "ТП-01", name: "Транспорт", type: "transport", unit: "job", saleRate: "2000", costRate: "1200" }
    ];
    let created = 0, skipped = 0;
    for (const s of seed) {
      const res = await pool.query(
        `INSERT INTO services (code, name, type, unit, sale_rate, cost_rate, is_active)
         SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::numeric, $6::numeric, 'active'
         WHERE NOT EXISTS (SELECT 1 FROM services WHERE code = $1::varchar OR name = $2::varchar)`,
        [s.code, s.name, s.type, s.unit, s.saleRate, s.costRate]
      );
      if (res.rowCount) created++; else skipped++;
    }
    await pool.end();
    return c.json({ status: "ok", created, skipped });
  } catch (e: any) { return c.json({ status: "error", message: e.message }, 500); }
});

// Seed на материјали од ценовник — идемпотентно (прескокнува постоечки кодови)
app.get("/api/seed-materials", async (c) => {
  try {
    const { MATERIALS_SEED } = await import("./materials-seed");
    const { Pool } = await import("pg");
    const ssl = process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false };
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl });
    let created = 0, skipped = 0;
    for (const m of MATERIALS_SEED) {
      const res = await pool.query(
        `INSERT INTO materials (code, name, type, unit, last_purchase_price, avg_cost, is_active)
         SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::numeric, $5::numeric, 'active'
         WHERE NOT EXISTS (SELECT 1 FROM materials WHERE code = $1::varchar OR name = $2::varchar)`,
        [m.code, m.name, m.type, m.unit, m.price]
      );
      if (res.rowCount) created++; else skipped++;
    }
    await pool.end();
    return c.json({ status: "ok", created, skipped, total: MATERIALS_SEED.length });
  } catch (e: any) {
    return c.json({ status: "error", message: e.message }, 500);
  }
});

// SPA fallback: serve index.html for all non-API routes
app.get("*", async (c) => {
  const path = c.req.path;
  // Don't interfere with API routes
  if (path.startsWith("/api/")) return c.notFound();
  // Root static фајлови (logo.png и сл.): ако бараниот пат постои како фајл, сервирај го директно
  if (path !== "/" && !path.includes("..")) {
    try {
      const fs = await import("fs");
      const p = STATIC_ROOT + path;
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        const ext = path.slice(path.lastIndexOf("."));
        const mime: Record<string, string> = {
          ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
          ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
          ".txt": "text/plain", ".json": "application/json",
          ".js": "application/javascript", ".mjs": "application/javascript",
          ".css": "text/css", ".map": "application/json",
          ".woff": "font/woff", ".woff2": "font/woff2",
        };
        return c.body(fs.readFileSync(p), 200, {
          "Content-Type": mime[ext] || "application/octet-stream",
          "Cache-Control": "public, max-age=86400",
        });
      }
    } catch { /* падни на SPA fallback */ }
  }
  // Serve index.html for all other routes (SPA)
  // НЕ смее да се кешира: тој кажува кој бундл да се вчита. Ако прелистувачот
  // задржи стар index.html, деплојот не се гледа додека не се направи Ctrl+Shift+R.
  try {
    const fs = await import("fs");
    const html = fs.readFileSync(STATIC_ROOT + "/index.html", "utf-8");
    return c.body(html, 200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    });
  } catch {
    return c.json({ error: "index.html not found" }, 500);
  }
});

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`[BOOT] Server on 0.0.0.0:${port}`);

  // Автоматски потсетници по е-пошта (работи само ако се вклучени во Подесувања)
  if (process.env.DATABASE_URL && process.env.DISABLE_REMINDERS !== "true") {
    import("./reminders").then(m => m.startReminderScheduler()).catch(e => console.error("[REMINDERS]", e));
    import("./backup").then(m => m.startBackupScheduler()).catch(e => console.error("[BACKUP]", e));
    if (process.env.MARKETING_SCHEDULER_DISABLED !== "true") import("./marketing-scheduler").then(m => m.startMarketingScheduler()).catch(e => console.error("[MKT]", e));
    if (process.env.DISABLE_AUTO_LEDGER !== "true") import("./finance-router").then(m => m.startLedgerNightly()).catch(e => console.error("[LEDGER]", e));
  }

  // Шемата се усогласува сама при секое подигање.
  // Сите изрази се IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, па повторувањето е безопасно.
  // Не смее да го сруши серверот — ако падне, апликацијата работи, само пишува во логот.
  if (process.env.SKIP_AUTO_MIGRATE === "true") {
    console.log("[MIGRATE] Прескокнато (SKIP_AUTO_MIGRATE=true)");
    return;
  }
  runMigrations()
    .then((r) => {
      if (r.errors.length) {
        console.error(`[MIGRATE] ${r.created} извршени, ${r.skipped} прескокнати, ${r.errors.length} ГРЕШКИ:`);
        for (const e of r.errors) console.error(`[MIGRATE]   ${e}`);
      } else {
        console.log(`[MIGRATE] Шемата е усогласена — ${r.created} извршени, ${r.skipped} прескокнати`);
      }
      import("./auth").then(m => m.ensureAuthReady()).catch(e => console.error("[AUTH]", e?.message ?? e));
      import("./reconcile").then(m => m.reconcileData())
        .then(n => n && console.log(`[RECONCILE] Усогласени ${n} записи (залиха, статуси на плаќање)`))
        .catch(e => console.error("[RECONCILE]", e?.message ?? e));
    })
    .catch((e) => console.error("[MIGRATE] Не успеа:", e?.message ?? e));
});
