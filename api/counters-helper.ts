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
};

export async function getNextDocNumber(kind: string, year?: number): Promise<string> {
  const db = getDb();
  const y = year ?? new Date().getFullYear();

  // Try to find existing counter
  const existing = await db
    .select()
    .from(docCounters)
    .where(and(eq(docCounters.kind, kind), eq(docCounters.year, y)));

  let nextVal: number;

  if (existing.length === 0) {
    // Create new counter
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

  if (kind === "invoice") {
    return `${num}/${y}`;
  }
  return `${prefix}-${num}/${y}`;
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
