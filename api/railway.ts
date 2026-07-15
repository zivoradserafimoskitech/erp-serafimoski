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
    const pool = new Pool({ 
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    const sql = getInitSql();
    const statements = sql.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      if (stmt.trim()) await pool.query(stmt + ';');
    }
    await pool.end();
    return c.json({ status: "tables created", count: statements.length });
  } catch (e: any) {
    return c.json({ status: "error", message: e.message }, 500);
  }
});

// 4. Test customer creation (public, no auth) — GET for easy browser test
app.get("/api/test-customer", async (c) => {
  try {
    // Use raw pg Pool for proper PostgreSQL handling
    const { Pool } = await import("pg");
    const pool = new Pool({ 
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    // Check if table exists
    const tables = await pool.query("SELECT tablename FROM pg_tables WHERE tablename = 'customers'");
    if (tables.rows.length === 0) {
      await pool.end();
      return c.json({ success: false, error: "Табелата customers не постои", hint: "Отвори /api/init-db прво" }, 500);
    }
    
    // Insert with PostgreSQL parameters ($1, $2...)
    const result = await pool.query(
      `INSERT INTO customers (name, company, email, phone, address, city, country, is_active, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW())`,
      ['Тест Клиент', 'Тест ДООЕЛ', 'test@test.mk', '070123456', 'Тест Улица 1', 'Скопје', 'Македонија']
    );
    await pool.end();
    return c.json({ success: true, message: "Клиентот е креиран!", result: result.rowCount });
  } catch (e: any) {
    return c.json({ success: false, error: e.message, stack: e.stack?.substring(0, 200) }, 500);
  }
});

// 3. CORS + tRPC API
app.use("/api/*", cors({
  origin: ["https://web-production-dceb8.up.railway.app", "http://localhost:5173"],
  credentials: true,
}));

app.get(Paths.oauthCallback, createOAuthCallbackHandler());
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});

// 4. Static files (frontend) — LAST!
app.use("*", serveStatic({ root: "./dist/public" }));

app.notFound((c) => {
  const accept = c.req.header("accept") ?? "";
  if (accept.includes("text/html")) {
    return c.redirect("/");
  }
  return c.json({ error: "Not Found" }, 404);
});

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`[BOOT] Server on 0.0.0.0:${port}`);
});
