/**
 * Готови производи (FG): физичка залиха + резервации на ставки од нарачка.
 * Резервацијата живее на order_items.reserved_qty; физичката количина на finished_goods_stock.
 * Ако производот нема FG ред — се создава со 0 (идемпотентно), достапно=0 + јасно предупредување.
 */
import { getPool } from "./queries/connection";

const q = async (sql: string, params: any[] = []) => (await getPool().query(sql, params)).rows as any[];
const f3 = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3);

/** Колку уште треба да се испорача од нарачана количина. */
export function remainingToDeliver(ordered: number, delivered: number): number {
  return Math.max(0, Math.round((ordered - delivered) * 1000) / 1000);
}

/** Достапна залиха = физичка − отворени резервации (други нарачки). */
export function availableFg(physical: number, reservedOpen: number): number {
  return Math.round((physical - reservedOpen) * 1000) / 1000;
}

/** Делумна испорака: колку се праќа сега и колку останува како backorder. */
export function allocateDelivery(remaining: number, requested: number): { ship: number; backorder: number } {
  const req = Math.max(0, requested);
  const rem = Math.max(0, remaining);
  const ship = Math.min(rem, req);
  return { ship: Math.round(ship * 1000) / 1000, backorder: Math.round((rem - ship) * 1000) / 1000 };
}

/** Макс. што може да се врати: испорачано − веќе вратено. */
export function returnableQty(delivered: number, alreadyReturned: number): number {
  return Math.max(0, Math.round((delivered - alreadyReturned) * 1000) / 1000);
}

export async function physicalFgQty(productId: number): Promise<number> {
  try {
    const rows = await q(`SELECT COALESCE(SUM(quantity), 0) AS q FROM finished_goods_stock WHERE product_id = $1`, [productId]);
    return Number(rows[0]?.q ?? 0);
  } catch (e: any) {
    // табелата може да недостасува пред миграција — не уривај
    if (e?.code === "42P01") return 0;
    throw e;
  }
}

/** Осигури FG ред (0 количина) за производ во магацин за готови производи. */
export async function ensureFgStockRow(productId: number): Promise<{ created: boolean; warehouseId: number | null; warning?: string }> {
  const prod = (await q(`SELECT id, name FROM products WHERE id = $1`, [productId]))[0];
  if (!prod) return { created: false, warehouseId: null, warning: `Производ #${productId} не постои` };

  let wh = (await q(`SELECT id FROM warehouses WHERE type = 'finished_goods' ORDER BY id LIMIT 1`))[0];
  if (!wh) {
    // создај стандарден FG магацин (како во продукција → ГЛ-ПРОД)
    try {
      const ins = await q(
        `INSERT INTO warehouses (code, name, type) VALUES ('GL-PROD', 'Готови производи', 'finished_goods')
         ON CONFLICT (code) DO NOTHING RETURNING id`,
      );
      wh = ins[0] ?? (await q(`SELECT id FROM warehouses WHERE code = 'GL-PROD' OR type = 'finished_goods' ORDER BY id LIMIT 1`))[0];
    } catch {
      wh = (await q(`SELECT id FROM warehouses ORDER BY id LIMIT 1`))[0];
    }
  }
  if (!wh) return { created: false, warehouseId: null, warning: `„${prod.name}“: нема магацин за готови производи` };

  const existing = (await q(
    `SELECT id FROM finished_goods_stock WHERE product_id = $1 AND warehouse_id = $2 LIMIT 1`,
    [productId, wh.id],
  ))[0];
  if (existing) return { created: false, warehouseId: Number(wh.id) };

  await q(
    `INSERT INTO finished_goods_stock (product_id, warehouse_id, quantity, unit_cost, notes)
     VALUES ($1,$2,'0','0',$3)`,
    [productId, wh.id, "автоматски ред (без залиха)"],
  );
  return {
    created: true,
    warehouseId: Number(wh.id),
    warning: `„${prod.name}“: немаше FG залиха — создаден е ред со 0. Резервација/испорака ќе биде backorder додека не се заведе производство.`,
  };
}

/** Отворени резервации за производ (исклучи опционално една нарачка). */
export async function openReservedFg(productId: number, excludeOrderId?: number): Promise<number> {
  try {
    const rows = await q(
      `SELECT COALESCE(SUM(GREATEST(0, COALESCE(oi.reserved_qty, 0))), 0) AS q
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.product_id = $1 AND o.status NOT IN ('cancelled','delivered')
         AND ($2::int IS NULL OR o.id <> $2)`,
      [productId, excludeOrderId ?? null],
    );
    return Number(rows[0]?.q ?? 0);
  } catch (e: any) {
    if (e?.code === "42703") return 0; // колоната уште не постои
    throw e;
  }
}

export async function availableFgQty(productId: number, excludeOrderId?: number): Promise<{ available: number; physical: number; warning?: string }> {
  const ensured = await ensureFgStockRow(productId);
  const phys = await physicalFgQty(productId);
  const reserved = await openReservedFg(productId, excludeOrderId);
  const available = availableFg(phys, reserved);
  const warnings: string[] = [];
  if (ensured.warning) warnings.push(ensured.warning);
  if (phys <= 0.0005) warnings.push(`Производ #${productId}: физичка FG залиха е 0 — сè ќе оди како backorder до производство/прием во ГЛ-ПРОД`);
  else if (available < 0) warnings.push(`Производ #${productId}: презакажано (достапно ${available})`);
  return { available, physical: phys, warning: warnings.length ? warnings.join("; ") : undefined };
}

/** FIFO одземање од finished_goods_stock. */
export async function deductFg(productId: number, qty: number): Promise<void> {
  if (qty <= 0.0005) return;
  await ensureFgStockRow(productId);
  const phys = await physicalFgQty(productId);
  if (phys + 0.0005 < qty) {
    throw new Error(
      `Нема доволно FG залиха за производ #${productId} (има ${phys}, потребно ${qty}). Заведи производство во ГЛ-ПРОД или намали ја количината.`,
    );
  }
  const entries = await q(
    `SELECT id, quantity FROM finished_goods_stock WHERE product_id = $1 AND quantity::numeric > 0 ORDER BY id`,
    [productId],
  );
  let left = qty;
  for (const e of entries) {
    if (left <= 0.0005) break;
    const have = Number(e.quantity);
    const take = Math.min(have, left);
    await q(`UPDATE finished_goods_stock SET quantity = $1, updated_at = now() WHERE id = $2`, [f3(have - take), e.id]);
    left -= take;
  }
}

/** Врати залиха (пр. поврат) — додај на прв запис или креирај. */
export async function restockFg(productId: number, qty: number, opts?: { warehouseId?: number; unitCost?: number; notes?: string }): Promise<void> {
  if (qty <= 0.0005) return;
  const ensured = await ensureFgStockRow(productId);
  const wh = opts?.warehouseId ?? ensured.warehouseId
    ?? (await q(`SELECT id FROM warehouses WHERE type = 'finished_goods' ORDER BY id LIMIT 1`))[0]?.id
    ?? (await q(`SELECT id FROM warehouses ORDER BY id LIMIT 1`))[0]?.id;
  if (!wh) throw new Error("Нема магацин за готови производи — креирај магацин тип finished_goods");
  const row = (await q(
    `SELECT id, quantity FROM finished_goods_stock WHERE product_id = $1 AND warehouse_id = $2 ORDER BY id LIMIT 1`,
    [productId, wh],
  ))[0];
  if (row) await q(`UPDATE finished_goods_stock SET quantity = $1, updated_at = now() WHERE id = $2`, [f3(Number(row.quantity) + qty), row.id]);
  else await q(
    `INSERT INTO finished_goods_stock (product_id, warehouse_id, quantity, unit_cost, notes) VALUES ($1,$2,$3,$4,$5)`,
    [productId, wh, f3(qty), (opts?.unitCost ?? 0).toFixed(2), opts?.notes ?? "поврат"],
  );
}

/**
 * Резервирај количини на ставки со product_id.
 * При confirmed (strict): блокира ако нема достапна залиха.
 * Без FG ред: создава 0 + предупредување; не урива освен при strict.
 */
export async function reserveOrderItems(orderId: number, opts: { strict: boolean }): Promise<{ reserved: number; warnings: string[] }> {
  const items = await q(
    `SELECT id, product_id, quantity, COALESCE(delivered_qty,0) AS delivered_qty, COALESCE(reserved_qty,0) AS reserved_qty, description
     FROM order_items WHERE order_id = $1`,
    [orderId],
  );
  const warnings: string[] = [];
  let reserved = 0;
  for (const it of items) {
    if (!it.product_id) {
      await q(`UPDATE order_items SET reserved_qty = 0 WHERE id = $1`, [it.id]).catch(() => {});
      continue;
    }
    const need = remainingToDeliver(Number(it.quantity), Number(it.delivered_qty));
    const { available: avail, physical, warning } = await availableFgQty(Number(it.product_id), orderId);
    if (warning) warnings.push(warning);
    if (opts.strict && need > avail + 0.0005) {
      throw new Error(
        `Нема доволно залиха за резервација на „${it.description}“ (физичка FG ${physical}, достапно ${avail}, потребно ${need}). ` +
          `Заведи готови производи во ГЛ-ПРОД или остави ја нарачката како pending (soft резервација / backorder).`,
      );
    }
    const take = Math.min(need, Math.max(0, avail));
    if (take + 0.0005 < need) {
      warnings.push(`„${it.description}“: резервирано ${take} од ${need} (backorder ${Math.round((need - take) * 1000) / 1000})`);
    }
    await q(`UPDATE order_items SET reserved_qty = $1 WHERE id = $2`, [f3(take), it.id]);
    reserved += take;
  }
  return { reserved, warnings };
}

export async function releaseOrderReservations(orderId: number): Promise<void> {
  await q(`UPDATE order_items SET reserved_qty = 0 WHERE order_id = $1`, [orderId]);
}

/** По испорака: зголеми delivered, намали reserved (не под 0). */
export async function applyDeliveryToOrderItem(orderItemId: number, shipQty: number): Promise<{ backorder: number }> {
  const it = (await q(
    `SELECT id, quantity, COALESCE(delivered_qty,0) AS delivered_qty, COALESCE(reserved_qty,0) AS reserved_qty FROM order_items WHERE id = $1`,
    [orderItemId],
  ))[0];
  if (!it) throw new Error("Ставката од нарачката не постои");
  const rem = remainingToDeliver(Number(it.quantity), Number(it.delivered_qty));
  const { ship, backorder } = allocateDelivery(rem, shipQty);
  if (ship + 0.0005 < shipQty) throw new Error(`Не може да се испорача ${shipQty} — остануваат само ${rem}`);
  const newDel = Number(it.delivered_qty) + ship;
  const newRes = Math.max(0, Number(it.reserved_qty) - ship);
  await q(`UPDATE order_items SET delivered_qty = $1, reserved_qty = $2 WHERE id = $3`, [f3(newDel), f3(newRes), orderItemId]);
  return { backorder };
}

/** Веќе вратено по order_item / product+invoice. */
export async function alreadyReturnedQty(opts: { orderItemId?: number; productId?: number; invoiceId?: number }): Promise<number> {
  try {
    if (opts.orderItemId) {
      const r = await q(
        `SELECT COALESCE(SUM(quantity),0) AS q FROM sales_return_items WHERE order_item_id = $1`,
        [opts.orderItemId],
      );
      return Number(r[0]?.q ?? 0);
    }
    if (opts.productId && opts.invoiceId) {
      const r = await q(
        `SELECT COALESCE(SUM(sri.quantity),0) AS q FROM sales_return_items sri
         JOIN sales_returns sr ON sr.id = sri.return_id
         WHERE sri.product_id = $1 AND sr.invoice_id = $2 AND sr.status <> 'cancelled'`,
        [opts.productId, opts.invoiceId],
      );
      return Number(r[0]?.q ?? 0);
    }
  } catch (e: any) {
    if (e?.code === "42P01") return 0;
    throw e;
  }
  return 0;
}
