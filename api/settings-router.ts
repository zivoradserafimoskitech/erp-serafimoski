import { z } from "zod";
import { eq } from "./queries/pg-compat";
// PostgreSQL compat
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { companySettings, units, unitConversions } from "@db/schema";

export const settingsRouter = createRouter({
  // ===== COMPANY SETTINGS =====
  settingsGet: publicQuery.query(async () => {
    const db = getDb();
    const result = await db.select().from(companySettings);
    return result[0] ?? null;
  }),

  settingsUpsert: publicQuery
    .input(z.object({
      name: z.string().min(1),
      address: z.string().optional(),
      edb: z.string().min(1),
      embs: z.string().optional(),
      bankName: z.string().optional(),
      bankAccount: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional(),
      logoUrl: z.string().optional(),
      defaultVatRate: z.string().default("18"),
      valuationMethod: z.enum(["weighted_average", "fifo"]).default("weighted_average"),
      currency: z.string().default("MKD"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.select().from(companySettings);
      if (existing.length === 0) {
        await db.insert(companySettings).values(input as any);
      } else {
        await db.update(companySettings).set(input as any).where(eq(companySettings.id, existing[0].id));
      }
      return { success: true };
    }),

  // ===== UNITS =====
  unitList: publicQuery.query(async () => {
    const db = getDb();
    return await db.select().from(units).orderBy(units.name);
  }),

  unitCreate: publicQuery
    .input(z.object({
      code: z.string().min(1),
      name: z.string().min(1),
      nameMk: z.string().optional(),
      category: z.enum(["weight", "length", "area", "volume", "piece", "time", "other"]).default("other"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(units).values(input as any);
      return { success: true };
    }),

  unitDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(units).where(eq(units.id, input.id));
      return { success: true };
    }),

  // ===== UNIT CONVERSIONS =====
  conversionList: publicQuery.query(async () => {
    const db = getDb();
    return await db.select().from(unitConversions).orderBy(unitConversions.id);
  }),

  conversionCreate: publicQuery
    .input(z.object({
      fromUnitId: z.number(),
      toUnitId: z.number(),
      factor: z.string(),
      materialType: z.string().optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(unitConversions).values(input as any);
      return { success: true };
    }),

  conversionDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(unitConversions).where(eq(unitConversions.id, input.id));
      return { success: true };
    }),
});
