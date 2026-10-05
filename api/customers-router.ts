import { z } from "zod";
import { eq, desc, like } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { listLimit } from "./list-limit";
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
        // празно = избриши го е-маилот
        email: z.union([z.literal(""), z.string().email()]).optional(),
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
      const { id, ...rest } = input;
      const data: any = { ...rest, updatedAt: new Date() };
      if (rest.email === "") data.email = null;
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
      z.object({ limit: z.number().int().min(1).optional(),
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
        .orderBy(desc(orders.createdAt)).limit(listLimit(input as any));

      let filtered = result;

      if (input?.status) {
        filtered = filtered.filter((r: any) => r.status === input.status);
      }
      if (input?.customerId) {
        filtered = filtered.filter((r: any) => r.customerId === input.customerId);
      }
      if (input?.search) {
        const s = input.search.toLowerCase();
        filtered = filtered.filter(
          (r: any) =>
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
        salesperson: z.string().max(160).optional(),
        items: z.array(
          z.object({
            description: z.string().min(1),
            drawingNumber: z.string().optional(),
            quantity: z.number().positive(),
            unitPrice: z.string(),
            totalPrice: z.string(),
            material: z.string().optional(),
            dimensions: z.string().optional(),
            notes: z.string().optional(),
            productId: z.number().optional(),
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
          items.map((item) => ({
            description: item.description,
            drawingNumber: item.drawingNumber,
            quantity: String(item.quantity),
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            material: item.material,
            dimensions: item.dimensions,
            notes: item.notes,
            productId: item.productId ?? null,
            orderId: insertId,
            reservedQty: "0",
            deliveredQty: "0",
          }))
        );

        const total = items.reduce((sum, i) => sum + parseFloat(i.totalPrice), 0);
        await db.update(orders).set({ totalAmount: total.toFixed(2) }).where(eq(orders.id, insertId));
      }

      const { reserveOrderItems } = await import("./fg-stock-helper");
      const strict = input.status === "confirmed";
      const res = await reserveOrderItems(insertId, { strict }).catch(async (e) => {
        // rollback soft: cancel order if strict reserve fails
        await db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, insertId));
        throw e;
      });

      return { success: true, id: insertId, warnings: res.warnings };
    }),

  orderUpdate: publicQuery
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["pending", "confirmed", "in_production", "ready", "delivered", "cancelled"]).optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        deliveryDate: z.string().optional(),
        notes: z.string().optional(),
        salesperson: z.string().max(160).optional().nullable(),
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
      const { reserveOrderItems, releaseOrderReservations } = await import("./fg-stock-helper");
      if (input.status === "cancelled") await releaseOrderReservations(id);
      else if (input.status === "confirmed" || input.status === "pending" || input.status === "in_production") {
        await reserveOrderItems(id, { strict: input.status === "confirmed" });
      }
      return { success: true };
    }),

  /** Ставки од нарачка со остаток за испорака (делумна DN / backorder). */
  orderOpenItems: publicQuery
    .input(z.object({ orderId: z.number() }))
    .query(async ({ input }) => {
      const { getPool } = await import("./queries/connection");
      const { remainingToDeliver, availableFgQty } = await import("./fg-stock-helper");
      const o = (await getPool().query(`SELECT id, order_number, customer_id, status, salesperson FROM orders WHERE id = $1`, [input.orderId])).rows[0];
      if (!o) throw new Error("Нарачката не постои");
      const items = (await getPool().query(
        `SELECT id, description, quantity, unit_price, total_price, product_id,
                COALESCE(delivered_qty,0) AS delivered_qty, COALESCE(reserved_qty,0) AS reserved_qty
         FROM order_items WHERE order_id = $1 ORDER BY id`, [input.orderId])).rows;
      const out = [];
      for (const it of items) {
        const ordered = Number(it.quantity);
        const delivered = Number(it.delivered_qty);
        const remaining = remainingToDeliver(ordered, delivered);
        let available: number | null = null;
        if (it.product_id) available = await availableFgQty(Number(it.product_id), input.orderId);
        out.push({
          id: it.id, description: it.description, quantity: ordered, deliveredQty: delivered, remaining,
          reservedQty: Number(it.reserved_qty), unitPrice: it.unit_price, totalPrice: it.total_price,
          productId: it.product_id ? Number(it.product_id) : null, available,
        });
      }
      return {
        orderId: o.id, orderNumber: o.order_number, customerId: o.customer_id, status: o.status,
        salesperson: o.salesperson, items: out,
        backorderItems: out.filter((i) => i.remaining > 0.0005),
      };
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
        quantity: z.number().positive(),
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
