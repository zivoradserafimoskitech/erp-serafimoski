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

export async function resolveActor(key: string | null): Promise<TrpcContext["actor"]> {
  if (!key) {
    // Нема лозинка воопшто поставена → системот е отворен, работи како администратор
    return process.env.APP_PASSWORD ? undefined : { id: null, name: "Отворен пристап", role: "admin" };
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
