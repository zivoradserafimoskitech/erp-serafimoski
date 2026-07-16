import { z } from "zod";
import { eq, desc } from "drizzle-orm";
// PostgreSQL compat
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  quotations, quotationItems,
  services, products, productComponents, materials,
  customers, orders, orderItems,
} from "@db/schema";
import { logAudit } from "./audit-helper";

export const quotationRouter = createRouter({
  // ===== SERVICES =====
  serviceList: publicQuery
    .input(z.object({ search: z.string().optional(), type: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      let result = await db.select().from(services).orderBy(services.name);
      if (input?.type) result = result.filter(r => r.type === input.type);
      if (input?.search) {
        const s = input.search.toLowerCase();
        result = result.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s));
      }
      return result;
    }),

  serviceCreate: publicQuery
    .input(z.object({
      name: z.string().min(1), code: z.string().min(1),
      type: z.enum(["laser_cutting", "plasma_cutting", "bending", "mig_welding", "tig_welding", "grinding", "drilling", "electrostatic_paint", "wet_paint", "galvanizing", "cnc_machining", "labor", "design", "transport", "installation", "other"]),
      unit: z.enum(["m2", "m", "kg", "hour", "pcs", "job", "m_cut", "bend"]),
      description: z.string().optional(),
      costRate: z.string().default("0"),
      saleRate: z.string().default("0"),
      machineId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(services).values(input as any);
      return { success: true };
    }),

  serviceUpdate: publicQuery
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      costRate: z.string().optional(),
      saleRate: z.string().optional(),
      isActive: z.enum(["active", "inactive"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(services).set(data).where(eq(services.id, id));
      return { success: true };
    }),

  serviceDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(services).where(eq(services.id, input.id));
      return { success: true };
    }),

  // ===== PRODUCTS =====
  productList: publicQuery
    .input(z.object({ search: z.string().optional(), category: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      let result = await db.select().from(products).orderBy(products.name);
      if (input?.category) result = result.filter(r => r.category === input.category);
      if (input?.search) {
        const s = input.search.toLowerCase();
        result = result.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s));
      }
      return result;
    }),

  productCreate: publicQuery
    .input(z.object({
      name: z.string().min(1), code: z.string().min(1),
      category: z.enum(["laser_fence", "decorative_fence", "metal_fence", "balcony_railing", "stair_railing", "gate", "pergola", "canopy", "metal_door", "industrial_product", "custom_metalwork", "shelf", "worktable", "other"]),
      description: z.string().optional(),
      unit: z.enum(["m2", "m", "kg", "pcs", "set"]),
      basis: z.enum(["m2", "m", "pcs"]).default("m2"),
      defaultPrice: z.string().default("0"),
      materialCost: z.string().default("0"),
      laborCost: z.string().default("0"),
      machineCost: z.string().default("0"),
      overheadCost: z.string().default("0"),
      totalCost: z.string().default("0"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(products).values(input as any);
      return { success: true };
    }),

  productUpdate: publicQuery
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      defaultPrice: z.string().optional(),
      materialCost: z.string().optional(),
      laborCost: z.string().optional(),
      machineCost: z.string().optional(),
      overheadCost: z.string().optional(),
      totalCost: z.string().optional(),
      isActive: z.enum(["active", "inactive"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(products).set(data).where(eq(products.id, id));
      return { success: true };
    }),

  productDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(products).where(eq(products.id, input.id));
      return { success: true };
    }),

  // ===== MATERIALS FOR QUOTE =====
  materialList: publicQuery
    .input(z.object({ search: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      let result = await db.select({
        id: materials.id, name: materials.name, code: materials.code,
        type: materials.type, unit: materials.unit, currentStock: materials.currentStock, avgCost: materials.avgCost,
      }).from(materials).where(eq(materials.isActive, "active")).orderBy(materials.name);
      if (input?.search) {
        const s = input.search.toLowerCase();
        result = result.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s));
      }
      return result;
    }),

  // ===== ESTIMATE FROM PRODUCT =====
  estimateFromProduct: publicQuery
    .input(z.object({
      productId: z.number(),
      area: z.string(),
      perimeter: z.string().optional(),
      length: z.string().optional(),
      quantity: z.string().default("1"),
    }))
    .query(async ({ input }) => {
      const db = getDb();
      const { productId, area, perimeter, length, quantity } = input;
      const a = parseFloat(area) || 0;
      const p = parseFloat(perimeter || "0");
      const l = parseFloat(length || "0");
      const qty = parseFloat(quantity) || 1;

      const comps = await db.select().from(productComponents)
        .where(eq(productComponents.productId, productId));

      let materialCost = 0;
      let serviceCost = 0;
      const lineItems = [];

      for (const c of comps) {
        let baseQty = 0;
        switch (c.scale) {
          case "area": baseQty = a * parseFloat(c.perUnit); break;
          case "perimeter": baseQty = p * parseFloat(c.perUnit); break;
          case "length": baseQty = l * parseFloat(c.perUnit); break;
          case "fixed": baseQty = parseFloat(c.perUnit); break;
        }
        const waste = baseQty * (parseFloat(c.wastePct) / 100);
        const totalQty = (baseQty + waste) * qty;

        if (c.kind === "material") {
          const m = await db.select().from(materials).where(eq(materials.id, c.refId));
          const unitCost = parseFloat(m[0]?.avgCost ?? "0") || parseFloat(m[0]?.lastPurchasePrice ?? "0");
          const totalCost = totalQty * unitCost;
          materialCost += totalCost;
          lineItems.push({
            itemType: "material" as const,
            referenceId: c.refId,
            description: m[0]?.name ?? "Материјал",
            quantity: totalQty.toFixed(3),
            unit: m[0]?.unit ?? "kg",
            unitCost: unitCost.toFixed(2),
            totalCost: totalCost.toFixed(2),
            sortOrder: c.sortOrder,
          });
        } else {
          const s = await db.select().from(services).where(eq(services.id, c.refId));
          const unitCost = parseFloat(s[0]?.costRate ?? "0");
          const totalCost = totalQty * unitCost;
          serviceCost += totalCost;
          lineItems.push({
            itemType: "service" as const,
            referenceId: c.refId,
            description: s[0]?.name ?? "Услуга",
            quantity: totalQty.toFixed(3),
            unit: s[0]?.unit ?? "hour",
            unitCost: unitCost.toFixed(2),
            totalCost: totalCost.toFixed(2),
            sortOrder: c.sortOrder,
          });
        }
      }

      const totalCost = materialCost + serviceCost;
      return {
        materialCost: materialCost.toFixed(2),
        serviceCost: serviceCost.toFixed(2),
        totalCost: totalCost.toFixed(2),
        lineItems,
      };
    }),

  // ===== QUOTATIONS =====
  quotationNextNumber: publicQuery.query(async () => {
    const { peekNextDocNumber } = await import("./counters-helper");
    return peekNextDocNumber("quote");
  }),

  quotationList: publicQuery
    .input(z.object({ status: z.string().optional(), search: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db
        .select({
          id: quotations.id, quoteNumber: quotations.quoteNumber, customerId: quotations.customerId,
          status: quotations.status, subtotal: quotations.subtotal,
          costAmount: quotations.costAmount, marginAmount: quotations.marginAmount, marginPercent: quotations.marginPercent,
          vatRate: quotations.vatRate, vatAmount: quotations.vatAmount, totalAmount: quotations.totalAmount,
          currency: quotations.currency, validUntil: quotations.validUntil,
          deliveryDays: quotations.deliveryDays, paymentTerms: quotations.paymentTerms,
          notes: quotations.notes, convertedOrderId: quotations.convertedOrderId,
          createdAt: quotations.createdAt, updatedAt: quotations.updatedAt,
          customerName: customers.name, customerCompany: customers.company,
        })
        .from(quotations)
        .leftJoin(customers, eq(quotations.customerId, customers.id))
        .orderBy(desc(quotations.createdAt));

      let filtered = result;
      if (input?.status) filtered = filtered.filter(r => r.status === input.status);
      if (input?.search) {
        const s = input.search.toLowerCase();
        filtered = filtered.filter(r => r.quoteNumber.toLowerCase().includes(s) || r.customerName?.toLowerCase().includes(s));
      }
      return filtered;
    }),

  quotationById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const q = await db.select().from(quotations).where(eq(quotations.id, input.id));
      if (!q[0]) return null;
      const items = await db.select().from(quotationItems).where(eq(quotationItems.quotationId, input.id)).orderBy(quotationItems.sortOrder);
      const cust = await db.select().from(customers).where(eq(customers.id, q[0].customerId));
      return { ...q[0], items, customer: cust[0] ?? null };
    }),

  quotationCreate: publicQuery
    .input(z.object({
      quoteNumber: z.string().min(1),
      customerId: z.number(),
      status: z.enum(["draft", "sent", "accepted", "rejected", "expired", "converted"]).default("draft"),
      subtotal: z.string().default("0"),
      costAmount: z.string().default("0"),
      marginAmount: z.string().default("0"),
      marginPercent: z.string().default("0"),
      vatRate: z.string().default("18"),
      vatAmount: z.string().default("0"),
      totalAmount: z.string().default("0"),
      currency: z.string().default("MKD"),
      validUntil: z.string().optional(),
      deliveryDays: z.number().default(14),
      paymentTerms: z.string().default("14 дена"),
      notes: z.string().optional(),
      items: z.array(z.object({
        itemType: z.enum(["material", "service", "product"]),
        referenceId: z.number().optional(),
        description: z.string().min(1),
        quantity: z.string(),
        unit: z.string(),
        unitPrice: z.string(),
        unitCost: z.string().default("0"),
        totalPrice: z.string(),
        totalCost: z.string().default("0"),
        vatRate: z.string().default("18"),
        notes: z.string().optional(),
        sortOrder: z.number().default(0),
      })).optional(),
    }))
    .mutation(async ({ input }) => {
      {
        const { bumpDocCounter } = await import("./counters-helper");
        await bumpDocCounter("quote", input.quoteNumber).catch(() => {});
      }
      const db = getDb();
      const { items, ...qData } = input;
      const result = await db.insert(quotations).values({
        ...qData,
        validUntil: qData.validUntil ? new Date(qData.validUntil) : null,
      } as any);
      const insertId = Number(result[0].insertId);
      if (items && items.length > 0) {
        await db.insert(quotationItems).values(items.map(i => ({ ...i, quotationId: insertId })));
      }
      await logAudit({ action: "CREATE", entityType: "quotation", entityId: insertId, description: `Креирана понуда ${qData.quoteNumber}` });
      return { success: true, id: insertId };
    }),

  quotationUpdate: publicQuery
    .input(z.object({
      id: z.number(),
      status: z.enum(["draft", "sent", "accepted", "rejected", "expired", "converted"]).optional(),
      validUntil: z.string().optional(),
      deliveryDays: z.number().optional(),
      paymentTerms: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      const updateData: any = { ...data };
      if (data.validUntil) updateData.validUntil = new Date(data.validUntil);
      await db.update(quotations).set(updateData).where(eq(quotations.id, id));
      return { success: true };
    }),

  quotationDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(quotationItems).where(eq(quotationItems.quotationId, input.id));
      await db.delete(quotations).where(eq(quotations.id, input.id));
      return { success: true };
    }),

  // ===== RECALCULATE MARGIN =====
  quotationRecalc: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const items = await db.select().from(quotationItems).where(eq(quotationItems.quotationId, input.id));
      const subtotal = items.reduce((s, i) => s + parseFloat(i.totalPrice), 0);
      const costTotal = items.reduce((s, i) => s + parseFloat(i.totalCost), 0);
      const margin = subtotal - costTotal;
      const marginPct = costTotal > 0 ? (margin / costTotal) * 100 : 0;
      const vat = subtotal * 0.18; // default
      await db.update(quotations).set({
        subtotal: subtotal.toFixed(2),
        costAmount: costTotal.toFixed(2),
        marginAmount: margin.toFixed(2),
        marginPercent: marginPct.toFixed(2),
        vatAmount: vat.toFixed(2),
        totalAmount: (subtotal + vat).toFixed(2),
      }).where(eq(quotations.id, input.id));
      return { success: true, subtotal, costTotal, margin, marginPct };
    }),

  // ===== CONVERT QUOTATION TO ORDER =====
  quotationConvert: publicQuery
    .input(z.object({
      quotationId: z.number(),
      orderNumber: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { quotationId, orderNumber } = input;

      const q = await db.select().from(quotations).where(eq(quotations.id, quotationId));
      if (!q[0]) throw new Error("Понудата не постои");
      if (q[0].status === "converted") throw new Error("Понудата е веќе претворена");

      const items = await db.select().from(quotationItems).where(eq(quotationItems.quotationId, quotationId)).orderBy(quotationItems.sortOrder);

      const orderResult = await db.insert(orders).values({
        orderNumber,
        customerId: q[0].customerId,
        status: "confirmed",
        priority: "normal",
        totalAmount: q[0].totalAmount,
        costAmount: q[0].costAmount,
        marginAmount: q[0].marginAmount,
        marginPercent: q[0].marginPercent,
        deliveryDate: q[0].validUntil,
        notes: q[0].notes ? `Конвертирано од понуда ${q[0].quoteNumber}. ${q[0].notes}` : `Конвертирано од понуда ${q[0].quoteNumber}`,
      } as any);
      const orderId = Number(orderResult[0].insertId);

      if (items.length > 0) {
        await db.insert(orderItems).values(items.map(i => ({
          orderId,
          description: i.description,
          quantity: Number(i.quantity),
          unitPrice: i.unitPrice,
          totalPrice: i.totalPrice,
          costPrice: i.totalCost,
          marginAmount: (parseFloat(i.totalPrice) - parseFloat(i.totalCost)).toFixed(2),
          material: i.itemType === "material" ? i.description : null,
          productId: i.referenceId,
          notes: i.notes,
        })));
      }

      await db.update(quotations).set({ status: "converted", convertedOrderId: orderId }).where(eq(quotations.id, quotationId));
      await logAudit({ action: "CONVERT", entityType: "quotation", entityId: quotationId, description: `Конвертирана понуда ${q[0].quoteNumber} во нарачка ${orderNumber}` });
      return { success: true, orderId };
    }),
});
