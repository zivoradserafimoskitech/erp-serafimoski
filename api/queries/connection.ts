// PostgreSQL connection со вистински drizzle-orm

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// Компатибилен слој: секој insert().values() автоматски враќа insertId (како MySQL)
// за да не се менуваат 58 места низ рутерите по миграцијата на Postgres.

// "" од форми кон numeric/date/int колони → undefined (PG одбива празен string за не-текст типови)
const TEXT_COLUMN_TYPES = new Set(["PgVarchar", "PgText", "PgChar"]);
function sanitizeRow(table: any, row: any) {
  if (!row || typeof row !== "object") return row;
  const out: any = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === "") {
      const col = table?.[k];
      const ct = col?.columnType;
      if (ct && !TEXT_COLUMN_TYPES.has(ct)) continue; // испушти → DB default / NULL
    }
    out[k] = v;
  }
  return out;
}
function sanitizeValues(table: any, data: any) {
  return Array.isArray(data) ? data.map((r) => sanitizeRow(table, r)) : sanitizeRow(table, data);
}

function wrapDb(real: any) {
  return new Proxy(real, {
    get(target, prop) {
      if (prop === "update") {
        return (table: any) => {
          const builder = target.update(table);
          return new Proxy(builder, {
            get(bt, bprop) {
              if (bprop === "set") {
                return (data: any) => bt.set(sanitizeRow(table, data));
              }
              const v = (bt as any)[bprop];
              return typeof v === "function" ? v.bind(bt) : v;
            },
          });
        };
      }
      if (prop === "insert") {
        return (table: any) => {
          const builder = target.insert(table);
          return new Proxy(builder, {
            get(bt, bprop) {
              if (bprop === "values") {
                return (data: any) => {
                  const q = bt.values(sanitizeValues(table, data));
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
