import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  materialLots, materials, suppliers, receipts, receiptItems,
  dnCertificates, deliveryNotes, documentItems, workOrders, workOrderMaterials,
} from "@db/schema";
import { logAudit } from "./audit-helper";

const lotSelect = {
  id: materialLots.id,
  materialId: materialLots.materialId,
  warehouseId: materialLots.warehouseId,
  receiptId: materialLots.receiptId,
  quantity: materialLots.quantity,
  remainingQty: materialLots.remainingQty,
  unitCost: materialLots.unitCost,
  date: materialLots.date,
  heatNumber: materialLots.heatNumber,
  certNumber: materialLots.certNumber,
  certStandard: materialLots.certStandard,
  certUrl: materialLots.certUrl,
  supplierId: materialLots.supplierId,
  materialName: materials.name,
  materialCode: materials.code,
  materialUnit: materials.unit,
};

export const certificatesRouter = createRouter({
  // ═══════════ РЕГИСТАР НА ШАРЖИ ═══════════
  lotCertList: publicQuery
    .input(
      z
        .object({
          search: z.string().optional(),
          materialId: z.number().optional(),
          filter: z.enum(["all", "with_cert", "missing_cert"]).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select(lotSelect)
        .from(materialLots)
        .leftJoin(materials, eq(materialLots.materialId, materials.id))
        .orderBy(desc(materialLots.date));

      const sups = await db.select().from(suppliers);
      const supMap = new Map((sups as any[]).map((x) => [x.id, x.name]));
      const rcs = await db.select().from(receipts);
      const rcMap = new Map((rcs as any[]).map((x) => [x.id, { num: x.receiptNumber, supplierId: x.supplierId }]));

      let out: any[] = (rows as any[]).map((r) => {
        const rc = r.receiptId ? rcMap.get(r.receiptId) : null;
        const supId = r.supplierId ?? rc?.supplierId ?? null;
        return {
          ...r,
          receiptNumber: rc?.num ?? null,
          supplierName: supId ? (supMap.get(supId) ?? null) : null,
          hasCert: Boolean(r.heatNumber || r.certNumber),
        };
      });

      const f = input?.filter ?? "all";
      if (f === "with_cert") out = out.filter((r) => r.hasCert);
      if (f === "missing_cert") out = out.filter((r) => !r.hasCert);
      if (input?.materialId) out = out.filter((r) => r.materialId === input.materialId);
      if (input?.search) {
        const s = input.search.trim().toLowerCase();
        out = out.filter(
          (r) =>
            (r.heatNumber ?? "").toLowerCase().includes(s) ||
            (r.certNumber ?? "").toLowerCase().includes(s) ||
            (r.certStandard ?? "").toLowerCase().includes(s) ||
            (r.materialName ?? "").toLowerCase().includes(s) ||
            (r.materialCode ?? "").toLowerCase().includes(s) ||
            (r.receiptNumber ?? "").toLowerCase().includes(s)
        );
      }
      return out;
    }),

  lotCertStats: publicQuery.query(async () => {
    const db = getDb();
    const rows = await db.select().from(materialLots);
    const all = rows as any[];
    const withCert = all.filter((r) => r.heatNumber || r.certNumber);
    const inStock = all.filter((r) => Number(r.remainingQty ?? 0) > 0);
    return {
      total: all.length,
      withCert: withCert.length,
      missing: all.length - withCert.length,
      inStockMissing: inStock.filter((r) => !(r.heatNumber || r.certNumber)).length,
    };
  }),

  lotCertUpdate: publicQuery
    .input(
      z.object({
        id: z.number(),
        heatNumber: z.string().optional(),
        certNumber: z.string().optional(),
        certStandard: z.string().optional(),
        certUrl: z.string().optional(),
        supplierId: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...rest } = input;
      const patch: any = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) patch[k] = v === "" ? null : v;
      }
      if (Object.keys(patch).length === 0) return { success: true };
      await db.update(materialLots).set(patch).where(eq(materialLots.id, id));
      await logAudit({
        action: "UPDATE", entityType: "material_lot", entityId: id,
        description: `Ажуриран атест/шаржа на партија #${id}`,
      }).catch(() => {});
      return { success: true };
    }),

  // ═══════════ АТЕСТИ НА ИСПРАТНИЦА ═══════════
  dnCertList: publicQuery
    .input(z.object({ deliveryNoteId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return await db
        .select()
        .from(dnCertificates)
        .where(eq(dnCertificates.deliveryNoteId, input.deliveryNoteId))
        .orderBy(dnCertificates.id);
    }),

  /**
   * Предлага шаржи за испратницата: гледа кои материјали се на неа
   * (директно, или преку работниот налог на нејзината нарачка) и враќа
   * партии со внесена шаржа, најстарите први (FIFO).
   */
  dnCertSuggest: publicQuery
    .input(z.object({ deliveryNoteId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const dnRows = await db.select().from(deliveryNotes).where(eq(deliveryNotes.id, input.deliveryNoteId));
      const dn: any = dnRows[0];
      if (!dn) return { materialIds: [], lots: [] };

      const items = await db
        .select()
        .from(documentItems)
        .where(and(eq(documentItems.documentId, input.deliveryNoteId), eq(documentItems.documentType, "delivery_note")));

      const matIds = new Set<number>();
      for (const it of items as any[]) if (it.materialId) matIds.add(it.materialId);

      // Ако испратницата е од готови производи, материјалите се на работниот налог
      if (matIds.size === 0 && dn.orderId) {
        const wos = await db.select().from(workOrders).where(eq(workOrders.orderId, dn.orderId));
        for (const wo of wos as any[]) {
          const wms = await db
            .select()
            .from(workOrderMaterials)
            .where(eq(workOrderMaterials.workOrderId, wo.id));
          for (const wm of wms as any[]) if (wm.materialId) matIds.add(wm.materialId);
        }
      }

      if (matIds.size === 0) return { materialIds: [], lots: [] };

      const rows = await db
        .select(lotSelect)
        .from(materialLots)
        .leftJoin(materials, eq(materialLots.materialId, materials.id))
        .orderBy(materialLots.date);

      const sups = await db.select().from(suppliers);
      const supMap = new Map((sups as any[]).map((x) => [x.id, x.name]));
      const rcs = await db.select().from(receipts);
      const rcMap = new Map((rcs as any[]).map((x) => [x.id, { num: x.receiptNumber, supplierId: x.supplierId }]));

      const lots = (rows as any[])
        .filter((r) => matIds.has(r.materialId) && (r.heatNumber || r.certNumber))
        .map((r) => {
          const rc = r.receiptId ? rcMap.get(r.receiptId) : null;
          const supId = r.supplierId ?? rc?.supplierId ?? null;
          return { ...r, receiptNumber: rc?.num ?? null, supplierName: supId ? (supMap.get(supId) ?? null) : null };
        });

      return { materialIds: Array.from(matIds), lots };
    }),

  /** Го заменува целиот сет атести на испратницата */
  dnCertSet: publicQuery
    .input(
      z.object({
        deliveryNoteId: z.number(),
        entries: z.array(
          z.object({
            lotId: z.number().nullable().optional(),
            materialId: z.number().nullable().optional(),
            materialName: z.string().optional(),
            heatNumber: z.string().optional(),
            certNumber: z.string().optional(),
            certStandard: z.string().optional(),
            certUrl: z.string().optional(),
            supplierName: z.string().optional(),
            quantity: z.string().optional(),
            unit: z.string().optional(),
            notes: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(dnCertificates).where(eq(dnCertificates.deliveryNoteId, input.deliveryNoteId));
      if (input.entries.length > 0) {
        await db.insert(dnCertificates).values(
          input.entries.map((e) => ({
            deliveryNoteId: input.deliveryNoteId,
            lotId: e.lotId ?? null,
            materialId: e.materialId ?? null,
            materialName: e.materialName ?? null,
            heatNumber: e.heatNumber ?? null,
            certNumber: e.certNumber ?? null,
            certStandard: e.certStandard ?? null,
            certUrl: e.certUrl ?? null,
            supplierName: e.supplierName ?? null,
            quantity: e.quantity ?? "0",
            unit: e.unit ?? null,
            notes: e.notes ?? null,
          })) as any
        );
      }
      return { success: true, count: input.entries.length };
    }),

  /** Каде е употребена една шаржа — за прашањето „кај кого отиде оваа партија“ */
  heatTrace: publicQuery
    .input(z.object({ heatNumber: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = getDb();
      const h = input.heatNumber.trim().toLowerCase();

      const lots = await db
        .select(lotSelect)
        .from(materialLots)
        .leftJoin(materials, eq(materialLots.materialId, materials.id));
      const matched = (lots as any[]).filter((r) => (r.heatNumber ?? "").toLowerCase() === h);

      const certs = await db.select().from(dnCertificates);
      const used = (certs as any[]).filter((c) => (c.heatNumber ?? "").toLowerCase() === h);

      const dnIds = Array.from(new Set(used.map((c) => c.deliveryNoteId)));
      const dnRows = dnIds.length > 0 ? await db.select().from(deliveryNotes) : [];
      const dns = (dnRows as any[]).filter((d) => dnIds.includes(d.id));

      return { lots: matched, deliveries: dns };
    }),
});
