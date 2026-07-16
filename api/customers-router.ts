import { z } from "zod";
import { eq, desc, like } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { customers, orders, orderItems } from "@db/schema";

export const customersRouter = createRouter({
  // === CUSTOMERS ===
  customerList: publicQuery
    .input(
      z.object({
        search: z.string().optional(),
        status: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      let query = db.select().from(customers);

      if (input?.search) {
        query = query.where(like(customers.name, `%${input.search}%`)) as typeof query;
      }
      if (input?.status) {
        query = query.where(eq(customers.isActive, input.status as any)) as typeof query;
      }

      return await query.orderBy(desc(customers.createdAt));
    }),

  customerById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db.select().from(customers).where(eq(customers.id, input.id));
      return result[0] ?? null;
    }),

  customerCreate: publicQuery
    .input(
      z.object({
        name: z.string().min(1),
        company: z.string().optional(),
        contactPerson: z.string().optional(),
        email: z.preprocess((v) => (v === "" ? undefined : v), z.preprocess((v) => (v === "" ? undefined : v), z.string().email().optional())),
        phone: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        country: z.string().optional(),
        taxNumber: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const result = await db.insert(customers).values(input);
      return result;
    }),

  customerUpdate: publicQuery
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        company: z.string().optional(),
        contactPerson: z.string().optional(),
        email: z.preprocess((v) => (v === "" ? undefined : v), z.preprocess((v) => (v === "" ? undefined : v), z.string().email().optional())),
        phone: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        country: z.string().optional(),
        taxNumber: z.string().optional(),
        notes: z.string().optional(),
        isActive: z.enum(["active", "inactive"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(customers).set(data).where(eq(customers.id, id));
      return { success: true };
    }),

  customerDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(customers).where(eq(customers.id, input.id));
      return { success: true };
    }),

  // === ORDERS ===
  orderList: publicQuery
    .input(
      z.object({
        status: z.string().optional(),
        customerId: z.number().optional(),
        search: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = getDb();

      const result = await db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          customerId: orders.customerId,
          status: orders.status,
          priority: orders.priority,
          totalAmount: orders.totalAmount,
          deliveryDate: orders.deliveryDate,
          notes: orders.notes,
          createdBy: orders.createdBy,
          createdAt: orders.createdAt,
          updatedAt: orders.updatedAt,
          customerName: customers.name,
          customerCompany: customers.company,
        })
        .from(orders)
        .leftJoin(customers, eq(orders.customerId, customers.id))
        .orderBy(desc(orders.createdAt));

      let filtered = result;

      if (input?.status) {
        filtered = filtered.filter((r) => r.status === input.status);
      }
      if (input?.customerId) {
        filtered = filtered.filter((r) => r.customerId === input.customerId);
      }
      if (input?.search) {
        const s = input.search.toLowerCase();
        filtered = filtered.filter(
          (r) =>
            r.orderNumber.toLowerCase().includes(s) ||
            r.customerName?.toLowerCase().includes(s)
        );
      }
      return filtered;
    }),

  orderById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const ord = await db.select().from(orders).where(eq(orders.id, input.id));
      if (!ord[0]) return null;

      const items = await db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, input.id));

      const cust = await db
        .select()
        .from(customers)
        .where(eq(customers.id, ord[0].customerId));

      return { ...ord[0], items, customer: cust[0] ?? null };
    }),

  orderCreate: publicQuery
    .input(
      z.object({
        orderNumber: z.string().min(1),
        customerId: z.number(),
        status: z.enum(["pending", "confirmed", "in_production", "ready", "delivered", "cancelled"]).default("pending"),
        priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
        deliveryDate: z.string().optional(),
        notes: z.string().optional(),
        items: z.array(
          z.object({
            description: z.string().min(1),
            drawingNumber: z.string().optional(),
            quantity: z.number().min(1),
            unitPrice: z.string(),
            totalPrice: z.string(),
            material: z.string().optional(),
            dimensions: z.string().optional(),
            notes: z.string().optional(),
          })
        ).optional(),
      })
    )
    .mutation(async ({ input }) => {
      {
        const { bumpDocCounter } = await import("./counters-helper");
        await bumpDocCounter("order", input.orderNumber).catch(() => {});
      }
      const db = getDb();
      const { items, ...orderData } = input;

      const insertData = {
        ...orderData,
        deliveryDate: orderData.deliveryDate ? new Date(orderData.deliveryDate) : null,
      };
      const result = await db.insert(orders).values(insertData as any);
      const insertId = Number(result[0].insertId);

      if (items && items.length > 0) {
        await db.insert(orderItems).values(
          items.map((item) => ({ ...item, orderId: insertId }))
        );

        // Update total amount
        const total = items.reduce((sum, i) => sum + parseFloat(i.totalPrice), 0);
        await db
          .update(orders)
          .set({ totalAmount: total.toFixed(2) })
          .where(eq(orders.id, insertId));
      }

      return { success: true, id: insertId };
    }),

  orderUpdate: publicQuery
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["pending", "confirmed", "in_production", "ready", "delivered", "cancelled"]).optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        deliveryDate: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      const updateData: any = { ...data };
      if (data.deliveryDate) {
        updateData.deliveryDate = new Date(data.deliveryDate);
      }
      await db.update(orders).set(updateData).where(eq(orders.id, id));
      return { success: true };
    }),

  orderDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(orderItems).where(eq(orderItems.orderId, input.id));
      await db.delete(orders).where(eq(orders.id, input.id));
      return { success: true };
    }),

  orderItemCreate: publicQuery
    .input(
      z.object({
        orderId: z.number(),
        description: z.string().min(1),
        drawingNumber: z.string().optional(),
        quantity: z.number().min(1),
        unitPrice: z.string(),
        totalPrice: z.string(),
        material: z.string().optional(),
        dimensions: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(orderItems).values(input);
      return { success: true };
    }),

  orderItemDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(orderItems).where(eq(orderItems.id, input.id));
      return { success: true };
    }),
});
