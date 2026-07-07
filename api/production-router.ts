import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { workOrders, workOrderOperations, orders } from "@db/schema";

export const productionRouter = createRouter({
  // === WORK ORDERS ===
  workOrderList: publicQuery
    .input(
      z.object({
        status: z.string().optional(),
        priority: z.string().optional(),
        search: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = getDb();

      const result = await db
        .select({
          id: workOrders.id,
          woNumber: workOrders.woNumber,
          orderId: workOrders.orderId,
          description: workOrders.description,
          status: workOrders.status,
          priority: workOrders.priority,
          plannedStart: workOrders.plannedStart,
          plannedEnd: workOrders.plannedEnd,
          actualStart: workOrders.actualStart,
          actualEnd: workOrders.actualEnd,
          assignedTo: workOrders.assignedTo,
          notes: workOrders.notes,
          createdBy: workOrders.createdBy,
          createdAt: workOrders.createdAt,
          updatedAt: workOrders.updatedAt,
          orderNumber: orders.orderNumber,
        })
        .from(workOrders)
        .leftJoin(orders, eq(workOrders.orderId, orders.id))
        .orderBy(desc(workOrders.createdAt));

      if (input?.status) {
        return result.filter((r) => r.status === input.status);
      }
      if (input?.priority) {
        return result.filter((r) => r.priority === input.priority);
      }
      if (input?.search) {
        return result.filter(
          (r) =>
            r.woNumber.toLowerCase().includes(input.search!.toLowerCase()) ||
            r.description.toLowerCase().includes(input.search!.toLowerCase())
        );
      }
      return result;
    }),

  workOrderById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const wo = await db
        .select()
        .from(workOrders)
        .where(eq(workOrders.id, input.id));

      if (!wo[0]) return null;

      const ops = await db
        .select()
        .from(workOrderOperations)
        .where(eq(workOrderOperations.workOrderId, input.id))
        .orderBy(workOrderOperations.sequence);

      return { ...wo[0], operations: ops };
    }),

  workOrderCreate: publicQuery
    .input(
      z.object({
        woNumber: z.string().min(1),
        orderId: z.number().optional(),
        description: z.string().min(1),
        status: z.enum(["pending", "in_progress", "on_hold", "completed", "cancelled"]).default("pending"),
        priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
        plannedStart: z.string().optional(),
        plannedEnd: z.string().optional(),
        assignedTo: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { orderId, ...rest } = input;
      const insertData: any = {
        ...rest,
        orderId: orderId ?? null,
      };
      if (rest.plannedStart) insertData.plannedStart = new Date(rest.plannedStart);
      if (rest.plannedEnd) insertData.plannedEnd = new Date(rest.plannedEnd);
      const result = await db.insert(workOrders).values(insertData);
      return result;
    }),

  workOrderUpdate: publicQuery
    .input(
      z.object({
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
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      const updateData: any = { ...data };

      if (data.plannedStart) updateData.plannedStart = new Date(data.plannedStart);
      if (data.plannedEnd) updateData.plannedEnd = new Date(data.plannedEnd);
      if (data.actualStart) updateData.actualStart = new Date(data.actualStart);
      if (data.actualEnd) updateData.actualEnd = new Date(data.actualEnd);

      // Auto-set actual dates on status change
      if (data.status === "in_progress" && !data.actualStart) {
        updateData.actualStart = new Date();
      }
      if (data.status === "completed" && !data.actualEnd) {
        updateData.actualEnd = new Date();
      }

      await db.update(workOrders).set(updateData).where(eq(workOrders.id, id));
      return { success: true };
    }),

  workOrderDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      // Delete operations first
      await db.delete(workOrderOperations).where(eq(workOrderOperations.workOrderId, input.id));
      await db.delete(workOrders).where(eq(workOrders.id, input.id));
      return { success: true };
    }),

  // === WORK ORDER OPERATIONS ===
  operationCreate: publicQuery
    .input(
      z.object({
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
        operator: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(workOrderOperations).values(input);
      return { success: true };
    }),

  operationUpdate: publicQuery
    .input(
      z.object({
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
        status: z.enum(["pending", "in_progress", "completed", "skipped"]).optional(),
        operator: z.string().optional(),
      })
    )
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

  // === STATS ===
  productionStats: publicQuery.query(async () => {
    const db = getDb();
    const allWO = await db.select().from(workOrders);

    const total = allWO.length;
    const pending = allWO.filter((w) => w.status === "pending").length;
    const inProgress = allWO.filter((w) => w.status === "in_progress").length;
    const completed = allWO.filter((w) => w.status === "completed").length;
    const onHold = allWO.filter((w) => w.status === "on_hold").length;

    return { total, pending, inProgress, completed, onHold };
  }),
});
