// Оперативни извештаи и модули: добивка по нарачка, распоред на производство,
// контрола на квалитет (неусогласености/рекламации) и одржување на машини.
import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getPool } from "./queries/connection";
import { loadRates, iso } from "./rates-helper";
import { toMkd, round2 } from "@contracts/finance";
import { autoSchedule, addDays, spreadHours, pickMachine } from "@contracts/schedule";
import { logAudit } from "./audit-helper";

const q = async (text: string, params: any[] = []) => (await getPool().query(text, params)).rows as any[];
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const todayIso = () => new Date().toISOString().slice(0, 10);

async function nextNumber(table: string, column: string, prefix: string, date: string) {
  const y = date.slice(0, 4);
  const r = await q(`SELECT COUNT(*)::int n FROM ${table} WHERE ${column} LIKE $1`, [`${prefix}-%/${y}`]);
  let n = r[0].n + 1;
  for (;;) {
    const num = `${prefix}-${String(n).padStart(3, "0")}/${y}`;
    if (!(await q(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [num])).length) return num;
    n++;
  }
}


// ===================== ТЕК НА НАРАЧКА =====================
type StageStatus = "done" | "current" | "todo" | "skipped";
interface Stage { key: string; label: string; status: StageStatus; detail: string; href?: string; action?: string; actionLabel?: string; refId?: number }

/** Групно ги пресметува чекорите за повеќе понуди (без N+1 прашања). */
async function computeFlows(quoteIds: number[]) {
  if (!quoteIds.length) return [];
  const quotes = await q(`SELECT qt.*, c.name AS customer, c.company FROM quotations qt LEFT JOIN customers c ON c.id = qt.customer_id WHERE qt.id = ANY($1)`, [quoteIds]);
  const orderIds = quotes.map(x => x.converted_order_id).filter(Boolean);
  const [proformas, wos, dns, invs, allocs, cash, orders] = await Promise.all([
    q(`SELECT id, invoice_number, quotation_id, total_amount, currency FROM invoices WHERE invoice_type = 'proforma' AND status <> 'cancelled' AND quotation_id = ANY($1)`, [quoteIds]),
    q(`SELECT id, wo_number, status, order_id, quotation_id FROM work_orders WHERE status <> 'cancelled' AND (quotation_id = ANY($1) OR order_id = ANY($2))`, [quoteIds, orderIds]),
    orderIds.length ? q(`SELECT id, dn_number, order_id FROM delivery_notes WHERE status <> 'cancelled' AND order_id = ANY($1)`, [orderIds]) : Promise.resolve([]),
    orderIds.length ? q(`SELECT id, invoice_number, order_id, total_amount, currency, status FROM invoices WHERE invoice_type = 'standard' AND status NOT IN ('cancelled') AND order_id = ANY($1)`, [orderIds]) : Promise.resolve([]),
    q(`SELECT doc_id, SUM(amount) s FROM payment_allocations WHERE doc_type = 'invoice' GROUP BY doc_id`),
    q(`SELECT invoice_id, SUM(amount) s FROM cash_transactions WHERE invoice_id IS NOT NULL AND direction = 'in' GROUP BY invoice_id`),
    orderIds.length ? q(`SELECT id, order_number, status FROM orders WHERE id = ANY($1)`, [orderIds]) : Promise.resolve([]),
  ]);
  const paidOf = (invId: number) =>
    Number(allocs.find(a => Number(a.doc_id) === Number(invId))?.s ?? 0) + Number(cash.find(c => Number(c.invoice_id) === Number(invId))?.s ?? 0);
  const { parseSchedule, advancePercent } = await import("@contracts/payment-terms");
  const fmt = (n: number, cur: string) => `${n.toLocaleString("mk-MK", { maximumFractionDigits: 2 })} ${cur === "MKD" ? "ден" : cur}`;

  return quotes.map(qt => {
    const cur = qt.currency || "MKD";
    const total = Number(qt.total_amount);
    const order = orders.find(o => Number(o.id) === Number(qt.converted_order_id));
    const pf = proformas.filter(p => Number(p.quotation_id) === Number(qt.id));
    const myWos = wos.filter(w => Number(w.quotation_id) === Number(qt.id) || (order && Number(w.order_id) === Number(order.id)));
    const myDns = order ? dns.filter(d => Number(d.order_id) === Number(order.id)) : [];
    const myInv = order ? invs.filter(i => Number(i.order_id) === Number(order.id)) : [];
    const sched = parseSchedule(qt.payment_schedule);
    const advPct = sched ? advancePercent(sched) : 0;
    const advNeeded = Math.round(total * advPct) / 100;
    const advPaid = pf.reduce((a, p) => a + paidOf(p.id), 0);
    const invTotal = myInv.reduce((a, i) => a + Number(i.total_amount), 0);
    const invPaid = myInv.reduce((a, i) => a + paidOf(i.id), 0) + advPaid;
    const accepted = ["accepted", "converted"].includes(qt.status);
    const woDone = myWos.length > 0 && myWos.every(w => w.status === "completed");
    const firstWo = myWos[0];

    const st: Stage[] = [];
    st.push({ key: "quote", label: "Понуда", status: accepted ? "done" : qt.status === "rejected" || qt.status === "expired" ? "skipped" : "current",
      detail: `${qt.quote_number} · ${fmt(total, cur)}`, href: `/ponudi?open=${qt.id}`, action: accepted ? undefined : "accept", actionLabel: "Прифатена од клиентот" });
    st.push({ key: "proforma", label: "Про-фактура", status: pf.length ? "done" : advPct > 0 ? "todo" : "skipped",
      detail: pf.length ? pf.map(p => p.invoice_number).join(", ") : advPct > 0 ? "потребна за авансот" : "не е потребна (без аванс)",
      href: pf[0] ? `/smetkovodstvo?open=${pf[0].id}` : undefined, action: pf.length ? undefined : "proforma", actionLabel: "Направи про-фактура" });
    st.push({ key: "advance", label: `Аванс${advPct ? ` ${advPct}%` : ""}`, status: advPct === 0 ? "skipped" : advPaid >= advNeeded - 0.01 ? "done" : "todo",
      detail: advPct === 0 ? "нема аванс" : `${fmt(advPaid, cur)} од ${fmt(advNeeded, cur)}`, action: advPct > 0 && advPaid < advNeeded - 0.01 && pf.length ? "payment" : undefined, actionLabel: "Евидентирај уплата", refId: pf[0]?.id });
    st.push({ key: "order", label: "Нарачка", status: order ? "done" : "todo", detail: order ? order.order_number : "уште не е потврдена",
      href: order ? `/klienti?order=${order.id}` : undefined, action: order ? undefined : "convert", actionLabel: "Потврди нарачка" });
    st.push({ key: "wo", label: "Производство", status: woDone ? "done" : myWos.length ? "current" : "todo",
      detail: myWos.length ? myWos.map(w => `${w.wo_number}${w.status === "completed" ? " ✓" : ""}`).join(", ") : "нема работен налог",
      href: firstWo ? `/proizvodstvo?open=${firstWo.id}` : undefined, action: myWos.length ? undefined : "workorder", actionLabel: "Отвори работен налог", refId: firstWo?.id });
    st.push({ key: "delivery", label: "Испратница", status: myDns.length ? "done" : "todo", detail: myDns.length ? myDns.map(d => d.dn_number).join(", ") : woDone ? "производството е готово" : "по завршено производство",
      href: myDns.length ? `/smetkovodstvo?q=${encodeURIComponent(myDns[0].dn_number)}` : undefined, action: !myDns.length && woDone ? "delivery" : undefined, actionLabel: "Направи испратница", refId: firstWo?.id });
    st.push({ key: "invoice", label: "Фактура", status: myInv.length ? "done" : "todo", detail: myInv.length ? myInv.map(i => i.invoice_number).join(", ") : "уште не е фактурирано",
      href: myInv[0] ? `/smetkovodstvo?open=${myInv[0].id}` : undefined, action: !myInv.length && firstWo && order ? "invoice" : undefined, actionLabel: "Направи фактура", refId: firstWo?.id });
    const paidDone = myInv.length > 0 && invPaid >= invTotal - 0.01;
    st.push({ key: "payment", label: "Наплата", status: paidDone ? "done" : "todo",
      detail: myInv.length ? `${fmt(invPaid, cur)} од ${fmt(invTotal, cur)}` : "по фактура", action: myInv.length && !paidDone ? "payment" : undefined, actionLabel: "Евидентирај наплата", refId: myInv[0]?.id });

    // тековен чекор = првиот што не е завршен/прескокнат
    const cur_i = st.findIndex(x => x.status === "todo" || x.status === "current");
    if (cur_i >= 0) st[cur_i].status = "current";
    for (let i = cur_i + 1; cur_i >= 0 && i < st.length; i++) if (st[i].status === "current") st[i].status = "todo";
    return {
      quotationId: qt.id, quoteNumber: qt.quote_number, customer: qt.company || qt.customer, total, currency: cur, createdAt: iso(qt.created_at),
      orderId: order?.id ?? null, closed: cur_i < 0, currentStage: cur_i >= 0 ? st[cur_i].key : null, stages: st,
    };
  });
}

export const opsRouter = createRouter({

  // ===================== ТЕЛЕФОН ЗА ПОДОТ =====================
  /** Издавање материјал од подот: постоечки ред од налогот, или нов материјал што веднаш се издава. */
  floorIssue: publicQuery
    .input(z.object({
      workOrderId: z.number(), woMaterialId: z.number().optional(), materialId: z.number().optional(),
      quantity: z.number().positive(), operator: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }): Promise<{ success: boolean; unitCost: string }> => {
      const wo = (await q(`SELECT id, wo_number, status FROM work_orders WHERE id = $1`, [input.workOrderId]))[0];
      if (!wo) throw new Error("Налогот не постои");
      if (wo.status === "completed" || wo.status === "cancelled") throw new Error("Налогот е затворен");
      const wh = (await q(`SELECT id FROM warehouses ORDER BY (code = 'GL-MAT') DESC, (type = 'raw_materials') DESC, id LIMIT 1`))[0];
      if (!wh) throw new Error("Нема магацин за материјали");
      let rowId = input.woMaterialId;
      let materialId = input.materialId;
      if (rowId) {
        const r = (await q(`SELECT material_id, is_actual FROM work_order_materials WHERE id = $1 AND work_order_id = $2`, [rowId, input.workOrderId]))[0];
        if (!r) throw new Error("Материјалот не е на овој налог");
        if (r.is_actual === "actual") throw new Error("Овој материјал е веќе издаден");
        materialId = Number(r.material_id);
        await q(`UPDATE work_order_materials SET quantity = $2 WHERE id = $1`, [rowId, input.quantity]);
      } else {
        if (!materialId) throw new Error("Избери материјал");
        const ins = await q(`INSERT INTO work_order_materials (work_order_id, material_id, quantity, unit_cost, total_cost, is_actual, notes)
          VALUES ($1,$2,$3,0,0,'planned',$4) RETURNING id`, [input.workOrderId, materialId, input.quantity, input.operator ? `Од подот: ${input.operator}` : "Од подот"]);
        rowId = Number(ins[0].id);
      }
      // целиот рутер (не под-рутер), за проверката на дозволи да ја види патеката storage.issueMaterial
      const mod: any = await import("./router");
      const caller: any = mod.appRouter.createCaller(ctx);
      try {
        const r: { unitCost: string } = await caller.storage.issueMaterial({
          materialId: materialId!, warehouseId: Number(wh.id), quantity: String(input.quantity),
          sourceDocType: "work_order", sourceDocId: input.workOrderId, reference: wo.wo_number, woMaterialId: rowId,
        });
        return { success: true, unitCost: r.unitCost };
      } catch (e) {
        // нов ред што не можел да се издаде (нема залиха) -- тргни го, да не остане празен ред
        if (!input.woMaterialId && rowId) await q(`DELETE FROM work_order_materials WHERE id = $1 AND is_actual <> 'actual'`, [rowId]);
        throw e;
      }
    }),

  // ===================== ТЕК НА НАРАЧКА =====================
  dealFlow: publicQuery
    .input(z.object({ quotationId: z.number() }))
    .query(async ({ input }) => (await computeFlows([input.quotationId]))[0] ?? null),

  dealList: publicQuery
    .input(z.object({ includeClosed: z.boolean().default(false) }).optional())
    .query(async ({ input }) => {
      const ids = (await q(`SELECT id FROM quotations WHERE status NOT IN ('rejected', 'expired') ORDER BY created_at DESC LIMIT 300`)).map(r => Number(r.id));
      const flows = await computeFlows(ids);
      const order = ["quote", "proforma", "advance", "order", "wo", "delivery", "invoice", "payment"];
      return flows.filter(f => input?.includeClosed || !f.closed)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(f => ({ ...f, stageIndex: f.currentStage ? order.indexOf(f.currentStage) : order.length }));
    }),

  /** Налог за нарачка: ако веќе има налог од понудата (без нарачка) -- поврзи го; инаку создади нов. */
  dealCreateWorkOrder: publicQuery
    .input(z.object({ quotationId: z.number() }))
    .mutation(async ({ input }) => {
      const qt = (await q(`SELECT id, converted_order_id FROM quotations WHERE id = $1`, [input.quotationId]))[0];
      if (!qt?.converted_order_id) throw new Error("Прво потврди ја нарачката");
      const free = (await q(`SELECT id, wo_number FROM work_orders WHERE quotation_id = $1 AND order_id IS NULL AND status <> 'cancelled' ORDER BY id LIMIT 1`, [input.quotationId]))[0];
      if (free) {
        await q(`UPDATE work_orders SET order_id = $2 WHERE id = $1`, [free.id, qt.converted_order_id]);
        await q(`UPDATE orders SET status = 'in_production' WHERE id = $1 AND status = 'confirmed'`, [qt.converted_order_id]);
        return { linked: true, woNumber: free.wo_number as string, orderId: Number(qt.converted_order_id) };
      }
      return { linked: false, woNumber: null, orderId: Number(qt.converted_order_id) };
    }),

  // ===================== ДОБИВКА ПО НАРАЧКА =====================
  profitabilityReport: publicQuery
    .input(z.object({ from: dateStr, to: dateStr }))
    .query(async ({ input }) => {
      const rate = await loadRates();
      const orders = await q(`SELECT o.id, o.order_number, o.status, o.created_at, o.cost_amount, c.name AS customer,
          COALESCE((SELECT SUM(total_price) FROM order_items oi WHERE oi.order_id = o.id), 0) AS items_net,
          qt.currency AS quote_currency, qt.quote_number, qt.cost_amount AS quote_cost
        FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN quotations qt ON qt.converted_order_id = o.id
        WHERE o.created_at::date BETWEEN $1 AND $2 AND o.status <> 'cancelled'
        ORDER BY o.created_at DESC LIMIT 500`, [input.from, input.to]);
      if (!orders.length) return { rows: [], totals: { revenue: 0, plannedCost: 0, actualCost: 0, profit: 0 } };
      const ids = orders.map(o => o.id);
      const wos = await q(`SELECT w.id, w.order_id, w.wo_number, w.status, w.cost_amount FROM work_orders w WHERE w.order_id = ANY($1)`, [ids]);
      const woIds = wos.map(w => w.id);
      const mats = woIds.length ? await q(`SELECT work_order_id, is_actual, SUM(total_cost) s FROM work_order_materials WHERE work_order_id = ANY($1) GROUP BY 1, 2`, [woIds]) : [];
      const ops = woIds.length ? await q(`SELECT work_order_id, SUM(cost_amount) s,
          SUM(COALESCE(NULLIF(actual_time, 0), 0)) actual_h, SUM(COALESCE(estimated_time, 0)) est_h
        FROM work_order_operations WHERE work_order_id = ANY($1) GROUP BY 1`, [woIds]) : [];
      const invs = await q(`SELECT order_id, subtotal, currency, issue_date, invoice_type FROM invoices
        WHERE order_id = ANY($1) AND invoice_type IN ('standard','credit_note') AND status NOT IN ('draft','cancelled')`, [ids]);

      const rows = orders.map(o => {
        const myWos = wos.filter(w => Number(w.order_id) === Number(o.id));
        const wIds = new Set(myWos.map(w => Number(w.id)));
        const matActual = mats.filter(m => wIds.has(Number(m.work_order_id)) && m.is_actual === "actual").reduce((a, m) => a + Number(m.s), 0);
        const matPlanned = mats.filter(m => wIds.has(Number(m.work_order_id)) && m.is_actual !== "actual").reduce((a, m) => a + Number(m.s), 0);
        const opCost = ops.filter(x => wIds.has(Number(x.work_order_id))).reduce((a, x) => a + Number(x.s), 0);
        const hours = ops.filter(x => wIds.has(Number(x.work_order_id))).reduce((a, x) => a + Number(x.actual_h || 0), 0);
        const date = iso(o.created_at);
        const cur = String(o.quote_currency || "MKD");
        // Приход: фактурирано (во денари) ако има; инаку договорено по нарачка
        const myInv = invs.filter(i => Number(i.order_id) === Number(o.id));
        let revenue: number | null;
        let revenueSource: "invoiced" | "order";
        if (myInv.length) {
          revenueSource = "invoiced";
          revenue = myInv.reduce<number | null>((a, i) => {
            const v = toMkd((i.invoice_type === "credit_note" ? -1 : 1) * Math.abs(Number(i.subtotal)), i.currency, iso(i.issue_date), rate);
            return a === null || v === null ? null : a + v;
          }, 0);
        } else {
          revenueSource = "order";
          revenue = toMkd(Number(o.items_net), cur, date, rate) ?? toMkd(Number(o.items_net), cur, todayIso(), rate);
        }
        // трошоците во понудата се секогаш во денари (од набавните цени), без разлика на валутата на понудата
        const plannedCost = Number(o.quote_cost ?? o.cost_amount ?? 0);
        const actualCost = round2(matActual + matPlanned + opCost);
        const done = myWos.length > 0 && myWos.every(w => w.status === "completed");
        const profit = revenue === null ? null : round2(revenue - actualCost);
        return {
          orderId: o.id, orderNumber: o.order_number, customer: o.customer, status: o.status, date, quoteNumber: o.quote_number,
          currency: cur, revenue: revenue === null ? null : round2(revenue), revenueSource,
          plannedCost: round2(plannedCost), actualCost, materialCost: round2(matActual + matPlanned), materialPlannedOnly: round2(matPlanned),
          operationCost: round2(opCost), hours: round2(hours), workOrders: myWos.map(w => w.wo_number),
          profit, marginPct: revenue && profit !== null && revenue !== 0 ? round2(profit / revenue * 100) : null,
          variance: round2(actualCost - plannedCost), finished: done,
        };
      });
      const totals = rows.reduce((t, r) => ({
        revenue: round2(t.revenue + (r.revenue ?? 0)), plannedCost: round2(t.plannedCost + r.plannedCost),
        actualCost: round2(t.actualCost + r.actualCost), profit: round2(t.profit + (r.profit ?? 0)),
      }), { revenue: 0, plannedCost: 0, actualCost: 0, profit: 0 });
      return { rows, totals };
    }),

  // ===================== РАСПОРЕД =====================
  machinesForSchedule: publicQuery.query(async () => {
    const rows = await q(`SELECT id, name, code, type, COALESCE(hours_per_day, 8) hours_per_day, operations FROM machines WHERE is_active = 'active' ORDER BY name`);
    return rows.map(m => ({ id: m.id, name: m.name, code: m.code, type: m.type, hoursPerDay: Number(m.hours_per_day), operations: (m.operations ?? "").split(",").filter(Boolean) }));
  }),

  machineScheduleSettings: publicQuery
    .input(z.object({ id: z.number(), hoursPerDay: z.number().min(0).max(24), operations: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      await q(`UPDATE machines SET hours_per_day = $2, operations = $3 WHERE id = $1`, [input.id, input.hoursPerDay, input.operations.join(",")]);
      return { success: true };
    }),

  scheduleBoard: publicQuery
    .input(z.object({ from: dateStr, days: z.number().min(1).max(42).default(14) }))
    .query(async ({ input }) => {
      const machines = await q(`SELECT id, name, code, COALESCE(hours_per_day, 8) hpd, operations FROM machines WHERE is_active = 'active' ORDER BY name`);
      const ops = await q(`SELECT o.id, o.work_order_id, o.sequence, o.operation, o.status, o.machine_id, o.planned_date,
          COALESCE(NULLIF(o.estimated_time, 0), 1) AS hours, w.wo_number, w.description, w.priority, w.planned_end, w.status AS wo_status
        FROM work_order_operations o JOIN work_orders w ON w.id = o.work_order_id
        WHERE w.status NOT IN ('completed', 'cancelled') AND o.status NOT IN ('completed', 'skipped')
        ORDER BY w.id, o.sequence`);
      const days: string[] = [];
      for (let i = 0; i < input.days; i++) days.push(addDays(input.from, i));
      // операција на избришана/неактивна машина се прикажува во „Без машина“
      const activeIds = new Set(machines.map(m => Number(m.id)));
      for (const o of ops) if (o.machine_id && !activeIds.has(Number(o.machine_id))) o.machine_id = null;
      const lanes = [...machines.map(m => ({ id: Number(m.id), name: m.name, code: m.code, hoursPerDay: Number(m.hpd) })), { id: 0, name: "Без машина", code: "—", hoursPerDay: 8 }];
      const capOf = (mid: number) => lanes.find(l => l.id === mid)?.hoursPerDay ?? 8;
      // Операција подолга од денот се протега на следните работни денови
      const segs = ops.filter(o => o.planned_date).flatMap(o => {
        const mid = Number(o.machine_id ?? 0);
        const parts = spreadHours(iso(o.planned_date), Number(o.hours), capOf(mid));
        return parts.map((p, i) => ({ o, mid, date: p.date, hours: p.hours, part: i + 1, parts: parts.length, end: parts[parts.length - 1].date }));
      });
      const endOf = new Map<number, string>();
      for (const sg of segs) endOf.set(Number(sg.o.id), sg.end);
      const cells = lanes.map(l => ({
        machineId: l.id,
        days: days.map(d => {
          const items = segs.filter(sg => sg.mid === l.id && sg.date === d);
          const hours = round2(items.reduce((a, sg) => a + sg.hours, 0));
          return { date: d, hours, items: items.map(sg => ({ opId: sg.o.id, woNumber: sg.o.wo_number, operation: sg.o.operation, hours: sg.hours, totalHours: Number(sg.o.hours),
            part: sg.part, parts: sg.parts, start: iso(sg.o.planned_date), status: sg.o.status, priority: sg.o.priority })) };
        }),
      }));
      const unscheduled = ops.filter(o => !o.planned_date).map(o => ({ opId: o.id, workOrderId: o.work_order_id, woNumber: o.wo_number, description: o.description, operation: o.operation, sequence: o.sequence, hours: Number(o.hours), machineId: o.machine_id, priority: o.priority }));
      // Можна испорака по налог = последниот ден на последната операција
      const promise = new Map<number, { woNumber: string; date: string | null; plannedEnd: string | null; unscheduled: number }>();
      for (const o of ops) {
        const k = Number(o.work_order_id);
        const p = promise.get(k) ?? { woNumber: o.wo_number, date: null, plannedEnd: o.planned_end ? iso(o.planned_end) : null, unscheduled: 0 };
        if (o.planned_date) { const d = endOf.get(Number(o.id)) ?? iso(o.planned_date); if (!p.date || d > p.date) p.date = d; } else p.unscheduled++;
        promise.set(k, p);
      }
      return { days, lanes, cells, unscheduled, promises: [...promise.entries()].map(([id, p]) => ({ workOrderId: id, ...p, late: !!(p.date && p.plannedEnd && p.date > p.plannedEnd) })) };
    }),

  scheduleSet: publicQuery
    .input(z.object({ opId: z.number(), machineId: z.number().nullable(), plannedDate: dateStr.nullable() }))
    .mutation(async ({ input }) => {
      await q(`UPDATE work_order_operations SET machine_id = $2, planned_date = $3 WHERE id = $1`, [input.opId, input.machineId || null, input.plannedDate]);
      return { success: true };
    }),

  scheduleAuto: publicQuery
    .input(z.object({ from: dateStr.optional(), reschedule: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      const from = input.from ?? todayIso();
      const machines = (await q(`SELECT id, name, type, COALESCE(hours_per_day, 8) hpd, operations FROM machines WHERE is_active = 'active' ORDER BY id`))
        .map(m => ({ id: Number(m.id), name: m.name, type: m.type, hoursPerDay: Number(m.hpd), operations: String(m.operations ?? "").split(",").filter(Boolean) }));
      const rows = await q(`SELECT o.id, o.work_order_id, o.sequence, o.operation, o.status, o.machine_id, o.planned_date,
          COALESCE(NULLIF(o.estimated_time, 0), 1) AS hours, w.priority, w.planned_end, w.created_at
        FROM work_order_operations o JOIN work_orders w ON w.id = o.work_order_id
        WHERE w.status NOT IN ('completed', 'cancelled') AND o.status NOT IN ('completed', 'skipped')`);
      const ops = rows.map(o => ({
        id: Number(o.id), workOrderId: Number(o.work_order_id), sequence: Number(o.sequence), operation: o.operation, hours: Number(o.hours),
        machineId: o.machine_id ? Number(o.machine_id) : null, plannedDate: o.planned_date ? iso(o.planned_date) : null,
        // започнатите и (без „reschedule“) веќе закажаните не се поместуваат; старите датуми во минатото се преплануваат
        locked: o.status === "in_progress" || (!input.reschedule && !!o.planned_date && iso(o.planned_date) >= from),
        started: o.status === "in_progress",
      }));
      const woMap = new Map<number, any>();
      for (const o of rows) woMap.set(Number(o.work_order_id), { id: Number(o.work_order_id), priority: o.priority, plannedEnd: o.planned_end ? iso(o.planned_end) : null, createdAt: new Date(o.created_at).toISOString() });
      const activeIds = new Set(machines.map(m => m.id));
      for (const o of ops) if (o.machineId && !activeIds.has(o.machineId)) { o.machineId = null; o.locked = false; }
      // закажана „без машина“, а сега има машина што ја работи -> распореди ја повторно (освен започнатите)
      for (const o of ops) if (!o.machineId && o.locked && !o.started && pickMachine(o, machines)) o.locked = false;
      const plan = autoSchedule({ from, machines, wos: [...woMap.values()], ops });
      for (const p of plan) await q(`UPDATE work_order_operations SET machine_id = $2, planned_date = $3 WHERE id = $1`, [p.opId, p.machineId, p.plannedDate]);
      return { scheduled: plan.length, multiDay: plan.filter(p => p.endDate > p.plannedDate).length, noMachine: plan.filter(p => !p.machineId).length };
    }),

  // ===================== КВАЛИТЕТ =====================
  qualityList: publicQuery
    .input(z.object({ status: z.string().optional(), kind: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const params: any[] = [];
      let where = "1=1";
      if (input?.status) { params.push(input.status); where += ` AND qi.status = $${params.length}`; }
      if (input?.kind) { params.push(input.kind); where += ` AND qi.kind = $${params.length}`; }
      const rows = await q(`SELECT qi.*, w.wo_number, c.name AS customer, s.name AS supplier, m.name AS material
        FROM quality_issues qi
        LEFT JOIN work_orders w ON w.id = qi.work_order_id LEFT JOIN customers c ON c.id = qi.customer_id
        LEFT JOIN suppliers s ON s.id = qi.supplier_id LEFT JOIN materials m ON m.id = qi.material_id
        WHERE ${where} ORDER BY qi.issue_date DESC, qi.id DESC LIMIT 500`, params);
      return rows.map(r => ({
        id: r.id, number: r.issue_number, date: iso(r.issue_date), kind: r.kind, status: r.status, title: r.title, description: r.description,
        rootCause: r.root_cause, action: r.action, cost: Number(r.cost), responsible: r.responsible, closedAt: r.closed_at ? iso(r.closed_at) : null,
        workOrderId: r.work_order_id, woNumber: r.wo_number, customerId: r.customer_id, customer: r.customer, supplierId: r.supplier_id, supplier: r.supplier,
        materialId: r.material_id, material: r.material,
      }));
    }),

  qualityStats: publicQuery.query(async () => {
    const r = await q(`SELECT
        COUNT(*) FILTER (WHERE status <> 'closed')::int AS open,
        COUNT(*) FILTER (WHERE kind = 'complaint' AND issue_date >= date_trunc('year', now()))::int AS complaints_year,
        COALESCE(SUM(cost) FILTER (WHERE issue_date >= date_trunc('year', now())), 0) AS cost_year
      FROM quality_issues`);
    return { open: r[0].open, complaintsYear: r[0].complaints_year, costYear: Number(r[0].cost_year) };
  }),

  qualityCreate: publicQuery
    .input(z.object({
      date: dateStr, kind: z.enum(["internal", "complaint", "supplier"]), title: z.string().min(3), description: z.string().optional(),
      workOrderId: z.number().optional(), customerId: z.number().optional(), supplierId: z.number().optional(), materialId: z.number().optional(),
      cost: z.number().min(0).default(0), responsible: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const num = await nextNumber("quality_issues", "issue_number", "НУ", input.date);
      const r = await q(`INSERT INTO quality_issues (issue_number, issue_date, kind, title, description, work_order_id, customer_id, supplier_id, material_id, cost, responsible)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [num, input.date, input.kind, input.title, input.description ?? null, input.workOrderId ?? null, input.customerId ?? null, input.supplierId ?? null, input.materialId ?? null, input.cost, input.responsible ?? null]);
      await logAudit({ action: "CREATE", entityType: "quality_issue", entityId: r[0].id, description: `Неусогласеност ${num}: ${input.title}` }).catch(() => {});
      return { success: true, id: r[0].id, number: num };
    }),

  qualityUpdate: publicQuery
    .input(z.object({
      id: z.number(), status: z.enum(["open", "in_progress", "closed"]).optional(), rootCause: z.string().optional(),
      action: z.string().optional(), cost: z.number().min(0).optional(), responsible: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const sets: string[] = []; const params: any[] = [input.id];
      const add = (col: string, v: any) => { params.push(v); sets.push(`${col} = $${params.length}`); };
      if (input.status) { add("status", input.status); add("closed_at", input.status === "closed" ? todayIso() : null); }
      if (input.rootCause !== undefined) add("root_cause", input.rootCause);
      if (input.action !== undefined) add("action", input.action);
      if (input.cost !== undefined) add("cost", input.cost);
      if (input.responsible !== undefined) add("responsible", input.responsible);
      if (sets.length) await q(`UPDATE quality_issues SET ${sets.join(", ")} WHERE id = $1`, params);
      return { success: true };
    }),

  qualityDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => { await q(`DELETE FROM quality_issues WHERE id = $1`, [input.id]); return { success: true }; }),

  // ===================== ОДРЖУВАЊЕ =====================
  maintenancePlans: publicQuery.query(async () => {
    const rows = await q(`SELECT p.*, m.name AS machine, m.code FROM maintenance_plans p JOIN machines m ON m.id = p.machine_id
      WHERE p.is_active = 'active' ORDER BY p.id`);
    const today = todayIso();
    return rows.map(p => {
      const last = p.last_done ? iso(p.last_done) : null;
      const next = last ? addDays(last, Number(p.interval_days)) : today;
      const daysLeft = Math.round((new Date(next).getTime() - new Date(today).getTime()) / 86400000);
      return { id: p.id, machineId: p.machine_id, machine: p.machine, code: p.code, title: p.title, intervalDays: Number(p.interval_days),
        lastDone: last, nextDue: next, daysLeft, state: daysLeft < 0 ? "overdue" : daysLeft <= 7 ? "soon" : "ok", notes: p.notes };
    }).sort((a, b) => a.daysLeft - b.daysLeft);
  }),

  maintenancePlanCreate: publicQuery
    .input(z.object({ machineId: z.number(), title: z.string().min(3), intervalDays: z.number().int().min(1), lastDone: dateStr.optional(), notes: z.string().optional() }))
    .mutation(async ({ input }) => {
      await q(`INSERT INTO maintenance_plans (machine_id, title, interval_days, last_done, notes) VALUES ($1,$2,$3,$4,$5)`,
        [input.machineId, input.title, input.intervalDays, input.lastDone ?? null, input.notes ?? null]);
      return { success: true };
    }),

  maintenancePlanDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => { await q(`UPDATE maintenance_plans SET is_active = 'inactive' WHERE id = $1`, [input.id]); return { success: true }; }),

  maintenanceLogCreate: publicQuery
    .input(z.object({
      machineId: z.number(), planId: z.number().optional(), date: dateStr, kind: z.enum(["planned", "breakdown", "repair"]),
      description: z.string().optional(), cost: z.number().min(0).default(0), downtimeHours: z.number().min(0).default(0), performedBy: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await q(`INSERT INTO maintenance_logs (machine_id, plan_id, done_date, kind, description, cost, downtime_hours, performed_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [input.machineId, input.planId ?? null, input.date, input.kind, input.description ?? null, input.cost, input.downtimeHours, input.performedBy ?? null]);
      if (input.planId) await q(`UPDATE maintenance_plans SET last_done = GREATEST(COALESCE(last_done, $2::date), $2::date) WHERE id = $1`, [input.planId, input.date]);
      return { success: true };
    }),

  maintenanceLogs: publicQuery
    .input(z.object({ machineId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const rows = await q(`SELECT l.*, m.name AS machine, p.title AS plan FROM maintenance_logs l JOIN machines m ON m.id = l.machine_id
        LEFT JOIN maintenance_plans p ON p.id = l.plan_id ${input?.machineId ? "WHERE l.machine_id = $1" : ""} ORDER BY l.done_date DESC, l.id DESC LIMIT 300`,
        input?.machineId ? [input.machineId] : []);
      return rows.map(l => ({ id: l.id, machineId: l.machine_id, machine: l.machine, plan: l.plan, date: iso(l.done_date), kind: l.kind, description: l.description,
        cost: Number(l.cost), downtimeHours: Number(l.downtime_hours), performedBy: l.performed_by }));
    }),

  maintenanceDue: publicQuery.query(async () => {
    const r = await q(`SELECT COUNT(*)::int n FROM maintenance_plans WHERE is_active = 'active'
      AND (last_done IS NULL OR last_done + interval_days <= CURRENT_DATE + 7)`);
    return { dueSoon: r[0].n };
  }),
});

