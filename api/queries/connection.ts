// PostgreSQL connection со вистински drizzle-orm

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL required");
    const ssl = process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false };
    pool = new Pool({ connectionString, ssl });
    db = drizzle(pool);
  }
  return db;
}

export function closeDb() {
  if (pool) {
    pool.end();
    pool = null;
    db = null;
  }
}

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL required");
    const ssl = process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false };
    pool = new Pool({ connectionString, ssl });
  }
  return pool;
}
