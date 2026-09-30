import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
// PostgreSQL compat
import { createRouter, publicQuery } from "./middleware";
import { listLimit } from "./list-limit";
import { getDb, getPool } from "./queries/connection";
import { recalcWorkOrderCost } from "./wo-cost-helper";
import {
  materials, materialStock, materialLots,
  inventoryTransactions, warehouses,
} from "@db/schema";
import { isLowStock } from "@contracts/stock";
import { adjustStock, warehouseQty, syncMaterialTotal, applyReceiptToPo } from "./stock-helper";
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
      // Резервирано = планиран (сè уште неиздаден) материјал на отворени работни налози
      const resRows: any = await db.execute(sql`
        SELECT wm.material_id AS mid, SUM(wm.quantity) AS qty, COUNT(DISTINCT wm.work_order_id) AS wos
        FROM work_order_materials wm JOIN work_orders w ON w.id = wm.work_order_id
        WHERE wm.is_actual <> 'actual' AND w.status NOT IN ('completed', 'cancelled')
        GROUP BY wm.material_id`);
      const resMap = new Map<number, { qty: number; wos: number }>(
        (resRows?.rows ?? resRows ?? []).map((r: any) => [Number(r.mid), { qty: Number(r.qty) || 0, wos: Number(r.wos) || 0 }]));
      const withStock = all.map((m: any) => {
        const stock = sumMap.has(m.id) ? sumMap.get(m.id) : m.currentStock;
        const res = resMap.get(m.id);
        const reserved = res?.qty ?? 0;
        return {
          ...m,
          currentStock: stock,
          reservedQty: reserved.toFixed(3),
          reservedWorkOrders: res?.wos ?? 0,
          availableQty: ((parseFloat(String(stock ?? "0")) || 0) - reserved).toFixed(3),
        };
      });

      let result = withStock;
      if (input?.search) {
        const s = input.search.toLowerCase();
        result = result.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s));
      }
      if (input?.type) result = result.filter(r => r.type === input.type);
      if (input?.lowStock) {
        result = result.filter(isLowStock);
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
      weightPerUnit: z.string().optional(),
      densityKey: z.enum(["steel", "stainless", "aluminum", "copper", "brass"]).optional(),
      defaultSupplierId: z.number().nullable().optional(),
      location: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const opening = parseFloat(input.currentStock) || 0;
      const result = await db.insert(materials).values({ ...input, currentStock: "0" });
      const insertId = Number(result[0].insertId);
      // Почетната залиха оди во магацин за суровини, за да може да се издава и пренесува
      if (opening > 0) {
        const whs = await db.select().from(warehouses);
        const wh = whs.find((w: any) => w.type === "raw_materials") ?? whs[0];
        if (wh) {
          await adjustStock(insertId, wh.id, opening, { unitCost: parseFloat((input as any).avgCost ?? "0") || 0 });
          await db.insert(inventoryTransactions).values({ materialId: insertId, warehouseId: wh.id, type: "adjustment",
            quantity: opening.toFixed(3), reference: "Почетна залиха", notes: "Почетна залиха при внес на материјал" } as any);
        }
        else await db.update(materials).set({ currentStock: opening.toFixed(3) }).where(eq(materials.id, insertId));
      }
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
      avgCost: z.string().optional(),
      lastPurchasePrice: z.string().optional(),
      weightPerUnit: z.string().optional(),
      densityKey: z.enum(["steel", "stainless", "aluminum", "copper", "brass"]).optional(),
      defaultSupplierId: z.number().nullable().optional(),
      location: z.string().optional(),
      isActive: z.enum(["active", "inactive"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(materials).set({ ...data, updatedAt: new Date() } as any).where(eq(materials.id, id));
      await logAudit({ action: "UPDATE", entityType: "material", entityId: id, description: `Изменет материјал #${id}` }).catch(() => {});
      return { success: true };
    }),

  // ===== АВТОМАТСКО ПОПОЛНУВАЊЕ НА ТЕЖИНИ =====
  weightAutofillPreview: publicQuery
    .input(z.object({ includeFilled: z.boolean().default(false) }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const { parseWeightFromName } = await import("./weight-parser");
      const all = await db.select().from(materials).where(eq(materials.isActive, "active"));

      const recognized: any[] = [];
      const skipped: any[] = [];

      for (const m of all as any[]) {
        const current = Number(m.weightPerUnit ?? 0);
        const alreadyFilled = current > 0;
        if (alreadyFilled && !input?.includeFilled) {
          skipped.push({ id: m.id, code: m.code, name: m.name, unit: m.unit, reason: "already" });
          continue;
        }
        const r = parseWeightFromName(m.name, m.unit, m.densityKey);
        if (!r || r.weightPerUnit <= 0) {
          skipped.push({ id: m.id, code: m.code, name: m.name, unit: m.unit, reason: "unparsed" });
          continue;
        }
        recognized.push({
          id: m.id, code: m.code, name: m.name, unit: m.unit,
          currentWeight: current,
          weightPerUnit: r.weightPerUnit,
          shape: r.shape, dims: r.dims,
          material: r.material, materialKey: r.materialKey,
          materialExplicit: r.materialExplicit, materialFromField: r.materialFromField,
          confidence: r.confidence, note: r.note ?? null,
        });
      }

      recognized.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === "medium" ? -1 : 1));
      return {
        recognized,
        skipped,
        totals: {
          all: all.length,
          recognized: recognized.length,
          medium: recognized.filter((r) => r.confidence === "medium").length,
          nonSteel: recognized.filter((r) => r.materialExplicit).length,
          guessedMaterial: recognized.filter((r) => r.materialExplicit && !r.materialFromField).length,
          alreadyFilled: skipped.filter((s) => s.reason === "already").length,
          unparsed: skipped.filter((s) => s.reason === "unparsed").length,
        },
      };
    }),

  weightAutofillApply: publicQuery
    .input(z.object({
      items: z.array(z.object({
        id: z.number(),
        weightPerUnit: z.number(),
        densityKey: z.enum(["steel", "stainless", "aluminum", "copper", "brass"]).optional(),
      })).min(1),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      let updated = 0;
      for (const it of input.items) {
        if (!(it.weightPerUnit > 0)) continue;
        const patch: any = { weightPerUnit: String(it.weightPerUnit), updatedAt: new Date() };
        if (it.densityKey) patch.densityKey = it.densityKey;
        await db.update(materials).set(patch).where(eq(materials.id, it.id));
        updated++;
      }
      await logAudit({
        action: "UPDATE", entityType: "material",
        description: `Автоматски пополнети тежини за ${updated} материјали`,
      }).catch(() => {});
      return { success: true, updated };
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
        heatNumber: z.string().optional(),
        certNumber: z.string().optional(),
        certStandard: z.string().optional(),
        certUrl: z.string().optional(),
        supplierId: z.number().optional(),
      })),
      transportCost: z.string().default("0"),
      customsCost: z.string().default("0"),
      otherCost: z.string().default("0"),
      userId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { receiptId, userId } = input;
      // Потврдена приемница не смее да се потврди повторно (залихата би се зголемила двапати)
      const rcRow = (await getPool().query(`SELECT status, po_id, warehouse_id, supplier_id, transport_cost, customs_cost, other_cost FROM receipts WHERE id = $1`, [receiptId])).rows[0];
      if (!rcRow) throw new Error("Приемницата не постои");
      if (rcRow.status === "confirmed") throw new Error("Приемницата е веќе потврдена — залихата е веќе зголемена");
      if (rcRow.status === "cancelled") throw new Error("Приемницата е откажана");
      // Ставките и трошоците се од приемницата во базата (листата на екранот не ги носи ставките,
      // па порано „Потврди“ се повикуваше со празна листа и залихата не се менуваше)
      const dbItems = (await getPool().query(`SELECT material_id, quantity, unit_price, total_price, landed_cost_alloc, heat_number, cert_number, cert_standard, cert_url
        FROM receipt_items WHERE receipt_id = $1 ORDER BY id`, [receiptId])).rows;
      const items = dbItems.length ? dbItems.map((r: any) => ({
        materialId: Number(r.material_id), quantity: String(r.quantity), unitPrice: String(r.unit_price), totalPrice: String(r.total_price),
        landedCostAlloc: String(r.landed_cost_alloc ?? "0"), heatNumber: r.heat_number ?? undefined, certNumber: r.cert_number ?? undefined,
        certStandard: r.cert_standard ?? undefined, certUrl: r.cert_url ?? undefined, supplierId: rcRow.supplier_id ? Number(rcRow.supplier_id) : undefined,
      })) : input.items;
      if (!items.length) throw new Error("Приемницата нема ставки — додади материјали пред да ја потврдиш");
      const warehouseId = Number(rcRow.warehouse_id ?? input.warehouseId);
      const transportCost = dbItems.length ? String(rcRow.transport_cost ?? "0") : input.transportCost;
      const customsCost = dbItems.length ? String(rcRow.customs_cost ?? "0") : input.customsCost;
      const otherCost = dbItems.length ? String(rcRow.other_cost ?? "0") : input.otherCost;

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
        await syncMaterialTotal(item.materialId);

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
          // Следливост — доаѓа од ставката на приемницата
          heatNumber: (item as any).heatNumber ?? null,
          certNumber: (item as any).certNumber ?? null,
          certStandard: (item as any).certStandard ?? null,
          certUrl: (item as any).certUrl ?? null,
          supplierId: (item as any).supplierId ?? null,
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

      await getPool().query(`UPDATE receipts SET status = 'confirmed' WHERE id = $1`, [receiptId]);
      if (rcRow.po_id) await applyReceiptToPo(Number(rcRow.po_id), items.map(i => ({ materialId: i.materialId, quantity: parseFloat(i.quantity) || 0 })));

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
      // ред од материјалите на налогот што се издава -- се означува како „реално“ за да не се издаде двапати
      woMaterialId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { materialId, warehouseId, quantity, sourceDocType, sourceDocId, reference, userId, woMaterialId } = input;
      if (woMaterialId) {
        const { workOrderMaterials } = await import("@db/schema");
        const row = (await db.select().from(workOrderMaterials).where(eq(workOrderMaterials.id, woMaterialId)))[0];
        if (row?.isActual === "actual") throw new Error("Овој материјал е веќе издаден за налогот");
      }
      const qty = parseFloat(quantity);

      // Check stock
      const stock = await db.select().from(materialStock)
        .where(and(eq(materialStock.materialId, materialId), eq(materialStock.warehouseId, warehouseId)));

      if (!stock[0] || parseFloat(stock[0].quantity) < qty) {
        throw new Error("Нема доволно залиха во магацинот");
      }

      const unitCost = stock[0].avgCost;
      // Магацин + партии (FIFO) + вкупна залиха на материјалот
      await adjustStock(materialId, warehouseId, -qty);

      if (woMaterialId) {
        const { workOrderMaterials } = await import("@db/schema");
        await db.update(workOrderMaterials).set({
          isActual: "actual", quantity: qty.toFixed(3),
          unitCost: parseFloat(unitCost).toFixed(2), totalCost: (qty * parseFloat(unitCost)).toFixed(2),
        }).where(eq(workOrderMaterials.id, woMaterialId));
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

      if (sourceDocType === "work_order" && sourceDocId) {
        await recalcWorkOrderCost(sourceDocId).catch(() => {});
      }
      return { success: true, unitCost, totalCost: (qty * parseFloat(unitCost)).toFixed(2) };
    }),

  // === INVENTORY TRANSACTIONS ===
  transactionList: publicQuery
    .input(z.object({ limit: z.number().int().min(1).optional(), materialId: z.number().optional(), type: z.string().optional() }).optional())
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

      const result = await query.orderBy(desc(inventoryTransactions.createdAt)).limit(listLimit(input as any));
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

      const qty = parseFloat(input.quantity);
      if (!(qty >= 0)) throw new Error("Количината мора да е позитивна");
      // Корекција = нова состојба во магацинот; другите типови се влез/излез
      const cur = await warehouseQty(input.materialId, warehouseId);
      const delta = input.type === "adjustment" ? qty - cur
        : (input.type === "receipt" || input.type === "return") ? qty : -qty;
      await adjustStock(input.materialId, warehouseId, delta, { unitCost: input.unitPrice ? parseFloat(input.unitPrice) : undefined });
      // вредност по набавна (просечна) цена, со знак -- за книжење на кусок/вишок
      const matRow: any = (await db.select().from(materials).where(eq(materials.id, input.materialId)))[0];
      const uc = input.unitPrice ? parseFloat(input.unitPrice) : parseFloat(matRow?.avgCost ?? "0") || 0;
      await db.insert(inventoryTransactions).values({ ...txData, warehouseId, unitCost: uc.toFixed(2), totalCost: (delta * uc).toFixed(2),
        notes: input.type === "adjustment" ? `${input.notes ? input.notes + " · " : ""}Корекција од ${cur} на ${qty}` : input.notes } as any);
      return { success: true };
    }),

  // === DASHBOARD STATS ===
  storageStats: publicQuery.query(async () => {
    const db = getDb();
    const allMaterials = await db.select().from(materials).where(eq(materials.isActive, "active"));
    const totalItems = allMaterials.length;
    const lowStockItems = allMaterials.filter(isLowStock).length;
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
