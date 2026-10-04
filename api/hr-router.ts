// Вработени и плати: регистар, часови од скенирање на подот, месечна пресметка со подесливи стапки.
// Само администратор (платите се доверливи).
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { getPool } from "./queries/connection";
import { iso } from "./rates-helper";
import { calcPayroll, DEFAULT_PAYROLL, round2, type PayrollParams } from "@contracts/finance";

const q = async (text: string, params: any[] = []) => (await getPool().query(text, params)).rows as any[];
const period = z.string().regex(/^\d{4}-\d{2}$/);
const paramsSchema = z.object({ contributionRate: z.number().min(0).max(60), incomeTaxRate: z.number().min(0).max(50), personalExemption: z.number().min(0) });

const mapEmp = (e: any) => ({
  id: e.id, fullName: e.full_name, position: e.position, scanName: e.scan_name, grossSalary: Number(e.gross_salary), hourlyCost: Number(e.hourly_cost),
  startDate: e.start_date ? iso(e.start_date) : null, endDate: e.end_date ? iso(e.end_date) : null, bankAccount: e.bank_account, notes: e.notes, isActive: e.is_active,
});

/** Часови по вработен за месецот, од скенирањата на подот (оператор = име за скенирање или целото име). */
async function hoursFor(per: string) {
  const [y, m] = per.split("-").map(Number);
  const from = `${per}-01`;
  const to = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const rows = await q(`SELECT LOWER(TRIM(operator)) AS op, SUM(COALESCE(minutes, EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at)) / 60)) AS mins
    FROM operation_time_logs WHERE started_at >= $1 AND started_at < $2 AND operator IS NOT NULL GROUP BY 1`, [from, to]);
  return new Map(rows.map(r => [r.op, Number(r.mins) / 60]));
}

export const hrRouter = createRouter({
  employeesList: publicQuery
    .input(z.object({ includeInactive: z.boolean().default(false), period: period.optional() }).optional())
    .query(async ({ input }) => {
      const rows = await q(`SELECT * FROM employees ${input?.includeInactive ? "" : "WHERE is_active = 'active'"} ORDER BY full_name`);
      const per = input?.period ?? new Date().toISOString().slice(0, 7);
      const hours = await hoursFor(per);
      return rows.map(e => {
        const h = hours.get(String(e.scan_name || e.full_name).trim().toLowerCase()) ?? 0;
        return { ...mapEmp(e), hoursThisPeriod: round2(h) };
      });
    }),

  employeeUpsert: publicQuery
    .input(z.object({
      id: z.number().optional(), fullName: z.string().min(3), position: z.string().optional(), scanName: z.string().optional(),
      grossSalary: z.number().min(0), hourlyCost: z.number().min(0).default(0), startDate: z.string().optional(), endDate: z.string().optional(),
      bankAccount: z.string().optional(), notes: z.string().optional(), isActive: z.enum(["active", "inactive"]).default("active"),
    }))
    .mutation(async ({ input }) => {
      const vals = [input.fullName, input.position ?? null, input.scanName ?? null, input.grossSalary, input.hourlyCost, input.startDate || null, input.endDate || null, input.bankAccount ?? null, input.notes ?? null, input.isActive];
      if (input.id) {
        await q(`UPDATE employees SET full_name=$1, position=$2, scan_name=$3, gross_salary=$4, hourly_cost=$5, start_date=$6, end_date=$7, bank_account=$8, notes=$9, is_active=$10 WHERE id=$11`, [...vals, input.id]);
        return { success: true, id: input.id };
      }
      const r = await q(`INSERT INTO employees (full_name, position, scan_name, gross_salary, hourly_cost, start_date, end_date, bank_account, notes, is_active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, vals);
      return { success: true, id: r[0].id };
    }),

  payrollDefaults: publicQuery.query(() => DEFAULT_PAYROLL),

  payrollGet: publicQuery
    .input(z.object({ period }))
    .query(async ({ input }) => {
      const run = (await q(`SELECT * FROM payroll_runs WHERE period = $1`, [input.period]))[0];
      if (!run) return null;
      const lines = await q(`SELECT l.*, e.full_name, e.position, e.bank_account FROM payroll_lines l JOIN employees e ON e.id = l.employee_id WHERE l.run_id = $1 ORDER BY e.full_name`, [run.id]);
      return {
        id: run.id, period: run.period, status: run.status, params: JSON.parse(run.params || "{}") as PayrollParams,
        lines: lines.map(l => ({ id: l.id, employeeId: l.employee_id, name: l.full_name, position: l.position, bankAccount: l.bank_account,
          gross: Number(l.gross), contributions: Number(l.contributions), taxBase: Number(l.tax_base), incomeTax: Number(l.income_tax), net: Number(l.net), hours: Number(l.hours) })),
      };
    }),

  payrollCalculate: publicQuery
    .input(z.object({ period, params: paramsSchema, grossOverrides: z.record(z.string(), z.number()).optional() }))
    .mutation(async ({ input }) => {
      const existing = (await q(`SELECT * FROM payroll_runs WHERE period = $1`, [input.period]))[0];
      if (existing?.status === "posted") throw new TRPCError({ code: "BAD_REQUEST", message: "Платата за овој месец е веќе книжена — прво откажи го книжењето" });
      const emps = await q(`SELECT * FROM employees WHERE is_active = 'active' ORDER BY full_name`);
      if (!emps.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Нема активни вработени" });
      const hours = await hoursFor(input.period);
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        let runId: number;
        if (existing) {
          runId = existing.id;
          await client.query(`DELETE FROM payroll_lines WHERE run_id = $1`, [runId]);
          await client.query(`UPDATE payroll_runs SET params = $2, status = 'draft' WHERE id = $1`, [runId, JSON.stringify(input.params)]);
        } else {
          runId = (await client.query(`INSERT INTO payroll_runs (period, params) VALUES ($1,$2) RETURNING id`, [input.period, JSON.stringify(input.params)])).rows[0].id;
        }
        for (const e of emps) {
          const gross = input.grossOverrides?.[String(e.id)] ?? Number(e.gross_salary);
          const c = calcPayroll(gross, input.params);
          const h = hours.get(String(e.scan_name || e.full_name).trim().toLowerCase()) ?? 0;
          await client.query(`INSERT INTO payroll_lines (run_id, employee_id, gross, contributions, tax_base, income_tax, net, hours) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [runId, e.id, c.gross, c.contributions, c.taxBase, c.incomeTax, c.net, round2(h)]);
        }
        await client.query("COMMIT");
        return { success: true, runId };
      } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    }),

  payrollPost: publicQuery
    .input(z.object({ period, post: z.boolean() }))
    .mutation(async ({ input }) => {
      const run = (await q(`SELECT * FROM payroll_runs WHERE period = $1`, [input.period]))[0];
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Нема пресметка за тој месец" });
      {
        const [y, m] = input.period.split("-").map(Number);
        const { assertOpen } = await import("./period-lock");
        await assertOpen(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10), `Плати за ${input.period}`);
      }
      await q(`UPDATE payroll_runs SET status = $2 WHERE id = $1`, [run.id, input.post ? "posted" : "draft"]);
      // главната книга се усогласува автоматски
      const { syncLedger } = await import("./finance-router");
      await syncLedger().catch(() => {});
      return { success: true };
    }),
});
