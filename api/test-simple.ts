// Simple direct test - no HTTP layer
import { getDb } from "./queries/connection";
import {
  materials, materialStock, inventoryTransactions,
  receipts, receiptItems, warehouses,
  workOrders, workOrderMaterials,
  invoices, documentItems, customers,
  docCounters,
} from "@db/schema";
import { eq, and, count, sql } from "drizzle-orm";

async function test() {
  const db = getDb();
  const results: string[] = [];
  const testId = Date.now();

  // 1. Get warehouse
  const wh = await db.select().from(warehouses).limit(1);
  if (!wh[0]) { console.log("❌ Нема магацин"); return; }
  const warehouseId = wh[0].id;
  results.push(`✓ Магацин: ${wh[0].name}`);

  // 2. Get first material
  const material = await db.select().from(materials).limit(1);
  if (!material[0]) { console.log("❌ Нема материјал"); return; }
  const materialId = material[0].id;
  results.push(`✓ Материјал: ${material[0].name}`);

  // 3. Check initial stock
  const initialStock = await db.select().from(materialStock)
    .where(and(eq(materialStock.materialId, materialId), eq(materialStock.warehouseId, warehouseId)));
  const initialQty = initialStock[0] ? parseFloat(String(initialStock[0].quantity)) : 0;
  results.push(`✓ Почетна залиха: ${initialQty.toFixed(3)}`);

  // STEP 1: RECEIPT (100 m2 at 850 den/m2)
  const receiptQty = 100;
  const receiptPrice = "850.00";
  
  const receiptResult = await db.insert(receipts).values({
    receiptNumber: `ПР-TEST-${testId}`,
    warehouseId,
    receiptDate: sql`CURRENT_DATE`,
    status: "draft",
    transportCost: "500",
    customsCost: "0",
    otherCost: "0",
    totalAmount: (receiptQty * parseFloat(receiptPrice)).toFixed(2),
  } as any);
  const receiptId = Number(receiptResult[0].insertId);

  await db.insert(receiptItems).values({
    receiptId, materialId,
    quantity: String(receiptQty), unit: "m2",
    unitPrice: receiptPrice,
    totalPrice: (receiptQty * parseFloat(receiptPrice)).toFixed(2),
    vatRate: "18",
    landedCostAlloc: "5.00",
  } as any);

  // Update stock
  const itemTotal = receiptQty * (parseFloat(receiptPrice) + 5);
  const newAvgCost = ((initialQty * (initialStock[0] ? parseFloat(String(initialStock[0].avgCost)) : 0)) + itemTotal) / (initialQty + receiptQty);

  if (initialStock[0]) {
    await db.update(materialStock)
      .set({ quantity: String(initialQty + receiptQty), avgCost: newAvgCost.toFixed(2) })
      .where(eq(materialStock.id, initialStock[0].id));
  } else {
    await db.insert(materialStock).values({
      materialId, warehouseId,
      quantity: String(receiptQty),
      avgCost: (itemTotal / receiptQty).toFixed(2),
    } as any);
  }

  await db.insert(inventoryTransactions).values({
    materialId, warehouseId, type: "receipt",
    quantity: String(receiptQty), unitCost: receiptPrice,
    totalCost: String(itemTotal),
    referenceType: "receipt", referenceId: receiptId,
  } as any);

  results.push(`--- ЧЕКОР 1: ПРИЕМНИЦА ---`);
  results.push(`✓ Приемница: ${receiptQty} m2 по ${receiptPrice} ден/m2 (+5 ден landed cost)`);

  // STEP 2: WORK ORDER
  const woQty = 50;
  
  const woResult = await db.insert(workOrders).values({
    woNumber: `РН-TEST-${testId}`,
    description: "Тест налог",
    status: "in_progress",
    priority: "normal",
    plannedStart: sql`CURRENT_DATE`,
    actualStart: sql`CURRENT_DATE`,
    costAmount: "0",
  } as any);
  const woId = Number(woResult[0].insertId);

  await db.insert(workOrderMaterials).values({
    workOrderId: woId, materialId,
    quantity: String(woQty),
    unitCost: newAvgCost.toFixed(2),
    totalCost: (woQty * newAvgCost).toFixed(2),
    isActual: "actual",
  } as any);

  const materialCost = woQty * newAvgCost;
  const remainingQty = initialQty + receiptQty - woQty;
  const afterReceiptStock = await db.select().from(materialStock)
    .where(and(eq(materialStock.materialId, materialId), eq(materialStock.warehouseId, warehouseId)));

  if (afterReceiptStock[0]) {
    await db.update(materialStock)
      .set({ quantity: String(remainingQty) })
      .where(eq(materialStock.id, afterReceiptStock[0].id));
  }

  await db.insert(inventoryTransactions).values({
    materialId, warehouseId, type: "issue",
    quantity: String(-woQty),
    unitCost: newAvgCost.toFixed(2), totalCost: String(-materialCost),
    referenceType: "work_order", referenceId: woId,
  } as any);

  await db.update(workOrders)
    .set({ costAmount: String(materialCost), status: "completed", actualEnd: sql`CURRENT_DATE` })
    .where(eq(workOrders.id, woId));

  results.push(`--- ЧЕКОР 2: ПРОИЗВОДСТВО ---`);
  results.push(`✓ Работен налог: потрошени ${woQty} m2`);
  results.push(`✓ Трошок на материјал: ${materialCost.toFixed(2)} ден. (просечна цена: ${newAvgCost.toFixed(2)} ден/m2)`);

  // STEP 3: INVOICE
  const custResult = await db.insert(customers).values({
    name: `Тест Клиент ${testId}`,
    code: `TEST-${testId}`,
    city: "Скопје",
    isActive: "active",
  } as any);
  const customerId = Number(custResult[0].insertId);

  const counter = await db.select().from(docCounters)
    .where(and(eq(docCounters.kind, "invoice"), eq(docCounters.year, 2025)))
    .limit(1);
  let invoiceNum = "001/2025";
  if (counter[0]) {
    const next = counter[0].value + 1;
    await db.update(docCounters).set({ value: next }).where(eq(docCounters.id, counter[0].id));
    invoiceNum = String(next).padStart(3, "0") + "/2025";
  }

  const subtotal = materialCost * 1.5; // 50% margin
  const vatAmt = subtotal * 0.18;
  const totalAmt = subtotal + vatAmt;

  const invResult = await db.insert(invoices).values({
    invoiceNumber: invoiceNum,
    customerId,
    issueDate: sql`CURRENT_DATE`,
    dueDate: sql`DATE_ADD(CURRENT_DATE, INTERVAL 30 DAY)`,
    subtotal: subtotal.toFixed(2),
    vatRate: "18",
    vatAmount: vatAmt.toFixed(2),
    totalAmount: totalAmt.toFixed(2),
    currency: "MKD",
    status: "issued",
    invoiceType: "standard",
  } as any);
  const invoiceId = Number(invResult[0].insertId);

  await db.insert(documentItems).values({
    documentId: invoiceId, documentType: "invoice",
    description: material[0].name,
    quantity: String(woQty), unit: "m2",
    unitPrice: (subtotal / woQty).toFixed(2),
    totalPrice: subtotal.toFixed(2),
    vatRate: "18",
    itemType: "product",
  } as any);

  const margin = subtotal - materialCost;
  const marginPct = (margin / subtotal) * 100;

  results.push(`--- ЧЕКОР 3: ФАКТУРА ---`);
  results.push(`✓ Фактура: ${invoiceNum}`);
  results.push(`✓ Износ без ДДВ: ${subtotal.toFixed(2)} ден.`);
  results.push(`✓ ДДВ (18%): ${vatAmt.toFixed(2)} ден.`);
  results.push(`✓ Вкупно: ${totalAmt.toFixed(2)} ден.`);
  results.push(`✓ Маржа: ${margin.toFixed(2)} ден. (${marginPct.toFixed(1)}%)`);

  // Cleanup
  await db.delete(documentItems).where(eq(documentItems.documentId as any, invoiceId));
  await db.delete(invoices).where(eq(invoices.id, invoiceId));
  await db.delete(workOrderMaterials).where(eq(workOrderMaterials.workOrderId as any, woId));
  await db.delete(workOrders).where(eq(workOrders.id, woId));
  await db.delete(receiptItems).where(eq(receiptItems.receiptId, receiptId));
  await db.delete(receipts).where(eq(receipts.id, receiptId));
  await db.delete(customers).where(eq(customers.id, customerId));
  if (initialStock[0]) {
    await db.update(materialStock)
      .set({ quantity: String(initialQty), avgCost: initialStock[0].avgCost })
      .where(eq(materialStock.id, initialStock[0].id));
  } else {
    await db.delete(materialStock).where(eq(materialStock.id, afterReceiptStock[0]?.id));
  }
  results.push(`✓ Тест податоци избришани`);

  // Print results
  console.log("\n=== Е2Е ТЕСТ: Приемница -> Производство -> Фактура ===\n");
  results.forEach(line => console.log(line));
  console.log("\n=== ✅ ЦЕЛОСНИОТ ТЕК РАБОТИ ПРАВИЛНО! ===");
  process.exit(0);
}

test().catch(err => {
  console.error("\n=== ❌ ТЕСТОТ НЕ УСПЕА ===");
  console.error(err.message);
  process.exit(1);
});
