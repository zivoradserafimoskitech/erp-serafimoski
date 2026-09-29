// Автоматска пресметка на цена на работен налог: операции (цена/час × време) + материјали
import { eq } from "drizzle-orm";
import { getDb } from "./queries/connection";
import { workOrders, workOrderOperations, workOrderMaterials, materials } from "@db/schema";

export async function recalcWorkOrderCost(workOrderId: number): Promise<string> {
  const db = getDb();
  const ops = await db.select().from(workOrderOperations).where(eq(workOrderOperations.workOrderId, workOrderId));
  const mats = await db.select().from(workOrderMaterials).where(eq(workOrderMaterials.workOrderId, workOrderId));

  let opCost = 0;
  for (const o of ops) {
    const rate = parseFloat(String(o.costRate ?? "0")) || 0;
    const hours = parseFloat(String(o.actualTime ?? "")) || parseFloat(String(o.estimatedTime ?? "")) || 0;
    const amount = rate * hours;
    opCost += amount;
    // Запиши ја пресметаната цена на самата операција за приказ
    const stored = parseFloat(String(o.costAmount ?? "0")) || 0;
    if (Math.abs(stored - amount) > 0.005) {
      await db.update(workOrderOperations).set({ costAmount: amount.toFixed(2) }).where(eq(workOrderOperations.id, o.id));
    }
  }

  // Секој ред е или планиран или реален (издавањето го претвора планираниот во реален), па нема двојно броење.
  // Ред без цена (на пр. копиран од понуда) се вреднува по просечната набавна цена на материјалот.
  let matCost = 0;
  for (const m of mats) {
    let cost = parseFloat(String(m.totalCost ?? "0")) || 0;
    if (cost <= 0) {
      const mat = (await db.select().from(materials).where(eq(materials.id, m.materialId)))[0];
      const unit = parseFloat(String(mat?.avgCost ?? "0")) || parseFloat(String(mat?.lastPurchasePrice ?? "0")) || 0;
      cost = unit * (parseFloat(String(m.quantity ?? "0")) || 0);
    }
    matCost += cost;
  }
  const total = opCost + matCost;
  await db.update(workOrders).set({ costAmount: total.toFixed(2) }).where(eq(workOrders.id, workOrderId));
  return total.toFixed(2);
}
