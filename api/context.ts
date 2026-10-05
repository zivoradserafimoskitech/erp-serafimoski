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
const CACHE_MS = 30_000;

/**
 * Дали апликацијата бара најава.
 * Fail-safe: ЗАТВОРЕНА по подразбирање.
 * Отворена е САМО ако е експлицитно поставено DISABLE_USER_GATE=true (тестови / локален развој).
 */
export async function gateActive(): Promise<boolean> {
  if (process.env.DISABLE_USER_GATE === "true") return false;
  // Сè друго: затворено (APP_PASSWORD, админ со код, или setup-режим)
  return true;
}

/**
 * Нема ни APP_PASSWORD ниту активен администратор со код —
 * треба првичен setup (создај админ или постави APP_PASSWORD).
 */
let setupCache: { on: boolean; at: number } | null = null;
export async function needsSetup(): Promise<boolean> {
  if (process.env.APP_PASSWORD) return false;
  if (process.env.DISABLE_USER_GATE === "true") return false;
  if (setupCache && Date.now() - setupCache.at < 15_000) return setupCache.on;
  let on = true;
  try {
    const { getPool } = await import("./queries/connection");
    const r = await getPool().query(
      `SELECT 1 FROM app_users WHERE role = 'admin' AND is_active = 'active' AND COALESCE(passcode, '') <> '' LIMIT 1`,
    );
    on = (r.rowCount ?? 0) === 0;
  } catch {
    on = true; // база недостапна / табела уште не постои → третирај како setup
  }
  setupCache = { on, at: Date.now() };
  return on;
}

export async function resolveActor(key: string | null): Promise<TrpcContext["actor"]> {
  if (!key) {
    // Без најава: отворено само ако DISABLE_USER_GATE=true
    return (await gateActive()) ? undefined : { id: null, name: "Отворен пристап", role: "admin" };
  }

  const hit = actorCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.actor;

  try {
    const { actorFromSession, actorFromCode, SESSION_PREFIX } = await import("./auth");
    const actor = key.startsWith(SESSION_PREFIX) ? await actorFromSession(key) : await actorFromCode(key);
    if (!actor) return undefined;
    const a = { id: actor.id, name: actor.name, role: (actor.role ?? "viewer") as Role };
    actorCache.set(key, { actor: a, at: Date.now() });
    return a;
  } catch {
    return undefined;
  }
}

export function clearActorCache() {
  actorCache.clear();
  setupCache = null;
}

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };
  try {
    ctx.user = await authenticateRequest(opts.req.headers);
  } catch {
    // Kimi OAuth е опционален / наследен
  }
  ctx.actor = await resolveActor(opts.req.headers.get("x-app-key"));
  return ctx;
}
