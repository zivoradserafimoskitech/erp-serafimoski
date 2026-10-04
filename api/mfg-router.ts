// Производство (напредно):
//  • технолошка постапка по производ → операциите на налогот се прават сами
//  • повеќестепен норматив (подсклопови) — разложување до материјали за MRP
//  • застои на машини и OEE (достапност × учинок × квалитет)
//  • квалитет по ISO 9001: план на контрола, записи од мерење, мерни инструменти и калибрации, 8D, оценка на добавувачи
//  • нестинг: извоз на деловите за програмата за распоредување и увоз на резултатот (табли, искористеност, остатоци)
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { getPool } from "./queries/connection";
import { iso } from "./rates-helper";

const q = async (text: string, params: any[] = []) => (await getPool().query(text, params)).rows as any[];
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const actor = (ctx: any) => ctx?.actor?.name ?? null;

export const OPERATIONS = ["cutting_laser", "cutting_plasma", "bending", "welding_mig", "welding_tig", "grinding", "drilling", "painting", "assembly", "quality_control", "packaging"] as const;
export const DOWNTIME_REASONS: Record<string, string> = {
  breakdown: "Дефект / расипување", setup: "Подесување / промена на алат", no_material: "Нема материјал", no_operator: "Нема оператор",
  maintenance: "Планирано одржување", no_work: "Нема работа", other: "Друго",
};

// ───────────── повеќестепен норматив ─────────────

/** Дали `childId` (директно или преку подсклопови) го содржи `productId` — за да нема круг. */
async function containsProduct(childId: number, productId: number, depth = 0): Promise<boolean> {
  if (childId === productId) return true;
  if (depth > 10) return true;
  const subs = await q(`SELECT ref_id FROM product_components WHERE product_id = $1 AND kind = 'product'`, [childId]);
  for (const s of subs) if (await containsProduct(Number(s.ref_id), productId, depth + 1)) return true;
  return false;
}
export async function assertNoCycle(productId: number, subProductId: number) {
  if (await containsProduct(subProductId, productId)) throw bad("Подсклопот (директно или преку свои делови) веќе го содржи овој производ — нормативот би бил во круг");
}

/**
 * Разложување на производ до материјали: количина по единица производ × количина, со отпадот,
 * низ сите нивоа на подсклопови. Норматив по m²/периметар/должина се зема по единица мера на производот.
 */
export async function explodeBom(productId: number, qty: number, out = new Map<number, number>(), depth = 0, path: number[] = []): Promise<Map<number, number>> {
  if (depth > 10 || path.includes(productId)) return out;
  const comps = await q(`SELECT kind, ref_id, per_unit, waste_pct FROM product_components WHERE product_id = $1`, [productId]);
  for (const c of comps) {
    const need = qty * (Number(c.per_unit) || 0) * (1 + (Number(c.waste_pct) || 0) / 100);
    if (need <= 0) continue;
    if (c.kind === "material") out.set(Number(c.ref_id), (out.get(Number(c.ref_id)) ?? 0) + need);
    else if (c.kind === "product") await explodeBom(Number(c.ref_id), need, out, depth + 1, [...path, productId]);
  }
  return out;
}

/** Потреби од отворени нарачки што уште немаат работен налог (по нормативот), со датум на испорака. */
export async function orderBomDemand(): Promise<Map<number, { qty: number; date: string | null; orders: Set<string> }>> {
  const rows = await q(`SELECT o.order_number, o.delivery_date, oi.product_id, oi.quantity FROM orders o JOIN order_items oi ON oi.order_id = o.id
    WHERE o.status IN ('pending', 'confirmed', 'in_production') AND oi.product_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM work_orders w WHERE w.order_id = o.id AND w.status <> 'cancelled')`);
  const out = new Map<number, { qty: number; date: string | null; orders: Set<string> }>();
  for (const r of rows) {
    const m = await explodeBom(Number(r.product_id), Number(r.quantity) || 0);
    const d = r.delivery_date ? iso(r.delivery_date) : null;
    for (const [mid, qn] of m) {
      const g = out.get(mid) ?? { qty: 0, date: null, orders: new Set<string>() };
      g.qty += qn; g.orders.add(r.order_number);
      if (d && (!g.date || d < g.date)) g.date = d;
      out.set(mid, g);
    }
  }
  return out;
}

// ───────────── технолошка постапка ─────────────

const routingStep = z.object({
  operation: z.enum(OPERATIONS), description: z.string().max(500).optional(), machineId: z.number().nullable().optional(),
  setupMin: z.number().min(0).default(0), runMin: z.number().min(0).default(0), notes: z.string().optional(),
});

/** Операции од постапката за производите на налогот (од нарачката или понудата). Постоечките операции не се дуплираат. */
export async function applyRoutingToWorkOrder(woId: number, only?: { productId: number; quantity: number }) {
  const wo = (await q(`SELECT id, order_id, quotation_id FROM work_orders WHERE id = $1`, [woId]))[0];
  if (!wo) throw bad("Налогот не постои");
  let items: { productId: number; quantity: number }[] = [];
  if (only) items = [only];
  else if (wo.order_id) items = (await q(`SELECT product_id, quantity FROM order_items WHERE order_id = $1 AND product_id IS NOT NULL`, [wo.order_id])).map((r) => ({ productId: Number(r.product_id), quantity: Number(r.quantity) || 0 }));
  else if (wo.quotation_id) items = (await q(`SELECT reference_id, quantity FROM quotation_items WHERE quotation_id = $1 AND item_type = 'product' AND reference_id IS NOT NULL`, [wo.quotation_id])).map((r) => ({ productId: Number(r.reference_id), quantity: Number(r.quantity) || 0 }));
  const existing = await q(`SELECT operation, description FROM work_order_operations WHERE work_order_id = $1`, [woId]);
  let seq = Number((await q(`SELECT COALESCE(MAX(sequence), 0) AS m FROM work_order_operations WHERE work_order_id = $1`, [woId]))[0].m);
  let added = 0;
  for (const it of items) {
    const steps = await q(`SELECT r.*, m.cost_per_hour, p.name AS product FROM product_routings r LEFT JOIN machines m ON m.id = r.machine_id
      LEFT JOIN products p ON p.id = r.product_id WHERE r.product_id = $1 ORDER BY r.sequence`, [it.productId]);
    for (const s of steps) {
      const desc = `${s.description || s.operation} — ${s.product ?? ""} × ${it.quantity}`.slice(0, 500);
      if (existing.some((e) => e.operation === s.operation && e.description === desc)) continue;
      const hours = (Number(s.setup_min) + Number(s.run_min) * it.quantity) / 60;
      seq += 10;
      await q(`INSERT INTO work_order_operations (work_order_id, operation, sequence, description, estimated_time, estimated_qty, qty_unit, status, cost_rate, cost_amount, machine_id)
        VALUES ($1,$2,$3,$4,$5,$6,'ком','pending',$7,0,$8)`, [woId, s.operation, seq, desc, hours.toFixed(2), it.quantity, Number(s.cost_per_hour ?? 0).toFixed(2), s.machine_id ?? null]);
      added++;
    }
  }
  if (added) {
    const { recalcWorkOrderCost } = await import("./wo-cost-helper");
    await recalcWorkOrderCost(woId).catch(() => {});
  }
  return { added, products: items.length };
}

// ───────────── OEE ─────────────

const workdays = (from: string, to: string) => {
  let n = 0;
  for (let d = new Date(from + "T00:00:00Z"); d <= new Date(to + "T00:00:00Z"); d = new Date(d.getTime() + 86400000)) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
};

export const mfgRouter = createRouter({
  // ===== Технолошка постапка =====
  routingList: publicQuery.input(z.object({ productId: z.number() })).query(async ({ input }) => {
    const rows = await q(`SELECT r.*, m.name AS machine FROM product_routings r LEFT JOIN machines m ON m.id = r.machine_id WHERE r.product_id = $1 ORDER BY r.sequence`, [input.productId]);
    return rows.map((r) => ({ id: r.id, sequence: r.sequence, operation: r.operation, description: r.description, machineId: r.machine_id, machine: r.machine, setupMin: Number(r.setup_min), runMin: Number(r.run_min), notes: r.notes }));
  }),
  routingSave: publicQuery
    .input(z.object({ productId: z.number(), steps: z.array(routingStep).max(60) }))
    .mutation(async ({ input }) => {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        await client.query(`DELETE FROM product_routings WHERE product_id = $1`, [input.productId]);
        let i = 0;
        for (const s of input.steps) {
          i += 10;
          await client.query(`INSERT INTO product_routings (product_id, sequence, operation, description, machine_id, setup_min, run_min, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [input.productId, i, s.operation, s.description ?? null, s.machineId ?? null, s.setupMin, s.runMin, s.notes ?? null]);
        }
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
      return { success: true, count: input.steps.length };
    }),
  woApplyRouting: publicQuery
    .input(z.object({ workOrderId: z.number(), productId: z.number().optional(), quantity: z.number().positive().optional() }))
    .mutation(async ({ input }) => applyRoutingToWorkOrder(input.workOrderId, input.productId ? { productId: input.productId, quantity: input.quantity ?? 1 } : undefined)),

  /** Норматив разложен до материјали (за преглед во каталогот). */
  bomExplode: publicQuery.input(z.object({ productId: z.number(), quantity: z.number().positive().default(1) })).query(async ({ input }) => {
    const m = await explodeBom(input.productId, input.quantity);
    if (!m.size) return [];
    const mats = await q(`SELECT id, name, unit, current_stock, COALESCE(NULLIF(avg_cost, 0), last_purchase_price, 0) AS price FROM materials WHERE id = ANY($1::int[])`, [[...m.keys()]]);
    return mats.map((x) => ({ materialId: x.id, name: x.name, unit: x.unit, quantity: r3(m.get(Number(x.id)) ?? 0), stock: Number(x.current_stock), cost: r2((m.get(Number(x.id)) ?? 0) * Number(x.price)) }))
      .sort((a, b) => b.cost - a.cost);
  }),

  // ===== Застои и OEE =====
  downtimeList: publicQuery
    .input(z.object({ from: dateStr, to: dateStr, machineId: z.number().optional() }))
    .query(async ({ input }) => {
      const rows = await q(`SELECT d.*, m.name AS machine FROM machine_downtime d LEFT JOIN machines m ON m.id = d.machine_id
        WHERE d.start_at < ($2::date + 1) AND COALESCE(d.end_at, now()) >= $1::date ${input.machineId ? "AND d.machine_id = $3" : ""}
        ORDER BY d.start_at DESC LIMIT 500`, input.machineId ? [input.from, input.to, input.machineId] : [input.from, input.to]);
      return rows.map((r) => ({ id: r.id, machineId: r.machine_id, machine: r.machine, startAt: r.start_at, endAt: r.end_at, reason: r.reason, reasonLabel: DOWNTIME_REASONS[r.reason] ?? r.reason, note: r.note, createdBy: r.created_by,
        minutes: Math.round(((r.end_at ? new Date(r.end_at).getTime() : Date.now()) - new Date(r.start_at).getTime()) / 60000) }));
    }),
  downtimeStart: publicQuery
    .input(z.object({ machineId: z.number(), reason: z.enum(Object.keys(DOWNTIME_REASONS) as [string, ...string[]]), note: z.string().max(500).optional(), startAt: z.string().optional(), endAt: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const open = (await q(`SELECT id FROM machine_downtime WHERE machine_id = $1 AND end_at IS NULL`, [input.machineId]))[0];
      if (open && !input.endAt) throw bad("За оваа машина веќе тече застој — прво заврши го");
      const start = input.startAt ? new Date(input.startAt) : new Date();
      const end = input.endAt ? new Date(input.endAt) : null;
      if (end && end <= start) throw bad("Крајот мора да е по почетокот");
      const r = await q(`INSERT INTO machine_downtime (machine_id, start_at, end_at, reason, note, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [input.machineId, start, end, input.reason, input.note ?? null, actor(ctx)]);
      return { id: r[0].id };
    }),
  downtimeEnd: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await q(`UPDATE machine_downtime SET end_at = now() WHERE id = $1 AND end_at IS NULL`, [input.id]);
    return { success: true };
  }),
  downtimeDelete: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await q(`DELETE FROM machine_downtime WHERE id = $1`, [input.id]);
    return { success: true };
  }),
  /**
   * OEE по машина за периодот:
   *  достапност = (планирано време − застои) / планирано време (работни денови × часови на ден)
   *  учинок     = нормирано време на завршените операции / вистинско време на нив
   *  квалитет   = 1 − неусогласени / произведени (неусогласености поврзани со налози на машината)
   */
  oee: publicQuery.input(z.object({ from: dateStr, to: dateStr })).query(async ({ input }) => {
    const machines = await q(`SELECT id, name, COALESCE(hours_per_day, 8) AS hpd FROM machines WHERE COALESCE(is_active, 'active') = 'active' ORDER BY name`);
    const days = workdays(input.from, input.to);
    const down = await q(`SELECT machine_id, reason,
        SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(end_at, now()), ($2::date + 1)::timestamp) - GREATEST(start_at, $1::date::timestamp))) / 3600) AS h
      FROM machine_downtime WHERE start_at < ($2::date + 1) AND COALESCE(end_at, now()) > $1::date GROUP BY machine_id, reason`, [input.from, input.to]);
    const ops = await q(`SELECT o.machine_id, o.work_order_id, COALESCE(o.estimated_time, 0) AS est, COALESCE(o.actual_time, 0) AS act, COALESCE(o.actual_qty, o.estimated_qty, 0) AS qty
      FROM work_order_operations o JOIN work_orders w ON w.id = o.work_order_id
      WHERE o.status = 'completed' AND o.machine_id IS NOT NULL AND COALESCE(w.actual_end, w.updated_at)::date BETWEEN $1 AND $2`, [input.from, input.to]);
    const issues = await q(`SELECT work_order_id, COUNT(*)::int AS n FROM quality_issues WHERE work_order_id IS NOT NULL AND issue_date BETWEEN $1 AND $2 AND kind = 'internal' GROUP BY work_order_id`, [input.from, input.to]).catch(() => []);
    return machines.map((m) => {
      const planned = days * Number(m.hpd);
      const dm = down.filter((d) => Number(d.machine_id) === Number(m.id));
      // планираното одржување и „нема работа“ не се губиток на достапност
      const lost = dm.filter((d) => !["maintenance", "no_work"].includes(d.reason)).reduce((s, d) => s + Number(d.h), 0);
      const excluded = dm.filter((d) => ["maintenance", "no_work"].includes(d.reason)).reduce((s, d) => s + Number(d.h), 0);
      const base = Math.max(0, planned - excluded);
      const availability = base > 0 ? Math.max(0, (base - lost) / base) : null;
      const mo = ops.filter((o) => Number(o.machine_id) === Number(m.id));
      const est = mo.reduce((s, o) => s + Number(o.est), 0), act = mo.reduce((s, o) => s + Number(o.act), 0);
      const performance = act > 0 ? Math.min(1, est / act) : null;
      const wos = new Set(mo.map((o) => Number(o.work_order_id)));
      const bad = issues.filter((i) => wos.has(Number(i.work_order_id))).reduce((s, i) => s + Number(i.n), 0);
      const quality = wos.size ? Math.max(0, 1 - bad / wos.size) : null;
      const oee = availability !== null && performance !== null && quality !== null ? availability * performance * quality : null;
      return {
        machineId: m.id, machine: m.name, plannedHours: r2(planned), downtimeHours: r2(lost), excludedHours: r2(excluded),
        byReason: Object.fromEntries(dm.map((d) => [d.reason, r2(Number(d.h))])),
        opsCompleted: mo.length, estHours: r2(est), actualHours: r2(act), workOrders: wos.size, qualityIssues: bad,
        availability, performance, quality, oee,
      };
    });
  }),

  // ===== Мерни инструменти и калибрации =====
  instrumentList: publicQuery.query(async () => {
    const rows = await q(`SELECT * FROM instruments ORDER BY status, next_due NULLS LAST, name`);
    const today = new Date().toISOString().slice(0, 10);
    return rows.map((r) => {
      const due = r.next_due ? iso(r.next_due) : null;
      return { id: r.id, name: r.name, code: r.code, serialNo: r.serial_no, range: r.range_text, location: r.location, intervalMonths: r.interval_months,
        lastCalibration: r.last_calibration ? iso(r.last_calibration) : null, nextDue: due, status: r.status, notes: r.notes,
        overdue: !!due && due < today && r.status === "active", dueSoon: !!due && due >= today && due <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) };
    });
  }),
  instrumentSave: publicQuery
    .input(z.object({ id: z.number().optional(), name: z.string().min(1).max(255), code: z.string().max(60).optional(), serialNo: z.string().max(120).optional(),
      range: z.string().max(120).optional(), location: z.string().max(160).optional(), intervalMonths: z.number().int().min(1).max(120).default(12),
      lastCalibration: dateStr.nullable().optional(), status: z.enum(["active", "out", "retired"]).default("active"), notes: z.string().optional() }))
    .mutation(async ({ input }) => {
      const next = input.lastCalibration ? addMonths(input.lastCalibration, input.intervalMonths) : null;
      const vals = [input.name, input.code ?? null, input.serialNo ?? null, input.range ?? null, input.location ?? null, input.intervalMonths, input.lastCalibration ?? null, next, input.status, input.notes ?? null];
      if (input.id) await q(`UPDATE instruments SET name=$1, code=$2, serial_no=$3, range_text=$4, location=$5, interval_months=$6, last_calibration=$7, next_due=$8, status=$9, notes=$10 WHERE id=$11`, [...vals, input.id]);
      else return { id: (await q(`INSERT INTO instruments (name, code, serial_no, range_text, location, interval_months, last_calibration, next_due, status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, vals))[0].id };
      return { id: input.id };
    }),
  instrumentDelete: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await q(`DELETE FROM instruments WHERE id = $1`, [input.id]);
    return { success: true };
  }),
  calibrationList: publicQuery.input(z.object({ instrumentId: z.number() })).query(async ({ input }) =>
    (await q(`SELECT * FROM instrument_calibrations WHERE instrument_id = $1 ORDER BY cal_date DESC`, [input.instrumentId]))
      .map((r) => ({ id: r.id, date: iso(r.cal_date), result: r.result, certificateNo: r.certificate_no, provider: r.provider, nextDue: r.next_due ? iso(r.next_due) : null, notes: r.notes }))),
  calibrationAdd: publicQuery
    .input(z.object({ instrumentId: z.number(), date: dateStr, result: z.enum(["pass", "fail"]), certificateNo: z.string().max(120).optional(), provider: z.string().max(255).optional(), notes: z.string().optional() }))
    .mutation(async ({ input }) => {
      const ins = (await q(`SELECT interval_months FROM instruments WHERE id = $1`, [input.instrumentId]))[0];
      if (!ins) throw bad("Инструментот не постои");
      const next = input.result === "pass" ? addMonths(input.date, Number(ins.interval_months)) : null;
      await q(`INSERT INTO instrument_calibrations (instrument_id, cal_date, result, certificate_no, provider, next_due, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [input.instrumentId, input.date, input.result, input.certificateNo ?? null, input.provider ?? null, next, input.notes ?? null]);
      // неуспешна калибрација → инструментот се вади од употреба
      await q(`UPDATE instruments SET last_calibration = $2, next_due = $3, status = CASE WHEN $4 = 'fail' THEN 'out' ELSE 'active' END WHERE id = $1`,
        [input.instrumentId, input.date, next, input.result]);
      return { success: true, nextDue: next };
    }),

  // ===== План на контрола и записи =====
  inspectionPlanList: publicQuery.input(z.object({ productId: z.number().nullable() })).query(async ({ input }) =>
    (await q(`SELECT p.*, i.name AS instrument FROM inspection_plans p LEFT JOIN instruments i ON i.id = p.instrument_id
      WHERE ${input.productId ? "p.product_id = $1" : "p.product_id IS NULL"} ORDER BY p.sort_order, p.id`, input.productId ? [input.productId] : []))
      .map((r) => ({ id: r.id, operation: r.operation, characteristic: r.characteristic, nominal: r.nominal === null ? null : Number(r.nominal), tolPlus: r.tol_plus === null ? null : Number(r.tol_plus),
        tolMinus: r.tol_minus === null ? null : Number(r.tol_minus), unit: r.unit, instrumentId: r.instrument_id, instrument: r.instrument, frequency: r.frequency, notes: r.notes }))),
  inspectionPlanSave: publicQuery
    .input(z.object({ productId: z.number().nullable(), items: z.array(z.object({
      operation: z.string().max(50).nullable().optional(), characteristic: z.string().min(1).max(255), nominal: z.number().nullable().optional(),
      tolPlus: z.number().nullable().optional(), tolMinus: z.number().nullable().optional(), unit: z.string().max(20).optional(),
      instrumentId: z.number().nullable().optional(), frequency: z.string().max(120).optional(), notes: z.string().optional() })).max(100) }))
    .mutation(async ({ input }) => {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        await client.query(`DELETE FROM inspection_plans WHERE ${input.productId ? "product_id = $1" : "product_id IS NULL"}`, input.productId ? [input.productId] : []);
        let k = 0;
        for (const it of input.items) await client.query(`INSERT INTO inspection_plans (product_id, operation, characteristic, nominal, tol_plus, tol_minus, unit, instrument_id, frequency, sort_order, notes)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [input.productId, it.operation ?? null, it.characteristic, it.nominal ?? null, it.tolPlus ?? null, it.tolMinus ?? null, it.unit ?? "mm", it.instrumentId ?? null, it.frequency ?? null, k++, it.notes ?? null]);
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
      return { success: true };
    }),
  /** Што треба да се измери на налогот: планот за производите на налогот + општиот план. */
  inspectionForWorkOrder: publicQuery.input(z.object({ workOrderId: z.number() })).query(async ({ input }) => {
    const wo = (await q(`SELECT id, wo_number, order_id, quotation_id FROM work_orders WHERE id = $1`, [input.workOrderId]))[0];
    if (!wo) throw bad("Налогот не постои");
    const products = wo.order_id ? (await q(`SELECT DISTINCT product_id FROM order_items WHERE order_id = $1 AND product_id IS NOT NULL`, [wo.order_id])).map((r) => Number(r.product_id))
      : wo.quotation_id ? (await q(`SELECT DISTINCT reference_id FROM quotation_items WHERE quotation_id = $1 AND item_type = 'product' AND reference_id IS NOT NULL`, [wo.quotation_id])).map((r) => Number(r.reference_id)) : [];
    const plan = await q(`SELECT p.*, i.name AS instrument, pr.name AS product FROM inspection_plans p LEFT JOIN instruments i ON i.id = p.instrument_id LEFT JOIN products pr ON pr.id = p.product_id
      WHERE p.product_id IS NULL OR p.product_id = ANY($1::int[]) ORDER BY p.product_id NULLS LAST, p.sort_order`, [products]);
    const records = await q(`SELECT r.*, i.name AS instrument FROM inspection_records r LEFT JOIN instruments i ON i.id = r.instrument_id WHERE r.work_order_id = $1 ORDER BY r.inspected_at`, [input.workOrderId]);
    return {
      woNumber: wo.wo_number,
      plan: plan.map((r) => ({ id: r.id, product: r.product, operation: r.operation, characteristic: r.characteristic, nominal: r.nominal === null ? null : Number(r.nominal),
        tolPlus: r.tol_plus === null ? null : Number(r.tol_plus), tolMinus: r.tol_minus === null ? null : Number(r.tol_minus), unit: r.unit, instrumentId: r.instrument_id, instrument: r.instrument, frequency: r.frequency })),
      records: records.map((r) => ({ id: r.id, planId: r.plan_id, characteristic: r.characteristic, nominal: r.nominal === null ? null : Number(r.nominal), tolPlus: r.tol_plus === null ? null : Number(r.tol_plus),
        tolMinus: r.tol_minus === null ? null : Number(r.tol_minus), measured: r.measured === null ? null : Number(r.measured), result: r.result, sampleNo: r.sample_no, instrument: r.instrument, inspector: r.inspector, at: r.inspected_at, notes: r.notes })),
    };
  }),
  inspectionRecord: publicQuery
    .input(z.object({ workOrderId: z.number(), planId: z.number().nullable().optional(), characteristic: z.string().min(1).max(255), nominal: z.number().nullable().optional(),
      tolPlus: z.number().nullable().optional(), tolMinus: z.number().nullable().optional(), measured: z.number().nullable().optional(),
      okManual: z.boolean().optional(), sampleNo: z.number().int().min(1).default(1), instrumentId: z.number().nullable().optional(), notes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      if (input.instrumentId) {
        const ins = (await q(`SELECT name, status, next_due FROM instruments WHERE id = $1`, [input.instrumentId]))[0];
        if (ins && (ins.status !== "active" || (ins.next_due && iso(ins.next_due) < new Date().toISOString().slice(0, 10))))
          throw bad(`Инструментот „${ins.name}“ не е калибриран (или е изваден од употреба) — мерењето не важи`);
      }
      // резултат: од толеранцијата ако има мерење, инаку рачно OK / не OK
      let result: "ok" | "nok";
      if (input.measured !== null && input.measured !== undefined && input.nominal !== null && input.nominal !== undefined) {
        const lo = input.nominal - Math.abs(input.tolMinus ?? 0), hi = input.nominal + Math.abs(input.tolPlus ?? 0);
        result = input.measured >= lo - 1e-9 && input.measured <= hi + 1e-9 ? "ok" : "nok";
      } else result = input.okManual === false ? "nok" : "ok";
      const r = await q(`INSERT INTO inspection_records (work_order_id, plan_id, characteristic, nominal, tol_plus, tol_minus, measured, result, sample_no, instrument_id, inspector, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [input.workOrderId, input.planId ?? null, input.characteristic, input.nominal ?? null, input.tolPlus ?? null, input.tolMinus ?? null, input.measured ?? null, result, input.sampleNo, input.instrumentId ?? null, actor(ctx), input.notes ?? null]);
      return { id: r[0].id, result };
    }),
  inspectionRecordDelete: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await q(`DELETE FROM inspection_records WHERE id = $1`, [input.id]);
    return { success: true };
  }),

  // ===== 8D =====
  eightDSave: publicQuery
    .input(z.object({ issueId: z.number(), d: z.object({
      d1: z.string().optional(), d2: z.string().optional(), d3: z.string().optional(), d4: z.string().optional(),
      d5: z.string().optional(), d6: z.string().optional(), d7: z.string().optional(), d8: z.string().optional(),
    }) }))
    .mutation(async ({ input }) => {
      await q(`UPDATE quality_issues SET eight_d = $2 WHERE id = $1`, [input.issueId, JSON.stringify(input.d)]);
      // D4 (корен) и D5 (мерки) се и полињата „причина“ и „мерка“ на неусогласеноста
      if (input.d.d4) await q(`UPDATE quality_issues SET root_cause = $2 WHERE id = $1`, [input.issueId, input.d.d4]);
      if (input.d.d5) await q(`UPDATE quality_issues SET action = $2 WHERE id = $1`, [input.issueId, input.d.d5]);
      return { success: true };
    }),
  eightDGet: publicQuery.input(z.object({ issueId: z.number() })).query(async ({ input }) => {
    const r = (await q(`SELECT eight_d, root_cause, action FROM quality_issues WHERE id = $1`, [input.issueId]))[0];
    const d = (r?.eight_d ?? {}) as Record<string, string>;
    return { ...d, d4: d.d4 ?? r?.root_cause ?? "", d5: d.d5 ?? r?.action ?? "" } as Record<string, string>;
  }),

  // ===== Оценка на добавувачи =====
  /** Точност на испорака (прием до очекуваниот датум), неусогласености, отстапување на цената од нарачаната. */
  supplierRating: publicQuery.input(z.object({ from: dateStr, to: dateStr })).query(async ({ input }) => {
    const sups = await q(`SELECT id, name FROM suppliers ORDER BY name`);
    const recs = await q(`SELECT r.supplier_id, r.receipt_date, po.expected_date, po.id AS po_id FROM receipts r LEFT JOIN purchase_orders po ON po.id = r.po_id
      WHERE r.status = 'confirmed' AND r.receipt_date BETWEEN $1 AND $2`, [input.from, input.to]);
    const issues = await q(`SELECT supplier_id, COUNT(*)::int AS n FROM quality_issues WHERE supplier_id IS NOT NULL AND issue_date BETWEEN $1 AND $2 GROUP BY supplier_id`, [input.from, input.to]).catch(() => []);
    const price = await q(`SELECT po.supplier_id, poi.unit_price AS ordered, ri.unit_price AS received FROM receipt_items ri JOIN receipts r ON r.id = ri.receipt_id
      JOIN purchase_order_items poi ON poi.purchase_order_id = r.po_id AND poi.material_id = ri.material_id JOIN purchase_orders po ON po.id = r.po_id
      WHERE r.status = 'confirmed' AND r.receipt_date BETWEEN $1 AND $2 AND poi.unit_price > 0`, [input.from, input.to]).catch(() => []);
    return sups.map((s) => {
      const rs = recs.filter((r) => Number(r.supplier_id) === Number(s.id));
      const withDate = rs.filter((r) => r.expected_date);
      const onTime = withDate.filter((r) => iso(r.receipt_date) <= iso(r.expected_date)).length;
      const nIssues = Number(issues.find((i) => Number(i.supplier_id) === Number(s.id))?.n ?? 0);
      const pv = price.filter((p) => Number(p.supplier_id) === Number(s.id));
      const priceDev = pv.length ? pv.reduce((a, p) => a + (Number(p.received) - Number(p.ordered)) / Number(p.ordered), 0) / pv.length : null;
      const delivery = withDate.length ? onTime / withDate.length : null;
      const quality = rs.length ? Math.max(0, 1 - nIssues / rs.length) : nIssues ? 0 : null;
      const priceScore = priceDev === null ? null : Math.max(0, Math.min(1, 1 - Math.max(0, priceDev) * 5));
      const parts = [[delivery, 0.4], [quality, 0.4], [priceScore, 0.2]].filter(([v]) => v !== null) as [number, number][];
      const score = parts.length ? parts.reduce((a, [v, w]) => a + v * w, 0) / parts.reduce((a, [, w]) => a + w, 0) : null;
      return { supplierId: s.id, supplier: s.name, receipts: rs.length, onTime, withDate: withDate.length, delivery, issues: nIssues, quality,
        priceDeviation: priceDev, score, grade: score === null ? null : score >= 0.9 ? "A" : score >= 0.75 ? "B" : score >= 0.6 ? "C" : "D" };
    }).filter((r) => r.receipts > 0 || r.issues > 0).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }),

  // ===== Нестинг =====
  /** Делови за распоредување од избраните налози: од ставките со DXF цртеж (понуда) и материјалите на налогот. */
  nestingParts: publicQuery.input(z.object({ workOrderIds: z.array(z.number()).min(1).max(50) })).query(async ({ input }) => {
    const wos = await q(`SELECT id, wo_number, quotation_id, order_id FROM work_orders WHERE id = ANY($1::int[])`, [input.workOrderIds]);
    const parts: { workOrder: string; workOrderId: number; part: string; quantity: number; material: string; thickness: string; drawingId: number | null; drawing: string | null; widthMm: number | null; heightMm: number | null }[] = [];
    for (const w of wos) {
      const items = w.quotation_id ? await q(`SELECT description, quantity, notes FROM quotation_items WHERE quotation_id = $1 ORDER BY sort_order, id`, [w.quotation_id]) : [];
      for (const it of items) {
        const m = /Цртеж #(\d+)/.exec(it.notes ?? "");
        if (!m) continue;
        const d = (await q(`SELECT id, file_name, stats FROM cad_drawings WHERE id = $1`, [Number(m[1])]))[0];
        const th = /—\s*([\d.,]+)\s*mm/.exec(it.description)?.[1] ?? "";
        const mat = /mm\s+(.+?)\s*\(/.exec(it.description)?.[1] ?? "";
        parts.push({ workOrder: w.wo_number, workOrderId: w.id, part: d?.file_name?.replace(/\.dxf$/i, "") ?? it.description.slice(0, 60), quantity: Number(it.quantity) || 1,
          material: mat, thickness: th.replace(",", "."), drawingId: d?.id ?? null, drawing: d?.file_name ?? null,
          widthMm: d?.stats?.bbox?.width ? r2(d.stats.bbox.width) : null, heightMm: d?.stats?.bbox?.height ? r2(d.stats.bbox.height) : null });
      }
    }
    return { parts, workOrders: wos.map((w) => ({ id: w.id, number: w.wo_number })) };
  }),
  nestingExportLog: publicQuery.input(z.object({ workOrderIds: z.array(z.number()).min(1), parts: z.any() })).mutation(async ({ input, ctx }) => {
    const r = await q(`INSERT INTO nesting_jobs (work_order_ids, parts, created_by) VALUES ($1,$2,$3) RETURNING id`, [input.workOrderIds, JSON.stringify(input.parts ?? []), actor(ctx)]);
    return { id: r[0].id };
  }),
  /**
   * Увоз на резултатот од нестинг: за секоја табла — материјал, колку табли, искористеност, остатоци.
   * Материјалот се издава на налогот (кг = табли × тежина на табла), остатоците се внесуваат како остатоци.
   */
  nestingImport: publicQuery
    .input(z.object({
      jobId: z.number().optional(), workOrderId: z.number(),
      sheets: z.array(z.object({
        materialId: z.number(), sheets: z.number().positive(), thicknessMm: z.number().positive(), widthMm: z.number().positive(), lengthMm: z.number().positive(),
        utilization: z.number().min(0).max(100).optional(),
        remnants: z.array(z.object({ widthMm: z.number().positive(), lengthMm: z.number().positive(), quantity: z.number().int().min(1).default(1) })).default([]),
      })).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const mod: any = await import("./router");
      const caller: any = mod.appRouter.createCaller(ctx);
      const { DENSITIES } = await import("@contracts/weight-geometry");
      const issued: any[] = [], remnants: string[] = [];
      for (const s of input.sheets) {
        const m = (await q(`SELECT id, name, unit, density_key, weight_per_unit FROM materials WHERE id = $1`, [s.materialId]))[0];
        if (!m) throw bad("Материјалот не постои");
        const density = (DENSITIES as any)[m.density_key ?? "steel"]?.value ?? 7850;
        const sheetKg = (s.thicknessMm * s.widthMm * s.lengthMm / 1e9) * density;
        // количина во единицата на материјалот: кг, табли/парчиња, или m²
        const qty = m.unit === "kg" ? sheetKg * s.sheets : m.unit === "m2" ? (s.widthMm * s.lengthMm / 1e6) * s.sheets : s.sheets;
        const r = await caller.ops.floorIssue({ workOrderId: input.workOrderId, materialId: s.materialId, quantity: r3(qty), operator: `нестинг${input.jobId ? ` #${input.jobId}` : ""}` });
        issued.push({ materialId: s.materialId, name: m.name, quantity: r3(qty), unit: m.unit, unitCost: r.unitCost });
        for (const rem of s.remnants) {
          const created: any = await caller.remnants.remnantCreate({ materialId: s.materialId, lengthMm: rem.lengthMm, quantity: rem.quantity, workOrderId: input.workOrderId,
            notes: `Остаток од нестинг ${rem.widthMm}×${rem.lengthMm} mm, ${s.thicknessMm} mm`, createdBy: actor(ctx) ?? undefined });
          const code = created?.code ?? created?.remnant?.code;
          if (code) { await q(`UPDATE material_remnants SET width_mm = $2 WHERE code = $1`, [code, rem.widthMm]); remnants.push(code); }
        }
      }
      if (input.jobId) await q(`UPDATE nesting_jobs SET result = $2, status = 'imported', imported_at = now() WHERE id = $1`, [input.jobId, JSON.stringify({ sheets: input.sheets, issued, remnants })]);
      return { issued, remnants };
    }),
  nestingJobs: publicQuery.query(async () =>
    (await q(`SELECT j.*, (SELECT string_agg(wo_number, ', ') FROM work_orders w WHERE w.id = ANY(j.work_order_ids)) AS wos FROM nesting_jobs j ORDER BY j.created_at DESC LIMIT 30`))
      .map((j) => ({ id: j.id, workOrders: j.wos, status: j.status, parts: Array.isArray(j.parts) ? j.parts.length : 0, createdAt: j.created_at, importedAt: j.imported_at, createdBy: j.created_by, result: j.result }))),
});

function addMonths(d: string, months: number): string {
  const [y, m, day] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}
