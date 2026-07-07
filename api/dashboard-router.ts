import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { orders, workOrders, materials, purchaseOrders, customers } from "@db/schema";

export const dashboardRouter = createRouter({
  stats: publicQuery.query(async () => {
    const db = getDb();

    const allOrders = await db.select().from(orders);
    const allWorkOrders = await db.select().from(workOrders);
    const allMaterials = await db.select().from(materials);
    const allPOs = await db.select().from(purchaseOrders);
    const allCustomers = await db.select().from(customers);

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

    // Procurement
    const draftPO = allPOs.filter((p) => p.status === "draft").length;
    const sentPO = allPOs.filter((p) => p.status === "sent").length;
    const confirmedPO = allPOs.filter((p) => p.status === "confirmed").length;

    // Revenue
    const totalRevenue = allOrders.reduce((sum, o) => sum + parseFloat(o.totalAmount), 0);
    const pendingRevenue = allOrders
      .filter((o) => o.status === "pending" || o.status === "confirmed")
      .reduce((sum, o) => sum + parseFloat(o.totalAmount), 0);

    // Customers
    const activeCustomers = allCustomers.filter((c) => c.isActive === "active").length;

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
      },
      procurement: {
        total: allPOs.length,
        draft: draftPO,
        sent: sentPO,
        confirmed: confirmedPO,
      },
      financial: {
        totalRevenue: totalRevenue.toFixed(2),
        pendingRevenue: pendingRevenue.toFixed(2),
      },
      customers: {
        total: allCustomers.length,
        active: activeCustomers,
      },
    };
  }),
});
