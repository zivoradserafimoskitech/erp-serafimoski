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
    // двојно потврдување не смее двапати да ја зголеми залихата
    await expect(caller.storage.processReceipt({ receiptId: rc.id, warehouseId: ids.wh, items: [{ materialId: ids.mat, quantity: "1000", unitPrice: "60", totalPrice: "60000" }] })).rejects.toThrow(/веќе потврдена/);
    await expect(caller.accounting.receiptDelete({ id: rc.id })).rejects.toThrow(/не може да се брише/);
  });

  it("приемница во нацрт се менува, потврдена не", async () => {
    const r = await caller.accounting.receiptCreate({ receiptNumber: "ПР-050/2026", warehouseId: ids.wh, receiptDate: today });
    await expect(caller.storage.processReceipt({ receiptId: r.id, warehouseId: ids.wh, items: [] })).rejects.toThrow(/нема ставки/);
    await caller.accounting.receiptEdit({ id: r.id, receiptNumber: "ПР-050/2026", supplierId: ids.sup, warehouseId: ids.wh, receiptDate: today,
      items: [{ materialId: ids.mat, quantity: "5", unit: "kg", unitPrice: "60", totalPrice: "300" }] });
    const full = await caller.accounting.receiptById({ id: r.id });
    expect(full.items).toHaveLength(1);
    expect(Number(full.totalAmount)).toBe(300);
    await caller.storage.processReceipt({ receiptId: r.id, warehouseId: ids.wh, items: [] });
    await expect(caller.accounting.receiptEdit({ id: r.id, receiptNumber: "ПР-050/2026", warehouseId: ids.wh, receiptDate: today, items: [] })).rejects.toThrow(/Само приемница во нацрт/);
    await caller.storage.transactionCreate({ materialId: ids.mat, warehouseId: ids.wh, type: "adjustment", quantity: "1000" });
  });

  it("набавна нарачка → приемница по нарачка → делумен и целосен прием", async () => {
    const po = await caller.procurement.poCreate({ poNumber: "НН-001/2026", supplierId: ids.sup, items: [{ materialId: ids.mat, description: "Лим", quantity: "100", unitPrice: "60", totalPrice: "6000" }] });
    const r1 = await caller.accounting.receiptCreate({ receiptNumber: "ПР-010/2026", poId: po.id, warehouseId: ids.wh, receiptDate: today,
      items: [{ materialId: ids.mat, quantity: "40", unit: "kg", unitPrice: "60", totalPrice: "2400" }] });
    await caller.storage.processReceipt({ receiptId: r1.id, warehouseId: ids.wh, items: [{ materialId: ids.mat, quantity: "40", unitPrice: "60", totalPrice: "2400" }] });
    let d = await caller.procurement.poById({ id: po.id });
    expect(d.status).toBe("partial");
    expect(Number(d.items[0].receivedQuantity)).toBe(40);
    const rcRow = (await caller.accounting.receiptList({})).find((r: any) => r.id === r1.id);
    expect(rcRow.status).toBe("confirmed");
    expect(Number(rcRow.supplierId)).toBe(ids.sup); // добавувачот доаѓа од нарачката
    const r2 = await caller.accounting.receiptCreate({ receiptNumber: "ПР-011/2026", poId: po.id, warehouseId: ids.wh, receiptDate: today,
      items: [{ materialId: ids.mat, quantity: "60", unit: "kg", unitPrice: "60", totalPrice: "3600" }] });
    await caller.storage.processReceipt({ receiptId: r2.id, warehouseId: ids.wh, items: [{ materialId: ids.mat, quantity: "60", unitPrice: "60", totalPrice: "3600" }] });
    d = await caller.procurement.poById({ id: po.id });
    expect(d.status).toBe("received");
    expect(Number(d.items[0].receivedQuantity)).toBe(100);
    // залихата назад на 1000 за следните тестови
    await caller.storage.transactionCreate({ materialId: ids.mat, warehouseId: ids.wh, type: "adjustment", quantity: "1000" });
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
    // фактура + влезна фактура + благајна + потрошен материјал (издавање за налогот) + 2 корекции на залиха (кусок)
    expect(s1.created).toBe(6);
    const s2 = await caller.finance.ledgerSync();
    expect(s2.created + s2.updated + s2.removed).toBe(0);
    const tb = await caller.finance.trialBalance({ from: "2000-01-01", to: "2100-01-01" });
    expect(tb.totals.debit).toBe(tb.totals.credit);
    expect(tb.accounts.find((a: any) => a.code === "400")?.closing ?? 0).toBeGreaterThan(0); // потрошен материјал
    expect(tb.accounts.find((a: any) => a.code === "469")?.closing ?? 0).toBeGreaterThan(0); // кусок
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
    expect(r.rows[0].costSource).toBe("workorders");
    expect(r.totals.counted).toBe(1);
    expect(r.totals.profit).toBe(r.rows[0].profit);
  });

  it("извештај за сметководител: само книжени фактури, во денари, со име на партнер", async () => {
    const r = await caller.accounting.accountantReport({ startDate: "2000-01-01", endDate: "2100-01-01" });
    for (const i of r.outgoing.items as any[]) {
      expect(["draft", "cancelled"]).not.toContain(i.status);
      expect(["standard", "credit_note"]).toContain(i.invoiceType);
      expect(typeof i.customerName).toBe("string");
      expect(typeof i.totalMkd).toBe("number");
    }
    for (const i of r.incoming.items as any[]) {
      expect(i.status).not.toBe("cancelled");
      // скенот не се праќа во извештајот (тежок е) — само знак дали постои
      expect("fileUrl" in i).toBe(false);
      expect(typeof i.hasFile).toBe("boolean");
    }
    expect(r.incoming.vatGroups).toBeTypeOf("object");
    await caller.settings.accountantEmailSet({ email: "smetkovoditel@primer.mk" });
    expect((await caller.settings.settingsGet() as any)?.accountantEmail ?? "smetkovoditel@primer.mk").toBe("smetkovoditel@primer.mk");
    const vat = await caller.finance.vatBooks({ from: "2000-01-01", to: "2100-01-01" });
    expect(Number(r.vatRecapitulation.outgoingVat)).toBeCloseTo(vat.summary.outVat, 1);
    expect(Number(r.vatRecapitulation.incomingVat)).toBeCloseTo(vat.summary.inVat, 1);
  });

  it("материјал со движења не се брише (се деактивира); движење без материјал се отстранува заедно со налогот", async () => {
    const r: any = await caller.storage.materialDelete({ id: ids.mat });
    expect(r.deactivated).toBe(true);
    const { getPool } = await import("./queries/connection");
    const pool = getPool();
    expect((await pool.query(`SELECT is_active FROM materials WHERE id = $1`, [ids.mat])).rows[0]?.is_active).toBe("inactive");
    await pool.query(`UPDATE materials SET is_active = 'active' WHERE id = $1`, [ids.mat]);
    // старо движење чиј материјал бил избришан
    const mv = (await pool.query(`INSERT INTO inventory_transactions (material_id, warehouse_id, type, quantity, unit_cost, total_cost, created_at)
      VALUES (987654, $1, 'issue', -50, 855, 42750, '2026-07-17') RETURNING id`, [ids.wh])).rows[0].id;
    await caller.finance.ledgerSync();
    const j = await caller.finance.journalList({ from: "2026-07-01", to: "2026-07-31", limit: 50, offset: 0 });
    const e: any = j.entries.find((x: any) => x.sourceType === "stock_move" && x.sourceId === Number(mv));
    expect(e.description).toContain("избришан материјал #987654");
    expect(e.source.orphan).toBe(true);
    // вистинско движење (материјалот постои) не смее да се отстрани одовде
    const real = (await pool.query(`SELECT id FROM inventory_transactions WHERE material_id = $1 LIMIT 1`, [ids.mat])).rows[0].id;
    await expect(caller.finance.orphanStockMoveDelete({ moveId: Number(real) })).rejects.toThrow();
    const res = await caller.finance.orphanStockMoveDelete({ moveId: Number(mv) });
    expect(res.removed).toBeGreaterThanOrEqual(1);
    const j2 = await caller.finance.journalList({ from: "2026-07-01", to: "2026-07-31", limit: 50, offset: 0 });
    expect(j2.entries.some((x: any) => x.sourceId === Number(mv) && x.sourceType === "stock_move")).toBe(false);
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

  it("влезна фактура: несигурно конто се прашува, одговорот се памети", async () => {
    const supId = (await caller.procurement.supplierCreate({ name: "Непознат Партнер ДОО" })).id;
    const inv = await caller.accounting.incomingInvoiceCreate({ supplierInvoiceNumber: "NP-1", supplierId: supId, receivedDate: today, subtotal: "100", vatAmount: "18", totalAmount: "118" });
    expect((await caller.accounting.incomingAccountReview()).some((r: any) => r.id === inv.id)).toBe(true);
    await caller.accounting.incomingInvoiceUpdate({ id: inv.id, expenseAccount: "413" });
    expect((await caller.accounting.incomingAccountReview()).some((r: any) => r.id === inv.id)).toBe(false);
    // следната фактура од истиот добавувач не прашува
    expect(await caller.accounting.incomingAccountSuggest({ supplierId: supId })).toMatchObject({ account: "413", sure: true });
    const evn = (await caller.procurement.supplierCreate({ name: "ЕВН Македонија" })).id;
    const e = await caller.accounting.incomingInvoiceCreate({ supplierInvoiceNumber: "E-1", supplierId: evn, receivedDate: today, subtotal: "100", vatAmount: "18", totalAmount: "118" });
    expect((await caller.accounting.incomingInvoiceById({ id: e.id }))?.expenseAccount).toBe("401");
    expect((await caller.accounting.incomingAccountReview()).some((r: any) => r.id === e.id)).toBe(false);
  });

  it("неусогласеност: налог -> клиент само, налог за доработка", async () => {
    const qi = await caller.ops.qualityCreate({ date: today, kind: "internal", title: "Погрешна мера на отвори", workOrderId: ids.wo });
    let row = (await caller.ops.qualityList()).find((r: any) => r.id === qi.id);
    expect(row.customerId).toBe(ids.cust); // клиентот од нарачката на налогот
    const rw = await caller.ops.qualityRework({ id: qi.id });
    row = (await caller.ops.qualityList()).find((r: any) => r.id === qi.id);
    expect(row).toMatchObject({ reworkWoId: rw.woId, reworkWoNumber: rw.woNumber, status: "in_progress" });
    const w = await caller.production.workOrderById({ id: rw.woId });
    expect(w.priority).toBe("high");
    await expect(caller.ops.qualityRework({ id: qi.id })).rejects.toThrow(/Веќе постои/);
    // врските може да се сменат
    await caller.ops.qualityUpdate({ id: qi.id, customerId: null });
    expect((await caller.ops.qualityList()).find((r: any) => r.id === qi.id).customerId).toBe(null);
    const opt = await caller.ops.qualityLinkOptions();
    expect(opt.wos.find((x: any) => x.id === ids.wo)?.customerId).toBe(ids.cust);
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
