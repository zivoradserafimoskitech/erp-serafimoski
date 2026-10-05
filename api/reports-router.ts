// Извештаи за раководство:
//  • добивка по купувач, по производ, по машина (од „Добивка по нарачка“ — само нарачки со познат приход и трошок)
//  • оваа година наспроти минатата, по месеци (приходи и расходи од главната книга)
//  • буџет наспроти остварено по позициите на билансот на успех
import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getPool } from "./queries/connection";
import { buildIncomeStatement, IS_REVENUE, IS_EXPENSE, IS_TAX, type AccountBalance } from "@contracts/statements";

const q = async (text: string, params: any[] = []) => (await getPool().query(text, params)).rows as any[];
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const r2 = (n: number) => Math.round(n * 100) / 100;
export const BUDGET_LINES = [...IS_REVENUE, ...IS_EXPENSE, IS_TAX].map((l) => ({ key: l.key, label: l.label, kind: IS_REVENUE.includes(l) ? "revenue" : "expense" }));

async function monthMovements(year: number): Promise<Map<number, AccountBalance[]>> {
  const rows = await q(`SELECT EXTRACT(MONTH FROM e.entry_date)::int AS m, l.account_code AS code, SUM(l.debit - l.credit) AS bal
    FROM gl_lines l JOIN gl_entries e ON e.id = l.entry_id
    WHERE e.entry_date BETWEEN $1 AND $2 AND e.source_type <> 'year_close' GROUP BY 1, 2`, [`${year}-01-01`, `${year}-12-31`]);
  const out = new Map<number, AccountBalance[]>();
  for (const r of rows) { const a = out.get(r.m) ?? []; a.push({ code: r.code, name: "", balance: Number(r.bal) }); out.set(r.m, a); }
  return out;
}

export const reportsRouter = createRouter({
  /** Добивка по купувач и по производ за периодот (нарачки создадени во периодот). */
  profitBy: publicQuery.input(z.object({ from: dateStr, to: dateStr })).query(async ({ input, ctx }) => {
    const mod: any = await import("./router");
    const caller: any = mod.appRouter.createCaller(ctx);
    const rep = await caller.ops.profitabilityReport(input);
    const rows: any[] = rep.rows;
    // по купувач
    const byC = new Map<string, { customer: string; orders: number; revenue: number; cost: number; profit: number }>();
    for (const r of rows) {
      const k = r.customer ?? "—";
      const g = byC.get(k) ?? { customer: k, orders: 0, revenue: 0, cost: 0, profit: 0 };
      g.orders++; g.revenue += r.revenue ?? 0; g.cost += r.actualCost; g.profit += r.profit ?? 0; byC.set(k, g);
    }
    // по производ: добивката на нарачката се дели по удел на ставката во вредноста на нарачката
    const ids = rows.map((r) => r.orderId);
    const items = ids.length ? await q(`SELECT oi.order_id, oi.product_id, oi.total_price, oi.quantity, COALESCE(p.name, oi.description) AS name
      FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ANY($1::int[])`, [ids]) : [];
    const byP = new Map<string, { product: string; qty: number; revenue: number; cost: number; profit: number; orders: Set<number> }>();
    for (const r of rows) {
      const its = items.filter((i) => Number(i.order_id) === Number(r.orderId));
      const tot = its.reduce((s, i) => s + Number(i.total_price), 0);
      for (const i of its) {
        const share = tot > 0 ? Number(i.total_price) / tot : 1 / its.length;
        const k = i.product_id ? `p${i.product_id}` : `d:${i.name}`;
        const g = byP.get(k) ?? { product: i.name, qty: 0, revenue: 0, cost: 0, profit: 0, orders: new Set<number>() };
        g.qty += Number(i.quantity); g.revenue += (r.revenue ?? 0) * share; g.cost += r.actualCost * share; g.profit += (r.profit ?? 0) * share; g.orders.add(r.orderId);
        byP.set(k, g);
      }
    }
    const fin = (g: any) => ({ ...g, revenue: r2(g.revenue), cost: r2(g.cost), profit: r2(g.profit), marginPct: g.revenue ? r2((g.profit / g.revenue) * 100) : null });
    return {
      byCustomer: [...byC.values()].map(fin).sort((a, b) => b.profit - a.profit),
      byProduct: [...byP.values()].map((g) => fin({ ...g, orders: g.orders.size })).sort((a, b) => b.profit - a.profit),
      totals: rep.totals,
    };
  }),

  /** По машина: часови и трошок на завршени операции, искористеност, приход распределен по удел во трошокот на налогот. */
  profitByMachine: publicQuery.input(z.object({ from: dateStr, to: dateStr })).query(async ({ input }) => {
    const machines = await q(`SELECT id, name, COALESCE(hours_per_day, 8) AS hpd, cost_per_hour FROM machines WHERE COALESCE(is_active, 'active') = 'active' ORDER BY name`);
    const ops = await q(`SELECT o.machine_id, o.work_order_id, COALESCE(NULLIF(o.actual_time, 0), o.estimated_time, 0) AS h, o.cost_amount
      FROM work_order_operations o JOIN work_orders w ON w.id = o.work_order_id
      WHERE o.status = 'completed' AND COALESCE(w.actual_end, w.updated_at)::date BETWEEN $1 AND $2`, [input.from, input.to]);
    const woCost = new Map<number, number>();
    for (const r of await q(`SELECT id, cost_amount FROM work_orders WHERE id = ANY($1::int[])`, [[...new Set(ops.map((o) => Number(o.work_order_id)))]])) woCost.set(Number(r.id), Number(r.cost_amount));
    const woRev = new Map<number, number>();
    for (const r of await q(`SELECT w.id, COALESCE(SUM(CASE WHEN i.invoice_type = 'credit_note' THEN -ABS(i.subtotal) ELSE i.subtotal END), 0) AS rev FROM work_orders w
      LEFT JOIN invoices i ON i.order_id = w.order_id AND i.invoice_type IN ('standard','credit_note') AND i.status NOT IN ('draft','cancelled') AND i.currency = 'MKD'
      WHERE w.id = ANY($1::int[]) GROUP BY w.id`, [[...new Set(ops.map((o) => Number(o.work_order_id)))]])) woRev.set(Number(r.id), Number(r.rev));
    let days = 0;
    for (let d = new Date(input.from + "T00:00:00Z"); d <= new Date(input.to + "T00:00:00Z"); d = new Date(d.getTime() + 86400000)) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) days++; }
    return machines.map((m) => {
      const mo = ops.filter((o) => Number(o.machine_id) === Number(m.id));
      const hours = mo.reduce((s, o) => s + Number(o.h), 0), cost = mo.reduce((s, o) => s + Number(o.cost_amount), 0);
      const revenue = mo.reduce((s, o) => { const wc = woCost.get(Number(o.work_order_id)) ?? 0; return s + (wc > 0 ? (woRev.get(Number(o.work_order_id)) ?? 0) * Number(o.cost_amount) / wc : 0); }, 0);
      const available = days * Number(m.hpd);
      return { machineId: m.id, machine: m.name, hours: r2(hours), available: r2(available), utilization: available ? hours / available : null, cost: r2(cost), revenue: r2(revenue),
        contribution: r2(revenue - cost), revenuePerHour: hours ? r2(revenue / hours) : null, ratePerHour: Number(m.cost_per_hour) };
    });
  }),

  /** Оваа година наспроти минатата по месеци: приходи (класа 7), расходи (класа 4), резултат. */
  yearOverYear: publicQuery.input(z.object({ year: z.number().int() })).query(async ({ input }) => {
    const [cur, prev] = await Promise.all([monthMovements(input.year), monthMovements(input.year - 1)]);
    const month = (mm: Map<number, AccountBalance[]>, m: number) => {
      const st = buildIncomeStatement(mm.get(m) ?? []);
      return { revenue: st.totalRevenue, expense: st.totalExpense, result: st.beforeTax };
    };
    const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, current: month(cur, i + 1), previous: month(prev, i + 1) }));
    const sum = (k: "current" | "previous", f: "revenue" | "expense" | "result") => r2(months.reduce((s, m) => s + m[k][f], 0));
    const thisMonth = new Date().getFullYear() === input.year ? new Date().getMonth() + 1 : 12;
    const ytd = (k: "current" | "previous", f: "revenue" | "expense" | "result") => r2(months.filter((m) => m.month <= thisMonth).reduce((s, m) => s + m[k][f], 0));
    return {
      year: input.year, months, upToMonth: thisMonth,
      totals: { current: { revenue: sum("current", "revenue"), expense: sum("current", "expense"), result: sum("current", "result") }, previous: { revenue: sum("previous", "revenue"), expense: sum("previous", "expense"), result: sum("previous", "result") } },
      ytd: { current: { revenue: ytd("current", "revenue"), expense: ytd("current", "expense"), result: ytd("current", "result") }, previous: { revenue: ytd("previous", "revenue"), expense: ytd("previous", "expense"), result: ytd("previous", "result") } },
    };
  }),

  // ===== Буџет =====
  budgetGet: publicQuery.input(z.object({ year: z.number().int() })).query(async ({ input }) => {
    const rows = await q(`SELECT line, month, amount FROM budgets WHERE year = $1`, [input.year]);
    return { lines: BUDGET_LINES, values: rows.map((r) => ({ line: r.line, month: r.month, amount: Number(r.amount) })) };
  }),
  /** Годишен износ по позиција (се дели рамномерно по месеци) или по месеци (12 износи). */
  budgetSave: publicQuery
    .input(z.object({ year: z.number().int(), values: z.array(z.object({ line: z.string().max(40), month: z.number().int().min(0).max(12), amount: z.number() })).max(500) }))
    .mutation(async ({ input }) => {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        await client.query(`DELETE FROM budgets WHERE year = $1`, [input.year]);
        for (const v of input.values) if (v.amount) await client.query(`INSERT INTO budgets (year, line, month, amount) VALUES ($1,$2,$3,$4)`, [input.year, v.line, v.month, v.amount]);
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
      return { success: true };
    }),
  /** Буџет наспроти остварено до месецот (вклучително), по позиција. */
  budgetVsActual: publicQuery.input(z.object({ year: z.number().int(), upToMonth: z.number().int().min(1).max(12) })).query(async ({ input }) => {
    const b = await q(`SELECT line, month, amount FROM budgets WHERE year = $1`, [input.year]);
    const mm = await monthMovements(input.year);
    const all: AccountBalance[] = [];
    for (let m = 1; m <= input.upToMonth; m++) all.push(...(mm.get(m) ?? []));
    const st = buildIncomeStatement(all);
    const actualOf = (key: string) => [...st.revenue, ...st.expense, st.tax].find((r) => r.key === key)?.amount ?? 0;
    const budgetOf = (key: string) => {
      const annual = b.filter((x) => x.line === key && Number(x.month) === 0).reduce((s, x) => s + Number(x.amount), 0);
      const monthly = b.filter((x) => x.line === key && Number(x.month) >= 1 && Number(x.month) <= input.upToMonth).reduce((s, x) => s + Number(x.amount), 0);
      return r2(annual * input.upToMonth / 12 + monthly);
    };
    const rows = BUDGET_LINES.map((l) => {
      const budget = budgetOf(l.key), actual = r2(actualOf(l.key));
      const diff = r2(actual - budget);
      // за приход подобро е повеќе, за расход — помалку
      const good = l.kind === "revenue" ? diff >= 0 : diff <= 0;
      return { ...l, budget, actual, diff, pct: budget ? actual / budget : null, good };
    });
    const sum = (kind: string, f: "budget" | "actual") => r2(rows.filter((r) => r.kind === kind).reduce((s, r) => s + r[f], 0));
    return { rows, upToMonth: input.upToMonth, totals: { revenue: { budget: sum("revenue", "budget"), actual: sum("revenue", "actual") }, expense: { budget: sum("expense", "budget"), actual: sum("expense", "actual") } } };
  }),

  /** Продажба по период: промет, по клиент, по продавач (salesperson на понуда/нарачка). */
  salesSummary: publicQuery.input(z.object({ from: dateStr, to: dateStr })).query(async ({ input }) => {
    const byCustomer = await q(`SELECT COALESCE(c.company, c.name, '—') AS customer, COUNT(i.id)::int AS invoices,
      COALESCE(SUM(CASE WHEN i.invoice_type = 'credit_note' THEN -ABS(i.subtotal) ELSE i.subtotal END), 0) AS revenue
      FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
      WHERE i.invoice_type IN ('standard','credit_note') AND i.status NOT IN ('draft','cancelled')
        AND i.issue_date BETWEEN $1 AND $2
      GROUP BY 1 ORDER BY revenue DESC LIMIT 100`, [input.from, input.to]);
    const bySalesperson = await q(`SELECT COALESCE(NULLIF(o.salesperson, ''), NULLIF(qt.salesperson, ''), NULLIF(i.salesperson, ''), '—') AS salesperson,
      COUNT(DISTINCT o.id)::int AS orders, COALESCE(SUM(o.total_amount), 0) AS order_total,
      COUNT(DISTINCT i.id)::int AS invoices, COALESCE(SUM(CASE WHEN i.invoice_type = 'credit_note' THEN -ABS(i.subtotal) ELSE i.subtotal END), 0) AS invoice_revenue
      FROM orders o
      LEFT JOIN quotations qt ON qt.id = o.quote_id OR qt.converted_order_id = o.id
      LEFT JOIN invoices i ON i.order_id = o.id AND i.invoice_type IN ('standard','credit_note') AND i.status NOT IN ('draft','cancelled')
      WHERE o.status <> 'cancelled' AND o.created_at::date BETWEEN $1 AND $2
      GROUP BY 1 ORDER BY order_total DESC LIMIT 50`, [input.from, input.to]).catch(() => []);
    const totals = await q(`SELECT COUNT(*)::int AS n,
      COALESCE(SUM(CASE WHEN invoice_type = 'credit_note' THEN -ABS(subtotal) ELSE subtotal END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN invoice_type = 'credit_note' THEN -ABS(vat_amount) ELSE vat_amount END), 0) AS vat
      FROM invoices WHERE invoice_type IN ('standard','credit_note') AND status NOT IN ('draft','cancelled') AND issue_date BETWEEN $1 AND $2`, [input.from, input.to]);
    return {
      from: input.from, to: input.to,
      totals: { invoices: totals[0]?.n ?? 0, revenue: Number(totals[0]?.revenue ?? 0), vat: Number(totals[0]?.vat ?? 0) },
      byCustomer: byCustomer.map((r) => ({ customer: r.customer, invoices: r.invoices, revenue: Number(r.revenue) })),
      bySalesperson: bySalesperson.map((r) => ({ salesperson: r.salesperson, orders: r.orders, orderTotal: Number(r.order_total), invoices: Number(r.invoices ?? 0), invoiceRevenue: Number(r.invoice_revenue ?? 0) })),
    };
  }),
});
