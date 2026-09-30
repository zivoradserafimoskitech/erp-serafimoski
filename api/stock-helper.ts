// Едно место за движење на залиха на материјал: магацин (material_stock), партии/атести (material_lots)
// и вкупната залиха на материјалот (materials.current_stock) секогаш се менуваат заедно.
import { getPool } from "./queries/connection";

const q = async (sql: string, params: any[] = []) => (await getPool().query(sql, params)).rows as any[];
const f3 = (n: number) => n.toFixed(3);

/** Вкупната залиха на материјалот = збир по магацини (ако има магацински записи). */
export async function syncMaterialTotal(materialId: number) {
  await q(`UPDATE materials SET current_stock = s.total, updated_at = now()
    FROM (SELECT SUM(quantity) total FROM material_stock WHERE material_id = $1) s
    WHERE materials.id = $1 AND s.total IS NOT NULL`, [materialId]);
}

export async function warehouseQty(materialId: number, warehouseId: number): Promise<number> {
  const r = await q(`SELECT quantity FROM material_stock WHERE material_id = $1 AND warehouse_id = $2`, [materialId, warehouseId]);
  return r[0] ? Number(r[0].quantity) : 0;
}

/** Намали ги партиите FIFO во магацинот; враќа ги земените делови (за пренос). */
async function takeLots(materialId: number, warehouseId: number, qty: number) {
  const lots = await q(`SELECT * FROM material_lots WHERE material_id = $1 AND warehouse_id = $2 AND remaining_qty > 0 ORDER BY id`, [materialId, warehouseId]);
  const taken: { lot: any; qty: number }[] = [];
  let left = qty;
  for (const l of lots) {
    if (left <= 0.0005) break;
    const take = Math.min(Number(l.remaining_qty), left);
    await q(`UPDATE material_lots SET remaining_qty = $1 WHERE id = $2`, [f3(Number(l.remaining_qty) - take), l.id]);
    taken.push({ lot: l, qty: take });
    left -= take;
  }
  return taken;
}

/**
 * Промена на залиха во магацин за delta (+ влез, - излез).
 * Излез: не дозволува негативна залиха и ги троши партиите FIFO. Влез без партија (вишок, рачна корекција) не создава партија.
 */
export async function adjustStock(materialId: number, warehouseId: number, delta: number, opts: { unitCost?: number } = {}) {
  if (Math.abs(delta) < 0.0005) return;
  const row = (await q(`SELECT id, quantity FROM material_stock WHERE material_id = $1 AND warehouse_id = $2`, [materialId, warehouseId]))[0];
  const cur = row ? Number(row.quantity) : 0;
  const next = cur + delta;
  if (next < -0.0005) throw new Error(`Нема доволно залиха во магацинот (има ${cur}, потребно ${Math.abs(delta)})`);
  if (row) await q(`UPDATE material_stock SET quantity = $1, updated_at = now() WHERE id = $2`, [f3(next), row.id]);
  else await q(`INSERT INTO material_stock (material_id, warehouse_id, quantity, avg_cost) VALUES ($1,$2,$3,$4)`,
    [materialId, warehouseId, f3(next), (opts.unitCost ?? 0).toFixed(2)]);
  if (delta < 0) await takeLots(materialId, warehouseId, -delta);
  await syncMaterialTotal(materialId);
}

/** Пренос меѓу магацини: залиха + партиите (атестите) ја следат робата. */
export async function transferStock(materialId: number, fromWh: number, toWh: number, qty: number, unitCost?: number) {
  const have = await warehouseQty(materialId, fromWh);
  if (have < qty - 0.0005) throw new Error(`Нема доволно залиха во изворниот магацин (има ${have}, потребно ${qty})`);
  const src = (await q(`SELECT avg_cost FROM material_stock WHERE material_id = $1 AND warehouse_id = $2`, [materialId, fromWh]))[0];
  await q(`UPDATE material_stock SET quantity = quantity - $1, updated_at = now() WHERE material_id = $2 AND warehouse_id = $3`, [f3(qty), materialId, fromWh]);
  const dst = (await q(`SELECT id FROM material_stock WHERE material_id = $1 AND warehouse_id = $2`, [materialId, toWh]))[0];
  if (dst) await q(`UPDATE material_stock SET quantity = quantity + $1, updated_at = now() WHERE id = $2`, [f3(qty), dst.id]);
  else await q(`INSERT INTO material_stock (material_id, warehouse_id, quantity, avg_cost) VALUES ($1,$2,$3,$4)`,
    [materialId, toWh, f3(qty), String(unitCost ?? src?.avg_cost ?? 0)]);
  for (const { lot, qty: part } of await takeLots(materialId, fromWh, qty)) {
    await q(`INSERT INTO material_lots (material_id, warehouse_id, receipt_id, supplier_id, date, heat_number, cert_number, cert_standard, cert_url,
        quantity, remaining_qty, unit_cost, landed_cost)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12)`,
      [materialId, toWh, lot.receipt_id, lot.supplier_id, lot.date, lot.heat_number, lot.cert_number, lot.cert_standard, lot.cert_url, f3(part), lot.unit_cost, lot.landed_cost]);
  }
  await syncMaterialTotal(materialId);
}

/**
 * Примена роба по набавна нарачка: количините се додаваат на ставките на нарачката (по материјал, по ред),
 * а статусот на нарачката станува „делумно примена“ или „примена“.
 */
export async function applyReceiptToPo(poId: number, received: { materialId: number; quantity: number }[]) {
  const items = await q(`SELECT id, material_id, quantity, received_quantity FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY id`, [poId]);
  for (const r of received) {
    let left = r.quantity;
    const mine = items.filter(i => Number(i.material_id) === r.materialId);
    for (let k = 0; k < mine.length && left > 0.0005; k++) {
      const it = mine[k];
      const open = Math.max(0, Number(it.quantity) - Number(it.received_quantity ?? 0));
      // вишокот оди на последниот ред од тој материјал
      const take = k === mine.length - 1 ? left : Math.min(open, left);
      if (take <= 0) continue;
      it.received_quantity = Number(it.received_quantity ?? 0) + take;
      await q(`UPDATE purchase_order_items SET received_quantity = $1 WHERE id = $2`, [f3(it.received_quantity), it.id]);
      left -= take;
    }
  }
  const all = items.length > 0 && items.every(i => Number(i.received_quantity ?? 0) >= Number(i.quantity) - 0.0005);
  const any = items.some(i => Number(i.received_quantity ?? 0) > 0.0005);
  const status = all ? "received" : any ? "partial" : null;
  if (status) await q(`UPDATE purchase_orders SET status = $1, updated_at = now() WHERE id = $2 AND status <> 'cancelled'`, [status, poId]);
}
