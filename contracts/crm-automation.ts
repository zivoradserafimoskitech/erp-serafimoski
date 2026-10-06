// CRM автоматизација — чиста логика (без база): потсетници, лог на е-пошта, SMTP од env.
import { daysBetween } from "./crm";

// ───────────── автоматски потсетници ─────────────

export type ReminderInput = {
  today: string;
  quoteFollowupDays: number;
  /** пратени понуди без одговор */
  quotes: { id: number; number: string; customerId: number | null; customer: string | null; sentAt: string; status: string; opportunityId: number | null; owner: string | null }[];
  /** отворени зделки */
  deals: { id: number; title: string; customerId: number | null; expectedClose: string | null; stage: string; owner: string | null }[];
  /** отворени задачи */
  tasks: { id: number; subject: string; dueDate: string | null; assignee: string | null; customerId: number | null; opportunityId: number | null }[];
};

export type PlannedTask = {
  autoKey: string; kind: "task"; subject: string; dueDate: string; assignee: string | null;
  customerId: number | null; opportunityId: number | null; quotationId: number | null;
};
export type PlannedNotification = { dedupeKey: string; kind: string; title: string; link: string; recipient: string | null };

/**
 * Што треба автоматски да се создаде. Идемпотентно преку клучевите:
 *  • понуда пратена пред ≥ N дена без одговор → задача „Јави се“ (еднаш по понуда)
 *  • зделка со поминат рок за затворање → задача „Ажурирај рок/фаза“ (еднаш по зделка и рок)
 *  • задача што доцни → известување (еднаш дневно)
 */
export function planReminders(i: ReminderInput): { tasks: PlannedTask[]; notifications: PlannedNotification[] } {
  const tasks: PlannedTask[] = [];
  const notifications: PlannedNotification[] = [];
  const days = Math.max(1, Math.floor(i.quoteFollowupDays || 3));
  for (const q of i.quotes) {
    if (q.status !== "sent") continue;
    if (daysBetween(q.sentAt.slice(0, 10), i.today) < days) continue;
    const key = `quote_followup:${q.id}`;
    tasks.push({
      autoKey: key, kind: "task", subject: `Јави се за понуда ${q.number}${q.customer ? ` — ${q.customer}` : ""} (без одговор ${days}+ дена)`.slice(0, 300),
      dueDate: i.today, assignee: q.owner, customerId: q.customerId, opportunityId: q.opportunityId, quotationId: q.id,
    });
    notifications.push({ dedupeKey: key, kind: "quote_followup", title: `Понуда ${q.number} без одговор ${days}+ дена`, link: `/ponudi?open=${q.id}`, recipient: q.owner });
  }
  for (const d of i.deals) {
    if (!d.expectedClose || d.stage === "won" || d.stage === "lost") continue;
    if (d.expectedClose >= i.today) continue;
    const key = `deal_overdue:${d.id}:${d.expectedClose}`;
    tasks.push({
      autoKey: key, kind: "task", subject: `Зделка „${d.title}“ — поминат рок за затворање (${d.expectedClose}). Ажурирај фаза или рок.`.slice(0, 300),
      dueDate: i.today, assignee: d.owner, customerId: d.customerId, opportunityId: d.id, quotationId: null,
    });
    notifications.push({ dedupeKey: key, kind: "deal_overdue", title: `Поминат рок: ${d.title}`.slice(0, 300), link: `/crm?deal=${d.id}`, recipient: d.owner });
  }
  for (const t of i.tasks) {
    if (!t.dueDate || t.dueDate >= i.today) continue;
    notifications.push({ dedupeKey: `task_overdue:${t.id}:${i.today}`, kind: "task_overdue", title: `Задачата доцни: ${t.subject}`.slice(0, 300), link: `/crm/aktivnosti`, recipient: t.assignee });
  }
  return { tasks, notifications };
}

// ───────────── е-пошта → CRM лог ─────────────

export type EmailLogInput = {
  to: string[]; cc?: string[]; subject: string; body: string; attachment?: string | null;
  customerId: number | null; opportunityId: number | null; quotationId: number | null;
  contacts: { id: number; email: string | null }[];
  sentBy: string | null;
};

/**
 * Од пратена порака: еден ред во лог + по една активност „email“ за секој погоден контакт
 * (или една за фирмата ако не е погоден ниту еден контакт).
 */
export function buildEmailLog(i: EmailLogInput) {
  const lower = new Set([...i.to, ...(i.cc ?? [])].map((e) => e.trim().toLowerCase()));
  const matched = i.contacts.filter((c) => c.email && lower.has(c.email.trim().toLowerCase()));
  const log = {
    direction: "out" as const, customerId: i.customerId, contactId: matched[0]?.id ?? null, opportunityId: i.opportunityId, quotationId: i.quotationId,
    toAddr: i.to.join(", "), ccAddr: i.cc?.length ? i.cc.join(", ") : null, subject: i.subject.slice(0, 300), body: i.body, attachment: i.attachment ?? null, sentBy: i.sentBy,
  };
  const notes = `До: ${log.toAddr}${log.ccAddr ? ` · CC: ${log.ccAddr}` : ""}${i.attachment ? ` · прилог: ${i.attachment}` : ""}\n\n${i.body}`.slice(0, 5000);
  const base = { kind: "email" as const, subject: `Е-пошта: ${i.subject}`.slice(0, 300), notes, customerId: i.customerId, opportunityId: i.opportunityId, quotationId: i.quotationId, createdBy: i.sentBy };
  const activities = matched.length ? matched.map((c) => ({ ...base, contactId: c.id })) : [{ ...base, contactId: null as number | null }];
  return { log, activities };
}


// ───────────── SMTP од env ─────────────

export type SmtpConfig = { host: string; port: number; secure: boolean; user: string; pass: string; from: string; source: "settings" | "env" };

/** SMTP од env променливи (SMTP_HOST/PORT/USER/PASS/FROM, опционално SMTP_SECURE). null ако не е поставено. */
export function smtpFromEnv(env: Record<string, string | undefined>): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(env.SMTP_PORT) || 587;
  const user = env.SMTP_USER?.trim() ?? "";
  const sec = (env.SMTP_SECURE ?? "").toLowerCase();
  return {
    host, port, user, pass: env.SMTP_PASS ?? "",
    secure: sec ? sec === "true" || sec === "1" : port === 465,
    from: env.SMTP_FROM?.trim() || user,
    source: "env",
  };
}

/** Денови за follow-up на понуда: поставка → env → 3. */
export function followupDays(setting: unknown, env?: string): number {
  const n = Number(setting) || Number(env) || 3;
  return Math.min(60, Math.max(1, Math.floor(n)));
}

/** Текст на дневен дигест за еден продавач. */
export function digestText(name: string | null, items: { title: string; link: string }[], baseUrl?: string): string {
  const lines = items.map((i) => `  • ${i.title}${baseUrl ? ` — ${baseUrl.replace(/\/$/, "")}${i.link}` : ""}`);
  return `Здраво${name ? ` ${name}` : ""},\n\nCRM потсетници за денес (${items.length}):\n${lines.join("\n")}\n\nОтвори „Активности → Мои задачи“ во ERP.`;
}
