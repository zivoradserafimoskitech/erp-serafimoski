import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql } from "drizzle-orm";
// PostgreSQL compat
import { createRouter, publicQuery } from "./middleware";
import { listLimit } from "./list-limit";
import { openDocs, refreshPaymentStatus, assertNoPayments, manualPartnerBalances, type OpenDoc } from "./payment-status";
import { guessExpenseAccount, toMkd, vatMismatch } from "@contracts/finance";
import { loadRates, iso } from "./rates-helper";
import { assertOpen } from "./period-lock";
import { assertSequential, nextSequential, isLastInSequence } from "./invoice-numbering";
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

/** ДДВ на влезна фактура мора да одговара на стапката; при обратно оданочување добавувачот не пресметува ДДВ. */
function checkIncomingVat(inv: { subtotal?: string; vatRate?: string; vatAmount?: string; reverseCharge?: boolean }, items?: { totalPrice: string; vatRate?: string }[]) {
  const base = Number(inv.subtotal) || 0, rate = Number(inv.vatRate) || 0, vat = Number(inv.vatAmount) || 0;
  if (inv.reverseCharge) {
    if (Math.abs(vat) > 0.005) throw new TRPCError({ code: "BAD_REQUEST", message: "Обратно оданочување: на фактурата од странскиот добавувач нема ДДВ (внеси 0) — ДДВ го пресметува програмата по стапката" });
    if (!(rate > 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "Обратно оданочување: избери стапка по која се пресметува ДДВ (најчесто 18%)" });
    return;
  }
  const bad = vatMismatch({ base, rate, vat, items: (items ?? []).map(i => ({ total: Number(i.totalPrice) || 0, rate: Number(i.vatRate ?? rate) || 0 })) });
  if (bad) throw new TRPCError({ code: "BAD_REQUEST", message: `ДДВ не одговара на стапката: ${base.toLocaleString("mk-MK")} × ${rate}% = ${bad.expected.toLocaleString("mk-MK", { minimumFractionDigits: 2 })}, а внесено е ${vat.toLocaleString("mk-MK", { minimumFractionDigits: 2 })}. Провери ја стапката или износот.` });
}

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
      if (input?.status) filtered = filtered.filter((r: any) => r.status === input.status);
      if (input?.type) filtered = filtered.filter((r: any) => r.invoiceType === input.type);
      if (input?.customerId) filtered = filtered.filter((r: any) => r.customerId === input.customerId);
      if (input?.search) {
        const s = input.search.toLowerCase();
        filtered = filtered.filter((r: any) => r.invoiceNumber.toLowerCase().includes(s) || r.customerName?.toLowerCase().includes(s));
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
      salesperson: z.string().max(160).optional(),
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
      // Излезна фактура / книжно одобрување: отворен период и број точно следен по ред
      if (input.invoiceType !== "proforma") {
        await assertOpen(input.issueDate, input.invoiceType === "credit_note" ? "Книжно одобрување" : "Фактура");
        input.invoiceNumber = await assertSequential(input.invoiceType === "credit_note" ? "creditNote" : "invoice", input.invoiceNumber, input.issueDate);
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
            const totalStock = stock.reduce((sum: any, s: any) => sum + parseFloat(String(s.quantity)), 0);
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
      /** ЕЦД за извоз — доказ, не менува книжење (смее и по заклучувањето) */
      customsDeclaration: z.string().max(60).nullable().optional(),
      customsDate: z.string().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;
      if (data.status) {
        const cur0: any = (await db.select().from(invoices).where(eq(invoices.id, id)))[0];
        const affectsBooks = cur0 && cur0.invoiceType !== "proforma" && (data.status === "cancelled" || data.status === "draft" || cur0.status === "draft" || cur0.status === "cancelled") && data.status !== cur0.status;
        if (affectsBooks) await assertOpen(cur0.issueDate, `Фактура ${cur0.invoiceNumber}`);
      }
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
      if (cur && cur.invoiceType !== "proforma") {
        // Издадена фактура не се брише: се откажува или сторнира со книжно одобрување (бројот останува)
        if (cur.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: `${cur.invoiceType === "credit_note" ? "Книжното одобрување" : "Фактурата"} ${cur.invoiceNumber} е издадена и не се брише — откажи ја или издади книжно одобрување (сторно)` });
        if (!(await isLastInSequence(cur.invoiceType === "credit_note" ? "creditNote" : "invoice", cur.invoiceNumber)))
          throw new TRPCError({ code: "BAD_REQUEST", message: `Нацртот ${cur.invoiceNumber} не е последен број — бришењето би оставило празнина. Откажи го наместо да го бришеш.` });
        await assertOpen(cur.issueDate, `Фактура ${cur.invoiceNumber}`);
      }
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
          // само дали има прилог — самата датотека се зема со documentFile кога се отвора
          hasFile: sql<boolean>`COALESCE(${incomingInvoices.fileUrl}, '') <> ''`, createdAt: incomingInvoices.createdAt,
          supplierName: suppliers.name,
        })
        .from(incomingInvoices)
        .leftJoin(suppliers, eq(incomingInvoices.supplierId, suppliers.id))
        .orderBy(desc(incomingInvoices.createdAt)).limit(listLimit(input as any));

      let filtered = result;
      if (input?.status) filtered = filtered.filter((r: any) => r.status === input.status);
      if (input?.supplierId) filtered = filtered.filter((r: any) => r.supplierId === input.supplierId);
      if (input?.search) {
        const s = input.search.toLowerCase();
        filtered = filtered.filter((r: any) => r.supplierInvoiceNumber.toLowerCase().includes(s) || r.supplierName?.toLowerCase().includes(s));
      }
      return filtered;
    }),

  /** Прикачена датотека (PDF/слика) на документ — се зема само кога корисникот ја отвора. */
  documentFile: publicQuery
    .input(z.object({ kind: z.enum(["incoming_invoice", "receipt", "email_invoice", "parsed_invoice"]), id: z.number() }))
    .query(async ({ input }) => {
      const t = { incoming_invoice: ["incoming_invoices", "file_url"], receipt: ["receipts", "file_url"], email_invoice: ["email_invoices", "pdf_base64"], parsed_invoice: ["parsed_invoices", "file_url"] }[input.kind];
      const r = (await getPool().query(`SELECT ${t[1]} AS f FROM ${t[0]} WHERE id = $1`, [input.id])).rows[0];
      const raw = String(r?.f ?? "");
      if (!raw) return null;
      const m = raw.match(/^data:([^;]+);base64,(.*)$/s);
      return m ? { mime: m[1], base64: m[2] } : { mime: "application/pdf", base64: raw };
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
      /** ДДВ период: кога фактурата е примена (по правило) — во тој месец се пријавува */
      vatDate: z.string().optional(),
      /** услуга од странски добавувач: ДДВ го пресметуваме ние (vatAmount на фактурата е 0) */
      reverseCharge: z.boolean().default(false),
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
      invData.vatDate = invData.vatDate || invData.receivedDate;
      await assertOpen(invData.vatDate, "Влезна фактура");
      checkIncomingVat(invData, items);
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
        vatDate: invData.vatDate,
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
      vatDate: z.string().optional(),
      /** да се запамети изборот кај добавувачот (следниот пат не прашува) */
      rememberForSupplier: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, rememberForSupplier, ...data } = input;
      const cur0: any = (await db.select().from(incomingInvoices).where(eq(incomingInvoices.id, id)))[0];
      if (!cur0) throw new TRPCError({ code: "NOT_FOUND", message: "Фактурата не постои" });
      // промена што влијае на книжењето (конто, откажување, ДДВ период) — само во отворен период, и стариот и новиот датум
      const booked = (data.expenseAccount && data.expenseAccount !== cur0.expenseAccount) || (data.vatDate && iso(data.vatDate) !== iso(cur0.vatDate))
        || (data.status && (data.status === "cancelled" || cur0.status === "cancelled") && data.status !== cur0.status);
      if (booked) {
        await assertOpen(cur0.vatDate ?? cur0.issueDate ?? cur0.receivedDate, `Влезна фактура ${cur0.supplierInvoiceNumber}`);
        if (data.vatDate) await assertOpen(data.vatDate, "Нов ДДВ период");
      }
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
      const cur0: any = (await db.select().from(incomingInvoices).where(eq(incomingInvoices.id, input.id)))[0];
      if (cur0) await assertOpen(cur0.vatDate ?? cur0.issueDate ?? cur0.receivedDate, `Влезна фактура ${cur0.supplierInvoiceNumber}`);
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
          notes: receipts.notes, hasFile: sql<boolean>`COALESCE(${receipts.fileUrl}, '') <> ''`, createdAt: receipts.createdAt,
          supplierName: suppliers.name,
        })
        .from(receipts)
        .leftJoin(suppliers, eq(receipts.supplierId, suppliers.id))
        .orderBy(desc(receipts.createdAt)).limit(listLimit(input as any));

      let filtered = result;
      if (input?.status) filtered = filtered.filter((r: any) => r.status === input.status);
      if (input?.search) {
        const s = input.search.toLowerCase();
        filtered = filtered.filter((r: any) => r.receiptNumber.toLowerCase().includes(s) || r.supplierName?.toLowerCase().includes(s));
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
      if (input?.status) filtered = filtered.filter((r: any) => r.status === input.status);
      if (input?.search) {
        const s = input.search.toLowerCase();
        filtered = filtered.filter((r: any) => r.dnNumber.toLowerCase().includes(s) || r.customerName?.toLowerCase().includes(s));
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
        orderItemId: z.number().optional(),
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
      const { deductFg, applyDeliveryToOrderItem, remainingToDeliver } = await import("./fg-stock-helper");

      // Валидација: FG залиха + остаток на нарачка
      if (items) {
        for (const item of items) {
          const qty = parseFloat(item.quantity) || 0;
          if (qty <= 0) continue;
          if (item.orderItemId) {
            const row = (await getPool().query(
              `SELECT quantity, COALESCE(delivered_qty,0) AS delivered_qty FROM order_items WHERE id = $1 AND ($2::int IS NULL OR order_id = $2)`,
              [item.orderItemId, data.orderId ?? null],
            )).rows[0];
            if (!row) throw new Error(`Ставка од нарачка #${item.orderItemId} не постои`);
            const rem = remainingToDeliver(Number(row.quantity), Number(row.delivered_qty));
            if (qty - rem > 0.0005) throw new Error(`„${item.description}“: бараш ${qty}, остануваат ${rem} (backorder)`);
          }
          if (item.itemType === "product" && item.productId) {
            await deductFg(item.productId, 0); // no-op check path — real deduct after insert
            const { physicalFgQty } = await import("./fg-stock-helper");
            const totalStock = await physicalFgQty(item.productId);
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
      const backorders: { orderItemId?: number; description: string; remaining: number }[] = [];
      if (items && items.length > 0) {
        await db.insert(documentItems).values(items.map(i => ({
          description: i.description, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice,
          totalPrice: i.totalPrice, notes: i.notes, productId: i.productId, materialId: i.materialId,
          weightKg: i.weightKg, itemType: i.itemType, documentId: insertId, documentType: "delivery_note" as const,
        })));

        for (const item of items) {
          const qty = parseFloat(item.quantity) || 0;
          if (qty <= 0) continue;
          if (item.itemType === "product" && item.productId) {
            await deductFg(item.productId, qty);
          }
          if (item.orderItemId) {
            const { backorder } = await applyDeliveryToOrderItem(item.orderItemId, qty);
            if (backorder > 0.0005) backorders.push({ orderItemId: item.orderItemId, description: item.description, remaining: backorder });
          } else if (data.orderId && item.productId) {
            // legacy match by product_id
            const oi = (await getPool().query(
              `SELECT id FROM order_items WHERE order_id = $1 AND product_id = $2
               AND (quantity::numeric - COALESCE(delivered_qty,0)) > 0.0005 ORDER BY id LIMIT 1`,
              [data.orderId, item.productId],
            )).rows[0];
            if (oi) {
              const { backorder } = await applyDeliveryToOrderItem(oi.id, qty);
              if (backorder > 0.0005) backorders.push({ orderItemId: oi.id, description: item.description, remaining: backorder });
            }
          }
        }
      }

      // Ако нарачката е целосно испорачана — статусот delivered
      if (data.orderId) {
        const open = (await getPool().query(
          `SELECT COUNT(*)::int AS n FROM order_items WHERE order_id = $1
           AND (quantity::numeric - COALESCE(delivered_qty,0)) > 0.0005`, [data.orderId])).rows[0]?.n ?? 0;
        if (Number(open) === 0) {
          await getPool().query(`UPDATE orders SET status = 'delivered', updated_at = now() WHERE id = $1 AND status <> 'cancelled'`, [data.orderId]);
        }
      }

      await logAudit({ action: "CREATE", entityType: "delivery_note", entityId: insertId, description: `Креирана испратница ${data.dnNumber}` }).catch(() => {});
      return { success: true, id: insertId, backorders };
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
            const fgWh = allWh.find((w: any) => w.code === "GL-PROD") || allWh.find((w: any) => w.type === "finished_goods");
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
      const allCust = await db.select().from(customers), allSup = await db.select().from(suppliers);
      const custNames = new Map(allCust.map((c: any) => [Number(c.id), c.company || c.name]));
      const supNames = new Map(allSup.map((x: any) => [Number(x.id), x.name]));
      const custTax = new Map(allCust.map((c: any) => [Number(c.id), c.edb || c.taxNumber || ""]));
      const supTax = new Map(allSup.map((x: any) => [Number(x.id), x.edb || ""]));
      // скеновите (base64) не се праќаат во извештајот — само знак дека постојат; се земаат одделно за ZIP
      const lite = ({ fileUrl, ...r }: any) => ({ ...r, hasFile: !!fileUrl });

      const filteredOutgoing = (await db.select().from(invoices))
        .filter((i: any) => ["standard", "credit_note"].includes(i.invoiceType) && !["draft", "cancelled"].includes(i.status) && inRange(i.issueDate))
        .map((i: any) => { const sg = i.invoiceType === "credit_note" ? -1 : 1; return { ...i, customerName: custNames.get(Number(i.customerId)) ?? "", partnerTaxId: custTax.get(Number(i.customerId)) ?? "",
          baseMkd: sg * Math.abs(mkdOf(i.subtotal, i.currency, i.issueDate)), vatMkd: sg * Math.abs(mkdOf(i.vatAmount, i.currency, i.issueDate)),
          totalMkd: sg * Math.abs(mkdOf(i.totalAmount, i.currency, i.issueDate)) }; })
        .sort((x: any, y: any) => String(x.issueDate).localeCompare(String(y.issueDate)));
      const filteredIncoming = (await db.select().from(incomingInvoices))
        .filter((i: any) => i.status !== "cancelled" && inRange(i.vatDate ?? i.receivedDate ?? i.issueDate))
        .map((i: any) => { const d = i.issueDate ?? i.receivedDate; return { ...lite(i), supplierName: supNames.get(Number(i.supplierId)) ?? "", partnerTaxId: supTax.get(Number(i.supplierId)) ?? "",
          baseMkd: mkdOf(i.subtotal, i.currency, d), vatMkd: mkdOf(i.vatAmount, i.currency, d), totalMkd: mkdOf(i.totalAmount, i.currency, d) }; })
        .sort((x: any, y: any) => String(x.vatDate ?? x.receivedDate).localeCompare(String(y.vatDate ?? y.receivedDate)));

      const sum = (rows: any[], f: string) => rows.reduce((a, r) => a + (Number(r[f]) || 0), 0);
      const totalOutgoing = sum(filteredOutgoing, "totalMkd"), totalOutgoingBase = sum(filteredOutgoing, "baseMkd");
      const totalIncoming = sum(filteredIncoming, "totalMkd"), totalIncomingBase = sum(filteredIncoming, "baseMkd");
      // ДДВ: од ДДВ книгите (вклучува ДДВ на аванси и обратно оданочување) — исто како ДДВ табот
      const { vatBooksData } = await import("./finance-router");
      const vb = await vatBooksData({ from: input.startDate, to: input.endDate });
      const vatBalance = vb.summary.payable;

      // По стапка на ДДВ (излезни и влезни)
      const byRate = (rows: any[]) => {
        const g: Record<string, { base: number; vat: number; count: number }> = {};
        for (const inv of rows) {
          const r = String(Number(inv.vatRate) || 0);
          if (!g[r]) g[r] = { base: 0, vat: 0, count: 0 };
          g[r].base += inv.baseMkd; g[r].vat += inv.vatMkd; g[r].count++;
        }
        return g;
      };
      const fromBook = (g: { key: string; base: number; vat: number; count: number }[]) =>
        Object.fromEntries(g.map(x => [x.key.startsWith("0-") ? "0" : x.key, x])) as Record<string, { base: number; vat: number; count: number }>;
      void byRate;
      const vatGroups = fromBook(vb.summary.output), vatGroupsIn = fromBook(vb.summary.input);

      const { workOrders, receipts: rcT, deliveryNotes: dnT, workOrderMaterials: womT } = await import("@db/schema");
      const allWO = (await db.select().from(workOrders)).filter((w: any) => inRange(w.createdAt));
      const allRc = (await db.select().from(rcT)).filter((r: any) => r.status !== "cancelled" && inRange(r.receiptDate ?? r.createdAt))
        .map((r: any) => ({ ...lite(r), supplierName: supNames.get(Number(r.supplierId)) ?? "" }));
      const allDn = (await db.select().from(dnT)).filter((d: any) => d.status !== "cancelled" && inRange(d.issueDate ?? d.createdAt))
        .map((d: any) => ({ ...d, customerName: custNames.get(Number(d.customerId)) ?? "" }));

      // Требовања: реално потрошен материјал (isActual='actual') по работните налози во периодот
      const woIds = new Set(allWO.map((w: any) => w.id));
      const allWOM = woIds.size
        ? (await db.select().from(womT)).filter((m: any) => m.isActual === "actual" && woIds.has(m.workOrderId))
        : [];
      const allMaterialsForReport = await db.select().from(materials);
      const matById = new Map<number, any>(allMaterialsForReport.map((m: any) => [m.id, m]));
      const woById = new Map<number, any>(allWO.map((w: any) => [w.id, w]));
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
          totalVat: vb.summary.outVat.toFixed(2),
          total: totalOutgoing.toFixed(2),
          items: filteredOutgoing,
          vatGroups,
        },
        incoming: {
          count: filteredIncoming.length,
          totalBase: totalIncomingBase.toFixed(2),
          totalVat: vb.summary.inVat.toFixed(2),
          total: totalIncoming.toFixed(2),
          items: filteredIncoming,
          vatGroups: vatGroupsIn,
        },
        vatRecapitulation: {
          outgoingVat: vb.summary.outVat.toFixed(2),
          incomingVat: vb.summary.inVat.toFixed(2),
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
      const db = getDb();
      const orig = await db.select().from(invoices).where(eq(invoices.id, input.originalInvoiceId));
      if (!orig[0]) throw new Error("Оригиналната фактура не постои");
      // Исправката оди во тековниот (отворен) период, со следен број по ред
      await assertOpen(input.issueDate, "Книжно одобрување");
      input.creditNoteNumber = await assertSequential("creditNote", input.creditNoteNumber, input.issueDate);
      // Не смее да се одобри повеќе отколку што е фактурирано (збирно со претходните одобренија)
      const o: any = orig[0];
      if (o.invoiceType !== "standard" || ["draft", "cancelled"].includes(o.status))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Книжно одобрување се издава само на издадена фактура" });
      const prev = (await getPool().query(`SELECT COALESCE(SUM(ABS(subtotal)),0) s, COALESCE(SUM(ABS(total_amount)),0) t FROM invoices
        WHERE invoice_type = 'credit_note' AND original_invoice_id = $1 AND status <> 'cancelled'`, [input.originalInvoiceId])).rows[0];
      const leftBase = Math.round((Math.abs(Number(o.subtotal)) - Number(prev.s)) * 100) / 100;
      const leftTotal = Math.round((Math.abs(Number(o.totalAmount)) - Number(prev.t)) * 100) / 100;
      if (Math.abs(Number(input.subtotal)) - leftBase > 0.005 || Math.abs(Number(input.totalAmount)) - leftTotal > 0.005)
        throw new TRPCError({ code: "BAD_REQUEST", message: `Може да се одобри најмногу ${leftBase.toLocaleString("mk-MK", { minimumFractionDigits: 2 })} без ДДВ (${leftTotal.toLocaleString("mk-MK", { minimumFractionDigits: 2 })} со ДДВ) — остатокот од фактурата ${o.invoiceNumber} по претходните одобренија` });

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
        items: items.map((item: any, idx: any) => ({
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
        return result.filter((r: any) => r.invoiceNumber.toLowerCase().includes(s) || r.customerName?.toLowerCase().includes(s));
      }
      return result;
    }),

  // ===== PARSED INVOICES =====
  parsedInvoiceList: publicQuery
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db.select().from(parsedInvoices).orderBy(desc(parsedInvoices.createdAt));
      // без самата датотека во листата
      const result = rows.map(({ fileUrl, ...r }: any) => ({ ...r, hasFile: !!fileUrl }));
      if (input?.status) return result.filter((r: any) => r.status === input.status);
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
    const manual = await manualPartnerBalances();
    // рачните налози со партнер се додаваат како уште еден „документ“ кај тој партнер
    const asDocs = (m: Map<number, number>, docType: "invoice" | "incoming_invoice") => [...m].map(([pid, v]) => ({ docType, partnerId: pid, openMkd: v } as OpenDoc));
    const payables = group([...docs.filter(d => d.docType === "incoming_invoice"), ...asDocs(manual.suppliers, "incoming_invoice")], "supplierId");
    const receivables = group([...docs.filter(d => d.docType === "invoice"), ...asDocs(manual.customers, "invoice")], "customerId");
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
  // Само предлог (не троши број): најголемиот постоечки + 1
  nextInvoiceNumber: publicQuery.query(async () => nextSequential("invoice", new Date().getFullYear())),
  nextCreditNoteNumber: publicQuery.query(async () => nextSequential("creditNote", new Date().getFullYear())),

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

  /** Поврат: книжно одобрување (опционално) + враќање на FG залиха. */
  salesReturnCreate: publicQuery
    .input(z.object({
      customerId: z.number(),
      orderId: z.number().optional(),
      invoiceId: z.number().optional(),
      reason: z.string().max(40).optional(),
      notes: z.string().optional(),
      issueDate: z.string(),
      createCreditNote: z.boolean().default(true),
      items: z.array(z.object({
        description: z.string().min(1),
        quantity: z.string(),
        unit: z.string().default("ком"),
        unitPrice: z.string().default("0"),
        totalPrice: z.string(),
        productId: z.number().optional(),
        orderItemId: z.number().optional(),
        restock: z.boolean().default(true),
        vatRate: z.string().default("18"),
      })).min(1),
    }))
    .mutation(async ({ input }) => {
      const { getNextDocNumber } = await import("./counters-helper");
      const { restockFg } = await import("./fg-stock-helper");
      const number = await getNextDocNumber("salesReturn").catch(async () => {
        const y = new Date().getFullYear();
        return `ВР-001/${y}`;
      });
      const subtotal = input.items.reduce((s, i) => s + (parseFloat(i.totalPrice) || 0), 0);
      const vatRate = parseFloat(input.items[0]?.vatRate ?? "18") || 18;
      const vatAmount = Math.round(subtotal * vatRate) / 100;
      const totalAmount = Math.round((subtotal + vatAmount) * 100) / 100;

      const r = await getPool().query(
        `INSERT INTO sales_returns (number, customer_id, order_id, invoice_id, status, reason, notes, issue_date)
         VALUES ($1,$2,$3,$4,'completed',$5,$6,$7) RETURNING id`,
        [number, input.customerId, input.orderId ?? null, input.invoiceId ?? null, input.reason ?? null, input.notes ?? null, input.issueDate],
      );
      const returnId = Number(r.rows[0].id);

      for (const it of input.items) {
        await getPool().query(
          `INSERT INTO sales_return_items (return_id, description, quantity, unit, unit_price, total_price, product_id, order_item_id, restock)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [returnId, it.description, it.quantity, it.unit, it.unitPrice, it.totalPrice, it.productId ?? null, it.orderItemId ?? null, it.restock !== false],
        );
        if (it.restock !== false && it.productId) {
          await restockFg(it.productId, parseFloat(it.quantity) || 0, { notes: `поврат ${number}` });
        }
      }

      let creditNoteId: number | null = null;
      if (input.createCreditNote && input.invoiceId) {
        const year = new Date(input.issueDate).getFullYear();
        const kn = await (await import("./invoice-numbering")).nextSequential("creditNote", year);
        // повикај ја истата валидација преку внатрешна логика — директно insert со assert
        const { assertOpen } = await import("./period-lock");
        const { assertSequential } = await import("./invoice-numbering");
        await assertOpen(input.issueDate, "Книжно одобрување");
        const knNum = await assertSequential("creditNote", kn, input.issueDate);
        const orig = (await getPool().query(`SELECT * FROM invoices WHERE id = $1`, [input.invoiceId])).rows[0];
        if (!orig) throw new Error("Фактурата за книжно не постои");
        const prev = (await getPool().query(
          `SELECT COALESCE(SUM(ABS(subtotal)),0) s, COALESCE(SUM(ABS(total_amount)),0) t FROM invoices
           WHERE invoice_type = 'credit_note' AND original_invoice_id = $1 AND status <> 'cancelled'`, [input.invoiceId])).rows[0];
        const leftBase = Math.round((Math.abs(Number(orig.subtotal)) - Number(prev.s)) * 100) / 100;
        if (subtotal - leftBase > 0.005) throw new Error(`Книжното (${subtotal}) ја надминува остатокот од фактурата (${leftBase})`);
        const ins = await getPool().query(
          `INSERT INTO invoices (invoice_number, customer_id, order_id, status, invoice_type, issue_date, subtotal, vat_rate, vat_amount, total_amount, currency, notes, original_invoice_id, salesperson)
           VALUES ($1,$2,$3,'issued','credit_note',$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [knNum, input.customerId, orig.order_id, input.issueDate, subtotal.toFixed(2), String(vatRate), vatAmount.toFixed(2), totalAmount.toFixed(2),
           orig.currency, input.notes ?? `Поврат ${number}`, input.invoiceId, orig.salesperson ?? null],
        );
        creditNoteId = Number(ins.rows[0].id);
        for (const it of input.items) {
          await getPool().query(
            `INSERT INTO document_items (document_id, document_type, description, quantity, unit, unit_price, total_price, vat_rate, product_id, item_type)
             VALUES ($1,'invoice',$2,$3,$4,$5,$6,$7,$8,'product')`,
            [creditNoteId, it.description, it.quantity, it.unit, it.unitPrice, it.totalPrice, it.vatRate ?? "18", it.productId ?? null],
          );
        }
        await getPool().query(`UPDATE sales_returns SET credit_note_id = $1 WHERE id = $2`, [creditNoteId, returnId]);
      }

      await logAudit({ action: "CREATE", entityType: "sales_return", entityId: returnId, description: `Поврат ${number}` }).catch(() => {});
      return { id: returnId, number, creditNoteId, subtotal, vatAmount, totalAmount };
    }),

  salesReturnList: publicQuery.query(async () => {
    const rows = await getPool().query(
      `SELECT r.*, COALESCE(c.company, c.name) AS customer FROM sales_returns r
       LEFT JOIN customers c ON c.id = r.customer_id ORDER BY r.created_at DESC LIMIT 200`,
    ).then((x) => x.rows).catch(() => []);
    return rows.map((r: any) => ({
      id: r.id, number: r.number, customerId: r.customer_id, customer: r.customer,
      orderId: r.order_id, invoiceId: r.invoice_id, creditNoteId: r.credit_note_id,
      status: r.status, reason: r.reason, notes: r.notes, issueDate: r.issue_date, createdAt: r.created_at,
    }));
  }),
});
