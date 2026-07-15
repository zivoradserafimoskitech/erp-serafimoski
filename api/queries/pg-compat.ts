// PostgreSQL compatibility layer
// Овој модул мора да е external за да работи со pg native bindings

import { Pool } from "pg";

let pool: Pool | null = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL required");
    const ssl = process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false };
    pool = new Pool({ connectionString, ssl });
  }
  return pool;
}

// Конвертира ? params во $1, $2...
function toPgSql(sql: string): string {
  let i = 1;
  return sql.replace(/\?/g, () => `$${i++}`);
}

class PgQueryBuilder {
  private table: string = "";
  private conditions: string[] = [];
  private values: any[] = [];
  private orderCol: string = "";
  private orderDir: string = "";
  private limitVal?: number;

  from(tableData: any) {
    this.table = tableData._?.name || tableData.name || "";
    return this;
  }

  where(condition: any) {
    if (condition && condition.type === "eq") {
      this.conditions.push(`${condition.column} = $${this.values.length + 1}`);
      this.values.push(condition.value);
    } else if (condition && condition.type === "and") {
      for (const c of condition.conditions || []) this.where(c);
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
    if (this.conditions.length > 0) sql += ` WHERE ${this.conditions.join(" AND ")}`;
    if (this.orderCol) sql += ` ORDER BY ${this.orderCol} ${this.orderDir || "ASC"}`;
    if (this.limitVal) sql += ` LIMIT ${this.limitVal}`;
    const result = await pool.query(sql, this.values);
    return result.rows;
  }
}

function eq(column: any, value: any) {
  const colName = typeof column === "string" ? column : (column.name || column._?.name || "id");
  return { type: "eq", column: colName, value };
}

function desc(column: any) {
  const colName = typeof column === "string" ? column : (column.name || column._?.name || "id");
  return { type: "desc", column: colName };
}

function and(...conditions: any[]) {
  return { type: "and", conditions };
}

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
          if (condition?.type === "eq") {
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
        if (condition?.type === "eq") sql += ` WHERE ${condition.column} = $1`;
        sql += " RETURNING *";
        const result = await pool.query(sql, [condition.value]);
        return result.rows;
      }
    }),
    execute: async (sql: string, params?: any[]) => {
      const pgSql = params?.length ? toPgSql(sql) : sql;
      const result = await pool.query(pgSql, params);
      return [result.rows, result.fields || []];
    },
    query: async (sql: string, params?: any[]) => pool.query(sql, params)
  };
}

export function closeDb() {
  if (pool) { pool.end(); pool = null; }
}

export { eq, desc, and };
