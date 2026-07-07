import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  invoices, incomingInvoices, documentItems,
  receipts, deliveryNotes, eInvoices, parsedInvoices,
  customers, suppliers,
} from "@db/schema";
import { sendInvoice, checkInvoiceStatus, lookupCompany, generateUJPXml, type UJPInvoicePayload } from "./ujp-service";

export const accountingRouter = createRouter({
  // ===== OUTGOING INVOICES (Излезни фактури) =====
  invoiceList: publicQuery
    .input(z.object({
      status: z.string().optional(),
      customerId: z.number().optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          customerId: invoices.customerId,
          orderId: invoices.orderId,
          status: invoices.status,
          invoiceType: invoices.invoiceType,
          issueDate: invoices.issueDate,
          dueDate: invoices.dueDate,
          subtotal: invoices.subtotal,
          vatRate: invoices.vatRate,
          vatAmount: invoices.vatAmount,
          totalAmount: invoices.totalAmount,
          currency: invoices.currency,
          notes: invoices.notes,
          eInvoiceId: invoices.eInvoiceId,
          createdAt: invoices.createdAt,
          customerName: customers.name,
          customerCompany: customers.company,
        })
        .from(invoices)
        .leftJoin(customers, eq(invoices.customerId, customers.id))
        .orderBy(desc(invoices.createdAt));

      let filtered = result;
      if (input?.status) filtered = filtered.filter(r => r.status === input.status);
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
      const items = await db.select().from(documentItems).where(
        and(eq(documentItems.documentId, input.id), eq(documentItems.documentType, "invoice"))
      );
      const cust = await db.select().from(customers).where(eq(customers.id, inv[0].customerId));
      return { ...inv[0], items, customer: cust[0] ?? null };
    }),

  invoiceCreate: publicQuery
    .input(z.object({
      invoiceNumber: z.string().min(1),
      customerId: z.number(),
      orderId: z.number().optional(),
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
      const result = await db.insert(invoices).values({
        ...invData,
        issueDate: new Date(invData.issueDate),
        dueDate: invData.dueDate ? new Date(invData.dueDate) : null,
      } as any);
      const insertId = Number(result[0].insertId);
      if (items && items.length > 0) {
        await db.insert(documentItems).values(items.map(i => ({ ...i, documentId: insertId, documentType: "invoice" as const })));
      }
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

  // ===== INCOMING INVOICES (Влезни фактури) =====
  incomingInvoiceList: publicQuery
    .input(z.object({
      status: z.string().optional(),
      supplierId: z.number().optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db
        .select({
          id: incomingInvoices.id,
          supplierInvoiceNumber: incomingInvoices.supplierInvoiceNumber,
          supplierId: incomingInvoices.supplierId,
          poId: incomingInvoices.poId,
          status: incomingInvoices.status,
          issueDate: incomingInvoices.issueDate,
          receivedDate: incomingInvoices.receivedDate,
          dueDate: incomingInvoices.dueDate,
          subtotal: incomingInvoices.subtotal,
          vatRate: incomingInvoices.vatRate,
          vatAmount: incomingInvoices.vatAmount,
          totalAmount: incomingInvoices.totalAmount,
          currency: incomingInvoices.currency,
          notes: incomingInvoices.notes,
          fileUrl: incomingInvoices.fileUrl,
          createdAt: incomingInvoices.createdAt,
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
      const items = await db.select().from(documentItems).where(
        and(eq(documentItems.documentId, input.id), eq(documentItems.documentType, "incoming_invoice"))
      );
      const sup = await db.select().from(suppliers).where(eq(suppliers.id, inv[0].supplierId));
      return { ...inv[0], items, supplier: sup[0] ?? null };
    }),

  incomingInvoiceCreate: publicQuery
    .input(z.object({
      supplierInvoiceNumber: z.string().min(1),
      supplierId: z.number(),
      poId: z.number().optional(),
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

  // ===== RECEIPTS (Приемници) =====
  receiptList: publicQuery
    .input(z.object({
      status: z.string().optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db
        .select({
          id: receipts.id,
          receiptNumber: receipts.receiptNumber,
          supplierId: receipts.supplierId,
          poId: receipts.poId,
          status: receipts.status,
          receiptDate: receipts.receiptDate,
          totalAmount: receipts.totalAmount,
          notes: receipts.notes,
          createdAt: receipts.createdAt,
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

  receiptCreate: publicQuery
    .input(z.object({
      receiptNumber: z.string().min(1),
      supplierId: z.number().optional(),
      poId: z.number().optional(),
      status: z.enum(["draft", "confirmed", "cancelled"]).default("draft"),
      receiptDate: z.string(),
      totalAmount: z.string().default("0"),
      notes: z.string().optional(),
      items: z.array(z.object({
        description: z.string().min(1),
        quantity: z.string(),
        unit: z.string().default("ком"),
        unitPrice: z.string(),
        totalPrice: z.string(),
        notes: z.string().optional(),
      })).optional(),
    }))
    .mutation(async ({ input }) => {
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
        await db.insert(documentItems).values(items.map(i => ({ ...i, documentId: insertId, documentType: "receipt" as const })));
      }
      return { success: true, id: insertId };
    }),

  receiptDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(documentItems).where(and(eq(documentItems.documentId, input.id), eq(documentItems.documentType, "receipt")));
      await db.delete(receipts).where(eq(receipts.id, input.id));
      return { success: true };
    }),

  // ===== DELIVERY NOTES (Испратници) =====
  deliveryNoteList: publicQuery
    .input(z.object({
      status: z.string().optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db
        .select({
          id: deliveryNotes.id,
          dnNumber: deliveryNotes.dnNumber,
          customerId: deliveryNotes.customerId,
          orderId: deliveryNotes.orderId,
          status: deliveryNotes.status,
          issueDate: deliveryNotes.issueDate,
          deliveryDate: deliveryNotes.deliveryDate,
          totalItems: deliveryNotes.totalItems,
          notes: deliveryNotes.notes,
          createdAt: deliveryNotes.createdAt,
          customerName: customers.name,
          customerCompany: customers.company,
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
        totalPrice: z.string(),
        notes: z.string().optional(),
      })).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { items, ...data } = input;
      const result = await db.insert(deliveryNotes).values({
        ...data,
        issueDate: new Date(data.issueDate),
        deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
        orderId: data.orderId ?? null,
      } as any);
      const insertId = Number(result[0].insertId);
      if (items && items.length > 0) {
        await db.insert(documentItems).values(items.map(i => ({ ...i, documentId: insertId, documentType: "delivery_note" as const })));
      }
      return { success: true, id: insertId };
    }),

  deliveryNoteDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(documentItems).where(and(eq(documentItems.documentId, input.id), eq(documentItems.documentType, "delivery_note")));
      await db.delete(deliveryNotes).where(eq(deliveryNotes.id, input.id));
      return { success: true };
    }),

  // ===== ACCOUNTANT REPORT =====
  accountantReport: publicQuery
    .input(z.object({
      startDate: z.string(),
      endDate: z.string(),
    }))
    .query(async ({ input }) => {
      const db = getDb();
      const start = new Date(input.startDate);
      const end = new Date(input.endDate);

      // Outgoing invoices
      const allOutgoing = await db.select().from(invoices);
      const filteredOutgoing = allOutgoing.filter(i => {
        const d = i.issueDate ? new Date(i.issueDate) : null;
        return d && d >= start && d <= end;
      });

      // Incoming invoices
      const allIncoming = await db.select().from(incomingInvoices);
      const filteredIncoming = allIncoming.filter(i => {
        const d = i.receivedDate ? new Date(i.receivedDate) : null;
        return d && d >= start && d <= end;
      });

      const totalOutgoing = filteredOutgoing.reduce((s, i) => s + parseFloat(i.totalAmount), 0);
      const totalOutgoingVat = filteredOutgoing.reduce((s, i) => s + parseFloat(i.vatAmount), 0);
      const totalIncoming = filteredIncoming.reduce((s, i) => s + parseFloat(i.totalAmount), 0);
      const totalIncomingVat = filteredIncoming.reduce((s, i) => s + parseFloat(i.vatAmount), 0);

      return {
        period: { start: input.startDate, end: input.endDate },
        outgoing: {
          count: filteredOutgoing.length,
          total: totalOutgoing.toFixed(2),
          totalVat: totalOutgoingVat.toFixed(2),
          items: filteredOutgoing,
        },
        incoming: {
          count: filteredIncoming.length,
          total: totalIncoming.toFixed(2),
          totalVat: totalIncomingVat.toFixed(2),
          items: filteredIncoming,
        },
        vatBalance: (totalOutgoingVat - totalIncomingVat).toFixed(2),
      };
    }),

  // ===== УЈП E-FAKTURA INTEGRATION =====
  ujpCompanyLookup: publicQuery
    .input(z.object({ edb: z.string().min(1) }))
    .query(async ({ input }) => {
      const result = await lookupCompany(input.edb);
      return result;
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
      certificateData: z.object({ cert: z.string(), pin: z.string() }).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { invoiceId, certificateData, ...sellerBuyerData } = input;

      // Fetch invoice from DB
      const inv = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
      if (!inv[0]) throw new Error("Фактурата не постои");
      const invoice = inv[0];

      // Fetch invoice items
      const items = await db.select().from(documentItems).where(
        and(eq(documentItems.documentId, invoiceId), eq(documentItems.documentType, "invoice"))
      );

      // Fetch customer for buyer details
      const cust = await db.select().from(customers).where(eq(customers.id, invoice.customerId));
      const customer = cust[0];

      // Build UJP payload
      const payload: UJPInvoicePayload = {
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate ? String(invoice.issueDate).split("T")[0] : new Date().toISOString().split("T")[0],
        dueDate: invoice.dueDate ? String(invoice.dueDate).split("T")[0] : undefined,
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
        currency: invoice.currency,
        paymentType: "42",
        subtotal: parseFloat(invoice.subtotal),
        vatAmount: parseFloat(invoice.vatAmount),
        totalAmount: parseFloat(invoice.totalAmount),
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
        notes: invoice.notes || undefined,
      };

      // Send to UJP
      const response = await sendInvoice(payload, certificateData);

      // Save e-invoice record
      if (response.euid) {
        await db.insert(eInvoices).values({
          invoiceId,
          ujpInvoiceId: response.euid,
          status: response.status === 200 ? "sent_to_ujp" : "rejected",
          responseMessage: response.message,
          sentAt: new Date(),
        } as any);

        // Update invoice with eInvoiceId
        await db.update(invoices).set({ eInvoiceId: response.euid }).where(eq(invoices.id, invoiceId));
      }

      return response;
    }),

  ujpCheckStatus: publicQuery
    .input(z.object({ euid: z.string() }))
    .query(async ({ input }) => {
      const status = await checkInvoiceStatus(input.euid);
      return status;
    }),

  ujpGenerateXml: publicQuery
    .input(z.object({ invoiceId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const inv = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId));
      if (!inv[0]) return null;
      const items = await db.select().from(documentItems).where(
        and(eq(documentItems.documentId, input.invoiceId), eq(documentItems.documentType, "invoice"))
      );
      const cust = await db.select().from(customers).where(eq(customers.id, inv[0].customerId));
      const xml = generateUJPXml({ ...inv[0], items, customer: cust[0] || {} });
      return xml;
    }),

  ujpInvoiceList: publicQuery
    .input(z.object({ search: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          customerId: invoices.customerId,
          status: invoices.status,
          invoiceType: invoices.invoiceType,
          issueDate: invoices.issueDate,
          totalAmount: invoices.totalAmount,
          currency: invoices.currency,
          eInvoiceId: invoices.eInvoiceId,
          customerName: customers.name,
          customerCompany: customers.company,
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
    .input(z.object({
      status: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      let query = db.select().from(parsedInvoices).orderBy(desc(parsedInvoices.createdAt));
      const result = await query;
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
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.insert(parsedInvoices).values({
        ...input,
        issueDate: input.issueDate ? new Date(input.issueDate) : null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
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
});
