import { z } from "zod";
import { eq, desc, like } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { materials, inventoryTransactions } from "@db/schema";

export const storageRouter = createRouter({
  // === MATERIALS ===
  materialList: publicQuery
    .input(
      z.object({
        search: z.string().optional(),
        type: z.string().optional(),
        lowStock: z.boolean().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      let query = db.select().from(materials);

      if (input?.search) {
        query = query.where(like(materials.name, `%${input.search}%`)) as typeof query;
      }
      if (input?.type) {
        query = query.where(eq(materials.type, input.type as any)) as typeof query;
      }

      const result = await query.orderBy(desc(materials.updatedAt));

      if (input?.lowStock) {
        return result.filter(
          (m) => parseFloat(m.currentStock) <= parseFloat(m.minStock)
        );
      }
      return result;
    }),

  materialById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db.select().from(materials).where(eq(materials.id, input.id));
      return result[0] ?? null;
    }),

  materialCreate: publicQuery
    .input(
      z.object({
        name: z.string().min(1),
        code: z.string().min(1),
        type: z.enum([
          "steel_sheet", "steel_profile", "steel_bar", "aluminum_sheet",
          "aluminum_profile", "stainless_sheet", "pipe", "angle",
          "channel", "screws", "welding", "paint", "other",
        ]),
        unit: z.enum(["kg", "m", "m2", "pcs", "l"]),
        description: z.string().optional(),
        minStock: z.string().default("0"),
        currentStock: z.string().default("0"),
        location: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const result = await db.insert(materials).values(input);
      return result;
    }),

  materialUpdate: publicQuery
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        code: z.string().min(1).optional(),
        type: z.enum([
          "steel_sheet", "steel_profile", "steel_bar", "aluminum_sheet",
          "aluminum_profile", "stainless_sheet", "pipe", "angle",
          "channel", "screws", "welding", "paint", "other",
        ]).optional(),
        unit: z.enum(["kg", "m", "m2", "pcs", "l"]).optional(),
        description: z.string().optional(),
        minStock: z.string().optional(),
        currentStock: z.string().optional(),
        location: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(materials).set(data).where(eq(materials.id, id));
      return { success: true };
    }),

  materialDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(materials).where(eq(materials.id, input.id));
      return { success: true };
    }),

  // === INVENTORY TRANSACTIONS ===
  transactionList: publicQuery
    .input(
      z.object({
        materialId: z.number().optional(),
        type: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      let query = db
        .select({
          id: inventoryTransactions.id,
          materialId: inventoryTransactions.materialId,
          type: inventoryTransactions.type,
          quantity: inventoryTransactions.quantity,
          unitPrice: inventoryTransactions.unitPrice,
          totalPrice: inventoryTransactions.totalPrice,
          reference: inventoryTransactions.reference,
          notes: inventoryTransactions.notes,
          createdBy: inventoryTransactions.createdBy,
          createdAt: inventoryTransactions.createdAt,
          materialName: materials.name,
          materialCode: materials.code,
        })
        .from(inventoryTransactions)
        .leftJoin(materials, eq(inventoryTransactions.materialId, materials.id));

      if (input?.materialId) {
        query = query.where(eq(inventoryTransactions.materialId, input.materialId)) as typeof query;
      }
      if (input?.type) {
        query = query.where(eq(inventoryTransactions.type, input.type as any)) as typeof query;
      }

      return await query.orderBy(desc(inventoryTransactions.createdAt));
    }),

  transactionCreate: publicQuery
    .input(
      z.object({
        materialId: z.number(),
        type: z.enum(["receipt", "issue", "adjustment", "return", "scrap"]),
        quantity: z.string(),
        unitPrice: z.string().optional(),
        totalPrice: z.string().optional(),
        reference: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      await db.insert(inventoryTransactions).values(input);

      // Update material stock
      const mat = await db.select().from(materials).where(eq(materials.id, input.materialId));
      if (mat[0]) {
        const current = parseFloat(mat[0].currentStock);
        const qty = parseFloat(input.quantity);
        let newStock = current;

        if (input.type === "receipt" || input.type === "return") {
          newStock = current + qty;
        } else if (input.type === "issue" || input.type === "scrap") {
          newStock = current - qty;
        } else if (input.type === "adjustment") {
          newStock = qty;
        }

        await db
          .update(materials)
          .set({ currentStock: newStock.toFixed(3) })
          .where(eq(materials.id, input.materialId));
      }

      return { success: true };
    }),

  // === DASHBOARD STATS ===
  storageStats: publicQuery.query(async () => {
    const db = getDb();
    const allMaterials = await db.select().from(materials);

    const totalItems = allMaterials.length;
    const lowStockItems = allMaterials.filter(
      (m) => parseFloat(m.currentStock) <= parseFloat(m.minStock)
    ).length;
    const totalValue = allMaterials.reduce(
      (sum, m) => sum + parseFloat(m.currentStock),
      0
    );

    return {
      totalItems,
      lowStockItems,
      totalValue,
    };
  }),
});
