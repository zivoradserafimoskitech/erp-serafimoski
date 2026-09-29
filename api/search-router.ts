// Брзо пребарување (Ctrl+K) низ сите главни записи.
import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getPool } from "./queries/connection";

const q = async (text: string, params: any[]) => (await getPool().query(text, params)).rows as any[];

export interface SearchHit { type: string; id: number; title: string; subtitle: string; href: string }

export const searchRouter = createRouter({
  globalSearch: publicQuery
    .input(z.object({ q: z.string().min(1).max(100) }))
    .query(async ({ input }) => {
      const term = `%${input.q.trim()}%`;
      const n = 6;
      const [cust, sup, quo, inv, inc, ord, wo, mat, dn, rc] = await Promise.all([
        q(`SELECT id, name, company, city FROM customers WHERE name ILIKE $1 OR company ILIKE $1 OR edb ILIKE $1 OR email ILIKE $1 ORDER BY name LIMIT ${n}`, [term]),
        q(`SELECT id, name, city FROM suppliers WHERE name ILIKE $1 OR edb ILIKE $1 ORDER BY name LIMIT ${n}`, [term]),
        q(`SELECT qt.id, qt.quote_number, qt.status, qt.total_amount, qt.currency, c.name AS cn FROM quotations qt LEFT JOIN customers c ON c.id = qt.customer_id
           WHERE qt.quote_number ILIKE $1 OR c.name ILIKE $1 ORDER BY qt.created_at DESC LIMIT ${n}`, [term]),
        q(`SELECT i.id, i.invoice_number, i.invoice_type, i.total_amount, i.currency, c.name AS cn FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
           WHERE i.invoice_number ILIKE $1 OR c.name ILIKE $1 ORDER BY i.created_at DESC LIMIT ${n}`, [term]),
        q(`SELECT ii.id, ii.supplier_invoice_number, ii.total_amount, s.name AS sn FROM incoming_invoices ii LEFT JOIN suppliers s ON s.id = ii.supplier_id
           WHERE ii.supplier_invoice_number ILIKE $1 OR s.name ILIKE $1 ORDER BY ii.created_at DESC LIMIT ${n}`, [term]),
        q(`SELECT o.id, o.order_number, o.status, c.name AS cn FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
           WHERE o.order_number ILIKE $1 OR c.name ILIKE $1 ORDER BY o.created_at DESC LIMIT ${n}`, [term]),
        q(`SELECT id, wo_number, description, status FROM work_orders WHERE wo_number ILIKE $1 OR description ILIKE $1 ORDER BY created_at DESC LIMIT ${n}`, [term]),
        q(`SELECT id, code, name, unit FROM materials WHERE is_active = 'active' AND (name ILIKE $1 OR code ILIKE $1) ORDER BY name LIMIT ${n}`, [term]),
        q(`SELECT d.id, d.dn_number, c.name AS cn FROM delivery_notes d LEFT JOIN customers c ON c.id = d.customer_id
           WHERE d.dn_number ILIKE $1 OR c.name ILIKE $1 ORDER BY d.created_at DESC LIMIT ${n}`, [term]),
        q(`SELECT r.id, r.receipt_number, s.name AS sn FROM receipts r LEFT JOIN suppliers s ON s.id = r.supplier_id
           WHERE r.receipt_number ILIKE $1 OR r.supplier_doc_number ILIKE $1 OR s.name ILIKE $1 ORDER BY r.created_at DESC LIMIT ${n}`, [term]),
      ]);
      const money = (v: any, c: any) => `${Number(v ?? 0).toLocaleString("mk-MK", { maximumFractionDigits: 2 })} ${c && c !== "MKD" ? c : "ден"}`;
      const enc = encodeURIComponent;
      const hits: SearchHit[] = [
        ...quo.map(r => ({ type: "Понуда", id: r.id, title: r.quote_number, subtitle: `${r.cn ?? ""} · ${money(r.total_amount, r.currency)}`, href: `/ponudi?open=${r.id}` })),
        ...inv.map(r => ({ type: r.invoice_type === "proforma" ? "Про-фактура" : r.invoice_type === "credit_note" ? "Книжно одобрување" : "Фактура", id: r.id, title: r.invoice_number, subtitle: `${r.cn ?? ""} · ${money(r.total_amount, r.currency)}`, href: `/smetkovodstvo?open=${r.id}` })),
        ...ord.map(r => ({ type: "Нарачка", id: r.id, title: r.order_number, subtitle: r.cn ?? "", href: `/klienti?order=${r.id}` })),
        ...wo.map(r => ({ type: "Работен налог", id: r.id, title: r.wo_number, subtitle: r.description ?? "", href: `/proizvodstvo?open=${r.id}` })),
        ...cust.map(r => ({ type: "Клиент", id: r.id, title: r.company || r.name, subtitle: [r.company ? r.name : "", r.city].filter(Boolean).join(" · "), href: `/klienti?q=${enc(r.name)}` })),
        ...sup.map(r => ({ type: "Добавувач", id: r.id, title: r.name, subtitle: r.city ?? "", href: `/nabavka?q=${enc(r.name)}` })),
        ...mat.map(r => ({ type: "Материјал", id: r.id, title: r.name, subtitle: `${r.code} · ${r.unit}`, href: `/sklad?q=${enc(r.code)}` })),
        ...inc.map(r => ({ type: "Влезна фактура", id: r.id, title: r.supplier_invoice_number, subtitle: `${r.sn ?? ""} · ${money(r.total_amount, "MKD")}`, href: `/smetkovodstvo?q=${enc(r.supplier_invoice_number)}` })),
        ...dn.map(r => ({ type: "Испратница", id: r.id, title: r.dn_number, subtitle: r.cn ?? "", href: `/smetkovodstvo?q=${enc(r.dn_number)}` })),
        ...rc.map(r => ({ type: "Приемница", id: r.id, title: r.receipt_number, subtitle: r.sn ?? "", href: `/priemnici?q=${enc(r.receipt_number)}` })),
      ];
      return hits;
    }),
});
