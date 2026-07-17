import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { createOAuthCallbackHandler } from "./kimi/auth";
import { Paths } from "@contracts/constants";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";

const app = new Hono();

// ── Заштита со лозинка (точка 5): активна само ако APP_PASSWORD е поставена ──
app.post("/api/auth-check", async (c) => {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return c.json({ ok: true, gate: false });
  const body = await c.req.json().catch(() => ({}));
  const provided = body?.password ?? c.req.header("x-app-key") ?? "";
  return c.json({ ok: provided === pw, gate: true });
});
app.use("/api/trpc/*", async (c, next) => {
  const pw = process.env.APP_PASSWORD;
  if (pw && c.req.header("x-app-key") !== pw) {
    return c.json({ error: { json: { message: "Најави се повторно (погрешна лозинка)", code: -32001, data: { code: "UNAUTHORIZED", httpStatus: 401 } } } }, 401);
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
app.get("/api/init-db", async (c) => {
  try {
    const { getInitSql } = await import("./init-db-sql");
    const { Pool } = await import("pg");
    const ssl = process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false };
    const pool = new Pool({ 
      connectionString: process.env.DATABASE_URL,
      ssl
    });
    const statements: string[] = getInitSql();
    let created = 0, skipped = 0;
    const errors: string[] = [];
    for (const stmt of statements) {
      try {
        await pool.query(stmt);
        created++;
      } catch (e: any) {
        // 42P07 duplicate_table, 42710 duplicate_object, 42701 duplicate_column — веќе постои, прескокни
        if (["42P07", "42710", "42701"].includes(e.code)) skipped++;
        else errors.push(`${e.code}: ${e.message.slice(0, 120)}`);
      }
    }
    await pool.end();
    if (errors.length) return c.json({ status: "partial", created, skipped, errors }, 500);
    return c.json({ status: "tables created", count: statements.length });
  } catch (e: any) {
    return c.json({ status: "error", message: e.message }, 500);
  }
});

// Debug: test db compatibility layer
app.get("/api/debug-db", async (c) => {
  try {
    const { getDb } = await import("./queries/pg-compat");
    const db = getDb();
    
    // Test 1: Raw execute
    const t1 = await db.execute("SELECT 1 as test");
    
    // Test 2: Check pg_tables
    const t2 = await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    
    // Test 3: Insert with pg-compat
    const { customers } = await import("../db/schema");
    const t3 = await db.insert(customers).values({
      name: "DEBUG клиент",
      company: "DEBUG",
      email: "debug@test.mk",
      is_active: "active"
    });
    
    return c.json({ success: true, t1, tables: t2.rows.map((r: any) => r.tablename), t3 });
  } catch (e: any) {
    return c.json({ success: false, error: e.message, stack: e.stack?.substring(0, 500) }, 500);
  }
});

// 4. Test customer creation — raw pg, сигурно работи
app.get("/api/test-customer", async (c) => {
  try {
    const pgModule = await import("pg");
    const Pool = pgModule.default?.Pool || pgModule.Pool;
    const ssl = process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false };
    const pool = new Pool({ 
      connectionString: process.env.DATABASE_URL,
      ssl
    });
    
    const result = await pool.query(
      `INSERT INTO customers (name, company, email, phone, address, city, country, is_active, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW()) RETURNING *`,
      ['Тест Клиент ' + Date.now(), 'Тест ДООЕЛ', 'test@test.mk', '070123456', 'Улица 1', 'Скопје', 'Македонија']
    );
    await pool.end();
    return c.json({ success: true, message: "Клиентот е креиран!", result: result.rows[0] });
  } catch (e: any) {
    return c.json({ success: false, error: e.message, stack: e.stack?.substring(0, 500) }, 500);
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
  origin: ["https://web-production-dceb8.up.railway.app", "http://localhost:5173", "https://erp-serafimoski.onrender.com"],
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
    const mimeTypes: Record<string, string> = {
      ".js": "application/javascript",
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
        };
        return c.body(fs.readFileSync(p), 200, {
          "Content-Type": mime[ext] || "application/octet-stream",
          "Cache-Control": "public, max-age=86400",
        });
      }
    } catch { /* падни на SPA fallback */ }
  }
  // Serve index.html for all other routes (SPA)
  try {
    const fs = await import("fs");
    const html = fs.readFileSync(STATIC_ROOT + "/index.html", "utf-8");
    return c.html(html);
  } catch {
    return c.json({ error: "index.html not found" }, 500);
  }
});

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`[BOOT] Server on 0.0.0.0:${port}`);
});
