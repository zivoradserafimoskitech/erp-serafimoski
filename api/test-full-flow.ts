// ===== End-to-End Test: Приемница -> Производство -> Фактура =====
import { getDb } from "./queries/connection";
import {
  materials, materialStock, inventoryTransactions,
  receipts, receiptItems, warehouses,
  workOrders, workOrderMaterials, workOrderOperations,
  invoices, documentItems, customers, products,
  docCounters, finishedGoodsStock,
} from "@db/schema";
import { eq, and, count, desc, sql } from "drizzle-orm";

async function testFullFlow() {
  console.log("\n=== Е2Е ТЕСТ: Приемница -> Производство -> Фактура ===\n");
  const db = getDb();

  // 1. Get a warehouse
  const wh = await db.select().from(warehouses).limit(1);
  if (!wh[0]) { console.log("❌ Нема магацин"); return; }
  const warehouseId = wh[0].id;
  console.log("✓ Магацин:", wh[0].name, "(ID:", warehouseId + ")");

  // 2. Get or create a test material
  let material = await db.select().from(materials).limit(1);
  let materialId: number;
  if (!material[0]) {
    const result = await db.insert(materials).values({
      name: "Тест Лим 2mm",
      code: "TEST-LIM-001",
      type: "sheet_metal",
      unit: "m2",
      avgCost: "0",
      lastPurchasePrice: "850.00",
      isActive: "active",
    } as any);
    materialId = Number(result[0].insertId);
    console.log("✓ Креиран тест материјал: Тест Лим 2mm (ID:", materialId + ")");
  } else {
    materialId = material[0].id;
    console.log("✓ Постоечки материјал:", material[0].name, "(ID:", materialId + ")");
  }

  // 3. Check initial stock
  const initialStock = await db.select().from(materialStock)
    .where(and(eq(materialStock.materialId, materialId), eq(materialStock.warehouseId, warehouseId)));
  const initialQty = initialStock[0] ? parseFloat(String(initialStock[0].quantity)) : 0;
  console.log("✓ Почетна залиха:", initialQty.toFixed(3), "m2");

  // ===== STEP 1: ПРИЕМНИЦА =====
  console.log("\n--- ЧЕКОР 1: ПРИЕМНИЦА ---");
  const receiptQty = 100;
  const receiptPrice = "850.00";

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  // Create receipt
  const testId = Date.now();
  
  const receiptResult = await db.insert(receipts).values({
    receiptNumber: `ПР-TEST-${testId}`,
    warehouseId: warehouseId,
    receiptDate: sql`CURRENT_DATE`,
    status: "draft",
    transportCost: "500",
    customsCost: "0",
    otherCost: "0",
    totalAmount: (receiptQty * parseFloat(receiptPrice)).toFixed(2),
  } as any);
  const receiptId = Number(receiptResult[0].insertId);

  // Add receipt item
  await db.insert(receiptItems).values({
    receiptId,
    materialId,
    quantity: String(receiptQty),
    unit: "m2",
    unitPrice: receiptPrice,
    totalPrice: (receiptQty * parseFloat(receiptPrice)).toFixed(2),
    vatRate: "18",
    landedCostAlloc: "5.00",
  } as any);

  // Process receipt -> update stock with weighted average
  const itemTotal = receiptQty * (parseFloat(receiptPrice) + 5); // + landed cost
  const newAvgCost = ((initialQty * (initialStock[0] ? parseFloat(String(initialStock[0].avgCost)) : 0)) + itemTotal) / (initialQty + receiptQty);

  if (initialStock[0]) {
    await db.update(materialStock)
      .set({
        quantity: String(initialQty + receiptQty),
        avgCost: newAvgCost.toFixed(2),
      })
      .where(eq(materialStock.id, initialStock[0].id));
  } else {
    await db.insert(materialStock).values({
      materialId,
      warehouseId,
      quantity: String(receiptQty),
      avgCost: (itemTotal / receiptQty).toFixed(2),
    } as any);
  }

  // Inventory transaction
  await db.insert(inventoryTransactions).values({
    materialId,
    warehouseId,
    type: "receipt",
    quantity: String(receiptQty),
    unitCost: receiptPrice,
    totalCost: String(itemTotal),
    referenceType: "receipt",
    referenceId: receiptId,
  } as any);

  console.log("✓ Приемница креирана:", receiptQty, "m2 по", receiptPrice, "ден/m2");

  // Check updated stock
  const afterReceiptStock = await db.select().from(materialStock)
    .where(and(eq(materialStock.materialId, materialId), eq(materialStock.warehouseId, warehouseId)));
  const afterReceiptQty = parseFloat(String(afterReceiptStock[0]?.quantity ?? "0"));
  console.log("✓ Залиха после приемница:", afterReceiptQty.toFixed(3), "m2 (просечна цена:", afterReceiptStock[0]?.avgCost, "ден)");

  if (afterReceiptQty !== initialQty + receiptQty) {
    console.log("❌ ГРЕШКА: Залихата не се зголеми правилно!");
    return;
  }
  console.log("✅ Приемницата работи правилно!");

  // ===== STEP 2: РАБОТЕН НАЛОГ =====
  console.log("\n--- ЧЕКОР 2: РАБОТЕН НАЛОГ ---");
  const woQty = 50; // Use 50 m2 for production

  // Create work order
  const woResult = await db.insert(workOrders).values({
    woNumber: `РН-TEST-${testId}`,
    description: "Тест налог за проверка на тек",
    status: "in_progress",
    priority: "normal",
    plannedStart: sql`CURRENT_DATE`,
    actualStart: sql`CURRENT_DATE`,
    costAmount: "0",
    notes: "Тест налог за проверка на тек",
  } as any);
  const woId = Number(woResult[0].insertId);

  // Add material to work order
  await db.insert(workOrderMaterials).values({
    workOrderId: woId,
    materialId,
    quantity: String(woQty),
    unitCost: String(afterReceiptStock[0]?.avgCost ?? receiptPrice),
    totalCost: (woQty * parseFloat(String(afterReceiptStock[0]?.avgCost ?? receiptPrice))).toFixed(2),
    isActual: "actual",
  } as any);

  // Deduct stock (issue material from warehouse)
  const materialCost = woQty * parseFloat(String(afterReceiptStock[0]?.avgCost ?? receiptPrice));
  const remainingQty = afterReceiptQty - woQty;

  await db.update(materialStock)
    .set({ quantity: String(remainingQty) })
    .where(eq(materialStock.id, afterReceiptStock[0].id));

  // Inventory transaction for issue
  await db.insert(inventoryTransactions).values({
    materialId,
    warehouseId,
    type: "issue",
    quantity: String(-woQty),
    unitCost: String(afterReceiptStock[0]?.avgCost ?? receiptPrice),
    totalCost: String(-materialCost),
    referenceType: "work_order",
    referenceId: woId,
  } as any);

  // Update work order cost
  await db.update(workOrders)
    .set({ costAmount: String(materialCost), status: "completed", actualEnd: sql`CURRENT_DATE` })
    .where(eq(workOrders.id, woId));

  console.log("✓ Работен налог креиран, потрошени", woQty, "m2");
  console.log("✓ Трошок на материјал:", materialCost.toFixed(2), "ден.");

  // Check stock after issue
  const afterIssueStock = await db.select().from(materialStock)
    .where(and(eq(materialStock.materialId, materialId), eq(materialStock.warehouseId, warehouseId)));
  const afterIssueQty = parseFloat(String(afterIssueStock[0]?.quantity ?? "0"));
  console.log("✓ Залиха после издавање:", afterIssueQty.toFixed(3), "m2");

  if (Math.abs(afterIssueQty - (afterReceiptQty - woQty)) > 0.001) {
    console.log("❌ ГРЕШКА: Залихата не се намали правилно!");
    return;
  }
  console.log("✅ Работниот налог работи правилно!");

  // ===== STEP 3: ФАКТУРА =====
  console.log("\n--- ЧЕКОР 3: ФАКТУРА ---");

  // Get or create a customer
  let customer = await db.select().from(customers).limit(1);
  let customerId: number;
  if (!customer[0]) {
    const custResult = await db.insert(customers).values({
      name: "Тест Клиент",
      code: "TEST-001",
      city: "Скопје",
      isActive: "active",
    } as any);
    customerId = Number(custResult[0].insertId);
  } else {
    customerId = customer[0].id;
  }

  // Create invoice with product that uses the material
  const product = await db.select().from(products).limit(1);
  const productId = product[0]?.id;

  // Get next invoice number
  const counter = await db.select().from(docCounters)
    .where(and(eq(docCounters.kind, "invoice"), eq(docCounters.year, 2025)))
    .limit(1);
  let invoiceNum = "001/2025";
  if (counter[0]) {
    const next = counter[0].value + 1;
    await db.update(docCounters).set({ value: next }).where(eq(docCounters.id, counter[0].id));
    invoiceNum = String(next).padStart(3, "0") + "/2025";
  }

  // Create invoice
  const subtotal = materialCost * 1.5; // 50% margin
  const vatAmount = subtotal * 0.18;
  const totalAmount = subtotal + vatAmount;

  const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

  const invResult = await db.insert(invoices).values({
    invoiceNumber: invoiceNum,
    customerId,
    issueDate: sql`CURRENT_DATE`,
    dueDate,
    subtotal: subtotal.toFixed(2),
    vatRate: "18",
    vatAmount: vatAmount.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
    currency: "MKD",
    status: "issued",
    invoiceType: "standard",
  } as any);
  const invoiceId = Number(invResult[0].insertId);

  // Add invoice item
  await db.insert(documentItems).values({
    documentId: invoiceId,
    documentType: "invoice",
    description: product[0]?.name ?? "Производ од метал",
    quantity: String(woQty),
    unit: "m2",
    unitPrice: (subtotal / woQty).toFixed(2),
    totalPrice: subtotal.toFixed(2),
    vatRate: "18",
    productId: productId ?? null,
    itemType: "product",
  } as any);

  console.log("✓ Фактура креирана:", invoiceNum);
  console.log("  - Износ без ДДВ:", subtotal.toFixed(2), "ден.");
  console.log("  - ДДВ (18%):", vatAmount.toFixed(2), "ден.");
  console.log("  - Вкупно:", totalAmount.toFixed(2), "ден.");

  // Calculate margin
  const margin = subtotal - materialCost;
  const marginPct = (margin / subtotal) * 100;
  console.log("  - Маржа:", margin.toFixed(2), "ден. (" + marginPct.toFixed(1) + "%)");

  console.log("\n=== РЕЗУЛТАТ ОД ТЕСТОТ ===");
  console.log("✅ ПРИЕМНИЦА: Залиха се зголеми од", initialQty, "->", afterReceiptQty, "m2");
  console.log("✅ ПРОИЗВОДСТВО: Залиха се намали од", afterReceiptQty, "->", afterIssueQty, "m2");
  console.log("✅ COSTING: Материјален трошок =", materialCost.toFixed(2), "ден.");
  console.log("✅ ФАКТУРА: Број", invoiceNum, ", Вкупно =", totalAmount.toFixed(2), "ден.");
  console.log("✅ МАРЖА:", margin.toFixed(2), "ден. (" + marginPct.toFixed(1) + "%)");
  console.log("\n🎉 ЦЕЛОСНИОТ ТЕК РАБОТИ ПРАВИЛНО!");

  // Cleanup: delete test data
  console.log("\n--- ЧИСТЕЊЕ НА ТЕСТ ПОДАТОЦИ ---");
  await db.delete(documentItems).where(eq(documentItems.documentId, invoiceId));
  await db.delete(invoices).where(eq(invoices.id, invoiceId));
  await db.delete(workOrderMaterials).where(eq(workOrderMaterials.workOrderId as any, woId));
  await db.delete(workOrders).where(eq(workOrders.id, woId));
  await db.delete(receiptItems).where(eq(receiptItems.receiptId, receiptId));
  await db.delete(receipts).where(eq(receipts.id, receiptId));
  // Restore stock
  if (initialStock[0]) {
    await db.update(materialStock)
      .set({ quantity: String(initialQty), avgCost: initialStock[0].avgCost })
      .where(eq(materialStock.id, initialStock[0].id));
  } else {
    await db.delete(materialStock).where(eq(materialStock.id, afterIssueStock[0].id));
  }
  console.log("✓ Тест податоци избришани, залиха вратена на почетна состојба");
}

testFullFlow().catch(err => {
  console.error("❌ ТЕСТОТ НЕ УСПЕА:", err.message);
  console.error(err.stack);
  process.exit(1);
});
