import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { materialRemnants, materials, warehouses, docCounters, companySettings } from "@db/schema";
import { logAudit } from "./audit-helper";

// ── Генератор на код: ОСТ-26-0042 ──────────────────────────────────────
async function nextRemnantCode(): Promise<string> {
  const db = getDb();
  const y = new Date().getFullYear();
  const existing = await db
    .select()
    .from(docCounters)
    .where(and(eq(docCounters.kind, "remnant"), eq(docCounters.year, y)));

  let nextVal: number;
  if (existing.length === 0) {
    await db.insert(docCounters).values({ kind: "remnant", year: y, value: 1 });
    nextVal = 1;
  } else {
    nextVal = existing[0].value + 1;
    await db
      .update(docCounters)
      .set({ value: nextVal, updatedAt: new Date() })
      .where(eq(docCounters.id, existing[0].id));
  }
  return `ОСТ-${String(y).slice(-2)}-${String(nextVal).padStart(4, "0")}`;
}

async function getCutParams(): Promise<{ kerf: number; minRemnant: number }> {
  const db = getDb();
  const rows = await db.select().from(companySettings);
  const s: any = rows[0] ?? {};
  return {
    kerf: Number(s.cutKerfMm ?? 2) || 0,
    minRemnant: Number(s.minRemnantMm ?? 300) || 0,
  };
}

const baseSelect = {
  id: materialRemnants.id,
  code: materialRemnants.code,
  materialId: materialRemnants.materialId,
  warehouseId: materialRemnants.warehouseId,
  lengthMm: materialRemnants.lengthMm,
  quantity: materialRemnants.quantity,
  location: materialRemnants.location,
  workOrderId: materialRemnants.workOrderId,
  sourceRemnantId: materialRemnants.sourceRemnantId,
  status: materialRemnants.status,
  usedInRef: materialRemnants.usedInRef,
  usedAt: materialRemnants.usedAt,
  notes: materialRemnants.notes,
  createdAt: materialRemnants.createdAt,
  materialName: materials.name,
  materialCode: materials.code,
  materialType: materials.type,
  warehouseName: warehouses.name,
};

export const remnantsRouter = createRouter({
  // ===== ЛИСТА =====
  remnantList: publicQuery
    .input(
      z
        .object({
          search: z.string().optional(),
          materialId: z.number().optional(),
          status: z.enum(["available", "used", "scrapped", "all"]).optional(),
          minLengthMm: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select(baseSelect)
        .from(materialRemnants)
        .leftJoin(materials, eq(materialRemnants.materialId, materials.id))
        .leftJoin(warehouses, eq(materialRemnants.warehouseId, warehouses.id))
        .orderBy(desc(materialRemnants.createdAt));

      let out = rows;
      const status = input?.status ?? "available";
      if (status !== "all") out = out.filter((r) => r.status === status);
      if (input?.materialId) out = out.filter((r) => r.materialId === input.materialId);
      if (input?.minLengthMm) out = out.filter((r) => Number(r.lengthMm) >= input.minLengthMm!);
      if (input?.search) {
        const s = input.search.trim().toLowerCase();
        out = out.filter(
          (r) =>
            (r.code ?? "").toLowerCase().includes(s) ||
            (r.materialName ?? "").toLowerCase().includes(s) ||
            (r.materialCode ?? "").toLowerCase().includes(s) ||
            (r.location ?? "").toLowerCase().includes(s)
        );
      }
      return out;
    }),

  // ===== ДОСТАПНИ ОСТАТОЦИ ЗА ЕДЕН МАТЕРИЈАЛ (за предлог при кроење) =====
  remnantsForMaterial: publicQuery
    .input(z.object({ materialId: z.number(), minLengthMm: z.number().optional() }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select(baseSelect)
        .from(materialRemnants)
        .leftJoin(materials, eq(materialRemnants.materialId, materials.id))
        .leftJoin(warehouses, eq(materialRemnants.warehouseId, warehouses.id))
        .where(
          and(
            eq(materialRemnants.materialId, input.materialId),
            eq(materialRemnants.status, "available")
          )
        );
      const min = input.minLengthMm ?? 0;
      return rows
        .filter((r) => Number(r.lengthMm) >= min)
        .sort((a, b) => Number(a.lengthMm) - Number(b.lengthMm)); // најмал доволен прв
    }),

  // ===== СТАТИСТИКА =====
  remnantStats: publicQuery.query(async () => {
    const db = getDb();
    const rows = await db
      .select({
        materialId: materialRemnants.materialId,
        lengthMm: materialRemnants.lengthMm,
        quantity: materialRemnants.quantity,
        status: materialRemnants.status,
      })
      .from(materialRemnants);

    const available = rows.filter((r) => r.status === "available");
    const totalPieces = available.reduce((a, r) => a + (r.quantity ?? 1), 0);
    const totalMeters =
      available.reduce((a, r) => a + Number(r.lengthMm) * (r.quantity ?? 1), 0) / 1000;
    const materialsWith = new Set(available.map((r) => r.materialId)).size;
    return {
      totalPieces,
      totalMeters: Math.round(totalMeters * 100) / 100,
      materialsWith,
      usedCount: rows.filter((r) => r.status === "used").length,
    };
  }),

  // ===== ПАРАМЕТРИ ЗА КРОЕЊЕ =====
  cutParamsGet: publicQuery.query(async () => {
    return await getCutParams();
  }),

  cutParamsSet: publicQuery
    .input(z.object({ kerf: z.number().min(0).max(50), minRemnant: z.number().min(0).max(5000) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const rows = await db.select().from(companySettings);
      if (rows.length === 0) return { success: false };
      await db
        .update(companySettings)
        .set({
          cutKerfMm: String(input.kerf),
          minRemnantMm: String(input.minRemnant),
          updatedAt: new Date(),
        } as any)
        .where(eq(companySettings.id, rows[0].id));
      return { success: true };
    }),

  // ===== СОЗДАВАЊЕ =====
  remnantCreate: publicQuery
    .input(
      z.object({
        materialId: z.number(),
        lengthMm: z.number().min(1),
        quantity: z.number().int().min(1).default(1),
        warehouseId: z.number().optional(),
        location: z.string().optional(),
        workOrderId: z.number().optional(),
        notes: z.string().optional(),
        createdBy: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const code = await nextRemnantCode();
      const inserted = await db
        .insert(materialRemnants)
        .values({
          code,
          materialId: input.materialId,
          warehouseId: input.warehouseId ?? null,
          lengthMm: String(input.lengthMm),
          quantity: input.quantity,
          location: input.location ?? null,
          workOrderId: input.workOrderId ?? null,
          notes: input.notes ?? null,
          createdBy: input.createdBy ?? null,
          status: "available",
        } as any)
        .returning();

      const row = inserted[0];
      try {
        await logAudit({
          action: "CREATE",
          entityType: "material_remnant",
          entityId: row?.id,
          description: `Регистриран остаток ${code} — ${input.lengthMm} mm`,
        } as any);
      } catch {
        /* audit е опционален */
      }
      return { success: true, id: row?.id, code };
    }),

  // ===== ИЗМЕНА =====
  remnantUpdate: publicQuery
    .input(
      z.object({
        id: z.number(),
        lengthMm: z.number().min(1).optional(),
        quantity: z.number().int().min(1).optional(),
        location: z.string().optional(),
        warehouseId: z.number().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...rest } = input;
      const data: any = { updatedAt: new Date() };
      if (rest.lengthMm !== undefined) data.lengthMm = String(rest.lengthMm);
      if (rest.quantity !== undefined) data.quantity = rest.quantity;
      if (rest.location !== undefined) data.location = rest.location;
      if (rest.warehouseId !== undefined) data.warehouseId = rest.warehouseId;
      if (rest.notes !== undefined) data.notes = rest.notes;
      await db.update(materialRemnants).set(data).where(eq(materialRemnants.id, id));
      return { success: true };
    }),

  // ===== ИСКОРИСТУВАЊЕ (со автоматски нов остаток ако остане доволно) =====
  remnantUse: publicQuery
    .input(
      z.object({
        id: z.number(),
        usedLengthMm: z.number().min(1),
        ref: z.string().optional(), // работен налог / опис
        keepRemainder: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(materialRemnants)
        .where(eq(materialRemnants.id, input.id));
      if (rows.length === 0) throw new Error("Остатокот не е пронајден");
      const r: any = rows[0];
      if (r.status !== "available") throw new Error("Остатокот веќе не е достапен");

      const total = Number(r.lengthMm);
      if (input.usedLengthMm > total) throw new Error("Внесената должина е поголема од остатокот");

      const { kerf, minRemnant } = await getCutParams();
      const rest = Math.max(0, total - input.usedLengthMm - kerf);

      // Оригиналот се затвора
      await db
        .update(materialRemnants)
        .set({
          status: "used",
          usedAt: new Date(),
          usedInRef: input.ref ?? null,
          updatedAt: new Date(),
        } as any)
        .where(eq(materialRemnants.id, input.id));

      let newCode: string | null = null;
      let scrapMm = 0;

      if (rest > 0 && input.keepRemainder && rest >= minRemnant) {
        newCode = await nextRemnantCode();
        await db.insert(materialRemnants).values({
          code: newCode,
          materialId: r.materialId,
          warehouseId: r.warehouseId,
          lengthMm: String(Math.round(rest * 10) / 10),
          quantity: 1,
          location: r.location,
          workOrderId: r.workOrderId,
          sourceRemnantId: r.id,
          status: "available",
          notes: `Од ${r.code}`,
        } as any);
      } else {
        scrapMm = rest;
      }

      return {
        success: true,
        restMm: Math.round(rest * 10) / 10,
        newCode,
        scrapMm: Math.round(scrapMm * 10) / 10,
        minRemnant,
        kerf,
      };
    }),

  // ===== ОТПИС =====
  remnantScrap: publicQuery
    .input(z.object({ id: z.number(), reason: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(materialRemnants)
        .set({
          status: "scrapped",
          usedAt: new Date(),
          usedInRef: input.reason ?? "Отпис",
          updatedAt: new Date(),
        } as any)
        .where(eq(materialRemnants.id, input.id));
      return { success: true };
    }),

  // ===== ВРАЌАЊЕ ВО ДОСТАПНИ =====
  remnantRestore: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(materialRemnants)
        .set({ status: "available", usedAt: null, usedInRef: null, updatedAt: new Date() } as any)
        .where(eq(materialRemnants.id, input.id));
      return { success: true };
    }),

  // ===== БРИШЕЊЕ =====
  remnantDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(materialRemnants).where(eq(materialRemnants.id, input.id));
      return { success: true };
    }),
});
