import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  warehouses, materialStock, stockTransfers, stockTransferItems,
  inventoryCounts, inventoryCountItems, materials,
  inventoryTransactions,
} from "@db/schema";
import { logAudit } from "./audit-helper";

export const warehouseRouter = createRouter({
  // ===== WAREHOUSES =====
  warehouseList: publicQuery.query(async () => {
    const db = getDb();
    return await db.select().from(warehouses).orderBy(warehouses.name);
  }),

  warehouseCreate: publicQuery
    .input(z.object({
      code: z.string().min(1),
      name: z.string().min(1),
      type: z.enum(["raw_materials", "finished_goods", "construction_site", "other"]),
      address: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(warehouses).values(input as any);
      return { success: true };
    }),

  warehouseUpdate: publicQuery
    .input(z.object({
      id: z.number(),
      code: z.string().optional(),
      name: z.string().optional(),
      type: z.enum(["raw_materials", "finished_goods", "construction_site", "other"]).optional(),
      address: z.string().optional(),
      isActive: z.enum(["active", "inactive"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(warehouses).set(data).where(eq(warehouses.id, id));
      return { success: true };
    }),

  // ===== MATERIAL STOCK BY WAREHOUSE =====
  materialStockList: publicQuery
    .input(z.object({ warehouseId: z.number().optional(), materialId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      let query = db
        .select({
          id: materialStock.id,
          materialId: materialStock.materialId,
          warehouseId: materialStock.warehouseId,
          quantity: materialStock.quantity,
          avgCost: materialStock.avgCost,
          materialName: materials.name,
          materialCode: materials.code,
          materialUnit: materials.unit,
        })
        .from(materialStock)
        .leftJoin(materials, eq(materialStock.materialId, materials.id));

      const result = await query;
      let filtered = result;
      if (input?.warehouseId) filtered = filtered.filter(r => r.warehouseId === input.warehouseId);
      if (input?.materialId) filtered = filtered.filter(r => r.materialId === input.materialId);
      return filtered;
    }),

  // ===== STOCK TRANSFERS =====
  transferList: publicQuery
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db.select().from(stockTransfers).orderBy(desc(stockTransfers.createdAt));
      if (input?.status) return result.filter(r => r.status === input.status);
      return result;
    }),

  transferById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const t = await db.select().from(stockTransfers).where(eq(stockTransfers.id, input.id));
      if (!t[0]) return null;
      const items = await db.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, input.id));
      return { ...t[0], items };
    }),

  transferCreate: publicQuery
    .input(z.object({
      transferNumber: z.string().min(1),
      fromWarehouseId: z.number(),
      toWarehouseId: z.number(),
      status: z.enum(["draft", "confirmed", "cancelled"]).default("draft"),
      transferDate: z.string(),
      notes: z.string().optional(),
      items: z.array(z.object({
        materialId: z.number(),
        quantity: z.string(),
        unitCost: z.string().optional(),
        notes: z.string().optional(),
      })).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { items, ...data } = input;
      const result = await db.insert(stockTransfers).values({
        ...data,
        transferDate: new Date(data.transferDate),
      } as any);
      const insertId = Number(result[0].insertId);

      if (items && items.length > 0) {
        await db.insert(stockTransferItems).values(items.map(i => ({ ...i, transferId: insertId })));
      }
      return { success: true, id: insertId };
    }),

  transferConfirm: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const transfer = await db.select().from(stockTransfers).where(eq(stockTransfers.id, input.id));
      if (!transfer[0]) throw new Error("Преносот не постои");
      if (transfer[0].status !== "draft") throw new Error("Само нацрт може да се потврди");

      const items = await db.select().from(stockTransferItems).where(eq(stockTransferItems.transferId, input.id));

      for (const item of items) {
        // Deduct from source
        const fromStock = await db.select().from(materialStock)
          .where(and(
            eq(materialStock.materialId, item.materialId),
            eq(materialStock.warehouseId, transfer[0].fromWarehouseId)
          ));
        if (fromStock[0]) {
          const newQty = parseFloat(fromStock[0].quantity) - parseFloat(item.quantity);
          if (newQty < 0) throw new Error(`Нема доволно залиха за материјал ${item.materialId}`);
          await db.update(materialStock)
            .set({ quantity: newQty.toFixed(3) })
            .where(eq(materialStock.id, fromStock[0].id));
        }

        // Add to destination
        const toStock = await db.select().from(materialStock)
          .where(and(
            eq(materialStock.materialId, item.materialId),
            eq(materialStock.warehouseId, transfer[0].toWarehouseId)
          ));
        if (toStock[0]) {
          await db.update(materialStock)
            .set({ quantity: (parseFloat(toStock[0].quantity) + parseFloat(item.quantity)).toFixed(3) })
            .where(eq(materialStock.id, toStock[0].id));
        } else {
          await db.insert(materialStock).values({
            materialId: item.materialId,
            warehouseId: transfer[0].toWarehouseId,
            quantity: item.quantity,
            avgCost: item.unitCost ?? "0",
          } as any);
        }

        // Log transactions
        await db.insert(inventoryTransactions).values({
          materialId: item.materialId,
          warehouseId: transfer[0].fromWarehouseId,
          type: "transfer_out",
          quantity: item.quantity,
          unitCost: item.unitCost,
          totalCost: item.unitCost ? (parseFloat(item.unitCost) * parseFloat(item.quantity)).toFixed(2) : null,
          sourceDocType: "transfer",
          sourceDocId: input.id,
          reference: transfer[0].transferNumber,
        } as any);

        await db.insert(inventoryTransactions).values({
          materialId: item.materialId,
          warehouseId: transfer[0].toWarehouseId,
          type: "transfer_in",
          quantity: item.quantity,
          unitCost: item.unitCost,
          totalCost: item.unitCost ? (parseFloat(item.unitCost) * parseFloat(item.quantity)).toFixed(2) : null,
          sourceDocType: "transfer",
          sourceDocId: input.id,
          reference: transfer[0].transferNumber,
        } as any);
      }

      await db.update(stockTransfers).set({ status: "confirmed" }).where(eq(stockTransfers.id, input.id));
      await logAudit({ action: "CONFIRM", entityType: "stock_transfer", entityId: input.id, description: `Потврден пренос ${transfer[0].transferNumber}` });
      return { success: true };
    }),

  // ===== INVENTORY COUNTS (POPIS) =====
  countList: publicQuery.query(async () => {
    const db = getDb();
    return await db.select().from(inventoryCounts).orderBy(desc(inventoryCounts.createdAt));
  }),

  countById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const c = await db.select().from(inventoryCounts).where(eq(inventoryCounts.id, input.id));
      if (!c[0]) return null;
      const items = await db
        .select({
          id: inventoryCountItems.id,
          countId: inventoryCountItems.countId,
          materialId: inventoryCountItems.materialId,
          systemQty: inventoryCountItems.systemQty,
          countedQty: inventoryCountItems.countedQty,
          difference: inventoryCountItems.difference,
          unitCost: inventoryCountItems.unitCost,
          totalDifference: inventoryCountItems.totalDifference,
          notes: inventoryCountItems.notes,
          materialName: materials.name,
          materialCode: materials.code,
        })
        .from(inventoryCountItems)
        .leftJoin(materials, eq(inventoryCountItems.materialId, materials.id))
        .where(eq(inventoryCountItems.countId, input.id));
      return { ...c[0], items };
    }),

  countCreate: publicQuery
    .input(z.object({
      countNumber: z.string().min(1),
      warehouseId: z.number(),
      countDate: z.string(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      // Auto-populate with current stock
      const currentStock = await db.select().from(materialStock)
        .where(eq(materialStock.warehouseId, input.warehouseId));

      const result = await db.insert(inventoryCounts).values({
        ...input,
        countDate: new Date(input.countDate),
      } as any);
      const insertId = Number(result[0].insertId);

      for (const s of currentStock) {
        await db.insert(inventoryCountItems).values({
          countId: insertId,
          materialId: s.materialId,
          systemQty: s.quantity,
          countedQty: s.quantity, // default to system qty
          difference: "0",
          unitCost: s.avgCost,
          totalDifference: "0",
        } as any);
      }

      return { success: true, id: insertId };
    }),

  countUpdateItem: publicQuery
    .input(z.object({
      id: z.number(),
      countedQty: z.string(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, countedQty, notes } = input;
      const item = await db.select().from(inventoryCountItems).where(eq(inventoryCountItems.id, id));
      if (!item[0]) throw new Error("Ставката не постои");

      const diff = parseFloat(countedQty) - parseFloat(item[0].systemQty ?? "0");
      const totalDiff = diff * parseFloat(item[0].unitCost ?? "0");

      await db.update(inventoryCountItems).set({
        countedQty,
        difference: diff.toFixed(3),
        totalDifference: totalDiff.toFixed(2),
        notes: notes ?? item[0].notes,
      }).where(eq(inventoryCountItems.id, id));

      return { success: true };
    }),

  countComplete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const count = await db.select().from(inventoryCounts).where(eq(inventoryCounts.id, input.id));
      if (!count[0]) throw new Error("Пописот не постои");

      const items = await db.select().from(inventoryCountItems).where(eq(inventoryCountItems.countId, input.id));

      for (const item of items) {
        const diff = parseFloat(item.difference ?? "0");
        if (diff === 0) continue;

        // Update material_stock
        const stock = await db.select().from(materialStock)
          .where(and(
            eq(materialStock.materialId, item.materialId),
            eq(materialStock.warehouseId, count[0].warehouseId)
          ));

        if (stock[0]) {
          const newQty = (parseFloat(stock[0].quantity) + diff).toFixed(3);
          await db.update(materialStock)
            .set({ quantity: newQty })
            .where(eq(materialStock.id, stock[0].id));
        }

        // Log adjustment transaction
        await db.insert(inventoryTransactions).values({
          materialId: item.materialId,
          warehouseId: count[0].warehouseId,
          type: "adjustment",
          quantity: Math.abs(diff).toFixed(3),
          unitCost: item.unitCost,
          totalCost: item.totalDifference,
          sourceDocType: "inventory_count",
          sourceDocId: input.id,
          reference: count[0].countNumber,
          notes: diff > 0 ? "Вишок при попис" : "Кусок при попис",
        } as any);
      }

      await db.update(inventoryCounts).set({ status: "completed" }).where(eq(inventoryCounts.id, input.id));
      await logAudit({ action: "CONFIRM", entityType: "inventory_count", entityId: input.id, description: `Завршен попис ${count[0].countNumber}` });
      return { success: true };
    }),
});
