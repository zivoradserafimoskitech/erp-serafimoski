import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  quotations, quotationItems,
  services, products,
  materials, customers, orders, orderItems,
} from "@db/schema";

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
      unit: z.enum(["m2", "m", "kg", "hour", "pcs", "job"]),
      description: z.string().optional(),
      defaultPrice: z.string().default("0"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(services).values(input);
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
      defaultPrice: z.string().default("0"),
      materialCost: z.string().default("0"),
      laborCost: z.string().default("0"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(products).values(input);
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
        type: materials.type, unit: materials.unit, currentStock: materials.currentStock,
      }).from(materials).orderBy(materials.name);
      if (input?.search) {
        const s = input.search.toLowerCase();
        result = result.filter(r => r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s));
      }
      return result;
    }),

  // ===== QUOTATIONS =====
  quotationList: publicQuery
    .input(z.object({ status: z.string().optional(), search: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db
        .select({
          id: quotations.id, quoteNumber: quotations.quoteNumber, customerId: quotations.customerId,
          status: quotations.status, subtotal: quotations.subtotal, vatRate: quotations.vatRate,
          vatAmount: quotations.vatAmount, totalAmount: quotations.totalAmount,
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
        totalPrice: z.string(),
        vatRate: z.string().default("18"),
        notes: z.string().optional(),
        sortOrder: z.number().default(0),
      })).optional(),
    }))
    .mutation(async ({ input }) => {
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

      // Create order
      const orderResult = await db.insert(orders).values({
        orderNumber,
        customerId: q[0].customerId,
        status: "confirmed",
        priority: "normal",
        totalAmount: q[0].totalAmount,
        deliveryDate: q[0].validUntil,
        notes: q[0].notes ? `Конвертирано од понуда ${q[0].quoteNumber}. ${q[0].notes}` : `Конвертирано од понуда ${q[0].quoteNumber}`,
      } as any);
      const orderId = Number(orderResult[0].insertId);

      // Create order items
      if (items.length > 0) {
        await db.insert(orderItems).values(items.map(i => ({
          orderId,
          description: i.description,
          quantity: Number(i.quantity),
          unitPrice: i.unitPrice,
          totalPrice: i.totalPrice,
          material: i.itemType === "material" ? i.description : null,
          notes: i.notes,
        })));
      }

      // Update quotation status
      await db.update(quotations).set({ status: "converted", convertedOrderId: orderId }).where(eq(quotations.id, quotationId));

      return { success: true, orderId };
    }),
});
