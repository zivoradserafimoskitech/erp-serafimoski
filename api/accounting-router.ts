import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
// PostgreSQL compat
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  invoices, incomingInvoices, documentItems,
  receipts, receiptItems, deliveryNotes,
  eInvoices, parsedInvoices,
  customers, suppliers, materials,
  finishedGoodsStock, products, services,
  warehouses, workOrders as workOrdersTable,
} from "@db/schema";
import { sendInvoice, checkInvoiceStatus, lookupCompany, generateUJPXml, getActiveCertificates, storeCertificate, type UJPInvoicePayload } from "./ujp-service";
import { logAudit } from "./audit-helper";
import { getNextDocNumber } from "./counters-helper";

export const accountingRouter = createRouter({
  // ===== OUTGOING INVOICES =====
  invoiceList: publicQuery
    .input(z.object({ status: z.string().optional(), customerId: z.number().optional(), search: z.string().optional(), type: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db
        .select({
          id: invoices.id, invoiceNumber: invoices.invoiceNumber, customerId: invoices.customerId,
          orderId: invoices.orderId, workOrderId: invoices.workOrderId,
          status: invoices.status, invoiceType: invoices.invoiceType,
          issueDate: invoices.issueDate, dueDate: invoices.dueDate,
          subtotal: invoices.subtotal, vatRate: invoices.vatRate,
          vatAmount: invoices.vatAmount, totalAmount: invoices.totalAmount,
          currency: invoices.currency, notes: invoices.notes,
          eInvoiceId: invoices.eInvoiceId, originalInvoiceId: invoices.originalInvoiceId,
          createdAt: invoices.createdAt,
          customerName: customers.name, customerCompany: customers.company,
        })
        .from(invoices)
        .leftJoin(customers, eq(invoices.customerId, customers.id))
        .orderBy(desc(invoices.createdAt));

      let filtered = result;
      if (input?.status) filtered = filtered.filter(r => r.status === input.status);
      if (input?.type) filtered = filtered.filter(r => r.invoiceType === input.type);
      if (input?.customerId) filtered = filtered.filter(r => r.customerId === input.customerId);
      if (input?.search) {
        const s = input.search.toLowerCase();
        filtered = filtered.filter(r => r.invoiceNumber.toLowerCase().includes(s) || r.customerName?.toLowerCase().includes(s));
      }
      return filtered;
    }),

  invoiceById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const inv = await db.select().from(invoices).where(eq(invoices.id, input.id));
      if (!inv[0]) return null;
      const items = await db.select({
        id: documentItems.id,
        documentId: documentItems.documentId,
        documentType: documentItems.documentType,
        description: documentItems.description,
        quantity: documentItems.quantity,
        unit: documentItems.unit,
        unitPrice: documentItems.unitPrice,
        discount: documentItems.discount,
        totalPrice: documentItems.totalPrice,
        vatRate: documentItems.vatRate,
        productId: documentItems.productId,
        serviceId: documentItems.serviceId,
        itemType: documentItems.itemType,
        notes: documentItems.notes,
        createdAt: documentItems.createdAt,
      }).from(documentItems).where(and(eq(documentItems.documentId, input.id), eq(documentItems.documentType, "invoice")));
      const cust = await db.select().from(customers).where(eq(customers.id, inv[0].customerId));
      return { ...inv[0], items, customer: cust[0] ?? null };
    }),

  invoiceCreate: publicQuery
    .input(z.object({
      invoiceNumber: z.string().min(1),
      customerId: z.number(),
      orderId: z.number().optional(),
      workOrderId: z.number().optional(),
      status: z.enum(["draft", "issued", "sent", "paid", "overdue", "cancelled"]).default("draft"),
      invoiceType: z.enum(["standard", "proforma", "credit_note"]).default("standard"),
      issueDate: z.string(),
      dueDate: z.string().optional(),
      subtotal: z.string().default("0"),
      vatRate: z.string().default("18"),
      vatAmount: z.string().default("0"),
      totalAmount: z.string().default("0"),
      currency: z.string().default("MKD"),
      notes: z.string().optional(),
      originalInvoiceId: z.number().optional(),
      items: z.array(z.object({
        description: z.string().min(1),
        quantity: z.string(),
        unit: z.string().default("ком"),
        unitPrice: z.string(),
        discount: z.string().default("0"),
        totalPrice: z.string(),
        vatRate: z.string().default("18"),
        notes: z.string().optional(),
        productId: z.number().optional(),
        serviceId: z.number().optional(),
        itemType: z.enum(["product", "service", "manual"]).default("manual"),
      })).optional(),
    }))
    .mutation(async ({ input }) => {
      {
        const { bumpDocCounter } = await import("./counters-helper");
        await bumpDocCounter("invoice", input.invoiceNumber).catch(() => {});
      }
      const db = getDb();
      const { items, ...invData } = input;

      // Validate stock for products
      if (items) {
        for (const item of items) {
          if (item.itemType === "product" && item.productId) {
            const stock = await db.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.productId, item.productId));
            const totalStock = stock.reduce((sum, s) => sum + parseFloat(String(s.quantity)), 0);
            const qty = parseFloat(item.quantity);
            if (totalStock < qty) {
              throw new Error(`Нема доволно залиха за ${item.description}. На залиха: ${totalStock.toFixed(3)}, потребно: ${qty.toFixed(3)}`);
            }
          }
        }
      }

      const result = await db.insert(invoices).values({
        ...invData,
        issueDate: new Date(invData.issueDate),
        dueDate: invData.dueDate ? new Date(invData.dueDate) : null,
      } as any);
      const insertId = Number(result[0].insertId);

      if (items && items.length > 0) {
        await db.insert(documentItems).values(items.map(i => ({
          description: i.description,
          quantity: i.quantity,
          unit: i.unit,
          unitPrice: i.unitPrice,
          discount: i.discount,
          totalPrice: i.totalPrice,
          vatRate: i.vatRate,
          notes: i.notes,
          productId: i.productId,
          serviceId: i.serviceId,
          itemType: i.itemType,
          documentId: insertId,
          documentType: "invoice" as const,
        })));
      }

      // Deduct stock for products when invoice is issued
      if (items && invData.status === "issued") {
        for (const item of items) {
          if (item.itemType === "product" && item.productId) {
            const stockEntries = await db.select().from(finishedGoodsStock)
              .where(eq(finishedGoodsStock.productId, item.productId))
              .orderBy(finishedGoodsStock.id);

            let remainingQty = parseFloat(item.quantity);
            for (const entry of stockEntries) {
              if (remainingQty <= 0) break;
              const entryQty = parseFloat(String(entry.quantity));
              const deduct = Math.min(entryQty, remainingQty);
              await db.update(finishedGoodsStock)
                .set({ quantity: String(entryQty - deduct) })
                .where(eq(finishedGoodsStock.id, entry.id));
              remainingQty -= deduct;
            }
          }
        }
      }

      await logAudit({ action: "CREATE", entityType: "invoice", entityId: insertId, description: `Креирана фактура ${invData.invoiceNumber}` });
      return { success: true, id: insertId };
    }),

  invoiceUpdate: publicQuery
    .input(z.object({
      id: z.number(),
      status: z.enum(["draft", "issued", "sent", "paid", "overdue", "cancelled"]).optional(),
      dueDate: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      const updateData: any = { ...data };
      if (data.dueDate) updateData.dueDate = new Date(data.dueDate);
      await db.update(invoices).set(updateData).where(eq(invoices.id, id));
      return { success: true };
    }),

  invoiceDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(documentItems).where(and(eq(documentItems.documentId, input.id), eq(documentItems.documentType, "invoice")));
      await db.delete(invoices).where(eq(invoices.id, input.id));
      return { success: true };
    }),

  // ===== INCOMING INVOICES =====
  incomingInvoiceList: publicQuery
    .input(z.object({ status: z.string().optional(), supplierId: z.number().optional(), search: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db
        .select({
          id: incomingInvoices.id, supplierInvoiceNumber: incomingInvoices.supplierInvoiceNumber,
          supplierId: incomingInvoices.supplierId, poId: incomingInvoices.poId, receiptId: incomingInvoices.receiptId,
          status: incomingInvoices.status, issueDate: incomingInvoices.issueDate,
          receivedDate: incomingInvoices.receivedDate, dueDate: incomingInvoices.dueDate,
          subtotal: incomingInvoices.subtotal, vatRate: incomingInvoices.vatRate,
          vatAmount: incomingInvoices.vatAmount, totalAmount: incomingInvoices.totalAmount,
          currency: incomingInvoices.currency, notes: incomingInvoices.notes,
          fileUrl: incomingInvoices.fileUrl, createdAt: incomingInvoices.createdAt,
          supplierName: suppliers.name,
        })
        .from(incomingInvoices)
        .leftJoin(suppliers, eq(incomingInvoices.supplierId, suppliers.id))
        .orderBy(desc(incomingInvoices.createdAt));

      let filtered = result;
      if (input?.status) filtered = filtered.filter(r => r.status === input.status);
      if (input?.supplierId) filtered = filtered.filter(r => r.supplierId === input.supplierId);
      if (input?.search) {
        const s = input.search.toLowerCase();
        filtered = filtered.filter(r => r.supplierInvoiceNumber.toLowerCase().includes(s) || r.supplierName?.toLowerCase().includes(s));
      }
      return filtered;
    }),

  incomingInvoiceById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const inv = await db.select().from(incomingInvoices).where(eq(incomingInvoices.id, input.id));
      if (!inv[0]) return null;
      const items = await db.select().from(documentItems).where(and(eq(documentItems.documentId, input.id), eq(documentItems.documentType, "incoming_invoice")));
      const sup = await db.select().from(suppliers).where(eq(suppliers.id, inv[0].supplierId));
      return { ...inv[0], items, supplier: sup[0] ?? null };
    }),

  incomingInvoiceCreate: publicQuery
    .input(z.object({
      supplierInvoiceNumber: z.string().min(1),
      supplierId: z.number(),
      poId: z.number().optional(),
      receiptId: z.number().optional(),
      status: z.enum(["received", "verified", "paid", "disputed", "cancelled"]).default("received"),
      issueDate: z.string().optional(),
      receivedDate: z.string(),
      dueDate: z.string().optional(),
      subtotal: z.string().default("0"),
      vatRate: z.string().default("18"),
      vatAmount: z.string().default("0"),
      totalAmount: z.string().default("0"),
      currency: z.string().default("MKD"),
      notes: z.string().optional(),
      fileUrl: z.string().optional(),
      items: z.array(z.object({
        description: z.string().min(1),
        quantity: z.string(),
        unit: z.string().default("ком"),
        unitPrice: z.string(),
        discount: z.string().default("0"),
        totalPrice: z.string(),
        vatRate: z.string().default("18"),
        notes: z.string().optional(),
      })).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { items, ...invData } = input;
      const result = await db.insert(incomingInvoices).values({
        ...invData,
        issueDate: invData.issueDate ? new Date(invData.issueDate) : null,
        receivedDate: new Date(invData.receivedDate),
        dueDate: invData.dueDate ? new Date(invData.dueDate) : null,
      } as any);
      const insertId = Number(result[0].insertId);
      if (items && items.length > 0) {
        await db.insert(documentItems).values(items.map(i => ({ ...i, documentId: insertId, documentType: "incoming_invoice" as const })));
      }
      return { success: true, id: insertId };
    }),

  incomingInvoiceUpdate: publicQuery
    .input(z.object({
      id: z.number(),
      status: z.enum(["received", "verified", "paid", "disputed", "cancelled"]).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(incomingInvoices).set(data).where(eq(incomingInvoices.id, id));
      return { success: true };
    }),

  incomingInvoiceDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(documentItems).where(and(eq(documentItems.documentId, input.id), eq(documentItems.documentType, "incoming_invoice")));
      await db.delete(incomingInvoices).where(eq(incomingInvoices.id, input.id));
      return { success: true };
    }),

  // ===== RECEIPTS =====
  receiptList: publicQuery
    .input(z.object({ status: z.string().optional(), search: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db
        .select({
          id: receipts.id, receiptNumber: receipts.receiptNumber,
          supplierId: receipts.supplierId, poId: receipts.poId,
          warehouseId: receipts.warehouseId, status: receipts.status,
          receiptDate: receipts.receiptDate, supplierDocNumber: receipts.supplierDocNumber,
          transportCost: receipts.transportCost, customsCost: receipts.customsCost,
          otherCost: receipts.otherCost, totalAmount: receipts.totalAmount,
          notes: receipts.notes, fileUrl: receipts.fileUrl, createdAt: receipts.createdAt,
          supplierName: suppliers.name,
        })
        .from(receipts)
        .leftJoin(suppliers, eq(receipts.supplierId, suppliers.id))
        .orderBy(desc(receipts.createdAt));

      let filtered = result;
      if (input?.status) filtered = filtered.filter(r => r.status === input.status);
      if (input?.search) {
        const s = input.search.toLowerCase();
        filtered = filtered.filter(r => r.receiptNumber.toLowerCase().includes(s) || r.supplierName?.toLowerCase().includes(s));
      }
      return filtered;
    }),

  receiptById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const r = await db.select().from(receipts).where(eq(receipts.id, input.id));
      if (!r[0]) return null;
      const items = await db
        .select({
          id: receiptItems.id, receiptId: receiptItems.receiptId,
          materialId: receiptItems.materialId, quantity: receiptItems.quantity,
          unit: receiptItems.unit, unitPrice: receiptItems.unitPrice,
          totalPrice: receiptItems.totalPrice, landedCostAlloc: receiptItems.landedCostAlloc,
          vatRate: receiptItems.vatRate, notes: receiptItems.notes,
          materialName: materials.name, materialCode: materials.code,
        })
        .from(receiptItems)
        .leftJoin(materials, eq(receiptItems.materialId, materials.id))
        .where(eq(receiptItems.receiptId, input.id));
      const sup = r[0].supplierId
        ? await db.select().from(suppliers).where(eq(suppliers.id, r[0].supplierId))
        : [];
      return { ...r[0], items, supplier: sup[0] ?? null };
    }),

  receiptCreate: publicQuery
    .input(z.object({
      receiptNumber: z.string().min(1),
      supplierId: z.number().optional(),
      poId: z.number().optional(),
      warehouseId: z.number(),
      status: z.enum(["draft", "confirmed", "cancelled"]).default("draft"),
      receiptDate: z.string(),
      supplierDocNumber: z.string().optional(),
      transportCost: z.string().default("0"),
      customsCost: z.string().default("0"),
      otherCost: z.string().default("0"),
      totalAmount: z.string().default("0"),
      notes: z.string().optional(),
      fileUrl: z.string().optional(),
      items: z.array(z.object({
        materialId: z.number(),
        quantity: z.string(),
        unit: z.string(),
        unitPrice: z.string(),
        totalPrice: z.string(),
        landedCostAlloc: z.string().default("0"),
        vatRate: z.string().default("18"),
        notes: z.string().optional(),
      })).optional(),
    }))
    .mutation(async ({ input }) => {
      {
        const { bumpDocCounter } = await import("./counters-helper");
        await bumpDocCounter("receipt", input.receiptNumber).catch(() => {});
      }
      const db = getDb();
      const { items, ...data } = input;
      const result = await db.insert(receipts).values({
        ...data,
        receiptDate: new Date(data.receiptDate),
        supplierId: data.supplierId ?? null,
        poId: data.poId ?? null,
      } as any);
      const insertId = Number(result[0].insertId);
      if (items && items.length > 0) {
        await db.insert(receiptItems).values(items.map(i => ({ ...i, receiptId: insertId })));
      }
      return { success: true, id: insertId };
    }),

  receiptUpdate: publicQuery
    .input(z.object({
      id: z.number(),
      status: z.enum(["draft", "confirmed", "cancelled"]).optional(),
      supplierDocNumber: z.string().optional(),
      transportCost: z.string().optional(),
      customsCost: z.string().optional(),
      otherCost: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(receipts).set(data).where(eq(receipts.id, id));
      return { success: true };
    }),

  receiptDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(receiptItems).where(eq(receiptItems.receiptId, input.id));
      await db.delete(receipts).where(eq(receipts.id, input.id));
      return { success: true };
    }),

  // ===== DELIVERY NOTES =====
  deliveryNoteList: publicQuery
    .input(z.object({ status: z.string().optional(), search: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db
        .select({
          id: deliveryNotes.id, dnNumber: deliveryNotes.dnNumber,
          customerId: deliveryNotes.customerId, orderId: deliveryNotes.orderId,
          status: deliveryNotes.status, issueDate: deliveryNotes.issueDate,
          deliveryDate: deliveryNotes.deliveryDate, totalItems: deliveryNotes.totalItems,
          notes: deliveryNotes.notes, createdAt: deliveryNotes.createdAt,
          customerName: customers.name, customerCompany: customers.company,
        })
        .from(deliveryNotes)
        .leftJoin(customers, eq(deliveryNotes.customerId, customers.id))
        .orderBy(desc(deliveryNotes.createdAt));

      let filtered = result;
      if (input?.status) filtered = filtered.filter(r => r.status === input.status);
      if (input?.search) {
        const s = input.search.toLowerCase();
        filtered = filtered.filter(r => r.dnNumber.toLowerCase().includes(s) || r.customerName?.toLowerCase().includes(s));
      }
      return filtered;
    }),

  deliveryNoteById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const dn = await db.select().from(deliveryNotes).where(eq(deliveryNotes.id, input.id));
      if (!dn[0]) return null;
      const items = await db.select().from(documentItems).where(and(eq(documentItems.documentId, input.id), eq(documentItems.documentType, "delivery_note")));
      const cust = await db.select().from(customers).where(eq(customers.id, dn[0].customerId));
      return { ...dn[0], items, customer: cust[0] ?? null };
    }),

  deliveryNoteCreate: publicQuery
    .input(z.object({
      dnNumber: z.string().min(1),
      customerId: z.number(),
      orderId: z.number().optional(),
      status: z.enum(["draft", "issued", "delivered", "cancelled"]).default("draft"),
      issueDate: z.string(),
      deliveryDate: z.string().optional(),
      totalItems: z.number().default(0),
      notes: z.string().optional(),
      items: z.array(z.object({
        description: z.string().min(1),
        quantity: z.string(),
        unit: z.string().default("ком"),
        unitPrice: z.string().default("0"),
        totalPrice: z.string().default("0"),
        notes: z.string().optional(),
        productId: z.number().optional(),
        itemType: z.enum(["product", "material", "manual"]).default("manual"),
      })).optional(),
    }))
    .mutation(async ({ input }) => {
      {
        const { bumpDocCounter } = await import("./counters-helper");
        await bumpDocCounter("deliveryNote", input.dnNumber).catch(() => {});
      }
      const db = getDb();
      const { items, ...data } = input;

      // Валидација на залиха за готови производи ПРЕД да се креира документот
      if (items) {
        for (const item of items) {
          if (item.itemType === "product" && item.productId) {
            const stock = await db.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.productId, item.productId));
            const totalStock = stock.reduce((sum, s) => sum + parseFloat(String(s.quantity)), 0);
            const qty = parseFloat(item.quantity) || 0;
            if (totalStock < qty) {
              throw new Error(`Нема доволно залиха на готов производ „${item.description}". На залиха: ${totalStock.toFixed(3)}, потребно: ${qty.toFixed(3)}`);
            }
          }
        }
      }

      const result = await db.insert(deliveryNotes).values({
        ...data,
        issueDate: new Date(data.issueDate),
        deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
        orderId: data.orderId ?? null,
      } as any);
      const insertId = Number(result[0].insertId);
      if (items && items.length > 0) {
        await db.insert(documentItems).values(items.map(i => ({ ...i, documentId: insertId, documentType: "delivery_note" as const })));

        // Одземи ја залихата на готови производи од ГЛ-ПРОД (FIFO по записи)
        for (const item of items) {
          if (item.itemType === "product" && item.productId) {
            const stockEntries = await db.select().from(finishedGoodsStock)
              .where(eq(finishedGoodsStock.productId, item.productId))
              .orderBy(finishedGoodsStock.id);
            let remainingQty = parseFloat(item.quantity) || 0;
            for (const entry of stockEntries) {
              if (remainingQty <= 0) break;
              const entryQty = parseFloat(String(entry.quantity));
              const deduct = Math.min(entryQty, remainingQty);
              await db.update(finishedGoodsStock)
                .set({ quantity: (entryQty - deduct).toFixed(3), updatedAt: new Date() } as any)
                .where(eq(finishedGoodsStock.id, entry.id));
              remainingQty -= deduct;
            }
          }
        }
      }

      await logAudit({ action: "CREATE", entityType: "delivery_note", entityId: insertId, description: `Креирана испратница ${data.dnNumber}` }).catch(() => {});
      return { success: true, id: insertId };
    }),

  deliveryNoteDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      // Врати ја залихата за готови производи од избришаната испратница
      const items = await db.select().from(documentItems).where(and(eq(documentItems.documentId, input.id), eq(documentItems.documentType, "delivery_note")));
      for (const item of items) {
        if (item.itemType === "product" && item.productId) {
          const qty = parseFloat(String(item.quantity)) || 0;
          if (qty <= 0) continue;
          const stockEntries = await db.select().from(finishedGoodsStock)
            .where(eq(finishedGoodsStock.productId, item.productId))
            .orderBy(finishedGoodsStock.id);
          if (stockEntries.length > 0) {
            const entry = stockEntries[stockEntries.length - 1];
            await db.update(finishedGoodsStock)
              .set({ quantity: (parseFloat(String(entry.quantity)) + qty).toFixed(3), updatedAt: new Date() } as any)
              .where(eq(finishedGoodsStock.id, entry.id));
          } else {
            const allWh = await db.select().from(warehouses);
            const fgWh = allWh.find(w => w.code === "GL-PROD") || allWh.find(w => w.type === "finished_goods");
            if (fgWh) {
              await db.insert(finishedGoodsStock).values({
                productId: item.productId, warehouseId: fgWh.id,
                quantity: qty.toFixed(3), unitCost: "0",
                notes: `Вратено од избришана испратница`,
              } as any);
            }
          }
        }
      }
      await db.delete(documentItems).where(and(eq(documentItems.documentId, input.id), eq(documentItems.documentType, "delivery_note")));
      await db.delete(deliveryNotes).where(eq(deliveryNotes.id, input.id));
      return { success: true };
    }),

  // ===== ACCOUNTANT REPORT WITH VAT RECAPITULATION =====
  accountantReport: publicQuery
    .input(z.object({ startDate: z.string(), endDate: z.string() }))
    .query(async ({ input }) => {
      const db = getDb();
      const start = new Date(input.startDate);
      const end = new Date(input.endDate);

      const allOutgoing = await db.select().from(invoices);
      const filteredOutgoing = allOutgoing.filter(i => {
        const d = i.issueDate ? new Date(i.issueDate) : null;
        return d && d >= start && d <= end;
      });

      const allIncoming = await db.select().from(incomingInvoices);
      const filteredIncoming = allIncoming.filter(i => {
        const d = i.receivedDate ? new Date(i.receivedDate) : null;
        return d && d >= start && d <= end;
      });

      const totalOutgoing = filteredOutgoing.reduce((s, i) => s + parseFloat(i.totalAmount), 0);
      const totalOutgoingVat = filteredOutgoing.reduce((s, i) => s + parseFloat(i.vatAmount), 0);
      const totalOutgoingBase = filteredOutgoing.reduce((s, i) => s + parseFloat(i.subtotal), 0);

      const totalIncoming = filteredIncoming.reduce((s, i) => s + parseFloat(i.totalAmount), 0);
      const totalIncomingVat = filteredIncoming.reduce((s, i) => s + parseFloat(i.vatAmount), 0);
      const totalIncomingBase = filteredIncoming.reduce((s, i) => s + parseFloat(i.subtotal), 0);

      const vatBalance = totalOutgoingVat - totalIncomingVat;

      // Group by VAT rate
      const vatGroups: Record<string, { base: number; vat: number }> = {};
      for (const inv of filteredOutgoing) {
        const rate = inv.vatRate;
        if (!vatGroups[rate]) vatGroups[rate] = { base: 0, vat: 0 };
        vatGroups[rate].base += parseFloat(inv.subtotal);
        vatGroups[rate].vat += parseFloat(inv.vatAmount);
      }

      const { workOrders, receipts: rcT, deliveryNotes: dnT } = await import("@db/schema");
      const inRange = (d: any) => { const x = d ? new Date(d) : null; return x && x >= start && x <= end; };
      const allWO = (await db.select().from(workOrders)).filter((w: any) => inRange(w.createdAt));
      const allRc = (await db.select().from(rcT)).filter((r: any) => inRange(r.receiptDate ?? r.createdAt));
      const allDn = (await db.select().from(dnT)).filter((d: any) => inRange(d.issueDate ?? d.createdAt));
      return {
        workOrders: allWO, receiptsList: allRc, deliveryNotesList: allDn,
        totalReceipts: allRc.reduce((a: number, r: any) => a + Number(r.totalAmount ?? 0), 0),
        period: { start: input.startDate, end: input.endDate },
        outgoing: {
          count: filteredOutgoing.length,
          totalBase: totalOutgoingBase.toFixed(2),
          totalVat: totalOutgoingVat.toFixed(2),
          total: totalOutgoing.toFixed(2),
          items: filteredOutgoing,
          vatGroups,
        },
        incoming: {
          count: filteredIncoming.length,
          totalBase: totalIncomingBase.toFixed(2),
          totalVat: totalIncomingVat.toFixed(2),
          total: totalIncoming.toFixed(2),
          items: filteredIncoming,
        },
        vatRecapitulation: {
          outgoingVat: totalOutgoingVat.toFixed(2),
          incomingVat: totalIncomingVat.toFixed(2),
          vatBalance: vatBalance.toFixed(2),
          vatToPay: vatBalance > 0 ? vatBalance.toFixed(2) : "0",
          vatCredit: vatBalance < 0 ? Math.abs(vatBalance).toFixed(2) : "0",
        },
      };
    }),

  // ===== CREDIT NOTE CREATE (сторно) =====
  creditNoteCreate: publicQuery
    .input(z.object({
      originalInvoiceId: z.number(),
      creditNoteNumber: z.string().min(1),
      issueDate: z.string(),
      subtotal: z.string(),
      vatRate: z.string().default("18"),
      vatAmount: z.string(),
      totalAmount: z.string(),
      notes: z.string().optional(),
      items: z.array(z.object({
        description: z.string().min(1),
        quantity: z.string(),
        unit: z.string().default("ком"),
        unitPrice: z.string(),
        totalPrice: z.string(),
        vatRate: z.string().default("18"),
      })).optional(),
    }))
    .mutation(async ({ input }) => {
      {
        const { bumpDocCounter } = await import("./counters-helper");
        await bumpDocCounter("creditNote", input.creditNoteNumber).catch(() => {});
      }
      const db = getDb();
      const orig = await db.select().from(invoices).where(eq(invoices.id, input.originalInvoiceId));
      if (!orig[0]) throw new Error("Оригиналната фактура не постои");

      const result = await db.insert(invoices).values({
        invoiceNumber: input.creditNoteNumber,
        customerId: orig[0].customerId,
        orderId: orig[0].orderId,
        status: "issued",
        invoiceType: "credit_note",
        issueDate: new Date(input.issueDate),
        subtotal: input.subtotal,
        vatRate: input.vatRate,
        vatAmount: input.vatAmount,
        totalAmount: input.totalAmount,
        currency: orig[0].currency,
        notes: input.notes,
        originalInvoiceId: input.originalInvoiceId,
      } as any);
      const insertId = Number(result[0].insertId);

      if (input.items && input.items.length > 0) {
        await db.insert(documentItems).values(input.items.map(i => ({ ...i, documentId: insertId, documentType: "invoice" as const })));
      }
      return { success: true, id: insertId };
    }),

  // ===== UJP E-FAKTURA =====
  ujpCompanyLookup: publicQuery
    .input(z.object({ edb: z.string().min(1) }))
    .query(async ({ input }) => {
      return await lookupCompany(input.edb);
    }),

  ujpSendInvoice: publicQuery
    .input(z.object({
      invoiceId: z.number(),
      sellerEdb: z.string(),
      sellerName: z.string(),
      sellerAddress: z.string().optional(),
      sellerCity: z.string().optional(),
      sellerVatNumber: z.string().optional(),
      buyerEdb: z.string(),
      buyerName: z.string(),
      buyerAddress: z.string().optional(),
      buyerCity: z.string().optional(),
      buyerVatNumber: z.string().optional(),
      certId: z.number().optional(),
      certificateData: z.object({ cert: z.string(), pin: z.string() }).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { invoiceId, certId, certificateData, ...sellerBuyerData } = input;
      const inv = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
      if (!inv[0]) throw new Error("Фактурата не постои");
      const items = await db.select().from(documentItems).where(and(eq(documentItems.documentId, invoiceId), eq(documentItems.documentType, "invoice")));
      const cust = await db.select().from(customers).where(eq(customers.id, inv[0].customerId));
      const customer = cust[0];

      const payload: UJPInvoicePayload = {
        invoiceNumber: inv[0].invoiceNumber,
        issueDate: inv[0].issueDate ? String(inv[0].issueDate).split("T")[0] : new Date().toISOString().split("T")[0],
        dueDate: inv[0].dueDate ? String(inv[0].dueDate).split("T")[0] : undefined,
        sellerEdb: sellerBuyerData.sellerEdb,
        sellerName: sellerBuyerData.sellerName,
        sellerAddress: sellerBuyerData.sellerAddress || "",
        sellerCity: sellerBuyerData.sellerCity || "",
        sellerVatNumber: sellerBuyerData.sellerVatNumber || null,
        buyerEdb: sellerBuyerData.buyerEdb,
        buyerName: sellerBuyerData.buyerName,
        buyerAddress: sellerBuyerData.buyerAddress || customer?.address || "",
        buyerCity: sellerBuyerData.buyerCity || customer?.city || "",
        buyerVatNumber: sellerBuyerData.buyerVatNumber || null,
        currency: inv[0].currency,
        paymentType: "42",
        subtotal: parseFloat(inv[0].subtotal),
        vatAmount: parseFloat(inv[0].vatAmount),
        totalAmount: parseFloat(inv[0].totalAmount),
        items: items.map((item, idx) => ({
          lineNumber: idx + 1,
          description: item.description,
          quantity: parseFloat(item.quantity),
          unit: item.unit || "ком",
          unitPrice: parseFloat(item.unitPrice),
          totalPrice: parseFloat(item.totalPrice),
          vatRate: parseFloat(item.vatRate),
          vatAmount: parseFloat(item.totalPrice) * parseFloat(item.vatRate) / 100,
        })),
        notes: inv[0].notes || undefined,
      };

      const response = await sendInvoice(payload, certId, certificateData);
      if (response.euid) {
        await db.insert(eInvoices).values({
          invoiceId,
          ujpInvoiceId: response.euid,
          status: response.status === 200 ? "sent_to_ujp" : "rejected",
          responseMessage: response.message,
          sentAt: new Date(),
        } as any);
        await db.update(invoices).set({ eInvoiceId: response.euid }).where(eq(invoices.id, invoiceId));
      }
      return response;
    }),

  // ===== CERTIFICATE MANAGEMENT =====
  certificateList: publicQuery.query(async () => {
    return await getActiveCertificates();
  }),

  certificateStore: publicQuery
    .input(z.object({
      name: z.string().min(1),
      certType: z.enum(["qualified", "advanced", "test"]),
      certificatePem: z.string().min(1),
      privateKeyPem: z.string().optional(),
      issuer: z.string().optional(),
      serialNumber: z.string().optional(),
      validFrom: z.string().optional(),
      validTo: z.string().optional(),
      edb: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await storeCertificate(input);
      return { success: true, id };
    }),

  ujpCheckStatus: publicQuery
    .input(z.object({ euid: z.string() }))
    .query(async ({ input }) => {
      return await checkInvoiceStatus(input.euid);
    }),

  ujpGenerateXml: publicQuery
    .input(z.object({ invoiceId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const inv = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId));
      if (!inv[0]) return null;
      const items = await db.select().from(documentItems).where(and(eq(documentItems.documentId, input.invoiceId), eq(documentItems.documentType, "invoice")));
      const cust = await db.select().from(customers).where(eq(customers.id, inv[0].customerId));
      return generateUJPXml({ ...inv[0], items, customer: cust[0] || {} });
    }),

  ujpInvoiceList: publicQuery
    .input(z.object({ search: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db
        .select({
          id: invoices.id, invoiceNumber: invoices.invoiceNumber,
          customerId: invoices.customerId, status: invoices.status,
          invoiceType: invoices.invoiceType, issueDate: invoices.issueDate,
          totalAmount: invoices.totalAmount, currency: invoices.currency,
          eInvoiceId: invoices.eInvoiceId,
          customerName: customers.name, customerCompany: customers.company,
        })
        .from(invoices)
        .leftJoin(customers, eq(invoices.customerId, customers.id))
        .orderBy(desc(invoices.createdAt));
      if (input?.search) {
        const s = input.search.toLowerCase();
        return result.filter(r => r.invoiceNumber.toLowerCase().includes(s) || r.customerName?.toLowerCase().includes(s));
      }
      return result;
    }),

  // ===== PARSED INVOICES =====
  parsedInvoiceList: publicQuery
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db.select().from(parsedInvoices).orderBy(desc(parsedInvoices.createdAt));
      if (input?.status) return result.filter(r => r.status === input.status);
      return result;
    }),

  parsedInvoiceCreate: publicQuery
    .input(z.object({
      originalFileName: z.string(),
      supplierName: z.string().optional(),
      invoiceNumber: z.string().optional(),
      issueDate: z.string().optional(),
      dueDate: z.string().optional(),
      totalAmount: z.string().optional(),
      vatAmount: z.string().optional(),
      currency: z.string().optional(),
      rawText: z.string().optional(),
      documentType: z.enum(["invoice", "receipt", "delivery_note", "other"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(parsedInvoices).values({
        ...input,
        issueDate: input.issueDate ? new Date(input.issueDate) : null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        documentType: input.documentType ?? "invoice",
      } as any);
      return { success: true };
    }),

  parsedInvoiceUpdate: publicQuery
    .input(z.object({
      id: z.number(),
      status: z.enum(["parsed", "verified", "imported"]).optional(),
      matchedInvoiceId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(parsedInvoices).set(data).where(eq(parsedInvoices.id, id));
      return { success: true };
    }),

  // ===== PAYABLES / RECEIVABLES =====
  payablesReceivables: publicQuery.query(async () => {
    const db = getDb();
    // Payables (incoming invoices not paid)
    const incoming = await db
      .select()
      .from(incomingInvoices)
      .where(eq(incomingInvoices.status, "received"));

    const payablesBySupplier = incoming.reduce((acc: any[], inv) => {
      const existing = acc.find(a => a.supplierId === inv.supplierId);
      if (existing) {
        existing.total += parseFloat(inv.totalAmount);
        existing.count += 1;
      } else {
        acc.push({ supplierId: inv.supplierId, total: parseFloat(inv.totalAmount), count: 1 });
      }
      return acc;
    }, []);

    // Receivables (outgoing invoices not paid)
    const outgoing = await db
      .select()
      .from(invoices)
      .where(eq(invoices.status, "issued"));

    const receivablesByCustomer = outgoing.reduce((acc: any[], inv) => {
      const existing = acc.find(a => a.customerId === inv.customerId);
      if (existing) {
        existing.total += parseFloat(inv.totalAmount);
        existing.count += 1;
      } else {
        acc.push({ customerId: inv.customerId, total: parseFloat(inv.totalAmount), count: 1 });
      }
      return acc;
    }, []);

    return {
      totalPayables: payablesBySupplier.reduce((s, p) => s + p.total, 0).toFixed(2),
      totalReceivables: receivablesByCustomer.reduce((s, r) => s + r.total, 0).toFixed(2),
      payables: payablesBySupplier,
      receivables: receivablesByCustomer,
    };
  }),

  // ===== FINISHED GOODS STOCK =====
  finishedGoodsList: publicQuery.query(async () => {
    const db = getDb();
    return db.select({
      id: finishedGoodsStock.id,
      productId: finishedGoodsStock.productId,
      warehouseId: finishedGoodsStock.warehouseId,
      workOrderId: finishedGoodsStock.workOrderId,
      quantity: finishedGoodsStock.quantity,
      unitCost: finishedGoodsStock.unitCost,
      notes: finishedGoodsStock.notes,
      updatedAt: finishedGoodsStock.updatedAt,
      productName: products.name,
      productCode: products.code,
      unit: products.unit,
      warehouseName: warehouses.name,
      warehouseCode: warehouses.code,
      woNumber: workOrdersTable.woNumber,
    }).from(finishedGoodsStock)
      .leftJoin(products, eq(finishedGoodsStock.productId, products.id))
      .leftJoin(warehouses, eq(finishedGoodsStock.warehouseId, warehouses.id))
      .leftJoin(workOrdersTable, eq(finishedGoodsStock.workOrderId, workOrdersTable.id))
      .orderBy(desc(finishedGoodsStock.updatedAt));
  }),

  finishedGoodsByProduct: publicQuery
    .input(z.object({ productId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db.select().from(finishedGoodsStock).where(eq(finishedGoodsStock.productId, input.productId));
    }),

  finishedGoodsCreate: publicQuery
    .input(z.object({
      productId: z.number(),
      warehouseId: z.number(),
      quantity: z.string().default("0"),
      unitCost: z.string().default("0"),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(finishedGoodsStock).values(input as any);
      return { success: true };
    }),

  finishedGoodsUpdate: publicQuery
    .input(z.object({
      id: z.number(),
      quantity: z.string().optional(),
      unitCost: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      await db.update(finishedGoodsStock).set(data as any).where(eq(finishedGoodsStock.id, id));
      return { success: true };
    }),

  // ===== PRODUCTS & SERVICES FOR INVOICING =====
  nextInvoiceNumber: publicQuery.query(async () => {
    return await getNextDocNumber("invoice");
  }),

  productListForInvoice: publicQuery.query(async () => {
    const db = getDb();
    return db.select({
      id: products.id,
      name: products.name,
      code: products.code,
      unit: products.unit,
      price: products.defaultPrice,
      category: products.category,
    }).from(products).where(eq(products.isActive, "active"));
  }),

  serviceListForInvoice: publicQuery.query(async () => {
    const db = getDb();
    return db.select({
      id: services.id,
      name: services.name,
      code: services.code,
      unit: services.unit,
      price: services.saleRate,
      type: services.type,
    }).from(services).where(eq(services.isActive, "active"));
  }),
});
