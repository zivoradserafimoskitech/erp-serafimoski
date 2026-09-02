import { eq, and } from "drizzle-orm";
// PostgreSQL compat
import { getDb } from "./queries/connection";
import { docCounters } from "@db/schema";

const PREFIXES: Record<string, string> = {
  quote: "ПО",
  workOrder: "РН",
  deliveryNote: "ИС",
  proforma: "ПФ",
  incomingInvoice: "ВФ",
  receipt: "ПР",
  invoice: "",
  creditNote: "КН",
  transfer: "ТР",
  count: "ПП",
  order: "НАР",
  po: "НН",
};

/**
 * За кој вид документ во која табела се чуваат бројот.
 * Служи бројачот да не понуди број што веќе е зафатен.
 * „incomingInvoice" не е тука — тој број го дава добавувачот, не ние.
 */
const NUMBER_SOURCE: Record<string, { table: string; column: string }> = {
  workOrder: { table: "work_orders", column: "wo_number" },
  quote: { table: "quotations", column: "quote_number" },
  deliveryNote: { table: "delivery_notes", column: "dn_number" },
  receipt: { table: "receipts", column: "receipt_number" },
  order: { table: "orders", column: "order_number" },
  po: { table: "purchase_orders", column: "po_number" },
  invoice: { table: "invoices", column: "invoice_number" },
  count: { table: "inventory_counts", column: "count_number" },
};

function formatNumber(kind: string, value: number, year: number): string {
  const prefix = PREFIXES[kind] ?? "";
  const num = String(value).padStart(3, "0");
  return kind === "invoice" ? `${num}/${year}` : `${prefix}-${num}/${year}`;
}

/**
 * Кои редни броеви се веќе зафатени за таа година.
 * Ако табелата не постои или прашањето падне, се враќа празно —
 * подобро е бројачот да работи како порано отколку да блокира создавање.
 */
async function takenNumbers(kind: string, year: number): Promise<Set<number>> {
  const src = NUMBER_SOURCE[kind];
  const taken = new Set<number>();
  if (!src) return taken;
  try {
    const db = getDb();
    const { sql } = await import("drizzle-orm");
    const rows: any = await db.execute(
      sql.raw(`SELECT "${src.column}" AS n FROM "${src.table}" WHERE "${src.column}" LIKE '%/${year}'`)
    );
    const list = rows?.rows ?? rows ?? [];
    for (const r of list) {
      const m = String(r.n ?? "").match(/(\d+)\s*\/\s*\d{4}$/);
      if (m) taken.add(parseInt(m[1], 10));
    }
  } catch {
    // табелата можеби не постои — продолжи без проверка
  }
  return taken;
}

export async function getNextDocNumber(kind: string, year?: number): Promise<string> {
  const db = getDb();
  const y = year ?? new Date().getFullYear();

  const existing = await db
    .select()
    .from(docCounters)
    .where(and(eq(docCounters.kind, kind), eq(docCounters.year, y)));

  const current = existing.length === 0 ? 0 : existing[0].value;

  // Прескокни ги броевите што веќе постојат во базата.
  // Бројачот и документите можат да се разминат ако некој внесол рачно,
  // ако е вратена резервна копија, или ако создавањето паднало на половина.
  const taken = await takenNumbers(kind, y);
  let nextVal = current + 1;
  let guard = 0;
  while (taken.has(nextVal) && guard < 10000) {
    nextVal++;
    guard++;
  }

  if (existing.length === 0) {
    await db.insert(docCounters).values({ kind, year: y, value: nextVal });
  } else {
    await db
      .update(docCounters)
      .set({ value: nextVal, updatedAt: new Date() })
      .where(eq(docCounters.id, existing[0].id));
  }

  return formatNumber(kind, nextVal, y);
}

export async function getNextDocNumberTxn(
  db: any,
  kind: string,
  year?: number
): Promise<string> {
  const y = year ?? new Date().getFullYear();
  const existing = await db
    .select()
    .from(docCounters)
    .where(and(eq(docCounters.kind, kind), eq(docCounters.year, y)));

  let nextVal: number;
  if (existing.length === 0) {
    await db.insert(docCounters).values({ kind, year: y, value: 1 });
    nextVal = 1;
  } else {
    nextVal = existing[0].value + 1;
    await db
      .update(docCounters)
      .set({ value: nextVal, updatedAt: new Date() })
      .where(eq(docCounters.id, existing[0].id));
  }

  const prefix = PREFIXES[kind] ?? "";
  const num = String(nextVal).padStart(3, "0");
  if (kind === "invoice") return `${num}/${y}`;
  return `${prefix}-${num}/${y}`;
}

export async function peekNextDocNumber(kind: string, year?: number): Promise<string> {
  const db = getDb();
  const y = year ?? new Date().getFullYear();
  const existing = await db
    .select()
    .from(docCounters)
    .where(and(eq(docCounters.kind, kind), eq(docCounters.year, y)));
  const nextVal = existing.length === 0 ? 1 : existing[0].value + 1;
  const prefix = PREFIXES[kind] ?? "";
  const num = String(nextVal).padStart(3, "0");
  if (kind === "invoice") return `${num}/${y}`;
  return `${prefix}-${num}/${y}`;
}

export async function bumpDocCounter(kind: string, usedNumber: string, year?: number): Promise<void> {
  const m = usedNumber.match(/(\d+)\s*\//);
  if (!m) return;
  const used = parseInt(m[1], 10);
  if (!Number.isFinite(used)) return;
  const db = getDb();
  const y = year ?? new Date().getFullYear();
  const existing = await db
    .select()
    .from(docCounters)
    .where(and(eq(docCounters.kind, kind), eq(docCounters.year, y)));
  if (existing.length === 0) {
    await db.insert(docCounters).values({ kind, year: y, value: used });
  } else if (existing[0].value < used) {
    await db.update(docCounters).set({ value: used, updatedAt: new Date() }).where(eq(docCounters.id, existing[0].id));
  }
}
