// PostgreSQL connection со вистински drizzle-orm

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// Компатибилен слој: секој insert().values() автоматски враќа insertId (како MySQL)
// за да не се менуваат 58 места низ рутерите по миграцијата на Postgres.
function wrapDb(real: any) {
  return new Proxy(real, {
    get(target, prop) {
      if (prop === "insert") {
        return (table: any) => {
          const builder = target.insert(table);
          return new Proxy(builder, {
            get(bt, bprop) {
              if (bprop === "values") {
                return (data: any) => {
                  const q = bt.values(data);
                  const idCol = table?.id;
                  if (!idCol || typeof q.returning !== "function") return q;
                  const withRet = q.returning({ insertId: idCol });
                  return withRet;
                };
              }
              const v = (bt as any)[bprop];
              return typeof v === "function" ? v.bind(bt) : v;
            },
          });
        };
      }
      const v = (target as any)[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}


let pool: Pool | null = null;
let db: any | null = null;

export function getDb() {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL required");
    const ssl = process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false };
    pool = new Pool({ connectionString, ssl });
    db = wrapDb(drizzle(pool));
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
