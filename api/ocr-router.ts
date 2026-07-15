import { z } from "zod";
import { eq, desc } from "../queries/pg-compat";
// PostgreSQL compat
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  parsedInvoices,
  parsedReceiptItems,
  materials,
  suppliers,
} from "@db/schema";
import {
  parsePdfDocument,
  parseTextDocument,
  matchItemsToMaterials,
  type MatchedItem,
} from "./ocr-service";

export const ocrRouter = createRouter({
  // Upload and parse PDF document
  parsePdf: publicQuery
    .input(z.object({
      base64Data: z.string(),
      fileName: z.string(),
      documentType: z.enum(["invoice", "receipt", "delivery_note", "other"]).default("receipt"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();

      // Decode base64 PDF
      const buffer = Buffer.from(input.base64Data, "base64");

      // Parse PDF
      const parsed = await parsePdfDocument(buffer);

      if (!parsed.rawText || parsed.items.length === 0) {
        return {
          success: false,
          message: "Не може да се извлече текст од PDF документот. Проверете дали документот содржи текст (не е скенирана слика).",
          parsed: null,
        };
      }

      // Match items to materials
      const matchedItems = await matchItemsToMaterials(parsed.items);

      // Save parsed document
      const result = await db.insert(parsedInvoices).values({
        originalFileName: input.fileName,
        supplierName: parsed.supplierName,
        invoiceNumber: parsed.documentNumber,
        issueDate: parsed.issueDate ? new Date(parsed.issueDate) : null,
        totalAmount: parsed.totalAmount,
        vatAmount: parsed.vatAmount,
        currency: parsed.currency ?? "MKD",
        rawText: parsed.rawText,
        documentType: input.documentType,
        status: "parsed",
      } as any);
      const parsedId = Number(result[0].insertId);

      // Save matched items
      if (matchedItems.length > 0) {
        await db.insert(parsedReceiptItems).values(
          matchedItems.map((item) => ({
            parsedInvoiceId: parsedId,
            rawDescription: item.rawDescription,
            matchedMaterialId: item.matchedMaterialId,
            matchedMaterialName: item.matchedMaterialName,
            matchConfidence: String(item.matchConfidence),
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            vatRate: item.vatRate ?? "18",
            isConfirmed: item.matchedMaterialId ? "pending" : "rejected",
          }))
        );
      }

      return {
        success: true,
        message: `Успешно парсирани ${matchedItems.length} ставки`,
        parsedId,
        document: {
          ...parsed,
          items: matchedItems,
        },
      };
    }),

  // Parse text directly (for OCR text from images)
  parseText: publicQuery
    .input(z.object({
      text: z.string().min(1),
      fileName: z.string().optional(),
      documentType: z.enum(["invoice", "receipt", "delivery_note", "other"]).default("receipt"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();

      const parsed = await parseTextDocument(input.text);

      if (parsed.items.length === 0) {
        return {
          success: false,
          message: "Не се пронајдени ставки во текстот. Проверете го форматот.",
          parsed: null,
        };
      }

      const matchedItems = await matchItemsToMaterials(parsed.items);

      const result = await db.insert(parsedInvoices).values({
        originalFileName: input.fileName ?? "text_input.txt",
        supplierName: parsed.supplierName,
        invoiceNumber: parsed.documentNumber,
        issueDate: parsed.issueDate ? new Date(parsed.issueDate) : null,
        totalAmount: parsed.totalAmount,
        vatAmount: parsed.vatAmount,
        currency: parsed.currency ?? "MKD",
        rawText: parsed.rawText,
        documentType: input.documentType,
        status: "parsed",
      } as any);
      const parsedId = Number(result[0].insertId);

      if (matchedItems.length > 0) {
        await db.insert(parsedReceiptItems).values(
          matchedItems.map((item) => ({
            parsedInvoiceId: parsedId,
            rawDescription: item.rawDescription,
            matchedMaterialId: item.matchedMaterialId,
            matchedMaterialName: item.matchedMaterialName,
            matchConfidence: String(item.matchConfidence),
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            vatRate: item.vatRate ?? "18",
            isConfirmed: item.matchedMaterialId ? "pending" : "rejected",
          }))
        );
      }

      return {
        success: true,
        message: `Успешно парсирани ${matchedItems.length} ставки`,
        parsedId,
        document: {
          ...parsed,
          items: matchedItems,
        },
      };
    }),

  // List all parsed documents
  parsedDocumentList: publicQuery
    .input(z.object({
      documentType: z.string().optional(),
      status: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db
        .select({
          id: parsedInvoices.id,
          originalFileName: parsedInvoices.originalFileName,
          supplierName: parsedInvoices.supplierName,
          invoiceNumber: parsedInvoices.invoiceNumber,
          issueDate: parsedInvoices.issueDate,
          totalAmount: parsedInvoices.totalAmount,
          vatAmount: parsedInvoices.vatAmount,
          currency: parsedInvoices.currency,
          documentType: parsedInvoices.documentType,
          status: parsedInvoices.status,
          createdAt: parsedInvoices.createdAt,
        })
        .from(parsedInvoices)
        .orderBy(desc(parsedInvoices.createdAt));

      let filtered = result;
      if (input?.documentType) filtered = filtered.filter(r => r.documentType === input.documentType);
      if (input?.status) filtered = filtered.filter(r => r.status === input.status);

      return filtered;
    }),

  // Get single parsed document with items
  parsedDocumentById: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const doc = await db
        .select()
        .from(parsedInvoices)
        .where(eq(parsedInvoices.id, input.id));

      if (!doc[0]) return null;

      const items = await db
        .select({
          id: parsedReceiptItems.id,
          parsedInvoiceId: parsedReceiptItems.parsedInvoiceId,
          rawDescription: parsedReceiptItems.rawDescription,
          matchedMaterialId: parsedReceiptItems.matchedMaterialId,
          matchedMaterialName: parsedReceiptItems.matchedMaterialName,
          matchConfidence: parsedReceiptItems.matchConfidence,
          quantity: parsedReceiptItems.quantity,
          unit: parsedReceiptItems.unit,
          unitPrice: parsedReceiptItems.unitPrice,
          totalPrice: parsedReceiptItems.totalPrice,
          vatRate: parsedReceiptItems.vatRate,
          isConfirmed: parsedReceiptItems.isConfirmed,
        })
        .from(parsedReceiptItems)
        .where(eq(parsedReceiptItems.parsedInvoiceId, input.id));

      return { ...doc[0], items };
    }),

  // Confirm/reject a parsed item
  updateParsedItem: publicQuery
    .input(z.object({
      id: z.number(),
      matchedMaterialId: z.number().nullable().optional(),
      isConfirmed: z.enum(["pending", "confirmed", "rejected"]).optional(),
      quantity: z.string().optional(),
      unitPrice: z.string().optional(),
      unit: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...data } = input;

      const updateData: any = { ...data };
      if (data.matchedMaterialId !== undefined && data.matchedMaterialId !== null) {
        // Get material name
        const mat = await db
          .select({ name: materials.name })
          .from(materials)
          .where(eq(materials.id, data.matchedMaterialId));
        updateData.matchedMaterialName = mat[0]?.name ?? null;
      }

      await db.update(parsedReceiptItems).set(updateData).where(eq(parsedReceiptItems.id, id));
      return { success: true };
    }),

  // Delete parsed document and its items
  deleteParsedDocument: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(parsedReceiptItems).where(eq(parsedReceiptItems.parsedInvoiceId, input.id));
      await db.delete(parsedInvoices).where(eq(parsedInvoices.id, input.id));
      return { success: true };
    }),

  // Get materials list for manual matching
  materialListForMatching: publicQuery.query(async () => {
    const db = getDb();
    return db
      .select({
        id: materials.id,
        name: materials.name,
        code: materials.code,
        unit: materials.unit,
      })
      .from(materials)
      .where(eq(materials.isActive, "active"));
  }),
});
