import { Pool } from "pg";

let pool: Pool | null = null;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    pool = new Pool({ 
      connectionString,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

// Compatibility wrapper that converts MySQL-style ? params to PostgreSQL $1, $2...
// and adapts result format
export function getDb() {
  const pgPool = getPool();
  
  return {
    execute: async (sql: string, params?: any[]) => {
      // Convert ? placeholders to $1, $2, etc.
      let pgSql = sql;
      if (params && params.length > 0) {
        let paramIndex = 1;
        pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
      }
      
      const result = await pgPool.query(pgSql, params);
      
      // Return in a format compatible with mysql2/promise
      // mysql2 returns [rows, fields] where rows is an array
      // We return a similar structure
      return [result.rows, result.fields || []];
    },
    
    // Raw query for direct pg access
    query: async (sql: string, params?: any[]) => {
      return pgPool.query(sql, params);
    }
  };
}

export function closeDb() {
  if (pool) {
    pool.end();
    pool = null;
  }
}
