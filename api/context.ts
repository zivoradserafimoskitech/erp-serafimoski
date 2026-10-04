import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User } from "@db/schema";
import { authenticateRequest } from "./kimi/auth";
import type { Role } from "@contracts/roles";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: User;
  /** Кој е и што смее — се разрешува од x-app-key */
  actor?: { id: number | null; name: string; role: Role };
};

/** Кеш за да не се оди во база на секое барање */
const actorCache = new Map<string, { actor: { id: number | null; name: string; role: Role }; at: number }>();
const CACHE_MS = 60_000;

/**
 * Дали апликацијата бара најава. Затворена е ако е поставена APP_PASSWORD на серверот
 * ИЛИ ако постои барем еден активен корисник администратор со код (Подесувања → Корисници).
 * Без ниту едно од двете е отворена за секого (и интерфејсот предупредува).
 */
let gateCache: { on: boolean; at: number } | null = null;
export async function gateActive(): Promise<boolean> {
  if (process.env.APP_PASSWORD) return true;
  if (process.env.DISABLE_USER_GATE === "true") return false;
  if (gateCache && Date.now() - gateCache.at < 30_000) return gateCache.on;
  let on = false;
  try {
    const { getPool } = await import("./queries/connection");
    const r = await getPool().query(`SELECT 1 FROM app_users WHERE role = 'admin' AND is_active = 'active' AND COALESCE(passcode, '') <> '' LIMIT 1`);
    on = (r.rowCount ?? 0) > 0;
  } catch { on = false; }
  gateCache = { on, at: Date.now() };
  return on;
}

export async function resolveActor(key: string | null): Promise<TrpcContext["actor"]> {
  if (!key) {
    // Без најава: отворено само ако апликацијата не бара најава
    return (await gateActive()) ? undefined : { id: null, name: "Отворен пристап", role: "admin" };
  }

  // Главната лозинка од околината секогаш е администратор
  if (process.env.APP_PASSWORD && key === process.env.APP_PASSWORD) {
    return { id: null, name: "Администратор", role: "admin" };
  }

  const hit = actorCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.actor;

  try {
    const { getDb } = await import("./queries/connection");
    const { appUsers } = await import("@db/schema");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    const rows = await db.select().from(appUsers).where(eq(appUsers.passcode, key));
    const u: any = rows[0];
    if (!u || u.isActive !== "active") return undefined;
    const actor = { id: u.id as number, name: u.name as string, role: (u.role ?? "viewer") as Role };
    actorCache.set(key, { actor, at: Date.now() });
    // Тивко бележење на последна активност
    db.update(appUsers).set({ lastSeenAt: new Date() } as any).where(eq(appUsers.id, u.id)).catch(() => {});
    return actor;
  } catch {
    // Табелата уште не постои — не заклучувај го системот
    return undefined;
  }
}

export function clearActorCache() {
  actorCache.clear();
  gateCache = null;
}

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };
  try {
    ctx.user = await authenticateRequest(opts.req.headers);
  } catch {
    // Authentication is optional here
  }
  ctx.actor = await resolveActor(opts.req.headers.get("x-app-key"));
  return ctx;
}
