// Бекап на целата база: JSON редови во gzip.
//  • прв ред: заглавие (формат, време, табели и број на редови)
//  • потоа по еден ред за секој запис: {"t": табела, "r": запис}
// Се чита во една трансакција (REPEATABLE READ), па сликата е доследна и додека некој работи.
// Враќањето се проверува прво во привремена шема што потоа се брише; вистинското враќање е во една трансакција.
import { z } from "zod";
import { gunzipSync, createGzip } from "zlib";
import { once } from "events";
import { PassThrough, type Readable } from "stream";
import { createRouter, publicQuery } from "./middleware";
import { getPool } from "./queries/connection";

const q = async (text: string, params: any[] = []) => (await getPool().query(text, params)).rows as any[];
export const BACKUP_FORMAT = "serafimoski-erp-backup";
/** Не се чуваат: сесиите (по враќање сите се најавуваат повторно). */
const SKIP_TABLES = new Set(["app_sessions"]);
const qi = (name: string) => `"${name.replace(/"/g, '""')}"`;

type Header = { format: string; version: number; createdAt: string; tables: { name: string; rows: number }[] };
export type BackupSummary = { tables: number; rows: number; bytes: number };

export function backupFileName(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `erp-bekap-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json.gz`;
}

async function publicTables(client: { query: (t: string, p?: any[]) => Promise<any> }): Promise<string[]> {
  const r = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`);
  return r.rows.map((x: any) => x.table_name as string).filter((t: string) => !SKIP_TABLES.has(t));
}

/** Бекап како поток (gzip). `done` се исполнува со збирот кога ќе заврши. */
export function backupStream(): { stream: Readable; done: Promise<BackupSummary> } {
  const gz = createGzip({ level: 6 });
  const out = new PassThrough();
  let bytes = 0;
  gz.on("data", (c: Buffer) => { bytes += c.length; });
  gz.pipe(out);
  const done = (async () => {
    const client = await getPool().connect();
    let rows = 0, tables = 0;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const names = await publicTables(client);
      const counts: { name: string; rows: number }[] = [];
      for (const t of names) counts.push({ name: t, rows: Number((await client.query(`SELECT COUNT(*)::bigint AS n FROM ${qi(t)}`)).rows[0].n) });
      const header: Header = { format: BACKUP_FORMAT, version: 1, createdAt: new Date().toISOString(), tables: counts };
      const write = async (s: string) => { if (!gz.write(s)) await once(gz, "drain"); };
      await write(JSON.stringify(header) + "\n");
      for (const t of names) {
        tables++;
        await client.query(`DECLARE bk NO SCROLL CURSOR FOR SELECT row_to_json(x)::text AS j FROM ${qi(t)} x`);
        const prefix = `{"t":${JSON.stringify(t)},"r":`;
        for (;;) {
          const r = await client.query("FETCH 500 FROM bk");
          if (!r.rows.length) break;
          rows += r.rows.length;
          await write(r.rows.map((x: any) => prefix + x.j + "}\n").join(""));
        }
        await client.query("CLOSE bk");
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      gz.destroy(e as Error);
      throw e;
    } finally {
      client.release();
    }
    gz.end();
    await once(out, "end").catch(() => {});
    return { tables, rows, bytes };
  })();
  done.catch(() => {});
  return { stream: out, done };
}

export async function backupToBuffer(): Promise<{ gz: Buffer; summary: BackupSummary }> {
  const { stream, done } = backupStream();
  const chunks: Buffer[] = [];
  stream.on("data", (c: Buffer) => chunks.push(c));
  const summary = await done;
  return { gz: Buffer.concat(chunks), summary };
}

/** Чита датотека од бекап (gzip или чист JSON) → заглавие + записи по табела. */
export function parseBackup(buf: Buffer): { header: Header; data: Map<string, any[]> } {
  if (!buf.length) throw new Error("Празна датотека");
  let text: string;
  try { text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString("utf8"); }
  catch { throw new Error("Датотеката не е бекап од програмата (не може да се отпакува)"); }
  const nl = text.indexOf("\n");
  let header: Header;
  try { header = JSON.parse(nl < 0 ? text : text.slice(0, nl)); } catch { throw new Error("Датотеката не е бекап од програмата"); }
  if (header?.format !== BACKUP_FORMAT) throw new Error("Датотеката не е бекап од програмата");
  const data = new Map<string, any[]>();
  for (const t of header.tables) data.set(t.name, []);
  let pos = nl + 1;
  while (pos > 0 && pos < text.length) {
    const end = text.indexOf("\n", pos);
    const line = text.slice(pos, end < 0 ? text.length : end);
    pos = end < 0 ? text.length : end + 1;
    if (!line) continue;
    const o = JSON.parse(line);
    (data.get(o.t) ?? data.set(o.t, []).get(o.t)!).push(o.r);
  }
  return { header, data };
}

/** Колони во кои може да се запише (без генерираните). */
async function writableColumns(client: any, schema: string, table: string): Promise<string[]> {
  const r = await client.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2 AND is_generated = 'NEVER' ORDER BY ordinal_position`, [schema, table]);
  return r.rows.map((x: any) => x.column_name);
}

async function insertRows(client: any, schema: string, table: string, rows: any[]) {
  if (!rows.length) return;
  const cols = (await writableColumns(client, schema, table)).map(qi).join(", ");
  const target = `${qi(schema)}.${qi(table)}`;
  for (let i = 0; i < rows.length; i += 500) {
    await client.query(`INSERT INTO ${target} (${cols}) OVERRIDING SYSTEM VALUE SELECT ${cols} FROM json_populate_recordset(NULL::${target}, $1::json)`,
      [JSON.stringify(rows.slice(i, i + 500))]);
  }
}

/** Редослед на внес по надворешните клучеви (прво родителите). */
async function insertOrder(client: any, tables: string[]): Promise<string[]> {
  const r = await client.query(`SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE c.contype = 'f' AND n.nspname = 'public'`);
  const strip = (s: string) => s.replace(/^public\./, "").replace(/^"|"$/g, "");
  const deps = new Map<string, Set<string>>(tables.map((t) => [t, new Set<string>()]));
  for (const x of r.rows) {
    const c = strip(x.child), p = strip(x.parent);
    if (c !== p && deps.has(c) && deps.has(p)) deps.get(c)!.add(p);
  }
  const out: string[] = [], seen = new Set<string>();
  const visit = (t: string, stack: Set<string>) => {
    if (seen.has(t) || stack.has(t)) return;
    stack.add(t);
    for (const p of deps.get(t) ?? []) visit(p, stack);
    stack.delete(t); seen.add(t); out.push(t);
  };
  for (const t of tables) visit(t, new Set());
  return out;
}

export type CheckResult = {
  ok: boolean; createdAt: string; tables: number; rows: number;
  problems: string[]; perTable: { name: string; expected: number; loaded: number }[];
};

/** Враќа ја копијата во привремена шема (која потоа се брише) и споредува број на записи. Базата не се менува. */
export async function checkRestore(buf: Buffer): Promise<CheckResult> {
  const { header, data } = parseBackup(buf);
  const client = await getPool().connect();
  const schema = `bk_check_${Date.now()}`;
  const problems: string[] = [];
  const perTable: CheckResult["perTable"] = [];
  let rows = 0;
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA ${qi(schema)}`);
    const existing = new Set(await publicTables(client));
    for (const t of header.tables) {
      const got = data.get(t.name) ?? [];
      if (got.length !== t.rows) problems.push(`${t.name}: во заглавието ${t.rows}, во датотеката ${got.length} записи (оштетена датотека?)`);
      if (!existing.has(t.name)) { problems.push(`${t.name}: табелата не постои во оваа верзија на програмата`); continue; }
      await client.query("SAVEPOINT sp");
      try {
        await client.query(`CREATE TABLE ${qi(schema)}.${qi(t.name)} (LIKE public.${qi(t.name)})`);
        await insertRows(client, schema, t.name, got);
        const n = Number((await client.query(`SELECT COUNT(*)::bigint AS n FROM ${qi(schema)}.${qi(t.name)}`)).rows[0].n);
        perTable.push({ name: t.name, expected: t.rows, loaded: n });
        rows += n;
        if (n !== t.rows) problems.push(`${t.name}: вратени ${n} од ${t.rows}`);
        await client.query("RELEASE SAVEPOINT sp");
      } catch (e: any) {
        await client.query("ROLLBACK TO SAVEPOINT sp");
        problems.push(`${t.name}: ${String(e?.message ?? e).slice(0, 200)}`);
        perTable.push({ name: t.name, expected: t.rows, loaded: 0 });
      }
    }
  } finally {
    await client.query("ROLLBACK").catch(() => {}); // привремената шема исчезнува
    client.release();
  }
  const result = { ok: problems.length === 0, createdAt: header.createdAt, tables: perTable.length, rows, problems, perTable };
  await markBackup("check", { tables: result.tables, rows, bytes: buf.length }, result.ok ? undefined : problems.slice(0, 5).join("; ")).catch(() => {});
  return result;
}

/**
 * Вистинско враќање: сите табели од копијата се празнат и се полнат од неа, во една трансакција
 * (ако нешто не успее — ништо не се менува). Броевите (id) продолжуваат од најголемиот вратен.
 */
export async function restoreBackup(buf: Buffer): Promise<{ ok: true; tables: number; rows: number; skipped: string[] }> {
  const { header, data } = parseBackup(buf);
  const client = await getPool().connect();
  const skipped: string[] = [];
  let rows = 0;
  try {
    await client.query("BEGIN");
    const existing = new Set(await publicTables(client));
    const names = header.tables.map((t) => t.name).filter((t) => { if (existing.has(t)) return true; skipped.push(t); return false; });
    if (!names.length) throw new Error("Во копијата нема ниту една позната табела");
    await client.query(`TRUNCATE ${names.map((t) => `public.${qi(t)}`).join(", ")} CASCADE`);
    for (const t of await insertOrder(client, names)) {
      const got = data.get(t) ?? [];
      try { await insertRows(client, "public", t, got); }
      catch (e: any) { throw new Error(`${t}: ${e?.message ?? e}`); }
      rows += got.length;
      // секвенци: следниот id по најголемиот вратен
      const seq = await client.query(`SELECT column_name, pg_get_serial_sequence($1, column_name) AS seq FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $2 AND pg_get_serial_sequence($1, column_name) IS NOT NULL`, [`public.${qi(t)}`, t]);
      for (const s of seq.rows) {
        await client.query(`SELECT setval($1, COALESCE((SELECT MAX(${qi(s.column_name)}) FROM public.${qi(t)}), 0) + 1, false)`, [s.seq]);
      }
    }
    await client.query(`DELETE FROM app_sessions`).catch(() => {});
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  // тајната за кодовите може да е друга во копијата
  const { resetAuth } = await import("./auth");
  resetAuth();
  await markBackup("restore", { tables: header.tables.length - skipped.length, rows, bytes: buf.length }).catch(() => {});
  return { ok: true, tables: header.tables.length - skipped.length, rows, skipped };
}

// ───────────── историја и автоматски бекап ─────────────

async function kvGet(key: string): Promise<string | null> {
  return (await q(`SELECT value FROM app_kv WHERE key = $1`, [key]))[0]?.value ?? null;
}
async function kvSet(key: string, value: string) {
  await q(`INSERT INTO app_kv (key, value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, value]);
}

type HistoryRow = { at: string; kind: "download" | "email" | "check" | "restore" | "email-too-big" | "error"; tables: number; rows: number; bytes: number; note?: string };
export async function markBackup(kind: HistoryRow["kind"], s: BackupSummary, note?: string) {
  const raw = await kvGet("backup:history");
  let list: HistoryRow[] = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
  list.unshift({ at: new Date().toISOString(), kind, tables: s.tables, rows: s.rows, bytes: s.bytes, ...(note ? { note } : {}) });
  await kvSet("backup:history", JSON.stringify(list.slice(0, 30)));
}

export const backupSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  email: z.string().default(""),
  hour: z.number().int().min(0).max(23).default(22),
});
export type BackupSettings = z.infer<typeof backupSettingsSchema>;
export async function getBackupSettings(): Promise<BackupSettings> {
  const raw = await kvGet("backup:settings");
  try { return backupSettingsSchema.parse(raw ? JSON.parse(raw) : {}); } catch { return backupSettingsSchema.parse({}); }
}

/** Најголема копија што се праќа како прилог (повеќето сервери за пошта примаат до ~25 MB). */
export const MAX_MAIL_BYTES = 20 * 1024 * 1024;

export async function emailBackup(to: string) {
  const { mailTransport } = await import("./mail-router");
  const { t, from, company } = await mailTransport();
  const { gz, summary } = await backupToBuffer();
  const name = backupFileName();
  const when = new Date().toLocaleString("mk-MK", { timeZone: "Europe/Skopje" });
  if (gz.length > MAX_MAIL_BYTES) {
    await t.sendMail({ from, to, subject: `Бекап — ${company} — преголем за е-пошта`,
      text: `Бекапот од ${when} има ${(gz.length / 1048576).toFixed(1)} MB — преголем за прилог.\nПреземете го рачно: Подесувања → Бекап → Преземи бекап.` });
    await markBackup("email-too-big", summary, to);
    return { sent: false, tooBig: true, ...summary };
  }
  await t.sendMail({ from, to, subject: `Бекап — ${company} — ${when}`,
    text: `Во прилог е целосна копија на базата (${summary.tables} табели, ${summary.rows} записи).\nЧувајте ја на безбедно место — ги содржи сите податоци на фирмата.\nВраќање: Подесувања → Бекап → Провери / Врати од датотека.`,
    attachments: [{ filename: name, content: gz, contentType: "application/gzip" }] });
  await markBackup("email", summary, to);
  return { sent: true, tooBig: false, ...summary };
}

function skopjeNow() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Skopje", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, hour: Number(g("hour")) % 24 };
}

export async function runScheduledBackup() {
  const s = await getBackupSettings();
  if (!s.enabled || !s.email) return;
  const now = skopjeNow();
  if (now.hour < s.hour) return;
  if ((await kvGet("backup:last-auto")) === now.date) return;
  await kvSet("backup:last-auto", now.date);
  try { await emailBackup(s.email); }
  catch (e: any) { await markBackup("error", { tables: 0, rows: 0, bytes: 0 }, String(e?.message ?? e).slice(0, 200)).catch(() => {}); }
}

export function startBackupScheduler() {
  const tick = () => runScheduledBackup().catch((e) => console.error("[BACKUP]", e?.message ?? e));
  setTimeout(tick, 90_000);
  setInterval(tick, 30 * 60_000);
}

export const backupRouter = createRouter({
  backupStatus: publicQuery.query(async () => {
    const raw = await kvGet("backup:history");
    let history: HistoryRow[] = [];
    try { history = raw ? JSON.parse(raw) : []; } catch { history = []; }
    const size = Number((await q(`SELECT pg_database_size(current_database()) AS n`))[0]?.n ?? 0);
    const mail = (await q(`SELECT smtp_host, smtp_user, smtp_password FROM company_settings LIMIT 1`))[0];
    const lastSaved = history.find((h) => h.kind === "download" || h.kind === "email") ?? null;
    return {
      settings: await getBackupSettings(),
      history,
      lastSaved,
      daysSince: lastSaved ? Math.floor((Date.now() - new Date(lastSaved.at).getTime()) / 86400000) : null,
      dbBytes: size,
      mailConfigured: !!(mail?.smtp_host && mail?.smtp_user && mail?.smtp_password),
      maxMailBytes: MAX_MAIL_BYTES,
    };
  }),
  backupSettingsSave: publicQuery.input(backupSettingsSchema).mutation(async ({ input }) => {
    if (input.enabled && !/^\S+@\S+\.\S+$/.test(input.email)) throw new Error("Внеси е-пошта на која ќе се праќа бекапот");
    await kvSet("backup:settings", JSON.stringify(input));
    return { success: true };
  }),
  backupSendNow: publicQuery.mutation(async () => {
    const s = await getBackupSettings();
    if (!s.email) throw new Error("Прво внеси е-пошта за бекап");
    return emailBackup(s.email);
  }),
});
