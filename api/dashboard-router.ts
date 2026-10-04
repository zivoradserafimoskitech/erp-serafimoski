import { createRouter, publicQuery } from "./middleware";
import { getPool } from "./queries/connection";
import { isLowStock } from "@contracts/stock";
import { openDocs, manualPartnerBalances } from "./payment-status";
import { loadRates, iso } from "./rates-helper";
import { toMkd } from "@contracts/finance";

export const dashboardRouter = createRouter({
  stats: publicQuery.query(async () => {
    // Само потребните колони (без прилози/датотеки) и бројки пресметани во базата
    const q = async (sql: string) => (await getPool().query(sql)).rows as any[];
    const camel = (rows: any[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/_([a-z])/g, (_m, c) => c.toUpperCase()), v])));
    const [allOrders, allWorkOrders, allMaterials, poCounts, custCounts, allInvoices, allIncoming, whCount, stockValue, allQuotes] = await Promise.all([
      q(`SELECT id, status, total_amount, cost_amount, margin_amount, quote_id, created_at FROM orders`).then(camel),
      q(`SELECT id, status, order_id FROM work_orders`).then(camel),
      q(`SELECT current_stock, min_stock FROM materials`).then(camel),
      q(`SELECT status, COUNT(*)::int AS n FROM purchase_orders GROUP BY status`),
      q(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active = 'active')::int AS active FROM customers`),
      q(`SELECT invoice_type, status, currency, issue_date, subtotal, vat_amount, total_amount FROM invoices WHERE invoice_type IN ('standard','credit_note') AND status NOT IN ('draft','cancelled')`).then(camel),
      q(`SELECT vat_amount, currency, received_date FROM incoming_invoices WHERE status <> 'cancelled'`).then(camel),
      q(`SELECT COUNT(*)::int AS n FROM warehouses`),
      q(`SELECT COALESCE(SUM(quantity * avg_cost), 0) AS v FROM material_stock`),
      q(`SELECT id, status, currency FROM quotations`).then(camel),
    ]);
    const poBy = (st: string) => Number(poCounts.find((r) => r.status === st)?.n ?? 0);

    // Orders
    const pendingOrders = allOrders.filter((o: any) => o.status === "pending").length;
    const confirmedOrders = allOrders.filter((o: any) => o.status === "confirmed").length;
    const inProductionOrders = allOrders.filter((o: any) => o.status === "in_production").length;
    const readyOrders = allOrders.filter((o: any) => o.status === "ready").length;
    const deliveredOrders = allOrders.filter((o: any) => o.status === "delivered").length;

    // Work orders
    const pendingWO = allWorkOrders.filter((w: any) => w.status === "pending").length;
    const inProgressWO = allWorkOrders.filter((w: any) => w.status === "in_progress").length;
    const completedWO = allWorkOrders.filter((w: any) => w.status === "completed").length;
    const onHoldWO = allWorkOrders.filter((w: any) => w.status === "on_hold").length;

    // Storage
    const totalMaterials = allMaterials.length;
    const lowStockCount = allMaterials.filter((m: any) => isLowStock(m)).length;
    // Материјали без поставен минимум — не се аларм, но вреди да се знае колку се
    const noMinStock = allMaterials.filter((m: any) => (parseFloat(m.minStock) || 0) <= 0).length;
    const totalInventoryValue = Number(stockValue[0]?.v ?? 0);

    // Procurement
    const draftPO = poBy("draft"), sentPO = poBy("sent"), partialPO = poBy("partial");

    // Revenue & Profit
    // Сè во денари: нарачката е во валутата на понудата, фактурите во својата валута
    const rate = await loadRates();
    const quoteCur = new Map<number, string>(allQuotes.map((q: any) => [Number(q.id), String(q.currency || "MKD").toUpperCase()]));
    const mkd = (v: any, cur: string, d: any) => { const n = parseFloat(v) || 0; return cur === "MKD" ? n : (toMkd(n, cur, iso(d), rate) ?? n); };
    const liveOrders = allOrders.filter((o: any) => o.status !== "cancelled");
    const oMkd = (o: any, f: string) => mkd(o[f], o.quoteId ? quoteCur.get(Number(o.quoteId)) ?? "MKD" : "MKD", o.createdAt);
    const totalRevenue = liveOrders.reduce((sum: number, o: any) => sum + oMkd(o, "totalAmount"), 0);
    const totalCost = liveOrders.reduce((sum: number, o: any) => sum + oMkd(o, "costAmount"), 0);
    const totalMargin = liveOrders.reduce((sum: number, o: any) => sum + oMkd(o, "marginAmount"), 0);
    // Само книжени фактури (како во главната книга и ДДВ книгите); книжното одобрување се одзема
    const booked = allInvoices;
    const iSign = (i: any) => i.invoiceType === "credit_note" ? -1 : 1;
    const iCur = (i: any) => String(i.currency || "MKD").toUpperCase();
    const totalInvoiced = booked.reduce((sum: number, i: any) => sum + iSign(i) * Math.abs(mkd(i.totalAmount, iCur(i), i.issueDate)), 0);
    // Отворени обврски/побарувања: вистинско салдо по плаќања (банка + благајна), во денари
    const open = await openDocs();
    // + салда од рачните налози со партнер (на пр. терк „Закупнина“ на 220 со избран добавувач)
    const manual = await manualPartnerBalances();
    const sumMap = (m: Map<number, number>) => [...m.values()].reduce((a, v) => a + v, 0);
    const manualPayables = sumMap(manual.suppliers), manualReceivables = sumMap(manual.customers);
    const totalPayables = open.filter(d => d.docType === "incoming_invoice").reduce((s, d) => s + d.openMkd, 0) + manualPayables;
    const totalReceivables = open.filter(d => d.docType === "invoice").reduce((s, d) => s + d.openMkd, 0) + manualReceivables;

    // Customers
    const activeCustomers = Number(custCounts[0]?.active ?? 0);

    // Quotes
    const pendingQuotes = allQuotes.filter((q: any) => q.status === "draft" || q.status === "sent").length;

    // Warehouses
    const warehouseCount = Number(whCount[0]?.n ?? 0);

    // VAT
    const outgoingVat = booked.reduce((sum: number, i: any) => sum + iSign(i) * Math.abs(mkd(i.vatAmount, iCur(i), i.issueDate)), 0);
    const incomingVat = allIncoming
      .reduce((sum: number, i: any) => sum + mkd(i.vatAmount, String(i.currency || "MKD").toUpperCase(), i.receivedDate), 0);

    // ── Показатели со јасен извор ──
    const year = new Date().getFullYear();
    // курс: на денот (до 10 дена назад), инаку последниот познат; без курс -> не се брои, туку се пријавува
    const lastRate = new Map<string, number>();
    for (const r of (await getPool().query(`SELECT DISTINCT ON (currency) currency, rate FROM exchange_rates ORDER BY currency, rate_date DESC`)).rows as any[]) lastRate.set(r.currency, Number(r.rate));
    let invoicedYear = 0, invoicedYearCount = 0, invoicedNoRate = 0;
    for (const i of booked as any[]) {
      if (new Date(i.issueDate).getFullYear() !== year) continue;
      const cur = String(i.currency || "MKD").toUpperCase();
      const net = Math.abs(parseFloat(i.subtotal) || 0);
      const v = cur === "MKD" ? net : (toMkd(net, cur, iso(i.issueDate), rate) ?? (lastRate.get(cur) ? net * lastRate.get(cur)! : null));
      if (v === null) { invoicedNoRate++; continue; }
      invoicedYear += iSign(i) * v;
      if (i.invoiceType === "standard") invoicedYearCount++;
    }
    const ordersOpen = allOrders.filter((o: any) => !["delivered", "cancelled"].includes(o.status)).length;
    const qualityOpen = Number((await getPool().query(`SELECT COUNT(*)::int n FROM quality_issues WHERE status <> 'closed'`)).rows[0]?.n ?? 0);
    const receivablesCount = open.filter(d => d.docType === "invoice").length;
    // нарачки означени „во производство“ а без ниеден отворен налог -- вреди да се провери
    const activeWoOrders = new Set(allWorkOrders.filter((w: any) => ["pending", "in_progress", "on_hold"].includes(w.status)).map((w: any) => Number(w.orderId)));
    const inProductionNoWo = allOrders.filter((o: any) => o.status === "in_production" && !activeWoOrders.has(Number(o.id))).length;
    const receiptsDraft = Number((await getPool().query(`SELECT COUNT(*)::int n FROM receipts WHERE status = 'draft'`)).rows[0]?.n ?? 0);
    const payablesCount = open.filter(d => d.docType === "incoming_invoice").length;

    return {
      kpi: {
        year, ordersOpen, ordersTotal: allOrders.length,
        woActive: pendingWO + inProgressWO + onHoldWO, woInProgress: inProgressWO, woPending: pendingWO,
        invoicedYear: Math.round(invoicedYear * 100) / 100, invoicedYearCount, invoicedNoRate,
        receivables: Math.round(totalReceivables * 100) / 100, receivablesCount,
        payables: Math.round(totalPayables * 100) / 100, payablesCount,
        manualPayables: Math.round(manualPayables * 100) / 100, manualReceivables: Math.round(manualReceivables * 100) / 100,
        qualityOpen,
      },
      orders: {
        total: allOrders.length,
        pending: pendingOrders,
        confirmed: confirmedOrders,
        inProduction: inProductionOrders,
        ready: readyOrders,
        delivered: deliveredOrders,
        cancelled: allOrders.filter((o: any) => o.status === "cancelled").length,
        inProductionNoWo,
      },
      production: {
        total: allWorkOrders.length,
        pending: pendingWO,
        inProgress: inProgressWO,
        completed: completedWO,
        onHold: onHoldWO,
      },
      storage: {
        totalMaterials,
        lowStock: lowStockCount,
        noMinStock,
        inventoryValue: totalInventoryValue.toFixed(2),
        warehouseCount,
      },
      procurement: {
        total: poCounts.reduce((a, r) => a + Number(r.n), 0),
        draft: draftPO,
        sent: sentPO,
        partial: partialPO,
        receiptsDraft,
      },
      financial: {
        totalRevenue: totalRevenue.toFixed(2),
        totalCost: totalCost.toFixed(2),
        totalMargin: totalMargin.toFixed(2),
        totalInvoiced: totalInvoiced.toFixed(2),
        totalPayables: totalPayables.toFixed(2),
        totalReceivables: totalReceivables.toFixed(2),
        outgoingVat: outgoingVat.toFixed(2),
        incomingVat: incomingVat.toFixed(2),
        vatBalance: (outgoingVat - incomingVat).toFixed(2),
      },
      customers: {
        total: Number(custCounts[0]?.total ?? 0),
        active: activeCustomers,
      },
      quotes: {
        total: allQuotes.length,
        pending: pendingQuotes,
      },
    };
  }),
});
