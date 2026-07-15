// PostgreSQL compatibility layer — емулира drizzle-orm MySQL API
// Сите рутери работат без промена!

import { Pool } from "pg";

let pool: Pool | null = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL required");
    pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

// Конвертира ? params во $1, $2...
function toPgSql(sql: string): string {
  let i = 1;
  return sql.replace(/\?/g, () => `$${i++}`);
}

// Емулација на drizzle-orm select().from().where()
class PgQueryBuilder {
  private table: string = "";
  private tableData: any;
  private conditions: string[] = [];
  private values: any[] = [];
  private orderCol: string = "";
  private orderDir: string = "";
  private limitVal?: number;

  from(tableData: any) {
    this.tableData = tableData;
    // Extract table name from pgTable definition
    this.table = tableData._?.name || tableData.name || "";
    return this;
  }

  where(condition: any) {
    // Handle drizzle eq() conditions
    if (condition && condition.type === "eq") {
      this.conditions.push(`${condition.column} = $${this.values.length + 1}`);
      this.values.push(condition.value);
    } else if (condition && condition.type === "and") {
      for (const c of condition.conditions || []) {
        this.where(c);
      }
    } else if (condition && condition.type === "desc") {
      // This is orderBy, not where
      this.orderCol = condition.column;
      this.orderDir = "DESC";
    }
    return this;
  }

  orderBy(condition: any) {
    if (condition && condition.type === "desc") {
      this.orderCol = condition.column;
      this.orderDir = "DESC";
    } else if (typeof condition === "string") {
      this.orderCol = condition;
    }
    return this;
  }

  limit(n: number) {
    this.limitVal = n;
    return this;
  }

  async execute() {
    const pool = getPool();
    let sql = `SELECT * FROM ${this.table}`;
    if (this.conditions.length > 0) {
      sql += ` WHERE ${this.conditions.join(" AND ")}`;
    }
    if (this.orderCol) {
      sql += ` ORDER BY ${this.orderCol} ${this.orderDir || "ASC"}`;
    }
    if (this.limitVal) {
      sql += ` LIMIT ${this.limitVal}`;
    }
    const result = await pool.query(sql, this.values);
    return result.rows;
  }
}

// eq() емулација
function eq(column: any, value: any) {
  const colName = typeof column === "string" ? column : (column.name || column._?.name || "id");
  return { type: "eq", column: colName, value };
}

// desc() емулација  
function desc(column: any) {
  const colName = typeof column === "string" ? column : (column.name || column._?.name || "id");
  return { type: "desc", column: colName };
}

// and() емулација
function and(...conditions: any[]) {
  return { type: "and", conditions };
}

// Главен DB wrapper
export function getDb() {
  const pool = getPool();
  
  return {
    select: () => new PgQueryBuilder(),
    
    insert: (tableData: any) => ({
      values: async (data: any) => {
        const table = tableData._?.name || tableData.name || "";
        const keys = Object.keys(data);
        const vals = Object.values(data);
        const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
        const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders}) RETURNING *`;
        const result = await pool.query(sql, vals);
        return result.rows;
      }
    }),
    
    update: (tableData: any) => ({
      set: (data: any) => ({
        where: async (condition: any) => {
          const table = tableData._?.name || tableData.name || "";
          const setClause = Object.keys(data).map((k, i) => `${k} = $${i + 1}`).join(", ");
          const vals = Object.values(data);
          let sql = `UPDATE ${table} SET ${setClause}`;
          if (condition && condition.type === "eq") {
            sql += ` WHERE ${condition.column} = $${vals.length + 1}`;
            vals.push(condition.value);
          }
          sql += " RETURNING *";
          const result = await pool.query(sql, vals);
          return result.rows;
        }
      })
    }),
    
    delete: (tableData: any) => ({
      where: async (condition: any) => {
        const table = tableData._?.name || tableData.name || "";
        let sql = `DELETE FROM ${table}`;
        if (condition && condition.type === "eq") {
          sql += ` WHERE ${condition.column} = $1`;
        }
        sql += " RETURNING *";
        const result = await pool.query(sql, [condition.value]);
        return result.rows;
      }
    }),
    
    // Raw execute for SQL queries
    execute: async (sql: string, params?: any[]) => {
      const pgSql = params && params.length > 0 ? toPgSql(sql) : sql;
      const result = await pool.query(pgSql, params);
      return [result.rows, result.fields || []];
    },
    
    query: async (sql: string, params?: any[]) => {
      return pool.query(sql, params);
    }
  };
}

// Re-export for router compatibility
export { eq, desc, and };
