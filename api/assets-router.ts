import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { fixedAssets, depreciationEntries, suppliers } from "@db/schema";
import { depreciationSchedule, assetState } from "@contracts/depreciation";
import { logAudit } from "./audit-helper";

const toInput = (a: any) => ({
  acquisitionValue: Number(a.acquisitionValue ?? 0),
  salvageValue: Number(a.salvageValue ?? 0),
  rate: Number(a.rate ?? 0),
  acquisitionDate: String(a.acquisitionDate),
  depreciationStart: a.depreciationStart ? String(a.depreciationStart) : null,
  status: a.status,
  disposalDate: a.disposalDate ? String(a.disposalDate) : null,
});

export const assetsRouter = createRouter({
  assetsList: publicQuery
    .input(
      z.object({
        search: z.string().optional(),
        category: z.string().optional(),
        status: z.enum(["all", "active", "disposed"]).optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = (await db.select().from(fixedAssets).orderBy(desc(fixedAssets.acquisitionDate))) as any[];
      const sups = (await db.select().from(suppliers)) as any[];
      const smap = new Map(sups.map((s) => [s.id, s.name]));

      let out = rows.map((a) => ({
        ...a,
        supplierName: a.supplierId ? (smap.get(a.supplierId) ?? null) : null,
        ...assetState(toInput(a)),
      }));

      const st = input?.status ?? "active";
      if (st !== "all") out = out.filter((a) => a.status === st);
      if (input?.category && input.category !== "all") out = out.filter((a) => a.category === input.category);
      if (input?.search) {
        const s = input.search.toLowerCase();
        out = out.filter((a) =>
          (a.name ?? "").toLowerCase().includes(s) ||
          (a.inventoryNo ?? "").toLowerCase().includes(s) ||
          (a.location ?? "").toLowerCase().includes(s) ||
          (a.invoiceRef ?? "").toLowerCase().includes(s)
        );
      }
      return out;
    }),

  assetsStats: publicQuery
    .input(z.object({ year: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const year = input?.year ?? new Date().getFullYear();
      const rows = (await db.select().from(fixedAssets)) as any[];
      const active = rows.filter((a) => a.status === "active");

      let acquisition = 0, accumulated = 0, bookValue = 0, yearAmount = 0, monthly = 0;
      for (const a of active) {
        const st = assetState(toInput(a), year);
        acquisition += Number(a.acquisitionValue ?? 0);
        accumulated += st.accumulated;
        bookValue += st.bookValue;
        yearAmount += st.currentYearAmount;
        if (!st.fullyDepreciated) monthly += st.monthlyAmount;
      }
      return {
        count: active.length,
        disposed: rows.filter((a) => a.status === "disposed").length,
        acquisition: Math.round(acquisition * 100) / 100,
        accumulated: Math.round(accumulated * 100) / 100,
        bookValue: Math.round(bookValue * 100) / 100,
        yearAmount: Math.round(yearAmount * 100) / 100,
        monthly: Math.round(monthly * 100) / 100,
        fullyDepreciated: active.filter((a) => assetState(toInput(a), year).fullyDepreciated).length,
        year,
      };
    }),

  assetById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const a: any = (await db.select().from(fixedAssets).where(eq(fixedAssets.id, input.id)))[0];
      if (!a) return null;
      const entries = await db
        .select()
        .from(depreciationEntries)
        .where(eq(depreciationEntries.assetId, input.id))
        .orderBy(depreciationEntries.year);
      return {
        ...a,
        ...assetState(toInput(a)),
        schedule: depreciationSchedule(toInput(a), new Date().getFullYear() + 40),
        posted: entries,
      };
    }),

  assetCreate: publicQuery
    .input(
      z.object({
        inventoryNo: z.string().min(1),
        name: z.string().min(2),
        category: z.string().default("machine"),
        description: z.string().optional(),
        location: z.string().optional(),
        supplierId: z.number().nullable().optional(),
        invoiceRef: z.string().optional(),
        acquisitionDate: z.string(),
        acquisitionValue: z.string(),
        salvageValue: z.string().default("0"),
        usefulLifeYears: z.string().default("5"),
        rate: z.string().default("20"),
        depreciationStart: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const dup = await db.select().from(fixedAssets).where(eq(fixedAssets.inventoryNo, input.inventoryNo));
      if (dup.length > 0) throw new Error("Инвентарниот број веќе постои");
      const res = await db.insert(fixedAssets).values({
        ...input,
        supplierId: input.supplierId ?? null,
        depreciationStart: input.depreciationStart || input.acquisitionDate,
        status: "active",
      } as any).returning();
      await logAudit({
        action: "CREATE", entityType: "fixed_asset", entityId: res[0]?.id,
        description: `Ново основно средство ${input.inventoryNo} — ${input.name}`,
      }).catch(() => {});
      return { success: true, id: res[0]?.id };
    }),

  assetUpdate: publicQuery
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        category: z.string().optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        supplierId: z.number().nullable().optional(),
        invoiceRef: z.string().optional(),
        acquisitionDate: z.string().optional(),
        acquisitionValue: z.string().optional(),
        salvageValue: z.string().optional(),
        usefulLifeYears: z.string().optional(),
        rate: z.string().optional(),
        depreciationStart: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...rest } = input;
      const patch: any = { updatedAt: new Date() };
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) patch[k] = v;
      await db.update(fixedAssets).set(patch).where(eq(fixedAssets.id, id));
      return { success: true };
    }),

  assetDispose: publicQuery
    .input(z.object({
      id: z.number(),
      disposalDate: z.string(),
      disposalValue: z.string().default("0"),
      disposalNote: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const a: any = (await db.select().from(fixedAssets).where(eq(fixedAssets.id, input.id)))[0];
      if (!a) throw new Error("Средството не постои");
      const st = assetState({ ...toInput(a), disposalDate: input.disposalDate });
      await db.update(fixedAssets).set({
        status: "disposed",
        disposalDate: input.disposalDate,
        disposalValue: input.disposalValue,
        disposalNote: input.disposalNote ?? null,
        updatedAt: new Date(),
      } as any).where(eq(fixedAssets.id, input.id));
      const gain = Number(input.disposalValue) - st.bookValue;
      await logAudit({
        action: "UPDATE", entityType: "fixed_asset", entityId: input.id,
        description: `Расходувано ${a.inventoryNo}; сегашна вредност ${st.bookValue}, продадено за ${input.disposalValue}`,
      }).catch(() => {});
      return { success: true, bookValue: st.bookValue, gain: Math.round(gain * 100) / 100 };
    }),

  assetRestore: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(fixedAssets).set({
        status: "active", disposalDate: null, disposalValue: "0",
        disposalNote: null, updatedAt: new Date(),
      } as any).where(eq(fixedAssets.id, input.id));
      return { success: true };
    }),

  assetDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(depreciationEntries).where(eq(depreciationEntries.assetId, input.id));
      await db.delete(fixedAssets).where(eq(fixedAssets.id, input.id));
      return { success: true };
    }),

  // ═══════════ ГОДИШНА ПРЕСМЕТКА ═══════════
  depreciationRun: publicQuery
    .input(z.object({ year: z.number(), commit: z.boolean().default(false) }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = (await db.select().from(fixedAssets)) as any[];
      const posted = (await db.select().from(depreciationEntries)) as any[];
      const postedSet = new Set(posted.map((p) => `${p.assetId}|${p.year}`));

      const lines = rows
        .map((a) => {
          const sched = depreciationSchedule(toInput(a), input.year);
          const row = sched.find((r) => r.year === input.year);
          if (!row) return null;
          return {
            assetId: a.id,
            inventoryNo: a.inventoryNo,
            name: a.name,
            category: a.category,
            acquisitionValue: Number(a.acquisitionValue),
            rate: Number(a.rate),
            months: row.months,
            amount: row.amount,
            accumulated: row.accumulated,
            bookValue: row.bookValue,
            alreadyPosted: postedSet.has(`${a.id}|${input.year}`),
          };
        })
        .filter(Boolean) as any[];

      return {
        year: input.year,
        lines,
        total: Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100,
        newCount: lines.filter((l) => !l.alreadyPosted).length,
      };
    }),

  depreciationPost: publicQuery
    .input(z.object({ year: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const rows = (await db.select().from(fixedAssets)) as any[];
      const posted = (await db.select().from(depreciationEntries)) as any[];
      const postedSet = new Set(posted.map((p) => `${p.assetId}|${p.year}`));

      let count = 0, total = 0;
      for (const a of rows) {
        if (postedSet.has(`${a.id}|${input.year}`)) continue;
        const sched = depreciationSchedule(toInput(a), input.year);
        const row = sched.find((r) => r.year === input.year);
        if (!row || row.amount <= 0) continue;
        await db.insert(depreciationEntries).values({
          assetId: a.id,
          year: input.year,
          months: row.months,
          amount: String(row.amount),
          accumulatedAfter: String(row.accumulated),
          bookValueAfter: String(row.bookValue),
        } as any);
        count++;
        total += row.amount;
      }
      await logAudit({
        action: "CREATE", entityType: "depreciation",
        description: `Проведена амортизација за ${input.year}: ${count} средства, ${total.toFixed(2)} ден`,
      }).catch(() => {});
      return { success: true, count, total: Math.round(total * 100) / 100 };
    }),

  depreciationUnpost: publicQuery
    .input(z.object({ year: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const rows = (await db.select().from(depreciationEntries)) as any[];
      let removed = 0;
      for (const r of rows.filter((x) => x.year === input.year)) {
        await db.delete(depreciationEntries).where(eq(depreciationEntries.id, r.id));
        removed++;
      }
      return { success: true, removed };
    }),
});
