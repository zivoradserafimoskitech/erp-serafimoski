// Вработени и плати: регистар, часови од скенирање на подот, месечна пресметка со подесливи стапки.
// Само администратор (платите се доверливи).
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { getPool } from "./queries/connection";
import { iso } from "./rates-helper";
import { calcPayroll, DEFAULT_PAYROLL, round2, splitContributions, type PayrollParams } from "@contracts/finance";

const q = async (text: string, params: any[] = []) => (await getPool().query(text, params)).rows as any[];
const period = z.string().regex(/^\d{4}-\d{2}$/);
const paramsSchema = z.object({ contributionRate: z.number().min(0).max(60), incomeTaxRate: z.number().min(0).max(50), personalExemption: z.number().min(0) });

const mapEmp = (e: any) => ({
  id: e.id, fullName: e.full_name, position: e.position, scanName: e.scan_name, grossSalary: Number(e.gross_salary), hourlyCost: Number(e.hourly_cost),
  startDate: e.start_date ? iso(e.start_date) : null, endDate: e.end_date ? iso(e.end_date) : null, bankAccount: e.bank_account, notes: e.notes, isActive: e.is_active,
  embg: e.embg ?? null, annualLeaveDays: Number(e.annual_leave_days ?? 20),
});

export const ABSENCE_KINDS: Record<string, string> = { annual: "Годишен одмор", sick: "Боледување", unpaid: "Неплатено отсуство", paid_other: "Платено отсуство (свадба, смрт...)", holiday: "Државен празник" };
/** Работни денови меѓу два датума (без сабота и недела). */
const workdaysBetween = (a: string, b: string) => {
  let n = 0;
  for (let d = new Date(a + "T00:00:00Z"); d <= new Date(b + "T00:00:00Z"); d = new Date(d.getTime() + 86400000)) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
};
const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
      embg: z.string().regex(/^\d{13}$/, "ЕМБГ има 13 цифри").optional().or(z.literal("")), annualLeaveDays: z.number().int().min(0).max(60).default(20),
    }))
    .mutation(async ({ input }) => {
      const vals = [input.fullName, input.position ?? null, input.scanName ?? null, input.grossSalary, input.hourlyCost, input.startDate || null, input.endDate || null, input.bankAccount ?? null, input.notes ?? null, input.isActive, input.embg || null, input.annualLeaveDays];
      if (input.id) {
        await q(`UPDATE employees SET full_name=$1, position=$2, scan_name=$3, gross_salary=$4, hourly_cost=$5, start_date=$6, end_date=$7, bank_account=$8, notes=$9, is_active=$10, embg=$11, annual_leave_days=$12 WHERE id=$13`, [...vals, input.id]);
        return { success: true, id: input.id };
      }
      const r = await q(`INSERT INTO employees (full_name, position, scan_name, gross_salary, hourly_cost, start_date, end_date, bank_account, notes, is_active, embg, annual_leave_days)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, vals);
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

  // ===== Отсуства: годишен одмор, боледување... =====
  absenceList: publicQuery.input(z.object({ year: z.number().int() })).query(async ({ input }) => {
    const rows = await q(`SELECT a.*, e.full_name FROM employee_absences a JOIN employees e ON e.id = a.employee_id
      WHERE a.date_to >= $1 AND a.date_from <= $2 ORDER BY a.date_from DESC`, [`${input.year}-01-01`, `${input.year}-12-31`]);
    const emps = await q(`SELECT id, full_name, COALESCE(annual_leave_days, 20) AS ald FROM employees WHERE is_active = 'active' ORDER BY full_name`);
    const used = (id: number, kind: string) => rows.filter((r) => Number(r.employee_id) === id && r.kind === kind).reduce((s, r) => s + Number(r.days), 0);
    return {
      absences: rows.map((r) => ({ id: r.id, employeeId: r.employee_id, name: r.full_name, kind: r.kind, label: ABSENCE_KINDS[r.kind] ?? r.kind, from: iso(r.date_from), to: iso(r.date_to), days: Number(r.days), note: r.note })),
      balance: emps.map((e) => ({ employeeId: e.id, name: e.full_name, entitled: Number(e.ald), annualUsed: used(e.id, "annual"), annualLeft: Number(e.ald) - used(e.id, "annual"), sick: used(e.id, "sick"), unpaid: used(e.id, "unpaid") })),
    };
  }),
  absenceSave: publicQuery
    .input(z.object({ id: z.number().optional(), employeeId: z.number(), kind: z.enum(Object.keys(ABSENCE_KINDS) as [string, ...string[]]), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), days: z.number().min(0.5).max(366).optional(), note: z.string().optional() }))
    .mutation(async ({ input }) => {
      if (input.to < input.from) throw new TRPCError({ code: "BAD_REQUEST", message: "Крајот е пред почетокот" });
      const days = input.days ?? workdaysBetween(input.from, input.to);
      const overlap = (await q(`SELECT 1 FROM employee_absences WHERE employee_id = $1 AND date_to >= $2 AND date_from <= $3 ${input.id ? "AND id <> $4" : ""}`,
        input.id ? [input.employeeId, input.from, input.to, input.id] : [input.employeeId, input.from, input.to]))[0];
      if (overlap) throw new TRPCError({ code: "BAD_REQUEST", message: "Вработениот веќе има отсуство во тој период" });
      if (input.id) await q(`UPDATE employee_absences SET employee_id=$1, kind=$2, date_from=$3, date_to=$4, days=$5, note=$6 WHERE id=$7`, [input.employeeId, input.kind, input.from, input.to, days, input.note ?? null, input.id]);
      else await q(`INSERT INTO employee_absences (employee_id, kind, date_from, date_to, days, note) VALUES ($1,$2,$3,$4,$5,$6)`, [input.employeeId, input.kind, input.from, input.to, days, input.note ?? null]);
      return { success: true, days };
    }),
  absenceDelete: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await q(`DELETE FROM employee_absences WHERE id = $1`, [input.id]);
    return { success: true };
  }),

  /** Платни листи за месецот: пресметка, придонеси по фондови, часови, отсуства во месецот. */
  payslips: publicQuery.input(z.object({ period })).query(async ({ input }) => {
    const run = (await q(`SELECT * FROM payroll_runs WHERE period = $1`, [input.period]))[0];
    if (!run) return null;
    const params = JSON.parse(run.params || "{}") as PayrollParams;
    const lines = await q(`SELECT l.*, e.full_name, e.position, e.bank_account, e.embg FROM payroll_lines l JOIN employees e ON e.id = l.employee_id WHERE l.run_id = $1 ORDER BY e.full_name`, [run.id]);
    const [y, m] = input.period.split("-").map(Number);
    const from = `${input.period}-01`, to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const abs = await q(`SELECT employee_id, kind, SUM(days) AS d FROM employee_absences WHERE date_from <= $2 AND date_to >= $1 GROUP BY 1, 2`, [from, to]);
    return {
      period: input.period, status: run.status, params, workdays: workdaysBetween(from, to),
      slips: lines.map((l) => ({
        employeeId: Number(l.employee_id), name: l.full_name, position: l.position, embg: l.embg, bankAccount: l.bank_account,
        gross: Number(l.gross), contributions: Number(l.contributions), contributionParts: splitContributions(Number(l.gross), params.contributionRate ?? 28),
        personalExemption: params.personalExemption, taxBase: Number(l.tax_base), incomeTax: Number(l.income_tax), net: Number(l.net), hours: Number(l.hours),
        absences: abs.filter((a) => Number(a.employee_id) === Number(l.employee_id)).map((a) => ({ kind: a.kind, label: ABSENCE_KINDS[a.kind] ?? a.kind, days: Number(a.d) })),
      })),
    };
  }),

  /**
   * МПИН (месечна пресметка за интегрирана наплата) — XML за проверка/увоз.
   * Тагови и редослед се според нашето разбирање на образецот; сметководителот го проверува пред поднесување во е-ПДД.
   */
  mpinXml: publicQuery.input(z.object({ period })).query(async ({ input }) => {
    const run = (await q(`SELECT * FROM payroll_runs WHERE period = $1`, [input.period]))[0];
    if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Нема пресметка за тој месец" });
    const params = JSON.parse(run.params || "{}") as PayrollParams;
    const co = (await q(`SELECT name, edb, embs, address FROM company_settings LIMIT 1`))[0] ?? {};
    const lines = await q(`SELECT l.*, e.full_name, e.embg FROM payroll_lines l JOIN employees e ON e.id = l.employee_id WHERE l.run_id = $1 ORDER BY e.full_name`, [run.id]);
    const missing = lines.filter((l) => !/^\d{13}$/.test(String(l.embg ?? ""))).map((l) => l.full_name);
    const [y, m] = input.period.split("-");
    const rows = lines.map((l, i) => {
      const parts = splitContributions(Number(l.gross), params.contributionRate ?? 28);
      const p = (k: string) => parts.find((x) => x.key === k)!.amount.toFixed(2);
      return `    <Vraboten RedenBroj="${i + 1}">
      <EMBG>${esc(l.embg)}</EMBG>
      <ImePrezime>${esc(l.full_name)}</ImePrezime>
      <BrutoPlata>${Number(l.gross).toFixed(2)}</BrutoPlata>
      <PridonesPIO>${p("pio")}</PridonesPIO>
      <PridonesZdravstvo>${p("health")}</PridonesZdravstvo>
      <PridonesVrabotuvanje>${p("employment")}</PridonesVrabotuvanje>
      <PridonesDopolnitelnoZdravstvo>${p("extra_health")}</PridonesDopolnitelnoZdravstvo>
      <LicnoOsloboduvanje>${Number(params.personalExemption ?? 0).toFixed(2)}</LicnoOsloboduvanje>
      <DanocnaOsnova>${Number(l.tax_base).toFixed(2)}</DanocnaOsnova>
      <PersonalenDanok>${Number(l.income_tax).toFixed(2)}</PersonalenDanok>
      <NetoPlata>${Number(l.net).toFixed(2)}</NetoPlata>
      <Casovi>${Number(l.hours).toFixed(0)}</Casovi>
    </Vraboten>`;
    }).join("\n");
    const sum = (k: string) => lines.reduce((s, l) => s + Number(l[k]), 0).toFixed(2);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- МПИН ${m}/${y} — предлог од ERP; проверете ги полињата со сметководителот пред поднесување во е-ПДД -->
<MPIN>
  <Obvrznik>
    <EDB>${esc(co.edb)}</EDB>
    <EMBS>${esc(co.embs)}</EMBS>
    <Naziv>${esc(co.name)}</Naziv>
    <Adresa>${esc(co.address)}</Adresa>
  </Obvrznik>
  <Period><Godina>${y}</Godina><Mesec>${m}</Mesec></Period>
  <Stapki Pridonesi="${params.contributionRate}" Danok="${params.incomeTaxRate}" LicnoOsloboduvanje="${params.personalExemption}"/>
  <Vraboteni Broj="${lines.length}">
${rows}
  </Vraboteni>
  <Vkupno>
    <Bruto>${sum("gross")}</Bruto>
    <Pridonesi>${sum("contributions")}</Pridonesi>
    <PersonalenDanok>${sum("income_tax")}</PersonalenDanok>
    <Neto>${sum("net")}</Neto>
  </Vkupno>
</MPIN>
`;
    return { xml, fileName: `MPIN-${y}-${m}.xml`, missingEmbg: missing };
  }),
});
