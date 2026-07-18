import { z } from "zod";
import { eq, desc } from "drizzle-orm";
// PostgreSQL compat
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { workOrders, workOrderOperations, workOrderMaterials, orders, materials } from "@db/schema";
import { logAudit } from "./audit-helper";

export const productionRouter = createRouter({
  // === WORK ORDERS ===
  workOrderList: publicQuery
    .input(z.object({ status: z.string().optional(), priority: z.string().optional(), search: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db
        .select({
          id: workOrders.id, woNumber: workOrders.woNumber, orderId: workOrders.orderId,
          description: workOrders.description, status: workOrders.status, priority: workOrders.priority,
          plannedStart: workOrders.plannedStart, plannedEnd: workOrders.plannedEnd,
          actualStart: workOrders.actualStart, actualEnd: workOrders.actualEnd,
          assignedTo: workOrders.assignedTo, costAmount: workOrders.costAmount,
          notes: workOrders.notes, createdBy: workOrders.createdBy,
          createdAt: workOrders.createdAt, updatedAt: workOrders.updatedAt,
          orderNumber: orders.orderNumber,
        })
        .from(workOrders)
        .leftJoin(orders, eq(workOrders.orderId, orders.id))
        .orderBy(desc(workOrders.createdAt));

      let filtered = result;
      if (input?.status) filtered = filtered.filter(r => r.status === input.status);
      if (input?.priority) filtered = filtered.filter(r => r.priority === input.priority);
      if (input?.search) {
        const s = input.search.toLowerCase();
        filtered = filtered.filter(r => r.woNumber.toLowerCase().includes(s) || r.description.toLowerCase().includes(s));
      }
      return filtered;
    }),

  workOrderById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const wo = await db.select().from(workOrders).where(eq(workOrders.id, input.id));
      let orderNumber: string | null = null;
      if (wo[0]?.orderId) {
        const { orders } = await import("@db/schema");
        const o = await db.select({ n: orders.orderNumber }).from(orders).where(eq(orders.id, wo[0].orderId));
        orderNumber = o[0]?.n ?? null;
      }
      if (!wo[0]) return null;
      const ops = await db.select().from(workOrderOperations).where(eq(workOrderOperations.workOrderId, input.id)).orderBy(workOrderOperations.sequence);
      const mats = await db
        .select({
          id: workOrderMaterials.id, workOrderId: workOrderMaterials.workOrderId,
          materialId: workOrderMaterials.materialId, quantity: workOrderMaterials.quantity,
          unitCost: workOrderMaterials.unitCost, totalCost: workOrderMaterials.totalCost,
          isActual: workOrderMaterials.isActual, notes: workOrderMaterials.notes,
          materialName: materials.name, materialCode: materials.code, materialUnit: materials.unit,
        })
        .from(workOrderMaterials)
        .leftJoin(materials, eq(workOrderMaterials.materialId, materials.id))
        .where(eq(workOrderMaterials.workOrderId, input.id));
      return { ...wo[0], orderNumber, operations: ops, materials: mats };
    }),

  workOrderCreate: publicQuery
    .input(z.object({
      woNumber: z.string().min(1),
      orderId: z.number().optional(),
      description: z.string().min(1),
      status: z.enum(["pending", "in_progress", "on_hold", "completed", "cancelled"]).default("pending"),
      priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
      plannedStart: z.string().optional(),
      plannedEnd: z.string().optional(),
      assignedTo: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      {
        const { bumpDocCounter } = await import("./counters-helper");
        await bumpDocCounter("workOrder", input.woNumber).catch(() => {});
      }
      const db = getDb();
      const { orderId, ...rest } = input;
      const insertData: any = { ...rest, orderId: orderId ?? null };
      if (rest.plannedStart) insertData.plannedStart = new Date(rest.plannedStart);
      if (rest.plannedEnd) insertData.plannedEnd = new Date(rest.plannedEnd);
      const result = await db.insert(workOrders).values(insertData);
      const insertId = Number(result[0].insertId);
      await logAudit({ action: "CREATE", entityType: "work_order", entityId: insertId, description: `Креиран налог ${input.woNumber}` });
      return { success: true, id: insertId };
    }),

  workOrderUpdate: publicQuery
    .input(z.object({
      id: z.number(),
      woNumber: z.string().optional(),
      orderId: z.number().optional(),
      description: z.string().optional(),
      status: z.enum(["pending", "in_progress", "on_hold", "completed", "cancelled"]).optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      plannedStart: z.string().optional(),
      plannedEnd: z.string().optional(),
      actualStart: z.string().optional(),
      actualEnd: z.string().optional(),
      assignedTo: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      const updateData: any = { ...data };
      if (data.plannedStart) updateData.plannedStart = new Date(data.plannedStart);
      if (data.plannedEnd) updateData.plannedEnd = new Date(data.plannedEnd);
      if (data.actualStart) updateData.actualStart = new Date(data.actualStart);
      if (data.actualEnd) updateData.actualEnd = new Date(data.actualEnd);

      if (data.status === "in_progress" && !data.actualStart) updateData.actualStart = new Date();
      if (data.status === "completed" && !data.actualEnd) updateData.actualEnd = new Date();

      await db.update(workOrders).set(updateData).where(eq(workOrders.id, id));
      return { success: true };
    }),

  workOrderDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(workOrderMaterials).where(eq(workOrderMaterials.workOrderId, input.id));
      await db.delete(workOrderOperations).where(eq(workOrderOperations.workOrderId, input.id));
      await db.delete(workOrders).where(eq(workOrders.id, input.id));
      return { success: true };
    }),

  // === WORK ORDER MATERIALS ===
  woMaterialCreate: publicQuery
    .input(z.object({
      workOrderId: z.number(),
      materialId: z.number(),
      quantity: z.string(),
      unitCost: z.string().default("0"),
      totalCost: z.string().default("0"),
      isActual: z.enum(["planned", "actual"]).default("planned"),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(workOrderMaterials).values(input as any);
      return { success: true };
    }),

  woMaterialDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(workOrderMaterials).where(eq(workOrderMaterials.id, input.id));
      return { success: true };
    }),

  // === WORK ORDER OPERATIONS ===
  operationCreate: publicQuery
    .input(z.object({
      workOrderId: z.number(),
      operation: z.enum([
        "cutting_laser", "cutting_plasma", "bending",
        "welding_mig", "welding_tig", "grinding",
        "drilling", "painting", "assembly",
        "quality_control", "packaging",
      ]),
      sequence: z.number(),
      description: z.string().optional(),
      estimatedTime: z.string().optional(),
      estimatedQty: z.string().optional(),
      qtyUnit: z.string().optional(),
      costRate: z.string().default("0"),
      operator: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(workOrderOperations).values(input as any);
      return { success: true };
    }),

  operationUpdate: publicQuery
    .input(z.object({
      id: z.number(),
      operation: z.enum([
        "cutting_laser", "cutting_plasma", "bending",
        "welding_mig", "welding_tig", "grinding",
        "drilling", "painting", "assembly",
        "quality_control", "packaging",
      ]).optional(),
      sequence: z.number().optional(),
      description: z.string().optional(),
      estimatedTime: z.string().optional(),
      actualTime: z.string().optional(),
      estimatedQty: z.string().optional(),
      actualQty: z.string().optional(),
      qtyUnit: z.string().optional(),
      status: z.enum(["pending", "in_progress", "completed", "skipped"]).optional(),
      operator: z.string().optional(),
      costRate: z.string().optional(),
      costAmount: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(workOrderOperations).set(data).where(eq(workOrderOperations.id, id));
      return { success: true };
    }),

  operationDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(workOrderOperations).where(eq(workOrderOperations.id, input.id));
      return { success: true };
    }),

  // === UPDATE WO COST ===

  // Точка 6: синџир нарачка → работен налог
  orderFromChain: publicQuery
    .input(z.object({ orderId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { orders } = await import("@db/schema");
      const ord = await db.select().from(orders).where(eq(orders.id, input.orderId));
      if (!ord[0]) throw new Error("Нарачката не постои");
      if (ord[0].status !== "confirmed") throw new Error("Налог се креира само од ПОТВРДЕНА нарачка — прво потврди ја нарачката");
      const existing = await db.select().from(workOrders).where(eq(workOrders.orderId, input.orderId));
      if (existing.length > 0) throw new Error(`За оваа нарачка веќе постои налог ${existing[0].woNumber}`);
      const { getNextDocNumber } = await import("./counters-helper");
      const woNumber = await getNextDocNumber("workOrder");
      await db.insert(workOrders).values({
        woNumber,
        orderId: input.orderId,
        description: `Налог за нарачка ${ord[0].orderNumber}`,
        status: "pending",
        priority: ord[0].priority ?? "normal",
      });
      await db.update(orders).set({ status: "in_production" }).where(eq(orders.id, input.orderId));
      return { success: true, woNumber };
    }),

  // Точка 6: синџир работен налог → фактура (ставка од описот и трошокот)
  workOrderToInvoice: publicQuery
    .input(z.object({ workOrderId: z.number(), marginPercent: z.number().default(30) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { orders, invoices, documentItems } = await import("@db/schema");
      const wo = await db.select().from(workOrders).where(eq(workOrders.id, input.workOrderId));
      if (!wo[0]) throw new Error("Налогот не постои");
      let customerId: number | null = null;
      if (wo[0].orderId) {
        const ord = await db.select().from(orders).where(eq(orders.id, wo[0].orderId));
        customerId = ord[0]?.customerId ?? null;
      }
      if (!customerId) throw new Error("Налогот нема поврзана нарачка со клиент — креирај фактура рачно");
      const { getNextDocNumber } = await import("./counters-helper");
      const invoiceNumber = await getNextDocNumber("invoice");
      const cost = Number(wo[0].costAmount ?? 0);
      const price = Math.round(cost * (1 + input.marginPercent / 100) * 100) / 100;
      const vat = Math.round(price * 0.18 * 100) / 100;
      const today = new Date().toISOString().slice(0, 10);
      const due = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
      const res = await db.insert(invoices).values({
        invoiceNumber, customerId, workOrderId: input.workOrderId,
        issueDate: today, dueDate: due, status: "draft",
        subtotal: String(price), vatRate: "18", vatAmount: String(vat),
        totalAmount: String(Math.round((price + vat) * 100) / 100), currency: "MKD",
      });
      const invId = Number((res as any)[0]?.insertId ?? 0);
      if (invId) {
        await db.insert(documentItems).values({
          documentId: invId, documentType: "invoice",
          description: wo[0].description ?? `Работен налог ${wo[0].woNumber}`,
          quantity: "1", unit: "pcs", unitPrice: String(price), totalPrice: String(price),
          vatRate: "18", itemType: "service", sortOrder: 0,
        });
      }
      return { success: true, invoiceNumber, id: invId };
    }),

  workOrderUpdateCost: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const ops = await db.select().from(workOrderOperations).where(eq(workOrderOperations.workOrderId, input.id));
      const mats = await db.select().from(workOrderMaterials).where(eq(workOrderMaterials.workOrderId, input.id));

      const opCost = ops.reduce((s, o) => s + parseFloat(o.costAmount ?? "0"), 0);
      const matCost = mats.reduce((s, m) => s + parseFloat(m.totalCost ?? "0"), 0);
      const totalCost = opCost + matCost;

      await db.update(workOrders).set({ costAmount: totalCost.toFixed(2) }).where(eq(workOrders.id, input.id));
      return { success: true, totalCost: totalCost.toFixed(2) };
    }),

  // === STATS ===
  productionStats: publicQuery.query(async () => {
    const db = getDb();
    const allWO = await db.select().from(workOrders);
    const total = allWO.length;
    const pending = allWO.filter(w => w.status === "pending").length;
    const inProgress = allWO.filter(w => w.status === "in_progress").length;
    const completed = allWO.filter(w => w.status === "completed").length;
    const onHold = allWO.filter(w => w.status === "on_hold").length;
    const totalCost = allWO.reduce((s, w) => s + parseFloat(w.costAmount ?? "0"), 0);
    return { total, pending, inProgress, completed, onHold, totalCost: totalCost.toFixed(2) };
  }),
});
