// Најава: кодовите се чуваат само како хеш, а прелистувачот добива сесија со рок наместо самиот код.
//  • хеш: scrypt(код, тајна на инсталацијата) — детерминистички, за да може да се најде корисникот по код
//    (кодот мора да е единствен), а без тајната не може да се погоди ни од копија на базата сама по себе
//  • сесија: случаен токен „st_…“; во базата е само неговиот SHA-256; важи 30 дена од последната употреба
//  • премногу погрешни обиди од иста адреса → пауза
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { getPool } from "./queries/connection";

const q = async (text: string, params: any[] = []) => (await getPool().query(text, params)).rows as any[];

export const HASH_PREFIX = "s2$";
export const SESSION_PREFIX = "st_";
export const SESSION_DAYS = 30;

let pepper: Buffer | null = null;
let ready: Promise<void> | null = null;

/** Табели, тајна на инсталацијата и еднократно хеширање на старите (чисти) кодови. */
export function ensureAuthReady(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await q(`CREATE TABLE IF NOT EXISTS "app_kv" ("key" varchar(80) PRIMARY KEY NOT NULL, "value" text, "updated_at" timestamp DEFAULT now() NOT NULL)`);
      await q(`ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "passcode_hint" varchar(8)`);
      await q(`CREATE TABLE IF NOT EXISTS "app_sessions" (
        "id" serial PRIMARY KEY NOT NULL,
        "token_hash" char(64) NOT NULL UNIQUE,
        "user_id" integer,
        "name" varchar(255) NOT NULL,
        "role" varchar(20) NOT NULL,
        "ip" varchar(64),
        "user_agent" varchar(300),
        "created_at" timestamp DEFAULT now() NOT NULL,
        "last_seen_at" timestamp DEFAULT now() NOT NULL,
        "expires_at" timestamp NOT NULL
      )`);
      await q(`CREATE INDEX IF NOT EXISTS "app_sessions_user_idx" ON "app_sessions" ("user_id")`);
      // тајната се создава еднаш; ON CONFLICT — ако две инстанци почнат истовремено, двете ја земаат истата
      await q(`INSERT INTO app_kv (key, value) VALUES ('auth_pepper', $1) ON CONFLICT (key) DO NOTHING`, [randomBytes(32).toString("base64")]);
      pepper = Buffer.from((await q(`SELECT value FROM app_kv WHERE key = 'auth_pepper'`))[0].value, "base64");
      const plain = await q(`SELECT id, passcode FROM app_users WHERE passcode NOT LIKE 's2$%'`);
      for (const u of plain) {
        await q(`UPDATE app_users SET passcode = $1, passcode_hint = COALESCE(passcode_hint, $2) WHERE id = $3`,
          [hashCode(u.passcode), hintOf(u.passcode), u.id]);
      }
      if (plain.length) console.log(`[AUTH] ${plain.length} кодови се префрлени во хеш`);
      await q(`DELETE FROM app_sessions WHERE expires_at < now()`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

/** По враќање од бекап тајната може да е друга — се чита повторно. */
export function resetAuth() { ready = null; pepper = null; }

export function hashCode(code: string): string {
  if (!pepper) throw new Error("auth not ready");
  return HASH_PREFIX + scryptSync(code, pepper, 32, { N: 16384, r: 8, p: 1 }).toString("base64url");
}
export const hintOf = (code: string) => `••••${code.slice(-2)}`;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export type Actor = { id: number | null; name: string; role: any };

/** Код (или главната лозинка од околината) → корисник. */
export async function actorFromCode(code: string): Promise<Actor | undefined> {
  if (!code) return undefined;
  if (process.env.APP_PASSWORD && safeEq(code, process.env.APP_PASSWORD)) return { id: null, name: "Администратор", role: "admin" };
  if (code.startsWith(SESSION_PREFIX)) return undefined;
  await ensureAuthReady();
  const u = (await q(`SELECT id, name, role, is_active FROM app_users WHERE passcode = $1`, [hashCode(code)]))[0];
  if (!u || u.is_active !== "active") return undefined;
  return { id: u.id, name: u.name, role: u.role ?? "viewer" };
}

/** Токен на сесија → корисник (улогата и името секогаш од корисникот, за промените да важат веднаш). */
export async function actorFromSession(token: string): Promise<Actor | undefined> {
  if (!token.startsWith(SESSION_PREFIX)) return undefined;
  await ensureAuthReady();
  const r = (await q(`SELECT s.id, s.user_id, s.name, s.role, s.last_seen_at, u.name AS u_name, u.role AS u_role, u.is_active
      FROM app_sessions s LEFT JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha(token)]))[0];
  if (!r) return undefined;
  if (r.user_id != null && (!r.u_name || r.is_active !== "active")) return undefined;
  // главната лозинка: сесијата важи само додека лозинката е поставена
  if (r.user_id == null && !process.env.APP_PASSWORD) return undefined;
  // продолжи го рокот најмногу еднаш на час
  if (Date.now() - new Date(r.last_seen_at).getTime() > 3600_000) {
    q(`UPDATE app_sessions SET last_seen_at = now(), expires_at = now() + interval '${SESSION_DAYS} days' WHERE id = $1`, [r.id]).catch(() => {});
    if (r.user_id != null) q(`UPDATE app_users SET last_seen_at = now() WHERE id = $1`, [r.user_id]).catch(() => {});
  }
  return r.user_id == null ? { id: null, name: r.name, role: r.role } : { id: r.user_id, name: r.u_name, role: r.u_role ?? "viewer" };
}

export async function createSession(actor: Actor, meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<string> {
  await ensureAuthReady();
  const token = SESSION_PREFIX + randomBytes(32).toString("base64url");
  await q(`INSERT INTO app_sessions (token_hash, user_id, name, role, ip, user_agent, expires_at)
    VALUES ($1,$2,$3,$4,$5,$6, now() + interval '${SESSION_DAYS} days')`,
    [sha(token), actor.id, actor.name, actor.role, meta.ip?.slice(0, 64) ?? null, meta.userAgent?.slice(0, 300) ?? null]);
  if (actor.id != null) await q(`UPDATE app_users SET last_seen_at = now() WHERE id = $1`, [actor.id]);
  return token;
}

export async function deleteSession(token: string) {
  if (!token.startsWith(SESSION_PREFIX)) return;
  await ensureAuthReady();
  await q(`DELETE FROM app_sessions WHERE token_hash = $1`, [sha(token)]);
}

/** Одјава од сите уреди; `keepToken` — сесијата од која се прави промената останува (самиот себе си го менува кодот). */
export async function revokeUserSessions(userId: number, keepToken?: string | null) {
  await ensureAuthReady();
  const keep = keepToken?.startsWith(SESSION_PREFIX) ? sha(keepToken) : "";
  return (await getPool().query(`DELETE FROM app_sessions WHERE user_id = $1 AND token_hash <> $2`, [userId, keep])).rowCount ?? 0;
}

export async function sessionCounts(): Promise<Map<number, { count: number; lastSeen: string | null }>> {
  await ensureAuthReady();
  const rows = await q(`SELECT user_id, COUNT(*)::int AS n, MAX(last_seen_at) AS last FROM app_sessions WHERE expires_at > now() AND user_id IS NOT NULL GROUP BY user_id`);
  return new Map(rows.map((r) => [Number(r.user_id), { count: r.n, lastSeen: r.last ? new Date(r.last).toISOString() : null }]));
}

// ── Ограничување на погрешни обиди (по IP адреса, во меморија) ──
const fails = new Map<string, { n: number; until: number }>();
/** Колку секунди уште треба да се чека (0 = може). */
export function loginWait(ip: string): number {
  const f = fails.get(ip);
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}
export function loginFailed(ip: string) {
  const f = fails.get(ip) ?? { n: 0, until: 0 };
  f.n++;
  // по 5 погрешни: 30 с, па се дуплира (до 15 мин)
  if (f.n >= 5) f.until = Date.now() + Math.min(30_000 * 2 ** (f.n - 5), 15 * 60_000);
  fails.set(ip, f);
  if (fails.size > 5000) fails.clear();
}
export function loginOk(ip: string) { fails.delete(ip); }
export function _resetLoginLimits() { fails.clear(); }
