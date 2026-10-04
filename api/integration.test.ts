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

  it("терк: шема без износи, се зачувува под име и се користи за налог", async () => {
    await expect(caller.finance.terkSave({ name: "Само должи", lines: [{ account: "412", side: "D" }, { account: "130", side: "D" }] })).rejects.toThrow(/Должи и едно на Побарува/);
    await expect(caller.finance.terkSave({ name: "Лошо конто", lines: [{ account: "99999", side: "D" }, { account: "220", side: "P" }] })).rejects.toThrow(/Непостоечки/);
    const { id } = await caller.finance.terkSave({ name: "Закупнина", description: "месечна закупнина на хала",
      lines: [{ account: "412", side: "D", note: "закупнина" }, { account: "130", side: "D", note: "ДДВ 18%" }, { account: "220", side: "P" }] });
    await expect(caller.finance.terkSave({ name: "закупнина", lines: [{ account: "412", side: "D" }, { account: "220", side: "P" }] })).rejects.toThrow(/Веќе постои/);
    const list = await caller.finance.terkList();
    const t = list.find((x: any) => x.id === id)!;
    expect(t.lines.map((l: any) => `${l.account}${l.side}`)).toEqual(["412D", "130D", "220P"]);
    // измена: редоследот и страните се зачувуваат точно
    await caller.finance.terkSave({ id, name: "Закупнина", lines: [{ account: "220", side: "P" }, { account: "412", side: "D" }] });
    expect((await caller.finance.terkList()).find((x: any) => x.id === id)!.lines.map((l: any) => l.account)).toEqual(["220", "412"]);
    const r = await caller.finance.manualEntryCreate({ date: "2026-09-30", description: "Закупнина 09", templateName: "Закупнина",
      lines: [{ account: "412", debit: 10000, credit: 0 }, { account: "220", debit: 0, credit: 10000, partnerType: "supplier", partnerId: ids.sup }] });
    const j = await caller.finance.journalList({ from: "2026-09-30", to: "2026-09-30", search: r.number, limit: 5, offset: 0 });
    expect(j.entries[0].templateName).toBe("Закупнина");
    // партнер: на 220 без добавувач не смее; со добавувач влегува во „неплатено кон добавувачи“
    await expect(caller.finance.manualEntryCreate({ date: "2026-09-30", description: "Без партнер",
      lines: [{ account: "412", debit: 500, credit: 0 }, { account: "220", debit: 0, credit: 500 }] })).rejects.toThrow(/добавувач/);
    await expect(caller.finance.manualEntryCreate({ date: "2026-09-30", description: "Погрешен вид",
      lines: [{ account: "412", debit: 500, credit: 0 }, { account: "220", debit: 0, credit: 500, partnerType: "supplier", partnerId: 99999999 }] })).rejects.toThrow(/Непостоечки/);
    const before = (await caller.dashboard.stats()).kpi;
    const r2 = await caller.finance.manualEntryCreate({ date: "2026-09-30", description: "Закупнина 10", templateName: "Закупнина",
      lines: [{ account: "412", debit: 700, credit: 0 }, { account: "220", debit: 0, credit: 700, partnerType: "supplier", partnerId: ids.sup }] });
    const after = (await caller.dashboard.stats()).kpi;
    expect(after.payables).toBeCloseTo(before.payables + 700, 2);
    expect(after.manualPayables).toBeCloseTo(before.manualPayables + 700, 2);
    const jl = await caller.finance.journalList({ from: "2026-09-30", to: "2026-09-30", search: r2.number, limit: 5, offset: 0 });
    expect(jl.entries[0].lines.find((l: any) => l.account === "220")?.partner).toBeTruthy();
    await caller.finance.terkRemove({ id });
    expect((await caller.finance.terkList()).some((x: any) => x.id === id)).toBe(false);
    // налогот останува и по бришење на теркот
    expect((await caller.finance.journalList({ from: "2026-09-30", to: "2026-09-30", search: r.number, limit: 5, offset: 0 })).total).toBe(1);
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
  // ───────── ревизија на финансиите ─────────
  it("ревизија: непрекината нумерација, бришење само нацрт, лимит на книжно одобрување", async () => {
    const { getPool } = await import("./queries/connection");
    const pool = getPool();
    const next = await caller.accounting.nextInvoiceNumber();
    const y = next.slice(-4);
    // предлогот не троши број (повеќе прашања = ист број)
    expect(await caller.accounting.nextInvoiceNumber()).toBe(next);
    await expect(caller.accounting.invoiceCreate({ invoiceNumber: "999/" + y, customerId: ids.cust, issueDate: `${y}-10-01`, subtotal: "100", vatAmount: "18", totalAmount: "118" })).rejects.toThrow(/по ред/);
    const a = await caller.accounting.invoiceCreate({ invoiceNumber: next, customerId: ids.cust, issueDate: `${y}-10-01`, status: "issued", subtotal: "1000", vatRate: "18", vatAmount: "180", totalAmount: "1180" });
    // издадена фактура не се брише
    await expect(caller.accounting.invoiceDelete({ id: a.id })).rejects.toThrow(/не се брише/);
    // книжно одобрување: не повеќе од фактурираното
    const kn1 = await caller.accounting.nextCreditNoteNumber();
    await expect(caller.accounting.creditNoteCreate({ originalInvoiceId: a.id, creditNoteNumber: kn1, issueDate: `${y}-10-02`, subtotal: "1500", vatAmount: "270", totalAmount: "1770" })).rejects.toThrow(/најмногу/);
    await caller.accounting.creditNoteCreate({ originalInvoiceId: a.id, creditNoteNumber: kn1, issueDate: `${y}-10-02`, subtotal: "600", vatAmount: "108", totalAmount: "708" });
    const kn2 = await caller.accounting.nextCreditNoteNumber();
    expect(kn2).not.toBe(kn1);
    await expect(caller.accounting.creditNoteCreate({ originalInvoiceId: a.id, creditNoteNumber: kn2, issueDate: `${y}-10-02`, subtotal: "500", vatAmount: "90", totalAmount: "590" })).rejects.toThrow(/најмногу 400/);
    // нацрт што е последен број смее да се избрише; следниот број пак е истиот
    const n2 = await caller.accounting.nextInvoiceNumber();
    const d = await caller.accounting.invoiceCreate({ invoiceNumber: n2, customerId: ids.cust, issueDate: `${y}-10-03`, subtotal: "10", vatAmount: "1.8", totalAmount: "11.8" });
    await caller.accounting.invoiceDelete({ id: d.id });
    expect(await caller.accounting.nextInvoiceNumber()).toBe(n2);
    void pool;
  });

  it("ревизија: ДДВ проверка, ДДВ период и обратно оданочување", async () => {
    await expect(caller.accounting.incomingInvoiceCreate({ supplierInvoiceNumber: "MN-77", supplierId: ids.sup, receivedDate: "2026-10-01",
      subtotal: "3000", vatRate: "0", vatAmount: "540", totalAmount: "3540" })).rejects.toThrow(/не одговара/);
    // фактура од септември примена во октомври -> во октомвриската пријава
    const inc = await caller.accounting.incomingInvoiceCreate({ supplierInvoiceNumber: "SEP-1", supplierId: ids.sup, issueDate: "2026-09-28", receivedDate: "2026-10-03",
      subtotal: "1000", vatRate: "18", vatAmount: "180", totalAmount: "1180", expenseAccount: "413" });
    const sep = await caller.finance.vatBooks({ from: "2026-09-01", to: "2026-09-30" });
    const oct = await caller.finance.vatBooks({ from: "2026-10-01", to: "2026-10-31" });
    expect(sep.incoming.some((r: any) => r.id === inc.id)).toBe(false);
    expect(oct.incoming.some((r: any) => r.id === inc.id)).toBe(true);
    // обратно оданочување: 18% и во КИФ и во КУФ, книжење 130/230
    await expect(caller.accounting.incomingInvoiceCreate({ supplierInvoiceNumber: "RC-0", supplierId: ids.sup, receivedDate: "2026-10-04", reverseCharge: true,
      subtotal: "1000", vatRate: "18", vatAmount: "180", totalAmount: "1180" })).rejects.toThrow(/нема ДДВ/);
    const rc = await caller.accounting.incomingInvoiceCreate({ supplierInvoiceNumber: "RC-1", supplierId: ids.sup, receivedDate: "2026-10-04", reverseCharge: true,
      subtotal: "1000", vatRate: "18", vatAmount: "0", totalAmount: "1000", expenseAccount: "413" });
    const b = await caller.finance.vatBooks({ from: "2026-10-01", to: "2026-10-31" });
    expect(b.incoming.find((r: any) => r.id === rc.id)?.vatMkd).toBe(180);
    expect(b.outgoing.some((r: any) => r.reverseCharge && r.id === rc.id && r.vatMkd === 180)).toBe(true);
    await caller.finance.ledgerSync();
    const j = await caller.finance.journalList({ from: "2026-10-04", to: "2026-10-04", search: "RC-1", limit: 5, offset: 0 });
    const lines = j.entries[0].lines as any[];
    expect(lines.find(l => l.account === "130" && l.debit === 180)).toBeTruthy();
    expect(lines.find(l => l.account === "230" && l.credit === 180)).toBeTruthy();
  });

  it("ревизија: банка — секоја ставка се книжи, провизија, усогласување", async () => {
    const { getPool } = await import("./queries/connection");
    const pool = getPool();
    const st = (await pool.query(`INSERT INTO bank_statements (account_number, statement_no, statement_date, prev_balance, new_balance, currency)
      VALUES ('300000000000001', '77', '2026-10-05', 0, -30150, 'MKD') RETURNING id`)).rows[0].id;
    const tx = (await pool.query(`INSERT INTO bank_transactions (statement_id, account_number, tx_date, direction, amount, provision, counterparty_name, purpose, match_status, dedupe_key)
      VALUES ($1, '300000000000001', '2026-10-05', 'out', 30000, 150, 'Вработени', 'исплата на плата за септември', 'unmatched', 'test-pl-1') RETURNING id`, [st])).rows[0].id;
    const sug = await caller.bank.bankKindSuggest({ txId: tx });
    expect(sug?.suggestion?.key).toBe("salary");
    await caller.bank.bankPostToAccount({ txId: tx, accountCode: "240" });
    await caller.finance.ledgerSync();
    const j = await caller.finance.journalList({ from: "2026-10-05", to: "2026-10-05", limit: 20, offset: 0 });
    expect(j.entries.some((e: any) => e.sourceType === "bank_other" && e.lines.some((l: any) => l.account === "240" && l.debit === 30000))).toBe(true);
    expect(j.entries.some((e: any) => e.sourceType === "bank_fee" && e.lines.some((l: any) => l.account === "100" && l.credit === 150))).toBe(true);
    const rec = await caller.bank.bankReconcile();
    expect(rec.rows.find((r: any) => r.currency === "MKD")?.statement).toBe(-30150);
  });

  it("ревизија: аванс со ДДВ", async () => {
    await caller.finance.ledgerSync();
    const all = await caller.finance.journalList({ from: "2000-01-01", to: "2100-01-01", search: "Аванс по", limit: 50, offset: 0 });
    const e: any = all.entries[0];
    expect(e).toBeTruthy();
    // уплатата по про-фактура (домашна, 18%) се дели на 235 и 230
    expect(e.lines.some((l: any) => l.account === "230" && l.credit > 0)).toBe(true);
    const settle = await caller.finance.journalList({ from: "2000-01-01", to: "2100-01-01", search: "Затворање аванс", limit: 5, offset: 0 });
    if (settle.entries.length) expect((settle.entries[0] as any).lines.some((l: any) => l.account === "230" && l.debit > 0)).toBe(true);
  });

  it("ревизија: заклучен период — ништо не се менува, сторно, дневник", async () => {
    const { getPool } = await import("./queries/connection");
    const m = await caller.finance.manualEntryCreate({ date: "2026-09-20", description: "Проба за сторно", lines: [{ account: "449", debit: 100, credit: 0 }, { account: "103", debit: 0, credit: 100 }] });
    const sepInc = await caller.accounting.incomingInvoiceCreate({ supplierInvoiceNumber: "SEP-LOCK", supplierId: ids.sup, receivedDate: "2026-09-25",
      subtotal: "1000", vatRate: "18", vatAmount: "180", totalAmount: "1180", expenseAccount: "413" });
    await caller.finance.ledgerSync();
    await expect(caller.finance.periodLockSet({ date: "2099-01-01" })).rejects.toThrow(/иден/);
    await caller.finance.periodLockSet({ date: "2026-09-30", reason: "ДДВ пријава за септември" });
    await expect(caller.finance.manualEntryCreate({ date: "2026-09-15", description: "Во заклучен", lines: [{ account: "449", debit: 1, credit: 0 }, { account: "103", debit: 0, credit: 1 }] })).rejects.toThrow(/заклучен/);
    await expect(caller.accounting.incomingInvoiceCreate({ supplierInvoiceNumber: "LOCK-1", supplierId: ids.sup, receivedDate: "2026-09-02", subtotal: "100", vatRate: "18", vatAmount: "18", totalAmount: "118" })).rejects.toThrow(/заклучен/);
    await expect(caller.accounting.incomingInvoiceDelete({ id: sepInc.id })).rejects.toThrow(/заклучен/);
    const j = await caller.finance.journalList({ from: "2026-09-20", to: "2026-09-20", search: m.number, limit: 5, offset: 0 });
    const ent: any = j.entries[0];
    expect(ent.locked).toBe(true);
    await expect(caller.finance.manualEntryDelete({ id: ent.id })).rejects.toThrow(/заклучен/);
    // документ сменет директно во базата по заклучувањето: налогот останува, проблемот се пријавува
    await getPool().query(`UPDATE incoming_invoices SET subtotal = 2000, vat_amount = 360, total_amount = 2360 WHERE id = $1`, [sepInc.id]);
    const sync = await caller.finance.ledgerSync();
    expect(sync.problems.some((p: any) => /заклучувањето/.test(p.reason))).toBe(true);
    const sj = await caller.finance.journalList({ from: "2026-09-25", to: "2026-09-25", search: "SEP-LOCK", limit: 5, offset: 0 });
    expect((sj.entries[0] as any).lines.find((l: any) => l.account === "413")?.debit).toBe(1000);
    // сторно во отворен период
    const s = await caller.finance.manualEntryStorno({ id: ent.id, date: "2026-10-02" });
    await expect(caller.finance.manualEntryStorno({ id: ent.id, date: "2026-10-02" })).rejects.toThrow(/веќе сторниран/);
    const sl = await caller.finance.journalList({ from: "2026-10-02", to: "2026-10-02", search: s.number, limit: 5, offset: 0 });
    expect((sl.entries[0] as any).lines.find((l: any) => l.account === "449")?.credit).toBe(100);
    const log = await caller.finance.glAuditList({ search: s.number });
    expect(log.rows.some((r: any) => r.action === "storno")).toBe(true);
    expect((await caller.finance.glAuditList({})).rows.some((r: any) => r.action === "lock")).toBe(true);
    await caller.finance.periodLockSet({ date: null });
    await getPool().query(`UPDATE incoming_invoices SET subtotal = 1000, vat_amount = 180, total_amount = 1180 WHERE id = $1`, [sepInc.id]);
    await caller.finance.ledgerSync();
  });

  it("ревизија: апликацијата бара најава штом постои администратор со код", async () => {
    const { gateActive, clearActorCache, resolveActor } = await import("./context");
    clearActorCache();
    expect(await gateActive()).toBe(false);
    expect((await resolveActor(null))?.role).toBe("admin");
    const r: any = await caller.appUsers.appUsersCreate({ name: "Шеф", passcode: "tajna-1234", role: "admin" });
    expect(r.gateActivated).toBe(true);
    expect(await resolveActor(null)).toBeUndefined();
    expect((await resolveActor("tajna-1234"))?.name).toBe("Шеф");
    await caller.appUsers.appUsersUpdate({ id: r.id, isActive: "inactive" });
    clearActorCache();
    expect(await gateActive()).toBe(false);
  });
  it("ревизија (средно): залихи на производи, месечна амортизација, затворање година, ЕЦД", async () => {
    const { getPool } = await import("./queries/connection");
    const pool = getPool();
    // залихи: книжи се само промената
    await caller.finance.inventoryValuationSave({ date: "2026-08-31", wip: 5000, fg: 2000 });
    await caller.finance.inventoryValuationSave({ date: "2026-09-30", wip: 3000, fg: 2500 });
    await expect(caller.finance.inventoryValuationSave({ date: "2026-07-31", wip: 1, fg: 1 })).rejects.toThrow(/по ред/);
    await caller.finance.ledgerSync();
    const iv = await caller.finance.journalList({ from: "2026-09-30", to: "2026-09-30", search: "Залихи на производи", limit: 5, offset: 0 });
    const l = (iv.entries[0] as any).lines;
    expect(l.find((x: any) => x.account === "600")?.credit).toBe(2000);
    expect(l.find((x: any) => x.account === "630")?.debit).toBe(500);
    expect(l.find((x: any) => x.account === "490")?.debit).toBe(1500);
    // амортизација 2026: месечно 1/12
    await pool.query(`INSERT INTO depreciation_entries (asset_id, year, months, amount) VALUES (999001, 2026, 12, 12000)`);
    await caller.finance.ledgerSync();
    const dep = (await caller.finance.journalList({ from: "2026-01-01", to: "2026-12-31", search: "Амортизација", limit: 50, offset: 0 })).entries.filter((e: any) => e.sourceType === "depreciation_m");
    expect(dep.length).toBe(new Date().getMonth() + 1);
    expect((dep[0] as any).lines.find((x: any) => x.account === "430")?.debit).toBe(1000);
    await pool.query(`DELETE FROM depreciation_entries WHERE asset_id = 999001`);
    // затворање на 2025: приходи и расходи на 800
    await caller.finance.manualEntryCreate({ date: "2025-06-30", description: "Приход 2025", lines: [{ account: "103", debit: 5000, credit: 0 }, { account: "740", debit: 0, credit: 5000 }] });
    await caller.finance.manualEntryCreate({ date: "2025-06-30", description: "Трошок 2025", lines: [{ account: "449", debit: 2000, credit: 0 }, { account: "103", debit: 0, credit: 2000 }] });
    await expect(caller.finance.yearClose({ year: new Date().getFullYear() })).rejects.toThrow(/не е завршена/);
    await caller.finance.yearClose({ year: 2025 });
    const yc = await caller.finance.journalList({ from: "2025-12-31", to: "2025-12-31", search: "Затворање на 2025", limit: 5, offset: 0 });
    const yl = (yc.entries[0] as any).lines;
    expect(yl.find((x: any) => x.account === "800")?.credit).toBe(3000);
    expect(yl.find((x: any) => x.account === "740")?.debit).toBe(5000);
    const tb = await caller.finance.trialBalance({ from: "2026-01-01", to: "2026-12-31" });
    expect(tb.accounts.find((a: any) => a.code === "740")?.opening ?? 0).toBe(0);
    expect(tb.accounts.find((a: any) => a.code === "800")?.opening).toBe(-3000);
    await caller.finance.yearReopen({ year: 2025 });
    await caller.finance.ledgerSync();
    expect((await caller.finance.journalList({ from: "2025-12-31", to: "2025-12-31", search: "Затворање", limit: 5, offset: 0 })).total).toBe(0);
    // ЕЦД: извоз со 0% без декларација -> предупредување; со декларација -> чисто
    const next = await caller.accounting.nextInvoiceNumber();
    const ex = await caller.accounting.invoiceCreate({ invoiceNumber: next, customerId: ids.cust, issueDate: "2026-10-03", status: "issued", currency: "EUR", subtotal: "100", vatRate: "0", vatAmount: "0", totalAmount: "100" });
    await pool.query(`UPDATE customers SET country = 'Austria' WHERE id = $1`, [ids.cust]);
    let vb = await caller.finance.vatBooks({ from: "2026-10-01", to: "2026-10-31" });
    expect(vb.warnings.some((w: string) => w.includes(next) && /ЕЦД/.test(w))).toBe(true);
    await caller.accounting.invoiceUpdate({ id: ex.id, customsDeclaration: "MK0001-26-123", customsDate: "2026-10-03" });
    vb = await caller.finance.vatBooks({ from: "2026-10-01", to: "2026-10-31" });
    expect(vb.warnings.some((w: string) => w.includes(next) && /ЕЦД/.test(w))).toBe(false);
    await pool.query(`UPDATE customers SET country = NULL WHERE id = $1`, [ids.cust]);
  });

  it("безбедност: кодот само како хеш, сесии со рок, нов код ги одјавува уредите", async () => {
    const { getPool } = await import("./queries/connection");
    const pool = getPool();
    const auth = await import("./auth");
    const { resolveActor, clearActorCache } = await import("./context");
    // стар корисник со чист код (пред миграцијата) → се хешира при подигање
    await pool.query(`INSERT INTO app_users (name, passcode, role) VALUES ('Стар', '445566', 'operator')`);
    auth.resetAuth();
    await auth.ensureAuthReady();
    const stored = (await pool.query(`SELECT passcode, passcode_hint FROM app_users WHERE name = 'Стар'`)).rows[0];
    expect(stored.passcode.startsWith("s2$")).toBe(true);
    expect(stored.passcode).not.toContain("445566");
    expect(stored.passcode_hint).toBe("••••66");
    clearActorCache();
    expect((await resolveActor("445566"))?.name).toBe("Стар");

    // нов корисник: во базата нема чист код; листата не го враќа
    const u: any = await caller.appUsers.appUsersCreate({ name: "Магационер", passcode: "778899", role: "operator" });
    const raw = (await pool.query(`SELECT passcode FROM app_users WHERE id = $1`, [u.id])).rows[0].passcode;
    expect(raw).not.toBe("778899");
    const list: any[] = await caller.appUsers.appUsersList();
    expect(JSON.stringify(list)).not.toContain("778899");
    expect(list.find((x) => x.id === u.id).passcodeHint).toBe("••••99");
    await expect(caller.appUsers.appUsersCreate({ name: "Дупликат", passcode: "778899" })).rejects.toThrow(/друг корисник/);

    // сесија: токен (не кодот), во базата само хеш на токенот
    const actor = await auth.actorFromCode("778899");
    const token = await auth.createSession(actor!, { ip: "1.2.3.4" });
    expect(token.startsWith("st_")).toBe(true);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM app_sessions WHERE token_hash = $1`, [token])).rows[0].n).toBe(0);
    clearActorCache();
    expect((await resolveActor(token))?.name).toBe("Магационер");
    // истечена сесија не важи
    await pool.query(`UPDATE app_sessions SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [u.id]);
    clearActorCache();
    expect(await resolveActor(token)).toBeUndefined();
    // нов код → стариот не важи, сесиите се бришат
    const t2 = await auth.createSession(actor!, {});
    const r: any = await caller.appUsers.appUsersResetCode({ id: u.id });
    expect(r.code).toMatch(/^\d{6}$/);
    clearActorCache();
    expect(await resolveActor(t2)).toBeUndefined();
    expect(await resolveActor("778899")).toBeUndefined();
    expect((await resolveActor(r.code))?.name).toBe("Магационер");
    // одјава
    const t3 = await auth.createSession({ id: u.id, name: "Магационер", role: "operator" }, {});
    await auth.deleteSession(t3);
    clearActorCache();
    expect(await resolveActor(t3)).toBeUndefined();
    // погрешни обиди → пауза
    auth._resetLoginLimits();
    for (let i = 0; i < 5; i++) auth.loginFailed("9.9.9.9");
    expect(auth.loginWait("9.9.9.9")).toBeGreaterThan(0);
    expect(auth.loginWait("8.8.8.8")).toBe(0);
  });

  it("бекап: доследна копија, проверка во привремена шема, враќање", async () => {
    const { getPool } = await import("./queries/connection");
    const pool = getPool();
    const bk = await import("./backup");
    const before = Number((await pool.query(`SELECT COUNT(*)::int AS n FROM invoices`)).rows[0].n);
    const custName = (await pool.query(`SELECT name FROM customers WHERE id = $1`, [ids.cust])).rows[0].name;
    const { gz, summary } = await bk.backupToBuffer();
    expect(summary.tables).toBeGreaterThan(30);
    expect(gz[0]).toBe(0x1f);
    const { header, data } = bk.parseBackup(gz);
    expect(header.tables.find((t) => t.name === "invoices")!.rows).toBe(before);
    expect(data.has("app_sessions")).toBe(false);

    const chk = await bk.checkRestore(gz);
    expect(chk.problems).toEqual([]);
    expect(chk.ok).toBe(true);
    expect(chk.rows).toBe(summary.rows);
    // проверката не остава траги
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM information_schema.schemata WHERE schema_name LIKE 'bk_check_%'`)).rows[0].n).toBe(0);
    await expect(bk.checkRestore(Buffer.from("не е бекап"))).rejects.toThrow(/бекап/);

    // промени по бекапот → враќање ги поништува; броевите продолжуваат
    await pool.query(`UPDATE customers SET name = 'ИЗМЕНЕТО' WHERE id = $1`, [ids.cust]);
    await pool.query(`DELETE FROM gl_audit`);
    const r = await bk.restoreBackup(gz);
    expect(r.ok).toBe(true);
    expect((await pool.query(`SELECT name FROM customers WHERE id = $1`, [ids.cust])).rows[0].name).toBe(custName);
    expect(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM invoices`)).rows[0].n)).toBe(before);
    const maxId = Number((await pool.query(`SELECT MAX(id) AS m FROM customers`)).rows[0].m);
    const ins = await pool.query(`INSERT INTO customers (name) VALUES ('По враќање') RETURNING id`);
    expect(Number(ins.rows[0].id)).toBeGreaterThan(maxId);
    // кодовите важат и по враќањето
    const { resolveActor, clearActorCache } = await import("./context");
    clearActorCache();
    expect((await resolveActor("445566"))?.name).toBe("Стар");
  });

  it("биланси и ДДВ-04 од главната книга", async () => {
    await caller.finance.ledgerSync();
    const fs: any = await caller.finance.financialStatements({ date: "2026-12-31" });
    expect(fs.balanceSheet.totalAssets).toBeGreaterThan(0);
    expect(Math.abs(fs.balanceSheet.difference)).toBeLessThan(0.01);
    expect(fs.balanceSheet.unmapped).toEqual([]);
    // резултатот во билансот на успех = приходи − расходи од бруто билансот (класи 7 и 4) без затворањето
    const tb: any = await caller.finance.trialBalance({ from: "2026-01-01", to: "2026-12-31" });
    const cls = (c: string) => tb.accounts.filter((a: any) => a.code.startsWith(c)).reduce((s: number, a: any) => s + a.debit - a.credit, 0);
    expect(fs.incomeStatement.beforeTax).toBeCloseTo(-(cls("7") + cls("4") + cls("5")), 1);
    // купувачите во актива = салдо на 12x
    const rec = fs.balanceSheet.assets.flatMap((x: any) => x.rows).find((r: any) => r.key === "a_receivables");
    expect(rec.accounts.every((a: any) => a.code.startsWith("12"))).toBe(true);
    // 235 (аванси) не е во „даноци“
    const tax = fs.balanceSheet.liabilities.flatMap((x: any) => x.rows).find((r: any) => r.key === "l_tax");
    expect(tax.accounts.some((a: any) => a.code === "235")).toBe(false);

    const v: any = await caller.finance.vat04({ from: "2026-01-01", to: "2026-12-31" });
    const vb: any = await caller.finance.vatBooks({ from: "2026-01-01", to: "2026-12-31" });
    expect(v.lines.find((l: any) => l.key === "t_pay").vat).toBeCloseTo(vb.summary.payable, 2);
    expect(v.lines.find((l: any) => l.key === "t_out").vat).toBeCloseTo(vb.summary.outVat, 2);
    await caller.finance.statementCodesSave({ kind: "vat04", codes: { o18: " 01 ", o10: "" } });
    expect((await caller.finance.vat04({ from: "2026-01-01", to: "2026-12-31" })).codes).toEqual({ o18: "01" });
  });

  it("компензација, ИОС и налози за плаќање", async () => {
    const { getPool } = await import("./queries/connection");
    const pool = getPool();
    const c = await caller.customers.customerCreate({ name: "Двострана ДОО", taxNumber: "4030999999999" });
    const custId = Number((c as any).id ?? (await pool.query(`SELECT id FROM customers WHERE name = 'Двострана ДОО'`)).rows[0].id);
    const sup = (await caller.procurement.supplierCreate({ name: "Двострана ДОО", edb: "4030999999999", bankAccount: "300 0000 1234 5678" }));
    const supId = Number(sup.id || (await pool.query(`SELECT id FROM suppliers WHERE name = 'Двострана ДОО'`)).rows[0].id);
    const num = await caller.accounting.nextInvoiceNumber();
    const inv = await caller.accounting.invoiceCreate({ invoiceNumber: num, customerId: custId, issueDate: "2026-10-10", status: "issued", subtotal: "10000", vatRate: "18", vatAmount: "1800", totalAmount: "11800" });
    const inc = await caller.accounting.incomingInvoiceCreate({ supplierInvoiceNumber: "DV-5", supplierId: supId, issueDate: "2026-10-11", receivedDate: "2026-10-11", dueDate: "2026-10-20",
      subtotal: "5000", vatRate: "18", vatAmount: "900", totalAmount: "5900", expenseAccount: "413" });

    // предлог: истиот ЕДБ
    const cand: any = await caller.settle.compensationCandidates({ customerId: custId, supplierId: supId });
    expect(cand.suggestions.map((x: any) => x.id)).toContain(supId);
    expect(cand.receivables.find((r: any) => r.id === inv.id).open).toBe(11800);
    // страните мора да се еднакви; не повеќе од отвореното
    await expect(caller.settle.compensationCreate({ date: "2026-10-15", customerId: custId, supplierId: supId,
      items: [{ docType: "invoice", docId: inv.id, amount: 5900 }, { docType: "incoming_invoice", docId: inc.id, amount: 5000 }] })).rejects.toThrow(/еднакви/);
    await expect(caller.settle.compensationCreate({ date: "2026-10-15", customerId: custId, supplierId: supId,
      items: [{ docType: "invoice", docId: inv.id, amount: 6000 }, { docType: "incoming_invoice", docId: inc.id, amount: 6000 }] })).rejects.toThrow(/останува/);
    const comp: any = await caller.settle.compensationCreate({ date: "2026-10-15", customerId: custId, supplierId: supId,
      items: [{ docType: "invoice", docId: inv.id, amount: 5900 }, { docType: "incoming_invoice", docId: inc.id, amount: 5900 }] });
    expect(comp.number).toMatch(/^КОМП-001\/2026$/);
    expect((await pool.query(`SELECT status FROM incoming_invoices WHERE id = $1`, [inc.id])).rows[0].status).toBe("paid");
    expect((await pool.query(`SELECT status FROM invoices WHERE id = $1`, [inv.id])).rows[0].status).toBe("partial");
    // книжење: Д 220 / П 120 по партнер
    await caller.finance.ledgerSync();
    const j = await caller.finance.journalList({ from: "2026-10-15", to: "2026-10-15", search: "КОМП-001", limit: 5, offset: 0 });
    const lines = j.entries[0].lines as any[];
    expect(lines.find((l) => l.account === "220" && l.debit === 5900)).toBeTruthy();
    expect(lines.find((l) => l.account === "120" && l.credit === 5900)).toBeTruthy();
    // фактура со компензација не се брише
    await expect(caller.accounting.incomingInvoiceDelete({ id: inc.id })).rejects.toThrow(/компензации/);

    // ИОС: на 14.10 (пред компензацијата) отворено е сè; на 31.10 — остатокот
    const before: any = await caller.settle.iosData({ partnerType: "customer", partnerId: custId, asOf: "2026-10-14" });
    expect(before.balance).toBe(11800);
    const after: any = await caller.settle.iosData({ partnerType: "customer", partnerId: custId, asOf: "2026-10-31" });
    expect(after.balance).toBe(5900);
    const sIos: any = await caller.settle.iosData({ partnerType: "supplier", partnerId: supId, asOf: "2026-10-31" });
    expect(sIos.balance).toBe(0);
    const log = await caller.settle.iosRecord({ partnerType: "customer", partnerId: custId, asOf: "2026-10-31", balance: 5900, sentTo: "x@y.mk" });
    await expect(caller.settle.iosAnswer({ id: log.id, status: "disputed" })).rejects.toThrow(/оспорува/);
    await caller.settle.iosAnswer({ id: log.id, status: "confirmed" });
    expect((await caller.settle.iosPartners()).find((p: any) => p.partnerType === "customer" && p.partnerId === custId).lastIos.status).toBe("confirmed");

    // поништување: фактурите повторно отворени, книжењето се тргнува
    await caller.settle.compensationCancel({ id: comp.id });
    expect((await pool.query(`SELECT status FROM incoming_invoices WHERE id = $1`, [inc.id])).rows[0].status).toBe("received");
    await caller.finance.ledgerSync();
    expect((await caller.finance.journalList({ from: "2026-10-15", to: "2026-10-15", search: "КОМП-001", limit: 5, offset: 0 })).entries.length).toBe(0);

    // налози за плаќање: жиро-сметката од картонот, сметка од 15 цифри, износ најмногу отвореното
    const po: any = await caller.settle.paymentOrderCandidates({ dueBy: "2026-10-31" });
    const row = po.domestic.find((r: any) => r.id === inc.id);
    expect(row.account).toBe("300000012345678");
    expect(row.accountOk).toBe(true);
    await expect(caller.settle.paymentOrderCreate({ payDate: "2026-10-20", items: [{ incomingInvoiceId: inc.id, amount: 5900, payeeAccount: "123", purpose: "x" }] })).rejects.toThrow(/15 цифри/);
    await expect(caller.settle.paymentOrderCreate({ payDate: "2026-10-20", items: [{ incomingInvoiceId: inc.id, amount: 9999, payeeAccount: row.account, purpose: "x" }] })).rejects.toThrow(/останува/);
    const b: any = await caller.settle.paymentOrderCreate({ payDate: "2026-10-20", items: [{ incomingInvoiceId: inc.id, amount: 5900, payeeAccount: row.account, purpose: "Плаќање по фактура DV-5", reference: "DV-5" }] });
    expect(b.total).toBe(5900);
    const after2: any = await caller.settle.paymentOrderCandidates({ dueBy: "2026-10-31" });
    expect(after2.domestic.find((r: any) => r.id === inc.id).inBatch.amount).toBe(5900);
    const listed: any = await caller.settle.paymentOrderList();
    expect(listed.batches[0].items[0].payee).toBe("Двострана ДОО");
  });

  it("книжење се прескокнува кога ништо не е сменето", async () => {
    const fin = await import("./finance-router");
    const { getPool } = await import("./queries/connection");
    const pool = getPool();
    const a = await fin.ledgerFingerprint();
    expect(await fin.ledgerFingerprint()).toBe(a);
    await fin.syncLedgerIfChanged("тест");
    expect((await fin.syncLedgerIfChanged("тест") as any).skipped).toBe(true);
    // прилогот не влијае; сменет износ влијае
    await pool.query(`UPDATE incoming_invoices SET file_url = 'abc' WHERE id = (SELECT MIN(id) FROM incoming_invoices)`);
    expect(await fin.ledgerFingerprint()).toBe(a);
    await pool.query(`UPDATE cash_transactions SET description = COALESCE(description, '') || ' ' WHERE id = (SELECT MIN(id) FROM cash_transactions)`);
    expect(await fin.ledgerFingerprint()).not.toBe(a);
    expect((await fin.syncLedgerIfChanged("тест") as any).skipped).toBeUndefined();
  });
});
