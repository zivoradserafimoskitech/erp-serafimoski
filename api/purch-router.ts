// Набавка (напредно):
//  • барање за понуда (RFQ) до повеќе добавувачи → одговори → споредба → избор → набавна нарачка
//  • ценовници на добавувачите (последна цена по материјал; од одговорите и приемниците)
//  • тристрано усогласување: нарачка ↔ приемница ↔ влезна фактура (количини и цени)
//  • одобрување на набавна нарачка над праг
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { getPool } from "./queries/connection";
import { iso } from "./rates-helper";

const q = async (text: string, params: any[] = []) => (await getPool().query(text, params)).rows as any[];
const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const actor = (ctx: any) => ctx?.actor?.name ?? null;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function poApprovalThreshold(): Promise<number | null> {
  const v = (await q(`SELECT value FROM app_kv WHERE key = 'po:approval'`))[0]?.value;
  try { const t = JSON.parse(v ?? "{}").threshold; return typeof t === "number" && t > 0 ? t : null; } catch { return null; }
}
/** Набавна нарачка над прагот не смее да се прати без одобрување. */
export async function assertPoApproved(poId: number, nextStatus?: string) {
  if (!nextStatus || !["sent", "confirmed"].includes(nextStatus)) return;
  const t = await poApprovalThreshold();
  if (t === null) return;
  const po = (await q(`SELECT total_amount, approved_at FROM purchase_orders WHERE id = $1`, [poId]))[0];
  if (po && Number(po.total_amount) > t && !po.approved_at)
    throw bad(`Нарачката е над ${t.toLocaleString("mk-MK")} ден — прво треба да ја одобри администратор`);
}

async function upsertPrice(supplierId: number, materialId: number, price: number, source: string, extra: { currency?: string; leadDays?: number | null; minQty?: number | null } = {}) {
  await q(`INSERT INTO supplier_prices (supplier_id, material_id, price, currency, lead_days, min_qty, valid_from, source, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE,$7,now())
    ON CONFLICT (supplier_id, material_id) DO UPDATE SET price = EXCLUDED.price, currency = EXCLUDED.currency, lead_days = COALESCE(EXCLUDED.lead_days, supplier_prices.lead_days),
      min_qty = COALESCE(EXCLUDED.min_qty, supplier_prices.min_qty), valid_from = EXCLUDED.valid_from, source = EXCLUDED.source, updated_at = now()`,
    [supplierId, materialId, price, extra.currency ?? "MKD", extra.leadDays ?? null, extra.minQty ?? null, source]);
}

async function nextRfqNumber() {
  const y = new Date().getFullYear();
  const rows = await q(`SELECT number FROM rfqs WHERE number LIKE $1`, [`БП-%/${y}`]);
  const max = rows.reduce((m, r) => Math.max(m, Number(String(r.number).match(/^БП-0*(\d+)\//)?.[1] ?? 0)), 0);
  return `БП-${String(max + 1).padStart(3, "0")}/${y}`;
}

export const purchRouter = createRouter({
  // ===== Барање за понуда =====
  rfqList: publicQuery.query(async () => {
    const r = await q(`SELECT r.*, (SELECT COUNT(*)::int FROM rfq_suppliers s WHERE s.rfq_id = r.id) AS sups,
      (SELECT COUNT(*)::int FROM rfq_suppliers s WHERE s.rfq_id = r.id AND s.responded_at IS NOT NULL) AS answered, po.po_number
      FROM rfqs r LEFT JOIN purchase_orders po ON po.id = r.po_id ORDER BY r.created_at DESC LIMIT 100`);
    return r.map((x) => ({ id: x.id, number: x.number, title: x.title, neededBy: x.needed_by ? iso(x.needed_by) : null, status: x.status, suppliers: x.sups, answered: x.answered, poNumber: x.po_number, createdAt: x.created_at }));
  }),
  rfqGet: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const r = (await q(`SELECT * FROM rfqs WHERE id = $1`, [input.id]))[0];
    if (!r) throw bad("Не постои");
    const items = await q(`SELECT i.*, m.name AS material, m.code FROM rfq_items i LEFT JOIN materials m ON m.id = i.material_id WHERE i.rfq_id = $1 ORDER BY i.id`, [input.id]);
    const sups = await q(`SELECT s.*, su.name, su.email FROM rfq_suppliers s JOIN suppliers su ON su.id = s.supplier_id WHERE s.rfq_id = $1 ORDER BY su.name`, [input.id]);
    const its = items.map((i) => ({ id: i.id, materialId: i.material_id, material: i.material, code: i.code, description: i.description, quantity: Number(i.quantity), unit: i.unit }));
    const offers = sups.map((s) => {
      const prices = (s.prices ?? {}) as Record<string, number>;
      const total = its.reduce((a, i) => a + (prices[i.id] ?? 0) * i.quantity, 0);
      const complete = its.every((i) => (prices[i.id] ?? 0) > 0);
      return { id: s.id, supplierId: s.supplier_id, name: s.name, email: s.email, sentAt: s.sent_at, respondedAt: s.responded_at, prices, deliveryDays: s.delivery_days,
        validUntil: s.valid_until ? iso(s.valid_until) : null, note: s.note, chosen: s.chosen, total: r2(total), complete };
    });
    // најдобра цена по ставка
    const best: Record<number, number | null> = {};
    for (const i of its) {
      const ps = offers.map((o) => o.prices[i.id]).filter((p) => p > 0);
      best[i.id] = ps.length ? Math.min(...ps) : null;
    }
    return { id: r.id, number: r.number, title: r.title, neededBy: r.needed_by ? iso(r.needed_by) : null, status: r.status, notes: r.notes, poId: r.po_id, items: its, offers, best };
  }),
  rfqCreate: publicQuery
    .input(z.object({ title: z.string().min(2).max(300), neededBy: dateStr.nullable().optional(), notes: z.string().optional(),
      items: z.array(z.object({ materialId: z.number().nullable().optional(), description: z.string().min(1).max(500), quantity: z.number().positive(), unit: z.string().max(20).optional() })).min(1),
      supplierIds: z.array(z.number()).min(1).max(20) }))
    .mutation(async ({ input, ctx }) => {
      const number = await nextRfqNumber();
      const r = await q(`INSERT INTO rfqs (number, title, needed_by, notes, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [number, input.title, input.neededBy ?? null, input.notes ?? null, actor(ctx)]);
      const id = Number(r[0].id);
      for (const i of input.items) await q(`INSERT INTO rfq_items (rfq_id, material_id, description, quantity, unit) VALUES ($1,$2,$3,$4,$5)`, [id, i.materialId ?? null, i.description, i.quantity, i.unit ?? null]);
      for (const s of [...new Set(input.supplierIds)]) await q(`INSERT INTO rfq_suppliers (rfq_id, supplier_id) VALUES ($1,$2)`, [id, s]);
      return { id, number };
    }),
  rfqMarkSent: publicQuery.input(z.object({ rfqSupplierId: z.number() })).mutation(async ({ input }) => {
    await q(`UPDATE rfq_suppliers SET sent_at = now() WHERE id = $1`, [input.rfqSupplierId]);
    await q(`UPDATE rfqs SET status = 'sent' WHERE id = (SELECT rfq_id FROM rfq_suppliers WHERE id = $1) AND status = 'draft'`, [input.rfqSupplierId]);
    return { success: true };
  }),
  /** Одговор од добавувач: цена по ставка, рок, важност. Цените одат и во ценовникот. */
  rfqRespond: publicQuery
    .input(z.object({ rfqSupplierId: z.number(), prices: z.record(z.string(), z.number().min(0)), deliveryDays: z.number().int().min(0).nullable().optional(), validUntil: dateStr.nullable().optional(), note: z.string().optional() }))
    .mutation(async ({ input }) => {
      const s = (await q(`SELECT rs.*, r.id AS rid FROM rfq_suppliers rs JOIN rfqs r ON r.id = rs.rfq_id WHERE rs.id = $1`, [input.rfqSupplierId]))[0];
      if (!s) throw bad("Не постои");
      await q(`UPDATE rfq_suppliers SET prices = $2, delivery_days = $3, valid_until = $4, note = $5, responded_at = now() WHERE id = $1`,
        [input.rfqSupplierId, JSON.stringify(input.prices), input.deliveryDays ?? null, input.validUntil ?? null, input.note ?? null]);
      const items = await q(`SELECT id, material_id FROM rfq_items WHERE rfq_id = $1`, [s.rid]);
      for (const i of items) { const p = input.prices[String(i.id)]; if (i.material_id && p > 0) await upsertPrice(Number(s.supplier_id), Number(i.material_id), p, "барање за понуда", { leadDays: input.deliveryDays ?? null }); }
      await q(`UPDATE rfqs SET status = 'answered' WHERE id = $1 AND status IN ('draft','sent')`, [s.rid]);
      return { success: true };
    }),
  /** Избор на понудата → набавна нарачка (нацрт) со нејзините цени. */
  rfqChoose: publicQuery.input(z.object({ rfqSupplierId: z.number() })).mutation(async ({ input, ctx }) => {
    const s = (await q(`SELECT rs.*, r.id AS rid, r.number, r.needed_by, r.po_id FROM rfq_suppliers rs JOIN rfqs r ON r.id = rs.rfq_id WHERE rs.id = $1`, [input.rfqSupplierId]))[0];
    if (!s) throw bad("Не постои");
    if (s.po_id) throw bad("За ова барање веќе е направена набавна нарачка");
    const prices = (s.prices ?? {}) as Record<string, number>;
    const items = await q(`SELECT * FROM rfq_items WHERE rfq_id = $1 ORDER BY id`, [s.rid]);
    if (items.some((i) => !i.material_id)) throw bad("Сите ставки мора да се поврзани со материјал од магацинот за да се направи набавна нарачка");
    if (items.some((i) => !(prices[i.id] > 0))) throw bad("Добавувачот нема дадено цена за сите ставки");
    const mod: any = await import("./router");
    const caller: any = mod.appRouter.createCaller(ctx);
    const { getNextDocNumber } = await import("./counters-helper");
    const poNumber = await getNextDocNumber("po");
    const expected = s.needed_by ? iso(s.needed_by) : s.delivery_days ? new Date(Date.now() + Number(s.delivery_days) * 86400000).toISOString().slice(0, 10) : undefined;
    const r = await caller.procurement.poCreate({ poNumber, supplierId: Number(s.supplier_id), status: "draft", expectedDate: expected, notes: `Од барање за понуда ${s.number}`,
      items: items.map((i) => ({ materialId: Number(i.material_id), description: i.description, quantity: String(i.quantity), unitPrice: String(prices[i.id]), totalPrice: (Number(i.quantity) * prices[i.id]).toFixed(2) })) });
    await q(`UPDATE rfq_suppliers SET chosen = (id = $1) WHERE rfq_id = $2`, [input.rfqSupplierId, s.rid]);
    await q(`UPDATE rfqs SET status = 'ordered', po_id = $2 WHERE id = $1`, [s.rid, r.id]);
    return { poId: r.id, poNumber };
  }),
  rfqDelete: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await q(`DELETE FROM rfqs WHERE id = $1 AND po_id IS NULL`, [input.id]);
    return { success: true };
  }),

  // ===== Ценовници =====
  priceList: publicQuery.input(z.object({ materialId: z.number().optional(), supplierId: z.number().optional() }).optional()).query(async ({ input }) => {
    const rows = await q(`SELECT sp.*, s.name AS supplier, m.name AS material, m.unit FROM supplier_prices sp JOIN suppliers s ON s.id = sp.supplier_id JOIN materials m ON m.id = sp.material_id
      WHERE ($1::int IS NULL OR sp.material_id = $1) AND ($2::int IS NULL OR sp.supplier_id = $2) ORDER BY m.name, sp.price`, [input?.materialId ?? null, input?.supplierId ?? null]);
    return rows.map((r) => ({ id: r.id, supplierId: r.supplier_id, supplier: r.supplier, materialId: r.material_id, material: r.material, unit: r.unit, price: Number(r.price), currency: r.currency,
      minQty: r.min_qty === null ? null : Number(r.min_qty), leadDays: r.lead_days, validFrom: r.valid_from ? iso(r.valid_from) : null, source: r.source, updatedAt: r.updated_at }));
  }),
  priceSave: publicQuery
    .input(z.object({ supplierId: z.number(), materialId: z.number(), price: z.number().positive(), currency: z.string().max(10).default("MKD"), leadDays: z.number().int().min(0).nullable().optional(), minQty: z.number().min(0).nullable().optional() }))
    .mutation(async ({ input }) => { await upsertPrice(input.supplierId, input.materialId, input.price, "рачно", input); return { success: true }; }),
  priceDelete: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => { await q(`DELETE FROM supplier_prices WHERE id = $1`, [input.id]); return { success: true }; }),
  /** Ценовникот се надополнува од потврдените приемници (последна платена цена). */
  pricesFromReceipts: publicQuery.mutation(async () => {
    const rows = await q(`SELECT DISTINCT ON (r.supplier_id, ri.material_id) r.supplier_id, ri.material_id, ri.unit_price FROM receipt_items ri JOIN receipts r ON r.id = ri.receipt_id
      WHERE r.status = 'confirmed' AND r.supplier_id IS NOT NULL AND ri.unit_price > 0 ORDER BY r.supplier_id, ri.material_id, r.receipt_date DESC, r.id DESC`);
    for (const r of rows) await upsertPrice(Number(r.supplier_id), Number(r.material_id), Number(r.unit_price), "приемница");
    return { updated: rows.length };
  }),

  // ===== Тристрано усогласување =====
  threeWayMatch: publicQuery.input(z.object({ from: dateStr, to: dateStr })).query(async ({ input }) => {
    const invs = await q(`SELECT ii.id, ii.supplier_invoice_number, ii.po_id, ii.receipt_id, ii.subtotal, ii.currency, COALESCE(ii.issue_date, ii.received_date) AS d, s.name AS supplier
      FROM incoming_invoices ii LEFT JOIN suppliers s ON s.id = ii.supplier_id
      WHERE ii.status <> 'cancelled' AND COALESCE(ii.issue_date, ii.received_date) BETWEEN $1 AND $2 AND (ii.po_id IS NOT NULL OR ii.receipt_id IS NOT NULL)
      ORDER BY d DESC`, [input.from, input.to]);
    const out = [];
    for (const inv of invs) {
      const poId = inv.po_id ?? (inv.receipt_id ? (await q(`SELECT po_id FROM receipts WHERE id = $1`, [inv.receipt_id]))[0]?.po_id : null);
      const po = poId ? (await q(`SELECT id, po_number FROM purchase_orders WHERE id = $1`, [poId]))[0] : null;
      const poItems = poId ? await q(`SELECT material_id, SUM(quantity) AS qty, AVG(unit_price) AS price FROM purchase_order_items WHERE purchase_order_id = $1 GROUP BY 1`, [poId]) : [];
      const recIds = inv.receipt_id ? [inv.receipt_id] : poId ? (await q(`SELECT id FROM receipts WHERE po_id = $1 AND status = 'confirmed'`, [poId])).map((r) => r.id) : [];
      const recItems = recIds.length ? await q(`SELECT ri.material_id, SUM(ri.quantity) AS qty, m.name FROM receipt_items ri LEFT JOIN materials m ON m.id = ri.material_id WHERE ri.receipt_id = ANY($1::int[]) GROUP BY 1, 3`, [recIds]) : [];
      const issues: string[] = [];
      let expected = 0;
      for (const ri of recItems) {
        const pi = poItems.find((p) => Number(p.material_id) === Number(ri.material_id));
        if (po && !pi) { issues.push(`${ri.name}: примено, а не е нарачано`); continue; }
        if (pi && Number(ri.qty) > Number(pi.qty) + 1e-6) issues.push(`${ri.name}: примено ${Number(ri.qty)}, нарачано ${Number(pi.qty)}`);
        expected += Number(ri.qty) * Number(pi?.price ?? 0);
      }
      if (!recItems.length) issues.push("Нема потврдена приемница — фактурата е за стока што не е примена");
      const invoiced = Number(inv.subtotal);
      const diff = r2(invoiced - expected);
      const priceOk = !po || !recItems.length || Math.abs(diff) <= Math.max(1, expected * 0.01);
      if (!priceOk) issues.push(`Основица на фактурата ${invoiced.toLocaleString("mk-MK")} наспроти примено × нарачана цена ${r2(expected).toLocaleString("mk-MK")} (разлика ${diff.toLocaleString("mk-MK")})`);
      out.push({ invoiceId: inv.id, invoice: inv.supplier_invoice_number, supplier: inv.supplier, date: iso(inv.d), currency: inv.currency, poNumber: po?.po_number ?? null,
        receipts: recIds.length, invoiced, expected: r2(expected), diff, ok: issues.length === 0, issues });
    }
    return out;
  }),

  // ===== Одобрување =====
  approvalSettings: publicQuery.query(async () => ({ threshold: await poApprovalThreshold() })),
  approvalSettingsSave: publicQuery.input(z.object({ threshold: z.number().min(0).nullable() })).mutation(async ({ input }) => {
    await q(`INSERT INTO app_kv (key, value, updated_at) VALUES ('po:approval', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify({ threshold: input.threshold || null })]);
    return { success: true };
  }),
  poApprove: publicQuery.input(z.object({ poId: z.number(), approve: z.boolean() })).mutation(async ({ input, ctx }) => {
    await q(`UPDATE purchase_orders SET approved_by = $2, approved_at = $3 WHERE id = $1`, [input.poId, input.approve ? actor(ctx) : null, input.approve ? new Date() : null]);
    return { success: true };
  }),
  pendingApprovals: publicQuery.query(async () => {
    const t = await poApprovalThreshold();
    if (t === null) return { threshold: null, list: [] };
    const rows = await q(`SELECT po.id, po.po_number, po.total_amount, po.status, s.name FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.status = 'draft' AND po.total_amount > $1 AND po.approved_at IS NULL ORDER BY po.created_at`, [t]);
    return { threshold: t, list: rows.map((r) => ({ id: r.id, number: r.po_number, total: Number(r.total_amount), supplier: r.name })) };
  }),
});
