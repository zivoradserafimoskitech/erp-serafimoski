// Заклучување на период: откако ДДВ пријавата за периодот е поднесена, документите и налозите
// до тој датум не се менуваат. Исправка се прави во тековниот период (сторно / книжно одобрување).
import { TRPCError } from "@trpc/server";
import { getPool } from "./queries/connection";

const iso10 = (d: any): string | null => {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  const x = new Date(d);
  return isNaN(x.getTime()) ? null : `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
export const fmtMk = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** До кој датум (вклучително) е заклучено; null = ништо не е заклучено. */
export async function lockedUntil(): Promise<string | null> {
  const r = await getPool().query(`SELECT locked_until FROM period_lock WHERE id = 1`).catch(() => ({ rows: [] as any[] }));
  return iso10(r.rows[0]?.locked_until);
}

export function isLocked(date: any, lock: string | null): boolean {
  const d = iso10(date);
  return !!(lock && d && d <= lock);
}

/** Фрла јасна грешка ако датумот е во заклучен период. */
export async function assertOpen(date: any, what: string) {
  const lock = await lockedUntil();
  const d = iso10(date);
  if (lock && d && d <= lock) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Периодот до ${fmtMk(lock)} е заклучен. ${what} (${fmtMk(d)}) не може да се менува — направи исправка во тековниот период (сторно или книжно одобрување).`,
    });
  }
}

/** Дневник на измени во главната книга: кој, кога, што. */
export async function glAudit(client: { query: (t: string, p?: any[]) => Promise<any> } | null, a: {
  actor: string; action: "create" | "update" | "delete" | "storno" | "lock" | "unlock" | "blocked";
  entryNumber?: string | null; entryDate?: string | null; sourceType?: string | null; description?: string | null; detail?: any;
}) {
  const c = client ?? getPool();
  await c.query(`INSERT INTO gl_audit (actor, action, entry_number, entry_date, source_type, description, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [a.actor, a.action, a.entryNumber ?? null, a.entryDate ?? null, a.sourceType ?? null, a.description ?? null, a.detail ? JSON.stringify(a.detail) : null]).catch(() => {});
}

export async function setLockedUntil(date: string | null) {
  await getPool().query(`INSERT INTO period_lock (id, locked_until, updated_at) VALUES (1, $1, now())
    ON CONFLICT (id) DO UPDATE SET locked_until = EXCLUDED.locked_until, updated_at = now()`, [date]);
}
