import { z } from "zod";
import { eq } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  machines, laborRates, overhead,
  productComponents, services, materials,
} from "@db/schema";

export const catalogRouter = createRouter({
  // ===== MACHINES =====
  machineList: publicQuery
    .input(z.object({ type: z.string().optional(), search: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      let result = await db.select().from(machines).orderBy(machines.name);
      if (input?.type) result = result.filter(r => r.type === input.type);
      if (input?.search) {
        const s = input.search.toLowerCase();
        result = result.filter(r => r.name.toLowerCase().includes(s));
      }
      return result;
    }),

  machineCreate: publicQuery
    .input(z.object({
      name: z.string().min(1),
      code: z.string().min(1),
      type: z.enum(["laser", "plasma", "bending", "welding", "painting", "grinding", "drilling", "cnc", "other"]),
      costPerHour: z.string().default("0"),
      costPerMeter: z.string().default("0"),
      annualAmortization: z.string().default("0"),
      annualElectricity: z.string().default("0"),
      annualGas: z.string().default("0"),
      annualService: z.string().default("0"),
      annualHours: z.string().default("2000"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(machines).values(input as any);
      return { success: true };
    }),

  machineUpdate: publicQuery
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      costPerHour: z.string().optional(),
      costPerMeter: z.string().optional(),
      annualAmortization: z.string().optional(),
      annualElectricity: z.string().optional(),
      annualGas: z.string().optional(),
      annualService: z.string().optional(),
      annualHours: z.string().optional(),
      isActive: z.enum(["active", "inactive"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(machines).set(data).where(eq(machines.id, id));
      return { success: true };
    }),

  machineDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(machines).where(eq(machines.id, input.id));
      return { success: true };
    }),

  // ===== LABOR RATES =====
  laborRateList: publicQuery.query(async () => {
    const db = getDb();
    return await db.select().from(laborRates).orderBy(laborRates.role);
  }),

  laborRateCreate: publicQuery
    .input(z.object({
      role: z.string().min(1),
      roleCode: z.string().min(1),
      costPerHour: z.string(),
      grossSalary: z.string().default("0"),
      contributionsPct: z.string().default("32"),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(laborRates).values(input as any);
      return { success: true };
    }),

  laborRateUpdate: publicQuery
    .input(z.object({
      id: z.number(),
      role: z.string().optional(),
      costPerHour: z.string().optional(),
      grossSalary: z.string().optional(),
      contributionsPct: z.string().optional(),
      isActive: z.enum(["active", "inactive"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(laborRates).set(data).where(eq(laborRates.id, id));
      return { success: true };
    }),

  laborRateDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(laborRates).where(eq(laborRates.id, input.id));
      return { success: true };
    }),

  // ===== OVERHEAD =====
  overheadList: publicQuery.query(async () => {
    const db = getDb();
    return await db.select().from(overhead).orderBy(overhead.name);
  }),

  overheadCreate: publicQuery
    .input(z.object({
      name: z.string().min(1),
      rateType: z.enum(["pct_of_labor", "per_hour", "per_m2", "fixed"]),
      rateValue: z.string(),
      annualAmount: z.string().default("0"),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(overhead).values(input as any);
      return { success: true };
    }),

  overheadUpdate: publicQuery
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      rateValue: z.string().optional(),
      annualAmount: z.string().optional(),
      isActive: z.enum(["active", "inactive"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(overhead).set(data).where(eq(overhead.id, id));
      return { success: true };
    }),

  overheadDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(overhead).where(eq(overhead.id, input.id));
      return { success: true };
    }),

  // ===== PRODUCT COMPONENTS (BOM) =====
  bomList: publicQuery
    .input(z.object({ productId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const comps = await db.select().from(productComponents)
        .where(eq(productComponents.productId, input.productId))
        .orderBy(productComponents.sortOrder);

      // Enrich with names
      const enriched = [];
      for (const c of comps) {
        let name = "";
        if (c.kind === "material") {
          const m = await db.select().from(materials).where(eq(materials.id, c.refId));
          name = m[0]?.name ?? "";
        } else {
          const s = await db.select().from(services).where(eq(services.id, c.refId));
          name = s[0]?.name ?? "";
        }
        enriched.push({ ...c, refName: name });
      }
      return enriched;
    }),

  bomCreate: publicQuery
    .input(z.object({
      productId: z.number(),
      kind: z.enum(["material", "service"]),
      refId: z.number(),
      perUnit: z.string(),
      wastePct: z.string().default("0"),
      scale: z.enum(["area", "perimeter", "length", "fixed"]).default("area"),
      notes: z.string().optional(),
      sortOrder: z.number().default(0),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(productComponents).values(input as any);
      return { success: true };
    }),

  bomUpdate: publicQuery
    .input(z.object({
      id: z.number(),
      perUnit: z.string().optional(),
      wastePct: z.string().optional(),
      scale: z.enum(["area", "perimeter", "length", "fixed"]).optional(),
      notes: z.string().optional(),
      sortOrder: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(productComponents).set(data).where(eq(productComponents.id, id));
      return { success: true };
    }),

  bomDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(productComponents).where(eq(productComponents.id, input.id));
      return { success: true };
    }),

  // ===== MACHINE HOUR CALCULATOR =====
  machineCalculate: publicQuery
    .input(z.object({
      id: z.number(),
      annualAmortization: z.string().default("0"),
      annualElectricity: z.string().default("0"),
      annualGas: z.string().default("0"),
      annualService: z.string().default("0"),
      annualOther: z.string().default("0"),
      annualHours: z.string().default("2000"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, annualOther, ...machineData } = input;

      const amortization = parseFloat(machineData.annualAmortization) || 0;
      const electricity = parseFloat(machineData.annualElectricity) || 0;
      const gas = parseFloat(machineData.annualGas) || 0;
      const service = parseFloat(machineData.annualService) || 0;
      const other = parseFloat(annualOther) || 0;
      const hours = parseFloat(machineData.annualHours) || 2000;

      if (hours <= 0) {
        throw new Error("Работните часови мора да бидат поголеми од 0");
      }

      const totalCosts = amortization + electricity + gas + service + other;
      const costPerHour = totalCosts / hours;

      // Update machine with calculated cost and input data
      await db.update(machines).set({
        costPerHour: costPerHour.toFixed(2),
        annualAmortization: machineData.annualAmortization,
        annualElectricity: machineData.annualElectricity,
        annualGas: machineData.annualGas,
        annualService: machineData.annualService,
        annualHours: machineData.annualHours,
      }).where(eq(machines.id, id));

      return {
        totalCosts: totalCosts.toFixed(2),
        costPerHour: costPerHour.toFixed(2),
        hours,
        breakdown: {
          amortization,
          electricity,
          gas,
          service,
          other,
        },
      };
    }),

  // ===== ESTIMATOR: Calculate product cost/price =====
  estimateProduct: publicQuery
    .input(z.object({
      productId: z.number(),
      area: z.string(),
      perimeter: z.string().optional(),
      length: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = getDb();
      const { productId, area, perimeter, length } = input;
      const a = parseFloat(area) || 0;
      const p = parseFloat(perimeter || "0");
      const l = parseFloat(length || "0");

      const comps = await db.select().from(productComponents)
        .where(eq(productComponents.productId, productId));

      let materialCost = 0;
      let serviceCost = 0;
      const details = [];

      for (const c of comps) {
        let qty = 0;
        switch (c.scale) {
          case "area": qty = a * parseFloat(c.perUnit); break;
          case "perimeter": qty = p * parseFloat(c.perUnit); break;
          case "length": qty = l * parseFloat(c.perUnit); break;
          case "fixed": qty = parseFloat(c.perUnit); break;
        }
        const waste = qty * (parseFloat(c.wastePct) / 100);
        const totalQty = qty + waste;

        let unitCost = 0;
        let totalCost = 0;

        if (c.kind === "material") {
          const m = await db.select().from(materials).where(eq(materials.id, c.refId));
          unitCost = parseFloat(m[0]?.avgCost ?? "0") || parseFloat(m[0]?.lastPurchasePrice ?? "0");
          totalCost = totalQty * unitCost;
          materialCost += totalCost;
        } else {
          const s = await db.select().from(services).where(eq(services.id, c.refId));
          unitCost = parseFloat(s[0]?.costRate ?? "0");
          totalCost = totalQty * unitCost;
          serviceCost += totalCost;
        }

        details.push({
          kind: c.kind,
          refId: c.refId,
          qty,
          waste,
          totalQty,
          unitCost,
          totalCost,
          scale: c.scale,
        });
      }

      return {
        materialCost: materialCost.toFixed(2),
        serviceCost: serviceCost.toFixed(2),
        totalCost: (materialCost + serviceCost).toFixed(2),
        details,
      };
    }),
});
