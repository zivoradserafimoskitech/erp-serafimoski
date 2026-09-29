import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  orders, workOrders, materials, purchaseOrders, customers,
  invoices, incomingInvoices, warehouses, materialStock,
  quotations,
} from "@db/schema";
import { isLowStock } from "@contracts/stock";
import { openDocs } from "./payment-status";
import { loadRates, iso } from "./rates-helper";
import { toMkd } from "@contracts/finance";

export const dashboardRouter = createRouter({
  stats: publicQuery.query(async () => {
    const db = getDb();

    const allOrders = await db.select().from(orders);
    const allWorkOrders = await db.select().from(workOrders);
    const allMaterials = await db.select().from(materials);
    const allPOs = await db.select().from(purchaseOrders);
    const allCustomers = await db.select().from(customers);
    const allInvoices = await db.select().from(invoices);
    const allIncoming = await db.select().from(incomingInvoices);
    const allWarehouses = await db.select().from(warehouses);
    const allStock = await db.select().from(materialStock);
    const allQuotes = await db.select().from(quotations);

    // Orders
    const pendingOrders = allOrders.filter((o) => o.status === "pending").length;
    const confirmedOrders = allOrders.filter((o) => o.status === "confirmed").length;
    const inProductionOrders = allOrders.filter((o) => o.status === "in_production").length;
    const readyOrders = allOrders.filter((o) => o.status === "ready").length;
    const deliveredOrders = allOrders.filter((o) => o.status === "delivered").length;

    // Work orders
    const pendingWO = allWorkOrders.filter((w) => w.status === "pending").length;
    const inProgressWO = allWorkOrders.filter((w) => w.status === "in_progress").length;
    const completedWO = allWorkOrders.filter((w) => w.status === "completed").length;
    const onHoldWO = allWorkOrders.filter((w) => w.status === "on_hold").length;

    // Storage
    const totalMaterials = allMaterials.length;
    const lowStockCount = allMaterials.filter(isLowStock).length;
    // Материјали без поставен минимум — не се аларм, но вреди да се знае колку се
    const noMinStock = allMaterials.filter((m) => (parseFloat(m.minStock) || 0) <= 0).length;
    const totalInventoryValue = allStock.reduce(
      (sum, s) => sum + parseFloat(s.quantity) * parseFloat(s.avgCost), 0
    );

    // Procurement
    const draftPO = allPOs.filter((p) => p.status === "draft").length;
    const sentPO = allPOs.filter((p) => p.status === "sent").length;
    const partialPO = allPOs.filter((p) => p.status === "partial").length;

    // Revenue & Profit
    // Сè во денари: нарачката е во валутата на понудата, фактурите во својата валута
    const rate = await loadRates();
    const quoteCur = new Map(allQuotes.map((q: any) => [q.id, String(q.currency || "MKD").toUpperCase()]));
    const mkd = (v: any, cur: string, d: any) => { const n = parseFloat(v) || 0; return cur === "MKD" ? n : (toMkd(n, cur, iso(d), rate) ?? n); };
    const liveOrders = allOrders.filter((o: any) => o.status !== "cancelled");
    const oMkd = (o: any, f: string) => mkd(o[f], o.quoteId ? quoteCur.get(o.quoteId) ?? "MKD" : "MKD", o.createdAt);
    const totalRevenue = liveOrders.reduce((sum: number, o: any) => sum + oMkd(o, "totalAmount"), 0);
    const totalCost = liveOrders.reduce((sum: number, o: any) => sum + oMkd(o, "costAmount"), 0);
    const totalMargin = liveOrders.reduce((sum: number, o: any) => sum + oMkd(o, "marginAmount"), 0);
    // Само книжени фактури (како во главната книга и ДДВ книгите); книжното одобрување се одзема
    const booked = allInvoices.filter((i: any) => ["standard", "credit_note"].includes(i.invoiceType) && !["draft", "cancelled"].includes(i.status));
    const iSign = (i: any) => i.invoiceType === "credit_note" ? -1 : 1;
    const iCur = (i: any) => String(i.currency || "MKD").toUpperCase();
    const totalInvoiced = booked.reduce((sum: number, i: any) => sum + iSign(i) * Math.abs(mkd(i.totalAmount, iCur(i), i.issueDate)), 0);
    // Отворени обврски/побарувања: вистинско салдо по плаќања (банка + благајна), во денари
    const open = await openDocs();
    const totalPayables = open.filter(d => d.docType === "incoming_invoice").reduce((s, d) => s + d.openMkd, 0);
    const totalReceivables = open.filter(d => d.docType === "invoice").reduce((s, d) => s + d.openMkd, 0);

    // Customers
    const activeCustomers = allCustomers.filter((c) => c.isActive === "active").length;

    // Quotes
    const pendingQuotes = allQuotes.filter(q => q.status === "draft" || q.status === "sent").length;

    // Warehouses
    const warehouseCount = allWarehouses.length;

    // VAT
    const outgoingVat = booked.reduce((sum: number, i: any) => sum + iSign(i) * Math.abs(mkd(i.vatAmount, iCur(i), i.issueDate)), 0);
    const incomingVat = allIncoming.filter((i: any) => i.status !== "cancelled")
      .reduce((sum: number, i: any) => sum + mkd(i.vatAmount, String(i.currency || "MKD").toUpperCase(), i.receivedDate), 0);

    return {
      orders: {
        total: allOrders.length,
        pending: pendingOrders,
        confirmed: confirmedOrders,
        inProduction: inProductionOrders,
        ready: readyOrders,
        delivered: deliveredOrders,
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
        total: allPOs.length,
        draft: draftPO,
        sent: sentPO,
        partial: partialPO,
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
        total: allCustomers.length,
        active: activeCustomers,
      },
      quotes: {
        total: allQuotes.length,
        pending: pendingQuotes,
      },
    };
  }),
});
