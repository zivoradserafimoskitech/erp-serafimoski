// PostgreSQL compatibility layer за сите рутери
// Емулира drizzle-orm MySQL API — рутерите работат без промена!

export { getDb, eq, desc, and } from "./pg-compat";
export { closeDb } from "./pg-compat";

// Helper за pg Pool директно ако е потребно
import { Pool } from "pg";

let pool: Pool | null = null;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL required");
    const ssl = process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false };
    pool = new Pool({ connectionString, ssl });
  }
  return pool;
}
