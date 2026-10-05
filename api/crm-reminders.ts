// CRM автоматски потсетници: follow-up на пратени понуди, зделки со поминат рок, задачи што доцнат.
// Создава задачи (crm_activities.auto_key → идемпотентно) и известувања во апликацијата (crm_notifications.dedupe_key),
// а ако е поставен SMTP и е-пошта на продавачот — дневен дигест.
import { z } from "zod";
import { publicQuery } from "./middleware";
import { getPool } from "./queries/connection";
import { iso } from "./rates-helper";
import { planReminders, followupDays, digestText, type ReminderInput } from "@contracts/crm-automation";

const q = async (text: string, params: any[] = []) => (await getPool().query(text, params)).rows as any[];
const num = (v: any) => (v === null || v === undefined ? null : Number(v));

export const crmReminderSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  quoteFollowupDays: z.number().int().min(1).max(60).optional(),
  digest: z.boolean().default(false),
  /** продавач (име како во „Продавач“) → е-пошта за дневниот дигест */
  emails: z.record(z.string(), z.string().email()).default({}),
});
export type CrmReminderSettings = z.infer<typeof crmReminderSettingsSchema>;

async function kvGet(key: string): Promise<string | null> {
  return (await q(`SELECT value FROM app_kv WHERE key = $1`, [key]))[0]?.value ?? null;
}
async function kvSet(key: string, value: string) {
  await q(`INSERT INTO app_kv (key, value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, value]);
}
export async function getCrmReminderSettings() {
  const raw = await kvGet("crm_reminders");
  let s: CrmReminderSettings;
  try { s = crmReminderSettingsSchema.parse(raw ? JSON.parse(raw) : {}); } catch { s = crmReminderSettingsSchema.parse({}); }
  return { ...s, effectiveDays: followupDays(s.quoteFollowupDays, process.env.CRM_QUOTE_FOLLOWUP_DAYS) };
}

const skopjeToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Skopje", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** Податоци за planReminders од базата. Старите записи (пред 60/90 дена) се игнорираат за да нема поплава при прво пуштање. */
export async function loadReminderInput(today: string, days: number): Promise<ReminderInput> {
  const quotes = await q(`SELECT qt.id, qt.quote_number, qt.customer_id, COALESCE(c.company, c.name) AS customer, COALESCE(qt.sent_at, qt.created_at) AS sent_at,
      qt.status, qt.opportunity_id, COALESCE(NULLIF(qt.salesperson, ''), o.owner, c.owner) AS owner
    FROM quotations qt LEFT JOIN customers c ON c.id = qt.customer_id LEFT JOIN crm_opportunities o ON o.id = qt.opportunity_id
    WHERE qt.status = 'sent' AND COALESCE(qt.sent_at, qt.created_at) >= $1::date - 60`, [today]);
  const deals = await q(`SELECT o.id, o.title, o.customer_id, o.expected_close, o.stage, COALESCE(o.owner, c.owner) AS owner
    FROM crm_opportunities o LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.stage IN ('new','contacted','quoting','quoted') AND o.expected_close < $1::date AND o.expected_close >= $1::date - 90`, [today]);
  const tasks = await q(`SELECT id, subject, due_date, COALESCE(assignee, created_by) AS assignee, customer_id, opportunity_id
    FROM crm_activities WHERE kind = 'task' AND done_at IS NULL AND due_date < $1::date`, [today]);
  return {
    today, quoteFollowupDays: days,
    quotes: quotes.map((r) => ({ id: Number(r.id), number: r.quote_number, customerId: num(r.customer_id), customer: r.customer, sentAt: iso(r.sent_at) ?? today,
      status: r.status, opportunityId: num(r.opportunity_id), owner: r.owner ?? null })),
    deals: deals.map((r) => ({ id: Number(r.id), title: r.title, customerId: num(r.customer_id), expectedClose: iso(r.expected_close), stage: r.stage, owner: r.owner ?? null })),
    tasks: tasks.map((r) => ({ id: Number(r.id), subject: r.subject, dueDate: iso(r.due_date), assignee: r.assignee ?? null, customerId: num(r.customer_id), opportunityId: num(r.opportunity_id) })),
  };
}

/** Едно извршување. Безбедно за повторување: постоечките клучеви се прескокнуваат. */
export async function runCrmReminders(opts: { today?: string; sendDigest?: boolean } = {}) {
  const s = await getCrmReminderSettings();
  const today = opts.today ?? skopjeToday();
  const plan = planReminders(await loadReminderInput(today, s.effectiveDays));
  let tasksCreated = 0, notificationsCreated = 0;
  for (const t of plan.tasks) {
    const r = await getPool().query(`INSERT INTO crm_activities (customer_id, opportunity_id, quotation_id, kind, subject, due_date, assignee, auto_key, created_by)
      VALUES ($1,$2,$3,'task',$4,$5,$6,$7,'Систем') ON CONFLICT (auto_key) DO NOTHING`,
      [t.customerId, t.opportunityId, t.quotationId, t.subject, t.dueDate, t.assignee, t.autoKey]);
    tasksCreated += r.rowCount ?? 0;
  }
  const fresh: typeof plan.notifications = [];
  for (const n of plan.notifications) {
    const r = await getPool().query(`INSERT INTO crm_notifications (recipient, kind, title, link, dedupe_key) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (dedupe_key) DO NOTHING`,
      [n.recipient, n.kind, n.title, n.link, n.dedupeKey]);
    if (r.rowCount) { notificationsCreated++; fresh.push(n); }
  }
  let digests = 0;
  if ((opts.sendDigest ?? true) && s.digest && fresh.length) digests = await sendDigests(s, fresh).catch((e) => { console.error("[CRM-REMINDERS] digest:", e?.message ?? e); return 0; });
  return { today, tasksCreated, notificationsCreated, digests, planned: { tasks: plan.tasks.length, notifications: plan.notifications.length } };
}

async function sendDigests(s: CrmReminderSettings, items: { recipient: string | null; title: string; link: string }[]) {
  const { mailTransport, smtpConfig } = await import("./mail-router");
  if (!(await smtpConfig())) return 0;
  const byWho = new Map<string, typeof items>();
  for (const i of items) if (i.recipient && s.emails[i.recipient]) byWho.set(i.recipient, [...(byWho.get(i.recipient) ?? []), i]);
  if (!byWho.size) return 0;
  const { t, from } = await mailTransport();
  let n = 0;
  for (const [who, list] of byWho) {
    await t.sendMail({ from, to: s.emails[who], subject: `CRM потсетници (${list.length})`, text: digestText(who, list, process.env.APP_URL) });
    n++;
  }
  return n;
}

export function startCrmReminderScheduler() {
  if (process.env.CRM_REMINDERS_DISABLED === "true") { console.log("[CRM-REMINDERS] исклучено (CRM_REMINDERS_DISABLED=true)"); return; }
  const tick = async () => {
    try {
      const s = await getCrmReminderSettings();
      if (!s.enabled) return;
      const r = await runCrmReminders();
      if (r.tasksCreated || r.notificationsCreated) console.log(`[CRM-REMINDERS] задачи +${r.tasksCreated}, известувања +${r.notificationsCreated}, дигест ${r.digests}`);
    } catch (e: any) { console.error("[CRM-REMINDERS]", e?.message ?? e); }
  };
  setTimeout(tick, 90_000);
  setInterval(tick, 30 * 60_000);
}

// ───────────── процедури (се спојуваат во crmRouter) ─────────────

const meOf = (ctx: any): string | null => (ctx?.actor?.id ? ctx?.actor?.name ?? null : null);
/** Со најава: мои + општи (без примач). Без најава (отворен режим): сите. */
const recipientWhere = (ctx: any, p: any[]) => {
  const me = meOf(ctx);
  if (!me) return "TRUE";
  p.push(me);
  return `(recipient = $${p.length} OR recipient IS NULL)`;
};

export const crmReminderProcedures = {
  notificationList: publicQuery.input(z.object({ limit: z.number().int().min(1).max(200).default(30) }).optional()).query(async ({ input, ctx }) => {
    const p: any[] = [];
    const w = recipientWhere(ctx, p);
    const rows = await q(`SELECT * FROM crm_notifications WHERE ${w} ORDER BY created_at DESC LIMIT ${input?.limit ?? 30}`, p);
    const unread = (await q(`SELECT COUNT(*)::int n FROM crm_notifications WHERE read_at IS NULL AND ${w}`, p))[0]?.n ?? 0;
    return { unread, items: rows.map((r) => ({ id: Number(r.id), kind: r.kind, title: r.title, link: r.link, recipient: r.recipient, read: !!r.read_at, createdAt: r.created_at })) };
  }),
  notificationRead: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    await q(`UPDATE crm_notifications SET read_at = now() WHERE id = $1 AND read_at IS NULL`, [input.id]);
    return { success: true };
  }),
  notificationReadAll: publicQuery.mutation(async ({ ctx }) => {
    const p: any[] = [];
    const w = recipientWhere(ctx, p);
    await q(`UPDATE crm_notifications SET read_at = now() WHERE read_at IS NULL AND ${w}`, p);
    return { success: true };
  }),
  crmRemindersGet: publicQuery.query(async () => {
    const { smtpConfig } = await import("./mail-router");
    const s = await getCrmReminderSettings();
    return { ...s, envDays: process.env.CRM_QUOTE_FOLLOWUP_DAYS ?? null, smtp: !!(await smtpConfig()), disabledByEnv: process.env.CRM_REMINDERS_DISABLED === "true" };
  }),
  crmRemindersSet: publicQuery.input(crmReminderSettingsSchema).mutation(async ({ input }) => {
    await kvSet("crm_reminders", JSON.stringify(input));
    return { success: true };
  }),
  crmRemindersRunNow: publicQuery.mutation(async () => runCrmReminders()),
};
