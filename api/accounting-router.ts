import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
// PostgreSQL compat
import { createRouter, publicQuery } from "./middleware";
import { listLimit } from "./list-limit";
import { openDocs, refreshPaymentStatus, assertNoPayments, type OpenDoc } from "./payment-status";
import { guessExpenseAccount, toMkd } from "@contracts/finance";
import { loadRates, iso } from "./rates-helper";
import { getDb, getPool } from "./queries/connection";
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
    .input(z.object({ limit: z.number().int().min(1).optional(), status: z.string().optional(), customerId: z.number().optional(), search: z.string().optional(), type: z.string().optional() }).optional())
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
        .orderBy(desc(invoices.createdAt)).limit(listLimit(input as any));

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
      const cust = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, invData.customerId));
      if (!cust[0]) throw new Error("Клиентот не постои");

      // Готовиот производ излегува од залиха со испратницата; ако нарачката веќе има испратница, фактурата не одзема повторно
      const hasDn = invData.orderId
        ? (await getPool().query(`SELECT 1 FROM delivery_notes WHERE order_id = $1 AND status <> 'cancelled' LIMIT 1`, [invData.orderId])).rows.length > 0
        : false;
      const movesStock = !hasDn && (invData.invoiceType ?? "standard") === "standard";

      // Validate stock for products
      if (items && movesStock) {
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
      if (items && movesStock && invData.status === "issued") {
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
      status: z.enum(["draft", "issued", "sent", "partial", "paid", "overdue", "cancelled"]).optional(),
      dueDate: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      const updateData: any = { ...data };
      if (data.dueDate) updateData.dueDate = new Date(data.dueDate);
      await db.update(invoices).set(updateData).where(eq(invoices.id, id));
      // Платено/делумно се изведува од уплатите; рачно „Платена“ останува (на пр. компензација)
      if (data.status && data.status !== "paid") await refreshPaymentStatus("invoice", id);
      const cur: any = (await db.select().from(invoices).where(eq(invoices.id, id)))[0];
      if (cur?.invoiceType === "credit_note" && cur.originalInvoiceId) await refreshPaymentStatus("invoice", Number(cur.originalInvoiceId));
      return { success: true };
    }),

  invoiceDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await assertNoPayments("invoice", input.id);
      const cur: any = (await db.select().from(invoices).where(eq(invoices.id, input.id)))[0];
      await db.delete(documentItems).where(and(eq(documentItems.documentId, input.id), eq(documentItems.documentType, "invoice")));
      await db.delete(invoices).where(eq(invoices.id, input.id));
      if (cur?.invoiceType === "credit_note" && cur.originalInvoiceId) await refreshPaymentStatus("invoice", Number(cur.originalInvoiceId));
      return { success: true };
    }),

  // ===== INCOMING INVOICES =====
  incomingInvoiceList: publicQuery
    .input(z.object({ limit: z.number().int().min(1).optional(), status: z.string().optional(), supplierId: z.number().optional(), search: z.string().optional() }).optional())
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
          currency: incomingInvoices.currency, notes: incomingInvoices.notes, expenseAccount: incomingInvoices.expenseAccount,
          fileUrl: incomingInvoices.fileUrl, createdAt: incomingInvoices.createdAt,
          supplierName: suppliers.name,
        })
        .from(incomingInvoices)
        .leftJoin(suppliers, eq(incomingInvoices.supplierId, suppliers.id))
        .orderBy(desc(incomingInvoices.createdAt)).limit(listLimit(input as any));

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

  // Предлог конто за нова влезна фактура (за формата)
  incomingAccountSuggest: publicQuery
    .input(z.object({ supplierId: z.number().optional(), text: z.string().max(2000).optional() }))
    .query(async ({ input }) => {
      const db = getDb();
      const sup: any = input.supplierId ? (await db.select().from(suppliers).where(eq(suppliers.id, input.supplierId)))[0] : null;
      return guessExpenseAccount(sup?.defaultExpenseAccount, [sup?.name, input.text].filter(Boolean).join(" "));
    }),

  // Влезни фактури каде програмата не знае што е купено -- операторот одговара со обични зборови
  incomingAccountReview: publicQuery.query(async () => {
    const rows = (await getPool().query(`SELECT ii.id, ii.supplier_invoice_number, ii.total_amount, ii.currency, ii.received_date, ii.expense_account, ii.notes,
        s.id AS supplier_id, s.name AS supplier, s.default_expense_account,
        (SELECT string_agg(d.description, ' · ') FROM document_items d WHERE d.document_type = 'incoming_invoice' AND d.document_id = ii.id) AS items
      FROM incoming_invoices ii LEFT JOIN suppliers s ON s.id = ii.supplier_id
      WHERE COALESCE(ii.account_confirmed, false) = false AND ii.status <> 'cancelled'
      ORDER BY ii.received_date DESC, ii.id DESC LIMIT 200`)).rows as any[];
    return rows
      .filter(r => !guessExpenseAccount(r.default_expense_account, [r.supplier, r.notes, r.items].filter(Boolean).join(" ")).sure)
      .map(r => ({ id: Number(r.id), number: r.supplier_invoice_number, supplierId: r.supplier_id ? Number(r.supplier_id) : null, supplier: r.supplier,
        total: Number(r.total_amount), currency: r.currency, date: r.received_date, items: r.items ?? "", notes: r.notes ?? "" }));
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
      expenseAccount: z.string().max(10).optional(),
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
      // Конто: избрано -> последно кај добавувачот -> предлог од текстот -> „набавки“ (310)
      const sup: any = (await db.select().from(suppliers).where(eq(suppliers.id, invData.supplierId)))[0];
      if (!sup) throw new Error("Добавувачот не постои");
      const chosen = !!invData.expenseAccount;
      if (!chosen) {
        const g = guessExpenseAccount(sup.defaultExpenseAccount, [sup.name, invData.notes, ...(items ?? []).map(i => i.description)].join(" "));
        invData.expenseAccount = g.account ?? undefined; // несигурно -> празно, чека одговор (во меѓувреме 310)
      }
      (invData as any).accountConfirmed = chosen;
      if (chosen) await db.update(suppliers).set({ defaultExpenseAccount: input.expenseAccount } as any).where(eq(suppliers.id, sup.id));
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
      status: z.enum(["received", "verified", "partial", "paid", "disputed", "cancelled"]).optional(),
      notes: z.string().optional(),
      expenseAccount: z.string().max(10).optional(),
      /** да се запамети изборот кај добавувачот (следниот пат не прашува) */
      rememberForSupplier: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, rememberForSupplier, ...data } = input;
      await db.update(incomingInvoices).set({ ...data, ...(data.expenseAccount ? { accountConfirmed: true } : {}) } as any).where(eq(incomingInvoices.id, id));
      if (data.expenseAccount && rememberForSupplier) {
        const inv: any = (await db.select().from(incomingInvoices).where(eq(incomingInvoices.id, id)))[0];
        if (inv) await db.update(suppliers).set({ defaultExpenseAccount: data.expenseAccount } as any).where(eq(suppliers.id, inv.supplierId));
      }
      if (data.status && data.status !== "paid") await refreshPaymentStatus("incoming_invoice", id);
      return { success: true };
    }),

  incomingInvoiceDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await assertNoPayments("incoming_invoice", input.id);
      await db.delete(documentItems).where(and(eq(documentItems.documentId, input.id), eq(documentItems.documentType, "incoming_invoice")));
      await db.delete(incomingInvoices).where(eq(incomingInvoices.id, input.id));
      return { success: true };
    }),

  // ===== RECEIPTS =====
  receiptList: publicQuery
    .input(z.object({ limit: z.number().int().min(1).optional(), status: z.string().optional(), search: z.string().optional() }).optional())
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
        .orderBy(desc(receipts.createdAt)).limit(listLimit(input as any));

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
          heatNumber: receiptItems.heatNumber, certNumber: receiptItems.certNumber, certStandard: receiptItems.certStandard, certUrl: receiptItems.certUrl,
          materialName: materials.name, materialCode: materials.code, unitLabel: materials.unit,
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
        heatNumber: z.string().optional(),
        certNumber: z.string().optional(),
        certStandard: z.string().optional(),
        certUrl: z.string().optional(),
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
      if (data.poId) {
        const po: any = (await getPool().query(`SELECT supplier_id, status, po_number FROM purchase_orders WHERE id = $1`, [data.poId])).rows[0];
        if (!po) throw new Error("Набавната нарачка не постои");
        if (po.status === "cancelled") throw new Error(`Нарачката ${po.po_number} е откажана`);
        if (!data.supplierId) data.supplierId = Number(po.supplier_id);
      }
      // Износ = збир на ставките (порано остануваше 0)
      const itemsTotal = (items ?? []).reduce((a, i) => a + (parseFloat(i.totalPrice) || 0), 0);
      if (!(parseFloat(data.totalAmount) > 0) && itemsTotal > 0) data.totalAmount = itemsTotal.toFixed(2);
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

  // Измена на приемница во нацрт (заглавје + ставки); потврдената не се менува -- залихата е веќе зголемена
  receiptEdit: publicQuery
    .input(z.object({
      id: z.number(),
      receiptNumber: z.string().min(1),
      supplierId: z.number().nullable().optional(),
      poId: z.number().nullable().optional(),
      warehouseId: z.number(),
      receiptDate: z.string(),
      supplierDocNumber: z.string().optional(),
      transportCost: z.string().default("0"),
      customsCost: z.string().default("0"),
      otherCost: z.string().default("0"),
      notes: z.string().optional(),
      items: z.array(z.object({
        materialId: z.number(), quantity: z.string(), unit: z.string(), unitPrice: z.string(), totalPrice: z.string(),
        landedCostAlloc: z.string().default("0"), vatRate: z.string().default("18"),
        heatNumber: z.string().optional(), certNumber: z.string().optional(), certStandard: z.string().optional(), certUrl: z.string().optional(), notes: z.string().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const cur: any = (await db.select().from(receipts).where(eq(receipts.id, input.id)))[0];
      if (!cur) throw new Error("Приемницата не постои");
      if (cur.status !== "draft") throw new Error("Само приемница во нацрт може да се менува — потврдената веќе ја зголемила залихата");
      const dup: any = (await db.select().from(receipts).where(eq(receipts.receiptNumber, input.receiptNumber)))[0];
      if (dup && dup.id !== input.id) throw new Error(`Бројот ${input.receiptNumber} веќе постои`);
      const { id, items, ...data } = input;
      const total = items.reduce((a, i) => a + (parseFloat(i.totalPrice) || 0), 0);
      await db.update(receipts).set({ ...data, receiptDate: new Date(data.receiptDate), supplierId: data.supplierId ?? null, poId: data.poId ?? null,
        totalAmount: total.toFixed(2) } as any).where(eq(receipts.id, id));
      await db.delete(receiptItems).where(eq(receiptItems.receiptId, id));
      if (items.length) await db.insert(receiptItems).values(items.map(i => ({ ...i, receiptId: id })) as any);
      await logAudit({ action: "UPDATE", entityType: "receipt", entityId: id, description: `Изменета приемница ${input.receiptNumber}` }).catch(() => {});
      return { success: true };
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
      const rc: any = (await db.select().from(receipts).where(eq(receipts.id, input.id)))[0];
      if (rc?.status === "confirmed") throw new Error("Потврдена приемница не може да се брише — залихата е веќе зголемена. Направи корекција на залихата.");
      await db.delete(receiptItems).where(eq(receiptItems.receiptId, input.id));
      await db.delete(receipts).where(eq(receipts.id, input.id));
      return { success: true };
    }),

  // ===== DELIVERY NOTES =====
  deliveryNoteList: publicQuery
    .input(z.object({ limit: z.number().int().min(1).optional(), status: z.string().optional(), search: z.string().optional() }).optional())
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
        .orderBy(desc(deliveryNotes.createdAt)).limit(listLimit(input as any));

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
        materialId: z.number().optional(),
        weightKg: z.string().optional(),
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
      // Периодот вклучува и цел краен ден (записите со време на последниот ден не смеат да испаднат)
      const start = new Date(input.startDate);
      const end = new Date(new Date(input.endDate).getTime() + 86400000 - 1);
      const inRange = (d: any) => { const x = d ? new Date(d) : null; return !!x && x >= start && x <= end; };
      // Исто како во ДДВ книгите и главната книга: само книжени документи, сè во денари
      const rate = await loadRates();
      const mkdOf = (v: any, cur: any, d: any) => { const n = parseFloat(String(v ?? 0)) || 0; const c = String(cur || "MKD").toUpperCase();
        return c === "MKD" ? n : (toMkd(n, c, iso(d), rate) ?? n); };
      const custNames = new Map((await db.select().from(customers)).map((c: any) => [Number(c.id), c.company || c.name]));
      const supNames = new Map((await db.select().from(suppliers)).map((x: any) => [Number(x.id), x.name]));

      const filteredOutgoing = (await db.select().from(invoices))
        .filter((i: any) => ["standard", "credit_note"].includes(i.invoiceType) && !["draft", "cancelled"].includes(i.status) && inRange(i.issueDate))
        .map((i: any) => { const sg = i.invoiceType === "credit_note" ? -1 : 1; return { ...i, customerName: custNames.get(Number(i.customerId)) ?? "",
          baseMkd: sg * Math.abs(mkdOf(i.subtotal, i.currency, i.issueDate)), vatMkd: sg * Math.abs(mkdOf(i.vatAmount, i.currency, i.issueDate)),
          totalMkd: sg * Math.abs(mkdOf(i.totalAmount, i.currency, i.issueDate)) }; })
        .sort((x: any, y: any) => String(x.issueDate).localeCompare(String(y.issueDate)));
      const filteredIncoming = (await db.select().from(incomingInvoices))
        .filter((i: any) => i.status !== "cancelled" && inRange(i.issueDate ?? i.receivedDate))
        .map((i: any) => { const d = i.issueDate ?? i.receivedDate; return { ...i, supplierName: supNames.get(Number(i.supplierId)) ?? "",
          baseMkd: mkdOf(i.subtotal, i.currency, d), vatMkd: mkdOf(i.vatAmount, i.currency, d), totalMkd: mkdOf(i.totalAmount, i.currency, d) }; })
        .sort((x: any, y: any) => String(x.issueDate ?? x.receivedDate).localeCompare(String(y.issueDate ?? y.receivedDate)));

      const sum = (rows: any[], f: string) => rows.reduce((a, r) => a + (Number(r[f]) || 0), 0);
      const totalOutgoing = sum(filteredOutgoing, "totalMkd"), totalOutgoingVat = sum(filteredOutgoing, "vatMkd"), totalOutgoingBase = sum(filteredOutgoing, "baseMkd");
      const totalIncoming = sum(filteredIncoming, "totalMkd"), totalIncomingVat = sum(filteredIncoming, "vatMkd"), totalIncomingBase = sum(filteredIncoming, "baseMkd");
      const vatBalance = totalOutgoingVat - totalIncomingVat;

      // По стапка на ДДВ (излезни)
      const vatGroups: Record<string, { base: number; vat: number }> = {};
      for (const inv of filteredOutgoing as any[]) {
        const r = String(inv.vatRate);
        if (!vatGroups[r]) vatGroups[r] = { base: 0, vat: 0 };
        vatGroups[r].base += inv.baseMkd;
        vatGroups[r].vat += inv.vatMkd;
      }

      const { workOrders, receipts: rcT, deliveryNotes: dnT, workOrderMaterials: womT } = await import("@db/schema");
      const allWO = (await db.select().from(workOrders)).filter((w: any) => inRange(w.createdAt));
      const allRc = (await db.select().from(rcT)).filter((r: any) => r.status !== "cancelled" && inRange(r.receiptDate ?? r.createdAt))
        .map((r: any) => ({ ...r, supplierName: supNames.get(Number(r.supplierId)) ?? "" }));
      const allDn = (await db.select().from(dnT)).filter((d: any) => d.status !== "cancelled" && inRange(d.issueDate ?? d.createdAt))
        .map((d: any) => ({ ...d, customerName: custNames.get(Number(d.customerId)) ?? "" }));

      // Требовања: реално потрошен материјал (isActual='actual') по работните налози во периодот
      const woIds = new Set(allWO.map((w: any) => w.id));
      const allWOM = woIds.size
        ? (await db.select().from(womT)).filter((m: any) => m.isActual === "actual" && woIds.has(m.workOrderId))
        : [];
      const allMaterialsForReport = await db.select().from(materials);
      const matById = new Map(allMaterialsForReport.map((m: any) => [m.id, m]));
      const woById = new Map(allWO.map((w: any) => [w.id, w]));
      const requisitions = allWOM.map((m: any) => {
        const mat = matById.get(m.materialId);
        const wo = woById.get(m.workOrderId);
        return {
          workOrderId: m.workOrderId,
          workOrderNumber: wo?.woNumber ?? "",
          date: wo?.createdAt ?? null,
          materialId: m.materialId,
          materialName: mat?.name ?? `#${m.materialId}`,
          unit: mat?.unit ?? "",
          quantity: m.quantity,
          unitCost: m.unitCost,
          totalCost: m.totalCost,
        };
      });
      const totalRequisitionCost = allWOM.reduce((a: number, m: any) => a + (parseFloat(String(m.totalCost ?? "0")) || 0), 0);
      return {
        workOrders: allWO, receiptsList: allRc, deliveryNotesList: allDn,
        requisitions, totalRequisitionCost: totalRequisitionCost.toFixed(2),
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
      await refreshPaymentStatus("invoice", input.originalInvoiceId);
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
    // Вистинско отворено салдо (минус банка и благајна), во денари
    const docs = await openDocs();
    const group = (list: OpenDoc[], key: "supplierId" | "customerId") => {
      const m = new Map<number | null, { total: number; count: number }>();
      for (const d of list) { const g = m.get(d.partnerId) ?? { total: 0, count: 0 }; g.total += d.openMkd; g.count++; m.set(d.partnerId, g); }
      return Array.from(m, ([id, g]) => ({ [key]: id, total: Math.round(g.total * 100) / 100, count: g.count }));
    };
    const payables = group(docs.filter(d => d.docType === "incoming_invoice"), "supplierId");
    const receivables = group(docs.filter(d => d.docType === "invoice"), "customerId");
    return {
      totalPayables: payables.reduce((s, p) => s + p.total, 0).toFixed(2),
      totalReceivables: receivables.reduce((s, r) => s + r.total, 0).toFixed(2),
      payables,
      receivables,
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
