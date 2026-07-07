import { z } from "zod";
import { eq, desc, like } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { suppliers, purchaseOrders, purchaseOrderItems, materials } from "@db/schema";

export const procurementRouter = createRouter({
  // === SUPPLIERS ===
  supplierList: publicQuery
    .input(
      z.object({
        search: z.string().optional(),
        status: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      let query = db.select().from(suppliers);

      if (input?.search) {
        query = query.where(like(suppliers.name, `%${input.search}%`)) as typeof query;
      }
      if (input?.status) {
        query = query.where(eq(suppliers.isActive, input.status as any)) as typeof query;
      }

      return await query.orderBy(desc(suppliers.createdAt));
    }),

  supplierById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db.select().from(suppliers).where(eq(suppliers.id, input.id));
      return result[0] ?? null;
    }),

  supplierCreate: publicQuery
    .input(
      z.object({
        name: z.string().min(1),
        contactPerson: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        country: z.string().optional(),
        materials: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(suppliers).values(input);
      return { success: true };
    }),

  supplierUpdate: publicQuery
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        contactPerson: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        country: z.string().optional(),
        materials: z.string().optional(),
        isActive: z.enum(["active", "inactive"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(suppliers).set(data).where(eq(suppliers.id, id));
      return { success: true };
    }),

  supplierDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(suppliers).where(eq(suppliers.id, input.id));
      return { success: true };
    }),

  // === PURCHASE ORDERS ===
  poList: publicQuery
    .input(
      z.object({
        status: z.string().optional(),
        supplierId: z.number().optional(),
        search: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = getDb();

      const result = await db
        .select({
          id: purchaseOrders.id,
          poNumber: purchaseOrders.poNumber,
          supplierId: purchaseOrders.supplierId,
          status: purchaseOrders.status,
          totalAmount: purchaseOrders.totalAmount,
          expectedDate: purchaseOrders.expectedDate,
          notes: purchaseOrders.notes,
          createdBy: purchaseOrders.createdBy,
          createdAt: purchaseOrders.createdAt,
          updatedAt: purchaseOrders.updatedAt,
          supplierName: suppliers.name,
        })
        .from(purchaseOrders)
        .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
        .orderBy(desc(purchaseOrders.createdAt));

      let filtered = result;

      if (input?.status) {
        filtered = filtered.filter((r) => r.status === input.status);
      }
      if (input?.supplierId) {
        filtered = filtered.filter((r) => r.supplierId === input.supplierId);
      }
      if (input?.search) {
        const s = input.search.toLowerCase();
        filtered = filtered.filter(
          (r) =>
            r.poNumber.toLowerCase().includes(s) ||
            r.supplierName?.toLowerCase().includes(s)
        );
      }
      return filtered;
    }),

  poById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const po = await db
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, input.id));
      if (!po[0]) return null;

      const items = await db
        .select({
          id: purchaseOrderItems.id,
          purchaseOrderId: purchaseOrderItems.purchaseOrderId,
          materialId: purchaseOrderItems.materialId,
          description: purchaseOrderItems.description,
          quantity: purchaseOrderItems.quantity,
          unitPrice: purchaseOrderItems.unitPrice,
          totalPrice: purchaseOrderItems.totalPrice,
          receivedQuantity: purchaseOrderItems.receivedQuantity,
          notes: purchaseOrderItems.notes,
          materialName: materials.name,
          materialCode: materials.code,
          materialUnit: materials.unit,
        })
        .from(purchaseOrderItems)
        .leftJoin(materials, eq(purchaseOrderItems.materialId, materials.id))
        .where(eq(purchaseOrderItems.purchaseOrderId, input.id));

      const sup = await db
        .select()
        .from(suppliers)
        .where(eq(suppliers.id, po[0].supplierId));

      return { ...po[0], items, supplier: sup[0] ?? null };
    }),

  poCreate: publicQuery
    .input(
      z.object({
        poNumber: z.string().min(1),
        supplierId: z.number(),
        status: z.enum(["draft", "sent", "confirmed", "received", "cancelled"]).default("draft"),
        expectedDate: z.string().optional(),
        notes: z.string().optional(),
        items: z.array(
          z.object({
            materialId: z.number(),
            description: z.string().min(1),
            quantity: z.string(),
            unitPrice: z.string(),
            totalPrice: z.string(),
            notes: z.string().optional(),
          })
        ).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { items, ...poData } = input;
      const insertData: any = { ...poData };
      if (poData.expectedDate) insertData.expectedDate = new Date(poData.expectedDate);

      const result = await db.insert(purchaseOrders).values(insertData);
      const insertId = Number(result[0].insertId);

      if (items && items.length > 0) {
        await db.insert(purchaseOrderItems).values(
          items.map((item) => ({ ...item, purchaseOrderId: insertId }))
        );

        const total = items.reduce((sum, i) => sum + parseFloat(i.totalPrice), 0);
        await db
          .update(purchaseOrders)
          .set({ totalAmount: total.toFixed(2) })
          .where(eq(purchaseOrders.id, insertId));
      }

      return { success: true, id: insertId };
    }),

  poUpdate: publicQuery
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["draft", "sent", "confirmed", "received", "cancelled"]).optional(),
        expectedDate: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      const updateData: any = { ...data };
      if (data.expectedDate) {
        updateData.expectedDate = new Date(data.expectedDate);
      }
      await db.update(purchaseOrders).set(updateData).where(eq(purchaseOrders.id, id));

      // If received, update inventory
      if (data.status === "received") {
        const items = await db
          .select()
          .from(purchaseOrderItems)
          .where(eq(purchaseOrderItems.purchaseOrderId, id));

        for (const item of items) {
          const remaining = parseFloat(item.quantity) - parseFloat(item.receivedQuantity);
          if (remaining > 0) {
            await db
              .update(purchaseOrderItems)
              .set({ receivedQuantity: item.quantity })
              .where(eq(purchaseOrderItems.id, item.id));

            const mat = await db
              .select()
              .from(materials)
              .where(eq(materials.id, item.materialId));
            if (mat[0]) {
              const newStock = (parseFloat(mat[0].currentStock) + remaining).toFixed(3);
              await db
                .update(materials)
                .set({ currentStock: newStock })
                .where(eq(materials.id, item.materialId));
            }
          }
        }
      }

      return { success: true };
    }),

  poDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, input.id));
      await db.delete(purchaseOrders).where(eq(purchaseOrders.id, input.id));
      return { success: true };
    }),

  // === PO ITEMS ===
  poItemCreate: publicQuery
    .input(
      z.object({
        purchaseOrderId: z.number(),
        materialId: z.number(),
        description: z.string().min(1),
        quantity: z.string(),
        unitPrice: z.string(),
        totalPrice: z.string(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(purchaseOrderItems).values(input);
      return { success: true };
    }),

  poItemDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(purchaseOrderItems).where(eq(purchaseOrderItems.id, input.id));
      return { success: true };
    }),
});
