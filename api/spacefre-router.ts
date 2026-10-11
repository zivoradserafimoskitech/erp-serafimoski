// tRPC router for the Spacefre panel in the ERP (proposal).
import { z } from "zod";
import { sql } from "drizzle-orm";
import { createRouter, authedQuery, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { spacefre, spacefreEnabled, handleEvent, normalizeCurrency, spacefreInvoiceCurrency } from "./spacefre-connector";

export const spacefreRouter = createRouter({
  status: authedQuery.query(() => ({ enabled: spacefreEnabled() })),

  /** Invoice currency: what Spacefre has on file + the supported list. */
  settings: authedQuery.query(() => spacefre.getSettings()),

  setInvoiceCurrency: adminQuery
    .input(z.object({ currency: z.string().min(1) }))
    .mutation(({ input }) => spacefre.putSettings(normalizeCurrency(input.currency))),

  links: authedQuery.query(async () => {
    const db = getDb();
    const r = await db.execute(sql`SELECT l.*, o.order_number, o.status AS order_status FROM spacefre_links l JOIN orders o ON o.id = l.order_id ORDER BY l.created_at DESC LIMIT 200`);
    return r.rows ?? [];
  }),

  accept: authedQuery
    .input(z.object({ spacefreWorkOrderId: z.string(), shipDate: z.string().optional() }))
    .mutation(({ input }) => spacefre.accept(input.spacefreWorkOrderId, input.shipDate)),

  decline: authedQuery
    .input(z.object({ spacefreWorkOrderId: z.string(), reason: z.string().min(3) }))
    .mutation(({ input }) => spacefre.decline(input.spacefreWorkOrderId, input.reason)),

  /** Backfill: pull new offers in case a webhook was missed (idempotent). */
  sync: adminQuery.mutation(async () => {
    const preferred = spacefreInvoiceCurrency();
    if (preferred) await spacefre.putSettings(preferred);
    const inbox = await spacefre.listOrders();
    let created = 0;
    for (const card of inbox.orders ?? []) {
      if (card.lane !== "new") continue;
      const r = await handleEvent("order.offered", `sync-${card.work_order_id}`, card);
      if (r === "created") created++;
    }
    return { created };
  }),
});
