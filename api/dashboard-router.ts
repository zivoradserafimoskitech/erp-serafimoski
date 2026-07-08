import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  orders, workOrders, materials, purchaseOrders, customers,
  invoices, incomingInvoices, warehouses, materialStock,
  quotations,
} from "@db/schema";

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
    const lowStockCount = allMaterials.filter(
      (m) => parseFloat(m.currentStock) <= parseFloat(m.minStock)
    ).length;
    const totalInventoryValue = allStock.reduce(
      (sum, s) => sum + parseFloat(s.quantity) * parseFloat(s.avgCost), 0
    );

    // Procurement
    const draftPO = allPOs.filter((p) => p.status === "draft").length;
    const sentPO = allPOs.filter((p) => p.status === "sent").length;
    const partialPO = allPOs.filter((p) => p.status === "partial").length;

    // Revenue & Profit
    const totalRevenue = allOrders.reduce((sum, o) => sum + parseFloat(o.totalAmount), 0);
    const totalCost = allOrders.reduce((sum, o) => sum + parseFloat(o.costAmount), 0);
    const totalMargin = allOrders.reduce((sum, o) => sum + parseFloat(o.marginAmount), 0);
    const totalInvoiced = allInvoices
      .filter(i => i.invoiceType === "standard")
      .reduce((sum, i) => sum + parseFloat(i.totalAmount), 0);
    const totalPayables = allIncoming
      .filter(i => i.status === "received")
      .reduce((sum, i) => sum + parseFloat(i.totalAmount), 0);

    // Customers
    const activeCustomers = allCustomers.filter((c) => c.isActive === "active").length;

    // Quotes
    const pendingQuotes = allQuotes.filter(q => q.status === "draft" || q.status === "sent").length;

    // Warehouses
    const warehouseCount = allWarehouses.length;

    // VAT
    const outgoingVat = allInvoices.reduce((sum, i) => sum + parseFloat(i.vatAmount), 0);
    const incomingVat = allIncoming.reduce((sum, i) => sum + parseFloat(i.vatAmount), 0);

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
