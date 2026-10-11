// Spacefre ↔ ERP Серафимоски: factory connector (proposal - not yet in the ERP repo).
//
// What it does
//  1. Receives signed Spacefre webhooks at POST /api/spacefre/webhook
//     order.offered  -> creates customer "Spacefre" (once), an order + item, link row
//     order.accepted / order.status_changed / order.shipped -> mirrors status on the order
//     invoice.recorded -> stores Spacefre's acknowledgement on the link row
//  2. Pushes the factory's own progress back to Spacefre through the
//     Factory connector API (accept / decline / status / shipment / invoice).
//
// Security: HMAC-SHA256 signature over "<t>.<raw body>", 5-minute replay window,
// constant-time compare, idempotency on X-Spacefre-Delivery. Disabled unless
// SPACEFRE_CONNECTOR_KEY and SPACEFRE_WEBHOOK_SECRET are set.
//
// Env: SPACEFRE_API_URL (default https://api.spacefre.com), SPACEFRE_CONNECTOR_KEY (sfc_...),
//      SPACEFRE_WEBHOOK_SECRET (whsec_...), SPACEFRE_INVOICE_CURRENCY (optional: EUR | MKD | ...;
//      the factory's default invoice currency, pushed to Spacefre on "Sync").
//
// Currency: Spacefre payouts are EUR. Invoices to Spacefre are issued in the chosen
// currency; the amount comes from Spacefre's invoice-preview (locked rate, recorded
// on both sides), so the ERP never invents its own conversion.

import type { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "./queries/connection";
import { customers, orders, orderItems, workOrders } from "../db/schema";
import { logAudit } from "./audit-helper";

// ---------------------------------------------------------------- config

export const spacefreConfig = () => ({
  apiUrl: (process.env.SPACEFRE_API_URL ?? "https://api.spacefre.com").replace(/\/$/, ""),
  key: process.env.SPACEFRE_CONNECTOR_KEY ?? "",
  secret: process.env.SPACEFRE_WEBHOOK_SECRET ?? "",
});
export const spacefreEnabled = () => {
  const c = spacefreConfig();
  return c.key.startsWith("sfc_") && c.secret.startsWith("whsec_");
};

// ---------------------------------------------------------------- signature (pure)

export function signSpacefre(secret: string, body: string, ts: number): string {
  const mac = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return `t=${ts},v1=${mac}`;
}

export function verifySpacefre(secret: string, body: string, header: string, nowSec: number, toleranceSec = 300): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const ts = Number(parts.t);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > toleranceSec) return false;
  const expected = Buffer.from(signSpacefre(secret, body, ts));
  const got = Buffer.from(header);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

// ---------------------------------------------------------------- currency (pure)

const CURRENCY_ALIASES: Record<string, string> = {
  MKD: "MKD", "ДЕН": "MKD", "ДЕН.": "MKD", DEN: "MKD", "DEN.": "MKD", "ДЕНАР": "MKD", "ДЕНАРИ": "MKD",
  EUR: "EUR", "€": "EUR", "ЕВРО": "EUR", EURO: "EUR",
};

/** ERP currency label -> ISO 4217 code ("ден" -> MKD, "€" -> EUR, "usd" -> USD). */
export function normalizeCurrency(value: string | null | undefined, fallback = "MKD"): string {
  const v = String(value ?? "").trim().toUpperCase();
  if (!v) return fallback;
  if (CURRENCY_ALIASES[v]) return CURRENCY_ALIASES[v];
  if (/^[A-Z]{3}$/.test(v)) return v;
  throw new Error(`unknown currency: ${value}`);
}

export const spacefreInvoiceCurrency = (): string | undefined =>
  process.env.SPACEFRE_INVOICE_CURRENCY ? normalizeCurrency(process.env.SPACEFRE_INVOICE_CURRENCY) : undefined;

// ---------------------------------------------------------------- mapping (pure)

/** Spacefre work-order status -> ERP order status. */
export const ORDER_STATUS_FROM_SPACEFRE: Record<string, string> = {
  issued: "pending",
  acknowledged: "confirmed",
  deviation_pending: "on_hold",
  in_progress: "in_production",
  nonconformance: "on_hold",
  completed: "ready",
  inspected: "ready",
  released_to_next_op: "delivered",
  rejected: "cancelled",
};

/** ERP work-order status -> Spacefre status to push (undefined = nothing to push). */
export const SPACEFRE_STATUS_FROM_ERP_WO: Record<string, string | undefined> = {
  pending: undefined,
  in_progress: "in_progress",
  on_hold: undefined, // a hold is a conversation: use Spacefre's deviation flow
  completed: "completed",
  cancelled: undefined, // cancel = decline (only while new) - never silent
};

export type SpacefreCard = {
  work_order_id: string;
  reference: string;
  status: string;
  process: string | null;
  material: string | null;
  thickness_mm: string | null;
  dimensions_mm: string[] | null;
  quantity: number | null;
  due_date: string | null;
  ship_date: string | null;
  payout_eur: string | null;
};

export function orderFromCard(card: SpacefreCard) {
  const qty = Number(card.quantity ?? 1) || 1;
  const payout = Number(card.payout_eur ?? 0);
  const dims = (card.dimensions_mm ?? []).join(" × ");
  return {
    orderNumber: `SF-${card.reference}`,
    status: ORDER_STATUS_FROM_SPACEFRE[card.status] ?? "pending",
    deliveryDate: card.ship_date ?? card.due_date,
    totalAmount: payout.toFixed(2),
    notes: `Spacefre мрежна нарачка ${card.reference} (${card.work_order_id}). Износ во EUR = исплата од Spacefre, без ДДВ.`,
    item: {
      description: [card.process?.replace(/_/g, " "), card.material, card.thickness_mm && `${card.thickness_mm} mm`].filter(Boolean).join(" · ") || "Spacefre дел",
      quantity: qty.toFixed(3),
      unitPrice: (payout / qty).toFixed(2),
      totalPrice: payout.toFixed(2),
      material: card.material,
      dimensions: dims || null,
    },
  };
}

// ---------------------------------------------------------------- tables

export const SPACEFRE_SQL = [
  `CREATE TABLE IF NOT EXISTS "spacefre_links" (
    "id" serial PRIMARY KEY NOT NULL,
    "spacefre_work_order_id" varchar(40) NOT NULL UNIQUE,
    "reference" varchar(40) NOT NULL,
    "order_id" bigint NOT NULL,
    "work_order_id" bigint,
    "last_status" varchar(40),
    "invoice_ack" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "spacefre_events" (
    "delivery_id" varchar(40) PRIMARY KEY NOT NULL,
    "event" varchar(40) NOT NULL,
    "received_at" timestamp DEFAULT now() NOT NULL
  )`,
];

// ---------------------------------------------------------------- webhook receiver

async function spacefreCustomerId(db: any): Promise<number> {
  const found = await db.select().from(customers).where(eq(customers.name, "Spacefre")).limit(1);
  if (found[0]) return found[0].id;
  const [row] = await db
    .insert(customers)
    .values({ name: "Spacefre", company: "Spacefre", country: "EU", notes: "Мрежа на фабрики - нарачки преку конектор", paymentDays: 30 } as any)
    .returning();
  return row.id;
}

export async function handleEvent(event: string, deliveryId: string, data: any): Promise<string> {
  const db = getDb();
  // idempotency: a redelivered webhook is acknowledged, not re-applied
  const seen = await db.execute(sql`INSERT INTO spacefre_events (delivery_id, event) VALUES (${deliveryId}, ${event}) ON CONFLICT DO NOTHING RETURNING delivery_id`);
  if (!seen.rows?.length) return "duplicate";

  if (event === "order.offered") {
    const card = data as SpacefreCard;
    const link = await db.execute(sql`SELECT order_id FROM spacefre_links WHERE spacefre_work_order_id = ${card.work_order_id}`);
    if (link.rows?.length) return "exists";
    const o = orderFromCard(card);
    const customerId = await spacefreCustomerId(db);
    const [order] = await db
      .insert(orders)
      .values({ orderNumber: o.orderNumber, customerId, status: o.status, totalAmount: o.totalAmount, deliveryDate: o.deliveryDate, notes: o.notes } as any)
      .returning();
    await db.insert(orderItems).values({ orderId: order.id, ...o.item } as any);
    await db.execute(sql`INSERT INTO spacefre_links (spacefre_work_order_id, reference, order_id, last_status) VALUES (${card.work_order_id}, ${card.reference}, ${order.id}, ${card.status})`);
    await logAudit({ action: "CREATE", entityType: "order", entityId: order.id, description: `Spacefre нарачка ${card.reference} примена` }).catch(() => {});
    return "created";
  }

  if (event === "order.accepted" || event === "order.status_changed" || event === "order.shipped") {
    const card = data as SpacefreCard;
    const link = await db.execute(sql`SELECT order_id FROM spacefre_links WHERE spacefre_work_order_id = ${card.work_order_id}`);
    const orderId = link.rows?.[0]?.order_id;
    if (!orderId) return "unknown-order";
    const status = ORDER_STATUS_FROM_SPACEFRE[card.status];
    if (status) await db.update(orders).set({ status, updatedAt: new Date() } as any).where(eq(orders.id, Number(orderId)));
    await db.execute(sql`UPDATE spacefre_links SET last_status = ${card.status}, updated_at = now() WHERE spacefre_work_order_id = ${card.work_order_id}`);
    return "updated";
  }

  if (event === "invoice.recorded") {
    await db.execute(sql`UPDATE spacefre_links SET invoice_ack = ${JSON.stringify(data)}, updated_at = now() WHERE spacefre_work_order_id = ${String(data.work_order_id)}`);
    return "recorded";
  }
  return "ignored";
}

export function registerSpacefreConnector(app: Hono) {
  app.post("/api/spacefre/webhook", async (c) => {
    if (!spacefreEnabled()) return c.json({ error: "Spacefre connector is not configured" }, 404);
    const raw = await c.req.text();
    const sig = c.req.header("x-spacefre-signature") ?? "";
    if (!verifySpacefre(spacefreConfig().secret, raw, sig, Math.floor(Date.now() / 1000))) {
      return c.json({ error: "bad signature" }, 401);
    }
    let body: any;
    try { body = JSON.parse(raw); } catch { return c.json({ error: "bad json" }, 400); }
    const event = c.req.header("x-spacefre-event") ?? body.event;
    const deliveryId = c.req.header("x-spacefre-delivery") ?? body.id;
    if (event === "ping") return c.json({ ok: true, pong: true });
    try {
      const result = await handleEvent(String(event), String(deliveryId), body.data ?? {});
      return c.json({ ok: true, result });
    } catch (e: any) {
      // 5xx -> Spacefre retries with backoff
      return c.json({ error: String(e?.message ?? e) }, 500);
    }
  });
}

// ---------------------------------------------------------------- outbound client

async function call(path: string, body?: unknown, method?: string): Promise<any> {
  const { apiUrl, key } = spacefreConfig();
  const r = await fetch(`${apiUrl}${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json", "X-Spacefre-Connector-Key": key },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Spacefre ${path}: ${r.status} ${data?.detail ?? ""}`);
  return data;
}

export const spacefre = {
  listOrders: () => call("/api/v1/connector/orders"),
  accept: (id: string, shipDate?: string) => call(`/api/v1/connector/orders/${id}/accept`, shipDate ? { ship_date: shipDate } : {}),
  decline: (id: string, reason: string) => call(`/api/v1/connector/orders/${id}/decline`, { reason }),
  status: (id: string, status: string) => call(`/api/v1/connector/orders/${id}/status`, { status }),
  shipment: (id: string, carrier: string, trackingNumber: string) =>
    call(`/api/v1/connector/orders/${id}/shipment`, { carrier, tracking_number: trackingNumber }),
  invoice: (id: string, number: string, amount: string, currency: string | undefined, issuedOn: string) =>
    call(`/api/v1/connector/orders/${id}/invoice`, { number, amount, ...(currency ? { currency } : {}), issued_on: issuedOn }),
  invoicePreview: (id: string, currency?: string) =>
    call(`/api/v1/connector/orders/${id}/invoice-preview${currency ? `?currency=${encodeURIComponent(currency)}` : ""}`),
  getSettings: () => call("/api/v1/connector/settings"),
  putSettings: (invoiceCurrency: string) => call("/api/v1/connector/settings", { invoice_currency: invoiceCurrency }, "PUT"),
};

/** Hook: call after an ERP work order changes status (production-router). Never throws. */
export async function onErpWorkOrderStatus(erpWorkOrderId: number, status: string): Promise<void> {
  if (!spacefreEnabled()) return;
  const target = SPACEFRE_STATUS_FROM_ERP_WO[status];
  if (!target) return;
  try {
    const db = getDb();
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, erpWorkOrderId)).limit(1);
    if (!wo?.orderId) return;
    const link = await db.execute(sql`SELECT spacefre_work_order_id FROM spacefre_links WHERE order_id = ${wo.orderId}`);
    const sfId = link.rows?.[0]?.spacefre_work_order_id;
    if (!sfId) return;
    await db.execute(sql`UPDATE spacefre_links SET work_order_id = ${erpWorkOrderId} WHERE order_id = ${wo.orderId}`);
    await spacefre.status(String(sfId), target);
    if (target === "completed") await spacefre.status(String(sfId), "inspected").catch(() => {});
  } catch (e) {
    console.warn("[spacefre] status push failed", e);
  }
}

/** Hook: after a delivery note (испратница) for a Spacefre order. */
export async function onErpDelivery(orderId: number, carrier: string, trackingNumber: string): Promise<void> {
  if (!spacefreEnabled()) return;
  const db = getDb();
  const link = await db.execute(sql`SELECT spacefre_work_order_id FROM spacefre_links WHERE order_id = ${orderId}`);
  const sfId = link.rows?.[0]?.spacefre_work_order_id;
  if (sfId) await spacefre.shipment(String(sfId), carrier, trackingNumber).catch((e) => console.warn("[spacefre] shipment push failed", e));
}

async function linkedSpacefreId(orderId: number | null | undefined): Promise<string | undefined> {
  if (!orderId) return undefined;
  const db = getDb();
  const link = await db.execute(sql`SELECT spacefre_work_order_id FROM spacefre_links WHERE order_id = ${orderId}`);
  const id = link.rows?.[0]?.spacefre_work_order_id;
  return id ? String(id) : undefined;
}

/**
 * Hook (workOrderToInvoice): for a Spacefre order, the invoice currency and net amount
 * come from Spacefre (chosen currency, locked FX rate). Returns undefined for other
 * orders - the ERP's own logic stays unchanged.
 */
export async function spacefreInvoiceTerms(
  orderId: number | null | undefined,
): Promise<{ currency: string; subtotal: number; fx: any } | undefined> {
  if (!spacefreEnabled()) return undefined;
  const sfId = await linkedSpacefreId(orderId);
  if (!sfId) return undefined;
  const fx = await spacefre.invoicePreview(sfId, spacefreInvoiceCurrency());
  return { currency: fx.quote, subtotal: Number(fx.expected_amount), fx };
}

/** Hook: after the ERP issues the invoice to Spacefre for that order (net amount). */
export async function onErpInvoice(orderId: number, number: string, netAmount: string, currency: string, issuedOn: string): Promise<void> {
  if (!spacefreEnabled()) return;
  const sfId = await linkedSpacefreId(orderId);
  if (sfId)
    await spacefre
      .invoice(sfId, number, netAmount, normalizeCurrency(currency), issuedOn)
      .catch((e) => console.warn("[spacefre] invoice push failed", e));
}
