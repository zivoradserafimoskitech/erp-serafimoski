import { z } from "zod";
import { eq, desc } from "drizzle-orm";
// PostgreSQL compat
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { workOrders, workOrderOperations, workOrderMaterials, orders, orderItems, customers, deliveryNotes, documentItems, materials, warehouses, products, finishedGoodsStock , operationTimeLogs } from "@db/schema";
import { recalcWorkOrderCost } from "./wo-cost-helper";
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
      const opsRaw = await db.select().from(workOrderOperations).where(eq(workOrderOperations.workOrderId, input.id)).orderBy(workOrderOperations.sequence);

      // Сесии од скенирање на подот
      const tLogs = await db
        .select()
        .from(operationTimeLogs)
        .where(eq(operationTimeLogs.workOrderId, input.id));
      const logsByOp = new Map<number, any[]>();
      for (const l of tLogs as any[]) {
        const arr = logsByOp.get(l.operationId) ?? [];
        arr.push(l);
        logsByOp.set(l.operationId, arr);
      }
      const ops = (opsRaw as any[]).map((o) => {
        const ls = logsByOp.get(o.id) ?? [];
        const open = ls.find((l) => !l.endedAt) ?? null;
        const loggedMinutes = ls
          .filter((l) => l.endedAt)
          .reduce((a, l) => a + (Number(l.minutes ?? 0) || 0), 0);
        return {
          ...o,
          openLog: open ? { id: open.id, operator: open.operator, startedAt: open.startedAt } : null,
          loggedMinutes: Math.round(loggedMinutes * 100) / 100,
          sessionCount: ls.filter((l) => l.endedAt).length,
          operators: Array.from(new Set(ls.map((l) => l.operator).filter(Boolean))),
          // Времето доаѓа од скенирање — рачното менување го газѝ
          timeFromScan: ls.length > 0,
        };
      });

      const mats = await db
        .select({
          id: workOrderMaterials.id, workOrderId: workOrderMaterials.workOrderId,
          materialId: workOrderMaterials.materialId, quantity: workOrderMaterials.quantity,
          unitCost: workOrderMaterials.unitCost, totalCost: workOrderMaterials.totalCost,
          isActual: workOrderMaterials.isActual, notes: workOrderMaterials.notes,
          materialName: materials.name, materialCode: materials.code, materialUnit: materials.unit,
          materialWeightPerUnit: materials.weightPerUnit,
        })
        .from(workOrderMaterials)
        .leftJoin(materials, eq(workOrderMaterials.materialId, materials.id))
        .where(eq(workOrderMaterials.workOrderId, input.id));
      const matsWithWeight = (mats as any[]).map((m) => ({
        ...m,
        weightKg:
          Math.round(
            (Number(m.materialWeightPerUnit ?? 0) || 0) * (Number(m.quantity ?? 0) || 0) * 1000
          ) / 1000,
      }));
      const plannedKg = matsWithWeight
        .filter((m) => m.isActual !== "actual")
        .reduce((a, m) => a + m.weightKg, 0);
      const actualKg = matsWithWeight
        .filter((m) => m.isActual === "actual")
        .reduce((a, m) => a + m.weightKg, 0);
      const allOps = ops as any[];
      const doneOps = allOps.filter((o) => o.status === "completed" || o.status === "skipped");
      const runningOps = allOps.filter((o) => o.openLog);
      const scanSummary = {
        totalOps: allOps.length,
        doneOps: doneOps.length,
        runningOps: runningOps.length,
        allDone: allOps.length > 0 && doneOps.length === allOps.length,
        totalLoggedMinutes: Math.round(allOps.reduce((a, o) => a + (o.loggedMinutes ?? 0), 0)),
        timeLogs: (tLogs as any[])
          .slice()
          .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
      };

      return {
        ...wo[0], orderNumber, operations: ops, materials: matsWithWeight, scanSummary,
        weightSummary: {
          plannedKg: Math.round(plannedKg * 1000) / 1000,
          actualKg: Math.round(actualKg * 1000) / 1000,
          diffKg: Math.round((actualKg - plannedKg) * 1000) / 1000,
        },
      };
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
      producedQty: z.string().optional(),
      producedUnit: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, producedQty, producedUnit, ...data } = input;
      const updateData: any = { ...data };
      if (data.plannedStart) updateData.plannedStart = new Date(data.plannedStart);
      if (data.plannedEnd) updateData.plannedEnd = new Date(data.plannedEnd);
      if (data.actualStart) updateData.actualStart = new Date(data.actualStart);
      if (data.actualEnd) updateData.actualEnd = new Date(data.actualEnd);

      if (data.status === "in_progress" && !data.actualStart) updateData.actualStart = new Date();
      if (data.status === "completed" && !data.actualEnd) updateData.actualEnd = new Date();

      // При премин во „Завршен" — автоматски влез во магацинот за готови производи (ГЛ-ПРОД)
      let finishedGoodsRegistered = false;
      if (data.status === "completed") {
        const existing = await db.select().from(workOrders).where(eq(workOrders.id, id));
        const wo = existing[0];
        if (wo && wo.status !== "completed") {
          // Дупликат-заштита: провери дали веќе има запис за овој налог
          const already = await db.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.workOrderId, id));
          if (already.length === 0) {
            // Најди го магацинот за готови производи
            const allWh = await db.select().from(warehouses);
            let fgWh = allWh.find(w => w.code === "GL-PROD") || allWh.find(w => w.type === "finished_goods");
            if (!fgWh) {
              const created = await db.insert(warehouses).values({
                code: "GL-PROD", name: "Главен Магацин - Производи", type: "finished_goods", isActive: "active",
              } as any);
              const newId = Number(created[0].insertId);
              const re = await db.select().from(warehouses).where(eq(warehouses.id, newId));
              fgWh = re[0];
            }

            // Прво: ако нарачката има ставка врзана со каталошки производ — користи го него
            let productId: number | null = null;
            if (wo.orderId) {
              const oItems = await db.select().from(orderItems).where(eq(orderItems.orderId, wo.orderId));
              const withProduct = oItems.filter(oi => oi.productId);
              if (withProduct.length === 1) productId = Number(withProduct[0].productId);
            }
            // Инаку: најди или создај производ поврзан со налогот
            if (!productId) {
              const prodCode = `ПРО-${wo.woNumber}`.slice(0, 100);
              const existingProd = await db.select().from(products).where(eq(products.code, prodCode));
              if (existingProd[0]) {
                productId = existingProd[0].id;
              } else {
                const insertedProd = await db.insert(products).values({
                  name: (wo.description || `Производ од налог ${wo.woNumber}`).slice(0, 255),
                  code: prodCode,
                  category: "производство",
                  unit: producedUnit || "ком",
                  basis: "piece",
                  isActive: "active",
                } as any);
                productId = Number(insertedProd[0].insertId);
              }
            }

            // Автоматска препресметка на цената пред да се пресмета трошок по единица
            const freshCost = await recalcWorkOrderCost(id).catch(() => String(wo.costAmount ?? "0"));
            const qty = parseFloat(producedQty || "1") || 1;
            const cost = parseFloat(String(freshCost || "0")) || 0;
            const unitCost = qty > 0 && cost > 0 ? (cost / qty).toFixed(2) : "0";

            await db.insert(finishedGoodsStock).values({
              productId,
              warehouseId: fgWh!.id,
              workOrderId: id,
              quantity: qty.toFixed(3),
              unitCost,
              notes: `Произведено по налог ${wo.woNumber}`,
            } as any);
            finishedGoodsRegistered = true;
            await logAudit({ action: "CREATE", entityType: "finished_goods", entityId: id, description: `Заведени ${qty} ${producedUnit || "ком"} готов производ во ГЛ-ПРОД од налог ${wo.woNumber}` });
          }
          // Нарачката е спремна за испорака
          if (wo.orderId) {
            await db.update(orders).set({ status: "ready" }).where(eq(orders.id, wo.orderId));
          }
        }
      }

      await db.update(workOrders).set(updateData).where(eq(workOrders.id, id));
      return { success: true, finishedGoodsRegistered };
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
      await recalcWorkOrderCost(input.workOrderId).catch(() => {});
      return { success: true };
    }),

  woMaterialDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const wm = await db.select().from(workOrderMaterials).where(eq(workOrderMaterials.id, input.id));
      await db.delete(workOrderMaterials).where(eq(workOrderMaterials.id, input.id));
      if (wm[0]) await recalcWorkOrderCost(wm[0].workOrderId).catch(() => {});
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
      await db.insert(workOrderOperations).values({ status: "pending", ...(input as any) });
      await recalcWorkOrderCost(input.workOrderId).catch(() => {});
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
      const op = await db.select().from(workOrderOperations).where(eq(workOrderOperations.id, id));
      if (op[0]) await recalcWorkOrderCost(op[0].workOrderId).catch(() => {});
      return { success: true };
    }),

  // ═══════════ РАБОТА НА ПОДОТ (скенирање) ═══════════
  woScanById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const wo = await db.select().from(workOrders).where(eq(workOrders.id, input.id));
      if (wo.length === 0) return null;

      const ops = await db
        .select()
        .from(workOrderOperations)
        .where(eq(workOrderOperations.workOrderId, input.id))
        .orderBy(workOrderOperations.sequence);

      const logs = await db
        .select()
        .from(operationTimeLogs)
        .where(eq(operationTimeLogs.workOrderId, input.id));

      const byOp = new Map<number, any[]>();
      for (const l of logs as any[]) {
        const arr = byOp.get(l.operationId) ?? [];
        arr.push(l);
        byOp.set(l.operationId, arr);
      }

      const opsOut = (ops as any[]).map((o) => {
        const ls = byOp.get(o.id) ?? [];
        const open = ls.find((l) => !l.endedAt) ?? null;
        const doneMinutes = ls
          .filter((l) => l.endedAt)
          .reduce((a, l) => a + (Number(l.minutes ?? 0) || 0), 0);
        return {
          ...o,
          openLog: open
            ? { id: open.id, operator: open.operator, startedAt: open.startedAt }
            : null,
          loggedMinutes: Math.round(doneMinutes * 100) / 100,
          operators: Array.from(new Set(ls.map((l) => l.operator).filter(Boolean))),
        };
      });

      return { ...(wo[0] as any), operations: opsOut };
    }),

  opClockIn: publicQuery
    .input(z.object({ operationId: z.number(), operator: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const ops = await db
        .select()
        .from(workOrderOperations)
        .where(eq(workOrderOperations.id, input.operationId));
      if (ops.length === 0) throw new Error("Операцијата не постои");
      const op: any = ops[0];

      // Ако веќе тече сесија за истиот работник — не отворај втора
      const existing = await db
        .select()
        .from(operationTimeLogs)
        .where(eq(operationTimeLogs.operationId, input.operationId));
      const open = (existing as any[]).find((l) => !l.endedAt);
      if (open) return { success: true, alreadyRunning: true, logId: open.id };

      const res = await db.insert(operationTimeLogs).values({
        operationId: input.operationId,
        workOrderId: op.workOrderId,
        operator: input.operator ?? null,
        startedAt: new Date(),
      } as any).returning();

      const patch: any = { status: "in_progress" };
      if (input.operator) patch.operator = input.operator;
      await db.update(workOrderOperations).set(patch).where(eq(workOrderOperations.id, input.operationId));

      // Работниот налог тргнува со првата скенирана операција
      const wos = await db.select().from(workOrders).where(eq(workOrders.id, op.workOrderId));
      const wo: any = wos[0];
      if (wo && (wo.status === "pending" || !wo.actualStart)) {
        await db.update(workOrders).set({
          status: wo.status === "pending" ? "in_progress" : wo.status,
          actualStart: wo.actualStart ?? new Date().toISOString().slice(0, 10),
          updatedAt: new Date(),
        } as any).where(eq(workOrders.id, op.workOrderId));
      }

      return { success: true, alreadyRunning: false, logId: res[0]?.id };
    }),

  opClockOut: publicQuery
    .input(z.object({
      operationId: z.number(),
      finish: z.boolean().default(false),
      note: z.string().optional(),
      actualQty: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const logs = await db
        .select()
        .from(operationTimeLogs)
        .where(eq(operationTimeLogs.operationId, input.operationId));

      const open = (logs as any[]).find((l) => !l.endedAt);
      const now = new Date();
      let sessionMinutes = 0;

      if (open) {
        const started = new Date(open.startedAt);
        sessionMinutes = Math.max(0, (now.getTime() - started.getTime()) / 60000);
        await db.update(operationTimeLogs).set({
          endedAt: now,
          minutes: sessionMinutes.toFixed(2),
          note: input.note ?? null,
        } as any).where(eq(operationTimeLogs.id, open.id));
      }

      // Вкупно време = сите затворени сесии
      const fresh = await db
        .select()
        .from(operationTimeLogs)
        .where(eq(operationTimeLogs.operationId, input.operationId));
      const totalMinutes = (fresh as any[])
        .filter((l) => l.endedAt)
        .reduce((a, l) => a + (Number(l.minutes ?? 0) || 0), 0);
      const hours = totalMinutes / 60;

      const patch: any = { actualTime: hours.toFixed(2) };
      if (input.finish) patch.status = "completed";
      if (input.actualQty) patch.actualQty = input.actualQty;
      await db.update(workOrderOperations).set(patch).where(eq(workOrderOperations.id, input.operationId));

      const ops = await db
        .select()
        .from(workOrderOperations)
        .where(eq(workOrderOperations.id, input.operationId));
      const op: any = ops[0];
      if (op) await recalcWorkOrderCost(op.workOrderId).catch(() => {});

      // Дали налогот е спремен за затворање?
      let allDone = false;
      let woNumber: string | null = null;
      let woStatus: string | null = null;
      if (op) {
        const siblings = await db
          .select()
          .from(workOrderOperations)
          .where(eq(workOrderOperations.workOrderId, op.workOrderId));
        const list = siblings as any[];
        allDone = list.length > 0 && list.every((o) => o.status === "completed" || o.status === "skipped");
        const w = await db.select().from(workOrders).where(eq(workOrders.id, op.workOrderId));
        woNumber = (w[0] as any)?.woNumber ?? null;
        woStatus = (w[0] as any)?.status ?? null;
      }

      return {
        success: true,
        sessionMinutes: Math.round(sessionMinutes),
        totalMinutes: Math.round(totalMinutes),
        hours: Math.round(hours * 100) / 100,
        workOrderId: op?.workOrderId ?? null,
        allOperationsDone: allDone,
        workOrderNumber: woNumber,
        workOrderStatus: woStatus,
      };
    }),

  // ═══════════ ЗАТВОРАЊЕ НА ОТВОРЕНИ СЕСИИ ═══════════
  // Се вика пред затворање на налог, за да не висат почнати операции.
  // Самото затворање оди преку workOrderUpdate — иста патека како од канцеларија,
  // за да не се дуплира логиката за ГЛ-ПРОД.
  closeOpenSessions: publicQuery
    .input(z.object({ workOrderId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const logs = await db
        .select()
        .from(operationTimeLogs)
        .where(eq(operationTimeLogs.workOrderId, input.workOrderId));

      const now = new Date();
      const open = (logs as any[]).filter((l) => !l.endedAt);
      const touched = new Set<number>();

      for (const l of open) {
        const mins = Math.max(0, (now.getTime() - new Date(l.startedAt).getTime()) / 60000);
        await db.update(operationTimeLogs)
          .set({ endedAt: now, minutes: mins.toFixed(2) } as any)
          .where(eq(operationTimeLogs.id, l.id));
        touched.add(l.operationId);
      }

      // Препиши го вкупното време на засегнатите операции
      for (const opId of touched) {
        const fresh = await db
          .select()
          .from(operationTimeLogs)
          .where(eq(operationTimeLogs.operationId, opId));
        const totalMin = (fresh as any[])
          .filter((l) => l.endedAt)
          .reduce((a, l) => a + (Number(l.minutes ?? 0) || 0), 0);
        await db.update(workOrderOperations)
          .set({ actualTime: (totalMin / 60).toFixed(2) } as any)
          .where(eq(workOrderOperations.id, opId));
      }

      if (touched.size > 0) await recalcWorkOrderCost(input.workOrderId).catch(() => {});
      return { success: true, closed: open.length };
    }),

  opTimeLogs: publicQuery
    .input(z.object({ workOrderId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return await db
        .select()
        .from(operationTimeLogs)
        .where(eq(operationTimeLogs.workOrderId, input.workOrderId))
        .orderBy(desc(operationTimeLogs.startedAt));
    }),

  operationDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const op = await db.select().from(workOrderOperations).where(eq(workOrderOperations.id, input.id));
      await db.delete(workOrderOperations).where(eq(workOrderOperations.id, input.id));
      if (op[0]) await recalcWorkOrderCost(op[0].workOrderId).catch(() => {});
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
  // Синџир: завршен налог → испратница со готовиот производ
  workOrderToDeliveryNote: publicQuery
    .input(z.object({ workOrderId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const woRes = await db.select().from(workOrders).where(eq(workOrders.id, input.workOrderId));
      const wo = woRes[0];
      if (!wo) throw new Error("Налогот не постои");
      if (wo.status !== "completed") throw new Error("Испратница се креира само од ЗАВРШЕН налог — прво заврши го");
      if (!wo.orderId) throw new Error("Налогот нема поврзана нарачка — не знам кој е клиентот. Креирај ја испратницата рачно од Сметководство → Испратници");

      const ordRes = await db.select().from(orders).where(eq(orders.id, wo.orderId));
      if (!ordRes[0]) throw new Error("Нарачката на налогот не постои");
      const customerId = ordRes[0].customerId;

      // Готовите производи произведени по овој налог, со преостаната залиха
      const fgRows = (await db.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.workOrderId, input.workOrderId)))
        .filter(f => (parseFloat(String(f.quantity ?? "0")) || 0) > 0);
      if (fgRows.length === 0) throw new Error("Нема залиха на готов производ од овој налог — или не е заведена, или веќе е испорачана");

      // Тежината на готовиот производ = потрошениот материјал на овој налог.
      // Ако има реално потрошено — тоа е вистината; инаку планираното.
      const woMats = await db
        .select({
          quantity: workOrderMaterials.quantity,
          isActual: workOrderMaterials.isActual,
          weightPerUnit: materials.weightPerUnit,
        })
        .from(workOrderMaterials)
        .leftJoin(materials, eq(workOrderMaterials.materialId, materials.id))
        .where(eq(workOrderMaterials.workOrderId, input.workOrderId));

      const kgOf = (rows: any[]) =>
        rows.reduce(
          (a, m) => a + (Number(m.weightPerUnit ?? 0) || 0) * (Number(m.quantity ?? 0) || 0),
          0
        );
      const actualRows = woMats.filter((m: any) => m.isActual === "actual");
      const totalMaterialKg = actualRows.length > 0 ? kgOf(actualRows) : kgOf(woMats as any[]);
      const totalProducedQty = fgRows.reduce(
        (a, f) => a + (parseFloat(String(f.quantity ?? "0")) || 0),
        0
      );
      // Тежина по едно парче готов производ
      const kgPerPiece = totalProducedQty > 0 ? totalMaterialKg / totalProducedQty : 0;

      const { getNextDocNumber, bumpDocCounter } = await import("./counters-helper");
      const dnNumber = await getNextDocNumber("deliveryNote");
      await bumpDocCounter("deliveryNote", dnNumber).catch(() => {});

      const today = new Date();
      const dnRes = await db.insert(deliveryNotes).values({
        dnNumber, customerId, orderId: wo.orderId,
        status: "issued", issueDate: today,
        totalItems: fgRows.length,
        notes: totalMaterialKg > 0
          ? `Од работен налог ${wo.woNumber} · вкупна тежина ${totalMaterialKg.toFixed(1)} кг`
          : `Од работен налог ${wo.woNumber}`,
      } as any);
      const dnId = Number(dnRes[0].insertId);

      // Ставки + одземање на залихата од ГЛ-ПРОД
      for (const fg of fgRows) {
        const prod = (await db.select().from(products).where(eq(products.id, fg.productId)))[0];
        const qty = parseFloat(String(fg.quantity)) || 0;
        await db.insert(documentItems).values({
          documentId: dnId, documentType: "delivery_note",
          description: prod?.name ?? `Производ #${fg.productId}`,
          quantity: qty.toFixed(3), unit: prod?.unit ?? "ком",
          unitPrice: "0", totalPrice: "0", vatRate: "0",
          productId: fg.productId, itemType: "product",
          weightKg: (kgPerPiece * qty).toFixed(3),
        } as any);
        await db.update(finishedGoodsStock)
          .set({ quantity: "0.000", updatedAt: new Date() } as any)
          .where(eq(finishedGoodsStock.id, fg.id));
      }

      // Нарачката е испорачана
      await db.update(orders).set({ status: "delivered" }).where(eq(orders.id, wo.orderId));
      await logAudit({ action: "CREATE", entityType: "delivery_note", entityId: dnId, description: `Креирана испратница ${dnNumber} од налог ${wo.woNumber}` }).catch(() => {});
      return { success: true, id: dnId, dnNumber };
    }),

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
