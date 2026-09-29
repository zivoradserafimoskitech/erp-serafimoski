// Усогласување при стартување: поправа стари податоци внесени пред заедничките правила
// (вкупна залиха = збир по магацини, партии <= залиха, статус на фактура = уплати). Безопасно за повторување.
import { getPool } from "./queries/connection";
import { refreshAllPaymentStatuses } from "./payment-status";

const q = async (sql: string, params: any[] = []) => (await getPool().query(sql, params)).rows as any[];

export async function reconcileData() {
  let fixed = 0;
  // 1) Вкупна залиха на материјал = збир по магацини
  const r1 = await getPool().query(`UPDATE materials m SET current_stock = s.total, updated_at = now()
    FROM (SELECT material_id, SUM(quantity) total FROM material_stock GROUP BY material_id) s
    WHERE m.id = s.material_id AND ABS(m.current_stock - s.total) > 0.0005`);
  fixed += r1.rowCount ?? 0;
  // 2) Партиите во магацин не смеат да бидат повеќе од залихата: намали ги најстарите (FIFO)
  const over = await q(`SELECT l.material_id, l.warehouse_id, SUM(l.remaining_qty) lots, COALESCE(MAX(s.quantity), 0) stock
    FROM material_lots l LEFT JOIN material_stock s ON s.material_id = l.material_id AND s.warehouse_id = l.warehouse_id
    WHERE l.remaining_qty > 0 GROUP BY l.material_id, l.warehouse_id HAVING SUM(l.remaining_qty) > COALESCE(MAX(s.quantity), 0) + 0.0005`);
  for (const o of over) {
    let left = Number(o.lots) - Math.max(0, Number(o.stock));
    for (const l of await q(`SELECT id, remaining_qty FROM material_lots WHERE material_id = $1 AND warehouse_id = $2 AND remaining_qty > 0 ORDER BY id`, [o.material_id, o.warehouse_id])) {
      if (left <= 0.0005) break;
      const take = Math.min(Number(l.remaining_qty), left);
      await q(`UPDATE material_lots SET remaining_qty = $1 WHERE id = $2`, [(Number(l.remaining_qty) - take).toFixed(3), l.id]);
      left -= take; fixed++;
    }
  }
  // 3) Статус платена/делумно според уплатите (банка, благајна, книжни одобренија)
  fixed += await refreshAllPaymentStatuses();
  return fixed;
}
