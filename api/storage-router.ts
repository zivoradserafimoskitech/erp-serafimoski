import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
// PostgreSQL compat
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  materials, materialStock, materialLots,
  inventoryTransactions, warehouses,
} from "@db/schema";
import { logAudit } from "./audit-helper";

export const storageRouter = createRouter({
  // === MATERIALS ===
  materialList: publicQuery
    .input(z.object({
      search: z.string().optional(),
      type: z.string().optional(),
      lowStock: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      let query = db.select().from(materials).where(eq(materials.isActive, "active"));

      const all = await query.orderBy(desc(materials.updatedAt));

      // Единствена вистина за залиха: сума по магацини (material_stock);
      // materials.currentStock е fallback за материјали без магацински записи.
      const { materialStock } = await import("@db/schema");
      const { sql } = await import("drizzle-orm");
      const sums = await db
        .select({ materialId: materialStock.materialId, total: sql<string>`SUM(${materialStock.quantity})` })
        .from(materialStock)
        .groupBy(materialStock.materialId);
      const sumMap = new Map(sums.map((r: any) => [r.materialId, r.total]));
      const withStock = all.map((m: any) => ({
        ...m,
        currentStock: sumMap.has(m.id) ? sumMap.get(m.id) : m.currentStock,
      }));

      let result = withStock;
      if (input?.search) {
        const s = input.search.toLowerCase();
        result = result.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s));
      }
      if (input?.type) result = result.filter(r => r.type === input.type);
      if (input?.lowStock) {
        result = result.filter(m => parseFloat(m.currentStock) <= parseFloat(m.minStock));
      }
      return result;
    }),

  materialById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db.select().from(materials).where(eq(materials.id, input.id));
      if (!result[0]) return null;
      // Get stock by warehouse
      const stock = await db.select()
        .from(materialStock)
        .where(eq(materialStock.materialId, input.id));
      const wh = await db.select().from(warehouses);
      const stockWithNames = stock.map(s => ({
        ...s,
        warehouseName: wh.find(w => w.id === s.warehouseId)?.name ?? "",
      }));
      return { ...result[0], stockByWarehouse: stockWithNames };
    }),

  materialCreate: publicQuery
    .input(z.object({
      name: z.string().min(1),
      code: z.string().min(1),
      type: z.enum([
        "steel_sheet", "steel_profile", "steel_bar", "aluminum_sheet",
        "aluminum_profile", "stainless_sheet", "pipe", "angle",
        "channel", "screws", "welding", "paint", "other",
      ]),
      unit: z.enum(["kg", "m", "m2", "pcs", "l", "sheet", "hour", "m_cut", "bend"]),
      description: z.string().optional(),
      minStock: z.string().default("0"),
      currentStock: z.string().default("0"),
      avgCost: z.string().default("0"),
      lastPurchasePrice: z.string().default("0"),
      location: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const result = await db.insert(materials).values(input);
      const insertId = Number(result[0].insertId);
      await logAudit({ action: "CREATE", entityType: "material", entityId: insertId, description: `Креиран материјал ${input.name}` });
      return { success: true, id: insertId };
    }),

  materialUpdate: publicQuery
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      code: z.string().min(1).optional(),
      type: z.enum([
        "steel_sheet", "steel_profile", "steel_bar", "aluminum_sheet",
        "aluminum_profile", "stainless_sheet", "pipe", "angle",
        "channel", "screws", "welding", "paint", "other",
      ]).optional(),
      unit: z.enum(["kg", "m", "m2", "pcs", "l", "sheet", "hour", "m_cut", "bend"]).optional(),
      description: z.string().optional(),
      minStock: z.string().optional(),
      location: z.string().optional(),
      isActive: z.enum(["active", "inactive"]).optional(),
    }))
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

  // === WEIGHTED AVERAGE RECEIPT PROCESSING ===
  processReceipt: publicQuery
    .input(z.object({
      receiptId: z.number(),
      warehouseId: z.number(),
      items: z.array(z.object({
        materialId: z.number(),
        quantity: z.string(),
        unitPrice: z.string(),
        totalPrice: z.string(),
        landedCostAlloc: z.string().default("0"),
      })),
      transportCost: z.string().default("0"),
      customsCost: z.string().default("0"),
      otherCost: z.string().default("0"),
      userId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { receiptId, warehouseId, items, transportCost, customsCost, otherCost, userId } = input;

      // Total additional costs
      const totalExtra = parseFloat(transportCost) + parseFloat(customsCost) + parseFloat(otherCost);
      const totalItemsValue = items.reduce((s, i) => s + parseFloat(i.totalPrice), 0);

      for (const item of items) {
        const qty = parseFloat(item.quantity);
        const unitPrice = parseFloat(item.unitPrice);

        // Proportional landed cost allocation
        const landedAlloc = totalItemsValue > 0
          ? (parseFloat(item.totalPrice) / totalItemsValue) * totalExtra
          : 0;
        const totalUnitCost = qty > 0 ? (qty * unitPrice + landedAlloc) / qty : unitPrice;

        // Get current stock
        const currentStock = await db.select()
          .from(materialStock)
          .where(and(
            eq(materialStock.materialId, item.materialId),
            eq(materialStock.warehouseId, warehouseId)
          ));

        // Get material for global avg
        const mat = await db.select().from(materials).where(eq(materials.id, item.materialId));
        if (!mat[0]) continue;

        if (currentStock[0]) {
          const oldQty = parseFloat(currentStock[0].quantity);
          const oldAvg = parseFloat(currentStock[0].avgCost);
          const newQty = oldQty + qty;
          // Weighted average: (oldQty*oldAvg + qty*totalUnitCost) / newQty
          const newAvg = newQty > 0 ? (oldQty * oldAvg + qty * totalUnitCost) / newQty : oldAvg;

          await db.update(materialStock)
            .set({ quantity: newQty.toFixed(3), avgCost: newAvg.toFixed(2) })
            .where(eq(materialStock.id, currentStock[0].id));
        } else {
          await db.insert(materialStock).values({
            materialId: item.materialId,
            warehouseId,
            quantity: qty.toFixed(3),
            avgCost: totalUnitCost.toFixed(2),
          } as any);
        }

        // Update global material stock and avgCost
        const globalQty = parseFloat(mat[0].currentStock);
        const globalAvg = parseFloat(mat[0].avgCost);
        const newGlobalQty = globalQty + qty;
        const newGlobalAvg = newGlobalQty > 0
          ? (globalQty * globalAvg + qty * totalUnitCost) / newGlobalQty
          : totalUnitCost;

        await db.update(materials)
          .set({
            currentStock: newGlobalQty.toFixed(3),
            avgCost: newGlobalAvg.toFixed(2),
            lastPurchasePrice: unitPrice.toFixed(2),
          })
          .where(eq(materials.id, item.materialId));

        // Create lot for FIFO option
        await db.insert(materialLots).values({
          materialId: item.materialId,
          warehouseId,
          receiptId,
          quantity: qty.toFixed(3),
          remainingQty: qty.toFixed(3),
          unitCost: unitPrice.toFixed(2),
          landedCost: landedAlloc.toFixed(2),
          date: new Date(),
        } as any);

        // Log transaction
        await db.insert(inventoryTransactions).values({
          materialId: item.materialId,
          warehouseId,
          type: "receipt",
          quantity: qty.toFixed(3),
          unitCost: totalUnitCost.toFixed(2),
          totalCost: (qty * totalUnitCost).toFixed(2),
          sourceDocType: "receipt",
          sourceDocId: receiptId,
          notes: `Приемница со просечна цена ${newGlobalAvg.toFixed(2)}`,
          createdBy: userId ?? null,
        } as any);
      }

      await logAudit({ action: "CONFIRM", entityType: "receipt", entityId: receiptId, description: `Потврдена приемница со просечна вреднување` });
      return { success: true };
    }),

  // === ISSUE MATERIAL (for work orders) ===
  issueMaterial: publicQuery
    .input(z.object({
      materialId: z.number(),
      warehouseId: z.number(),
      quantity: z.string(),
      sourceDocType: z.string(),
      sourceDocId: z.number(),
      reference: z.string().optional(),
      userId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { materialId, warehouseId, quantity, sourceDocType, sourceDocId, reference, userId } = input;
      const qty = parseFloat(quantity);

      // Check stock
      const stock = await db.select().from(materialStock)
        .where(and(eq(materialStock.materialId, materialId), eq(materialStock.warehouseId, warehouseId)));

      if (!stock[0] || parseFloat(stock[0].quantity) < qty) {
        throw new Error("Нема доволно залиха во магацинот");
      }

      const unitCost = stock[0].avgCost;
      const newQty = parseFloat(stock[0].quantity) - qty;

      await db.update(materialStock)
        .set({ quantity: newQty.toFixed(3) })
        .where(eq(materialStock.id, stock[0].id));

      // Update global stock
      const mat = await db.select().from(materials).where(eq(materials.id, materialId));
      if (mat[0]) {
        await db.update(materials)
          .set({ currentStock: (parseFloat(mat[0].currentStock) - qty).toFixed(3) })
          .where(eq(materials.id, materialId));
      }

      // Log issue
      await db.insert(inventoryTransactions).values({
        materialId,
        warehouseId,
        type: "issue",
        quantity: qty.toFixed(3),
        unitCost,
        totalCost: (qty * parseFloat(unitCost)).toFixed(2),
        sourceDocType,
        sourceDocId,
        reference,
        notes: `Испорака за ${sourceDocType} #${sourceDocId}`,
        createdBy: userId ?? null,
      } as any);

      return { success: true, unitCost, totalCost: (qty * parseFloat(unitCost)).toFixed(2) };
    }),

  // === INVENTORY TRANSACTIONS ===
  transactionList: publicQuery
    .input(z.object({ materialId: z.number().optional(), type: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      let query = db
        .select({
          id: inventoryTransactions.id,
          materialId: inventoryTransactions.materialId,
          warehouseId: inventoryTransactions.warehouseId,
          type: inventoryTransactions.type,
          quantity: inventoryTransactions.quantity,
          unitCost: inventoryTransactions.unitCost,
          totalCost: inventoryTransactions.totalCost,
          reference: inventoryTransactions.reference,
          sourceDocType: inventoryTransactions.sourceDocType,
          sourceDocId: inventoryTransactions.sourceDocId,
          notes: inventoryTransactions.notes,
          createdBy: inventoryTransactions.createdBy,
          createdAt: inventoryTransactions.createdAt,
          materialName: materials.name,
          materialCode: materials.code,
        })
        .from(inventoryTransactions)
        .leftJoin(materials, eq(inventoryTransactions.materialId, materials.id));

      const result = await query.orderBy(desc(inventoryTransactions.createdAt));
      let filtered = result;
      if (input?.materialId) filtered = filtered.filter(r => r.materialId === input.materialId);
      if (input?.type) filtered = filtered.filter(r => r.type === input.type);
      return filtered;
    }),

  // === MANUAL TRANSACTION (for adjustments etc) ===
  transactionCreate: publicQuery
    .input(z.object({
      materialId: z.number(),
      warehouseId: z.number().default(1),
      type: z.enum(["receipt", "issue", "adjustment", "return", "scrap"]),
      quantity: z.string(),
      unitPrice: z.string().optional(),
      totalPrice: z.string().optional(),
      reference: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { warehouseId, ...txData } = input;

      await db.insert(inventoryTransactions).values({ ...txData, warehouseId } as any);

      // Update material stock
      const mat = await db.select().from(materials).where(eq(materials.id, input.materialId));
      if (mat[0]) {
        const current = parseFloat(mat[0].currentStock);
        const qty = parseFloat(input.quantity);
        let newStock = current;
        if (input.type === "receipt" || input.type === "return") newStock = current + qty;
        else if (input.type === "issue" || input.type === "scrap") newStock = current - qty;
        else if (input.type === "adjustment") newStock = qty;
        await db.update(materials).set({ currentStock: newStock.toFixed(3) }).where(eq(materials.id, input.materialId));
      }
      return { success: true };
    }),

  // === DASHBOARD STATS ===
  storageStats: publicQuery.query(async () => {
    const db = getDb();
    const allMaterials = await db.select().from(materials).where(eq(materials.isActive, "active"));
    const totalItems = allMaterials.length;
    const lowStockItems = allMaterials.filter(m => parseFloat(m.currentStock) <= parseFloat(m.minStock)).length;
    const totalValue = allMaterials.reduce((sum, m) => sum + parseFloat(m.currentStock) * parseFloat(m.avgCost), 0);

    return { totalItems, lowStockItems, totalValue: totalValue.toFixed(2) };
  }),

  // === MATERIAL LOTS (FIFO) ===
  lotList: publicQuery
    .input(z.object({ materialId: z.number().optional(), warehouseId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      let query = db.select().from(materialLots).orderBy(materialLots.date);
      const result = await query;
      let filtered = result.filter(r => parseFloat(r.remainingQty) > 0);
      if (input?.materialId) filtered = filtered.filter(r => r.materialId === input.materialId);
      if (input?.warehouseId) filtered = filtered.filter(r => r.warehouseId === input.warehouseId);
      return filtered;
    }),
});
