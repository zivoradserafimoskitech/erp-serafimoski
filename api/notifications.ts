// Известувања во апликацијата (ѕвонче во заглавјето). Генерички — ги користат маркетинг и други модули.
import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getPool } from "./queries/connection";

const q = async (text: string, params: any[] = []) => (await getPool().query(text, params)).rows as any[];

/** Создај известување. Со dedupeKey — најмногу едно по клуч (идемпотентно). */
export async function notify(n: { recipient?: string | null; kind: string; title: string; link?: string | null; dedupeKey?: string | null }) {
  const r = await getPool().query(
    `INSERT INTO app_notifications (recipient, kind, title, link, dedupe_key) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (dedupe_key) DO NOTHING`,
    [n.recipient ?? null, n.kind.slice(0, 40), n.title.slice(0, 300), n.link?.slice(0, 300) ?? null, n.dedupeKey?.slice(0, 160) ?? null]);
  return (r.rowCount ?? 0) > 0;
}

const meOf = (ctx: any): string | null => (ctx?.actor?.id ? ctx?.actor?.name ?? null : null);
/** Со најава: мои + општи (без примач). Без најава (отворен режим): сите. */
function recipientWhere(ctx: any, p: any[]) {
  const me = meOf(ctx);
  if (!me) return "TRUE";
  p.push(me);
  return `(recipient = $${p.length} OR recipient IS NULL)`;
}

export const notificationsRouter = createRouter({
  notificationList: publicQuery.input(z.object({ limit: z.number().int().min(1).max(200).default(30) }).optional()).query(async ({ input, ctx }) => {
    const p: any[] = [];
    const w = recipientWhere(ctx, p);
    const rows = await q(`SELECT * FROM app_notifications WHERE ${w} ORDER BY created_at DESC LIMIT ${input?.limit ?? 30}`, p);
    const unread = (await q(`SELECT COUNT(*)::int n FROM app_notifications WHERE read_at IS NULL AND ${w}`, p))[0]?.n ?? 0;
    return { unread, items: rows.map((r) => ({ id: Number(r.id), kind: r.kind as string, title: r.title as string, link: r.link as string | null, recipient: r.recipient as string | null, read: !!r.read_at, createdAt: r.created_at as Date })) };
  }),
  notificationRead: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await q(`UPDATE app_notifications SET read_at = now() WHERE id = $1 AND read_at IS NULL`, [input.id]);
    return { success: true };
  }),
  notificationReadAll: publicQuery.mutation(async ({ ctx }) => {
    const p: any[] = [];
    const w = recipientWhere(ctx, p);
    await q(`UPDATE app_notifications SET read_at = now() WHERE read_at IS NULL AND ${w}`, p);
    return { success: true };
  }),
});
