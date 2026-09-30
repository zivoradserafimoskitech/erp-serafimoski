// Интеграциски тест на целиот тек, на вистинска Postgres база.
// Се извршува САМО со TEST_DATABASE_URL (посебна празна база) — никогаш врз продукција:
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/erp_test npm test
import { describe, it, expect, beforeAll } from "vitest";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("целосен тек (интеграциски)", () => {
  let caller: any;
  const today = new Date().toISOString().slice(0, 10);
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.DATABASE_SSL = "false";
    delete process.env.APP_PASSWORD;
    process.env.DISABLE_AUTO_LEDGER = "true"; // тестот сам ја повикува синхронизацијата и ги брои промените
    const { getPool } = await import("./queries/connection");
    const pool = getPool();
    // празна база: избриши ја шемата и создај ја одново
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const { getInitSql } = await import("./init-db-sql");
    for (const stmt of getInitSql()) {
      try { await pool.query(stmt); } catch (e: any) { if (!["42P07", "42710", "42701"].includes(e.code)) throw new Error(`${e.message}\n${stmt.slice(0, 200)}`); }
    }
    const { appRouter } = await import("./router");
    caller = appRouter.createCaller({ req: new Request("http://test"), resHeaders: new Headers(), actor: { id: null, name: "test", role: "admin" } } as any);
  });

  it("магацин, материјал и приемница", async () => {
    await caller.warehouse.warehouseCreate({ code: "M1", name: "Магацин", type: "raw_materials" });
    ids.wh = (await caller.warehouse.warehouseList())[0].id;
    ids.mat = (await caller.storage.materialCreate({ name: "Лим 3мм", code: "L3", type: "steel_sheet", unit: "kg" })).id;
    await caller.procurement.supplierCreate({ name: "Челик" });
    ids.sup = (await caller.procurement.supplierList())[0].id;
    const rc = await caller.accounting.receiptCreate({ receiptNumber: "ПР-001/2026", supplierId: ids.sup, warehouseId: ids.wh, receiptDate: today,
      items: [{ materialId: ids.mat, quantity: "1000", unit: "kg", unitPrice: "60", totalPrice: "60000" }] });
    await caller.storage.processReceipt({ receiptId: rc.id, warehouseId: ids.wh, items: [{ materialId: ids.mat, quantity: "1000", unitPrice: "60", totalPrice: "60000" }] });
    const m = (await caller.storage.materialList()).find((x: any) => x.id === ids.mat);
    expect(Number(m.currentStock)).toBe(1000);
  });

  it("понуда → нарачка → налог → издавање (без двојно издавање) → трошок", async () => {
    await caller.customers.customerCreate({ name: "Клиент" });
    ids.cust = (await caller.customers.customerList({}))[0].id;
    const q = await caller.quotation.quotationCreate({ quoteNumber: "ПО-001/2026", customerId: ids.cust, subtotal: "10000", vatAmount: "1800", totalAmount: "11800",
      items: [{ itemType: "material", referenceId: ids.mat, description: "Лим", quantity: "100", unit: "kg", unitPrice: "100", totalPrice: "10000", unitCost: "60", totalCost: "6000" }] });
    await caller.quotation.quotationUpdate({ id: q.id, status: "accepted" });
    const conv = await caller.quotation.quotationConvert({ quotationId: q.id, orderNumber: "НАР-001/2026" });
    await caller.production.orderFromChain({ orderId: conv.orderId });
    ids.wo = (await caller.production.workOrderList({}))[0].id;
    await caller.production.woMaterialCreate({ workOrderId: ids.wo, materialId: ids.mat, quantity: "20" });
    const wom = (await caller.production.workOrderById({ id: ids.wo })).materials[0];
    // резервирано пред издавање
    const before = (await caller.storage.materialList()).find((x: any) => x.id === ids.mat);
    expect(Number(before.reservedQty)).toBe(20);
    await caller.storage.issueMaterial({ materialId: ids.mat, warehouseId: ids.wh, quantity: "20", sourceDocType: "work_order", sourceDocId: ids.wo, woMaterialId: wom.id });
    await expect(caller.storage.issueMaterial({ materialId: ids.mat, warehouseId: ids.wh, quantity: "20", sourceDocType: "work_order", sourceDocId: ids.wo, woMaterialId: wom.id }))
      .rejects.toThrow(/веќе издаден/);
    const after = (await caller.storage.materialList()).find((x: any) => x.id === ids.mat);
    expect(Number(after.currentStock)).toBe(980);
    expect(Number(after.reservedQty)).toBe(0);
    await caller.production.operationCreate({ workOrderId: ids.wo, operation: "cutting_laser", sequence: 1, estimatedTime: "2", costRate: "1000" });
    const cost = await caller.production.workOrderUpdateCost({ id: ids.wo });
    expect(Number(cost.totalCost)).toBeCloseTo(2000 + 20 * 60, 0);
  });

  it("распоред закажува отворени операции", async () => {
    const r = await caller.ops.scheduleAuto({ from: "2026-10-05" });
    expect(r.scheduled).toBeGreaterThan(0);
  });

  it("испратница и фактура од налог (порано паѓаа)", async () => {
    await caller.production.workOrderUpdate({ id: ids.wo, status: "completed", producedQty: "1", producedUnit: "ком" });
    const dn = await caller.production.workOrderToDeliveryNote({ workOrderId: ids.wo });
    expect(dn.dnNumber).toMatch(/^ИС-\d{3}\/\d{4}$/);
    const next = await caller.settings.nextDocNumber({ kind: "deliveryNote" });
    expect(next).not.toBe(dn.dnNumber);
    const inv = await caller.production.workOrderToInvoice({ workOrderId: ids.wo });
    const full = await caller.accounting.invoiceById({ id: inv.id });
    expect(full.invoiceType).toBe("standard");
    expect(Number(full.subtotal)).toBe(10000); // цената од нарачката, не трошок + маржа
    await expect(caller.production.workOrderToInvoice({ workOrderId: ids.wo })).rejects.toThrow(/веќе постои фактура/);
    ids.inv = inv.id;
  });

  it("главна книга: книжење, рамнотежа, благајна, ДДВ", async () => {
    await caller.accounting.invoiceUpdate({ id: ids.inv, status: "issued" });
    await caller.accounting.incomingInvoiceCreate({ supplierInvoiceNumber: "F-1", supplierId: ids.sup, receivedDate: today, issueDate: today, subtotal: "60000", vatAmount: "10800", totalAmount: "70800" });
    await caller.finance.cashCreate({ txDate: today, direction: "in", amount: 1000, invoiceId: ids.inv });
    // благајната го менува статусот и салдото исто како банката
    expect((await caller.accounting.invoiceById({ id: ids.inv }))?.status).toBe("partial");
    await caller.accounting.invoiceUpdate({ id: ids.inv, status: "sent" });
    expect((await caller.accounting.invoiceById({ id: ids.inv }))?.status).toBe("partial");
    await expect(caller.accounting.invoiceDelete({ id: ids.inv })).rejects.toThrow(/благајнички/);
    const pr = await caller.accounting.payablesReceivables();
    expect(Number(pr.totalReceivables)).toBe(10800);
    expect(Number(pr.totalPayables)).toBe(70800);
    const s1 = await caller.finance.ledgerSync();
    expect(s1.problems).toEqual([]);
    expect(s1.created).toBe(3);
    const s2 = await caller.finance.ledgerSync();
    expect(s2.created + s2.updated + s2.removed).toBe(0);
    const tb = await caller.finance.trialBalance({ from: "2000-01-01", to: "2100-01-01" });
    expect(tb.totals.debit).toBe(tb.totals.credit);
    const vat = await caller.finance.vatBooks({ from: "2000-01-01", to: "2100-01-01" });
    expect(vat.summary.outVat).toBe(1800);
    expect(vat.summary.inVat).toBe(10800);
    await caller.accounting.invoiceUpdate({ id: ids.inv, status: "cancelled" });
    const s3 = await caller.finance.ledgerSync();
    expect(s3.removed).toBeGreaterThanOrEqual(1);
  });

  it("добивка по нарачка", async () => {
    const r = await caller.ops.profitabilityReport({ from: "2000-01-01", to: "2100-01-01" });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].actualCost).toBeGreaterThan(0);
  });

  it("плати: пресметка и книжење", async () => {
    await caller.hr.employeeUpsert({ fullName: "Марко Марковски", grossSalary: 60000 });
    await caller.hr.payrollCalculate({ period: "2026-09", params: { contributionRate: 28, incomeTaxRate: 10, personalExemption: 10000 } });
    const run = await caller.hr.payrollGet({ period: "2026-09" });
    expect(run.lines[0].net).toBe(39880);
    await caller.hr.payrollPost({ period: "2026-09", post: true });
    const tb = await caller.finance.trialBalance({ from: "2000-01-01", to: "2100-01-01" });
    expect(tb.accounts.find((a: any) => a.code === "420")?.debit).toBe(60000);
  });

  it("тек на нарачка со аванс: про-фактура → уплата → нарачка → налог → фактура → наплата, аванс се затвора", async () => {
    const q = await caller.quotation.quotationCreate({ quoteNumber: "ПО-050/2026", customerId: ids.cust, subtotal: "10000", vatAmount: "1800", totalAmount: "11800",
      paymentSchedule: JSON.stringify([{ percent: 50, when: "advance" }, { percent: 50, when: "on_delivery" }]),
      items: [{ itemType: "material", referenceId: ids.mat, description: "Лим", quantity: "100", unit: "kg", unitPrice: "100", totalPrice: "10000", unitCost: "60", totalCost: "6000" }] });
    let f = await caller.ops.dealFlow({ quotationId: q.id });
    expect(f.currentStage).toBe("quote");
    await caller.quotation.quotationUpdate({ id: q.id, status: "accepted" });
    f = await caller.ops.dealFlow({ quotationId: q.id });
    expect(f.currentStage).toBe("proforma");
    const pf = await caller.quotation.quotationToProforma({ quotationId: q.id, issueDate: today, vatRate: "18" });
    await caller.finance.cashCreate({ txDate: today, direction: "in", amount: 5900, invoiceId: pf.id });
    f = await caller.ops.dealFlow({ quotationId: q.id });
    expect(f.stages.find((s: any) => s.key === "advance").status).toBe("done");
    expect(f.currentStage).toBe("order");
    const conv = await caller.quotation.quotationConvert({ quotationId: q.id, orderNumber: "НАР-050/2026" });
    const link = await caller.ops.dealCreateWorkOrder({ quotationId: q.id });
    if (!link.linked) await caller.production.orderFromChain({ orderId: conv.orderId });
    f = await caller.ops.dealFlow({ quotationId: q.id });
    expect(f.currentStage).toBe("wo");
    const woId = f.stages.find((s: any) => s.key === "wo").refId;
    // телефон: издај друг материјал
    await caller.ops.floorIssue({ workOrderId: woId, materialId: ids.mat, quantity: 5, operator: "Марко" });
    const scan = await caller.production.woScanById({ id: woId });
    expect(scan.materials.some((m: any) => m.isActual === "actual" && Number(m.quantity) === 5)).toBe(true);
    await expect(caller.ops.floorIssue({ workOrderId: woId, materialId: ids.mat, quantity: 99999 })).rejects.toThrow(/залиха/);
    expect((await caller.production.woScanById({ id: woId })).materials).toHaveLength(1); // празниот ред е тргнат
    await caller.production.workOrderUpdate({ id: woId, status: "completed", producedQty: "1", producedUnit: "ком" });
    await caller.production.workOrderToDeliveryNote({ workOrderId: woId });
    const inv = await caller.production.workOrderToInvoice({ workOrderId: woId });
    await caller.accounting.invoiceUpdate({ id: inv.id, status: "issued" });
    await caller.finance.cashCreate({ txDate: today, direction: "in", amount: 5900, invoiceId: inv.id });
    expect((await caller.accounting.invoiceById({ id: inv.id }))?.status).toBe("paid");
    f = await caller.ops.dealFlow({ quotationId: q.id });
    expect(f.closed).toBe(true);
    // книжење: аванс 235 е затворен, купувачот 120 за оваа нарачка е на нула
    const s = await caller.finance.ledgerSync();
    expect(s.problems).toEqual([]);
    const tb = await caller.finance.trialBalance({ from: "2000-01-01", to: "2100-01-01" });
    expect(tb.accounts.find((a: any) => a.code === "235")?.closing ?? 0).toBe(0);
    expect(tb.totals.debit).toBe(tb.totals.credit);
    expect((await caller.ops.dealList({})).some((d: any) => d.quotationId === q.id)).toBe(false); // завршена -> не е во тек
  });

  it("брзо пребарување", async () => {
    const hits = await caller.search.globalSearch({ q: "ПО-050" });
    expect(hits[0]).toMatchObject({ type: "Понуда", title: "ПО-050/2026" });
    expect((await caller.search.globalSearch({ q: "Лим" })).some((h: any) => h.type === "Материјал")).toBe(true);
  });

  it("потсетници: преглед", async () => {
    await caller.reminders.remindersSet({ enabled: true, bossEmail: "sef@test.mk", overdueToCustomer: true, overdueEveryDays: 7, quoteFollowupDays: 7, quoteFollowup: true, weekly: true, weeklyWeekday: 1, sendHour: 8 });
    const p = await caller.reminders.remindersPreview();
    expect(Array.isArray(p.overdue)).toBe(true);
    expect(p.weekly.woDone).toBeGreaterThanOrEqual(1);
  });
});
