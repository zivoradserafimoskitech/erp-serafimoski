// Усогласување при стартување: поправа стари податоци внесени пред заедничките правила
// (вкупна залиха = збир по магацини, партии <= залиха, статус на фактура = уплати). Безопасно за повторување.
import { getPool } from "./queries/connection";
import { refreshAllPaymentStatuses } from "./payment-status";
import { suggestExpenseAccount } from "@contracts/finance";

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
  // 3) Приемници што веќе ја зголемиле залихата, а останале „нацрт“ (порано статусот не се менуваше) -> потврдени
  const r3 = await getPool().query(`UPDATE receipts r SET status = 'confirmed' WHERE r.status = 'draft'
    AND EXISTS (SELECT 1 FROM inventory_transactions t WHERE t.source_doc_type = 'receipt' AND t.source_doc_id = r.id)`);
  fixed += r3.rowCount ?? 0;

  // 3б) Износ на приемница = збир на ставките (порано не се пресметуваше)
  const r3b = await getPool().query(`UPDATE receipts r SET total_amount = x.s FROM (SELECT receipt_id, SUM(total_price) s FROM receipt_items GROUP BY receipt_id) x
    WHERE x.receipt_id = r.id AND COALESCE(r.total_amount, 0) = 0 AND x.s > 0`);
  fixed += r3b.rowCount ?? 0;

  // 4) Влезни фактури внесени пред полето „конто“: предлог по добавувач/ставки/белешка (ЕВН -> 401...), инаку 310
  const noAcc = await q(`SELECT ii.id, ii.supplier_id, ii.notes, s.name, s.default_expense_account,
      (SELECT string_agg(d.description, ' ') FROM document_items d WHERE d.document_type = 'incoming_invoice' AND d.document_id = ii.id) AS items
    FROM incoming_invoices ii LEFT JOIN suppliers s ON s.id = ii.supplier_id WHERE ii.expense_account IS NULL`);
  for (const r of noAcc) {
    const acc = r.default_expense_account || suggestExpenseAccount([r.name, r.notes, r.items].filter(Boolean).join(" ")) || "310";
    await q(`UPDATE incoming_invoices SET expense_account = $1 WHERE id = $2`, [acc, r.id]);
    if (acc !== "310" && !r.default_expense_account && r.supplier_id) await q(`UPDATE suppliers SET default_expense_account = $1 WHERE id = $2 AND default_expense_account IS NULL`, [acc, r.supplier_id]);
    fixed++;
  }
  if (noAcc.length) import("./finance-router").then(m => m.syncLedger()).catch(() => {});

  // 5) Статус платена/делумно според уплатите (банка, благајна, книжни одобренија)
  fixed += await refreshAllPaymentStatuses();
  return fixed;
}
