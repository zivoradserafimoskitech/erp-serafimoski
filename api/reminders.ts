// Автоматски потсетници по е-пошта:
//  1) доцнење на плаќање -> љубезен потсетник до клиентот (најмногу еднаш на N дена по фактура)
//  2) понуди без одговор по N дена -> листа до шефот (секоја понуда само еднаш)
//  3) неделен извештај -> до шефот, еднаш неделно
// Серверот ги проверува на секои 30 минути; секоја задача оди најмногу еднаш дневно / неделно.
import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getPool } from "./queries/connection";
import { mailTransport } from "./mail-router";
import { iso } from "./rates-helper";

const q = async (text: string, params: any[] = []) => (await getPool().query(text, params)).rows as any[];

export const reminderSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  bossEmail: z.string().default(""),
  overdueToCustomer: z.boolean().default(true),
  overdueEveryDays: z.number().int().min(1).max(60).default(7),
  quoteFollowupDays: z.number().int().min(1).max(60).default(7),
  quoteFollowup: z.boolean().default(true),
  weekly: z.boolean().default(true),
  weeklyWeekday: z.number().int().min(0).max(6).default(1), // 1 = понеделник
  sendHour: z.number().int().min(0).max(23).default(8),
});
export type ReminderSettings = z.infer<typeof reminderSettingsSchema>;

async function kvGet(key: string): Promise<string | null> {
  return (await q(`SELECT value FROM app_kv WHERE key = $1`, [key]))[0]?.value ?? null;
}
async function kvSet(key: string, value: string) {
  await q(`INSERT INTO app_kv (key, value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, value]);
}
export async function getReminderSettings(): Promise<ReminderSettings> {
  const raw = await kvGet("reminders");
  try { return reminderSettingsSchema.parse(raw ? JSON.parse(raw) : {}); } catch { return reminderSettingsSchema.parse({}); }
}

/** Локално време во Скопје: датум, час, ден во неделата. */
function skopjeNow() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Skopje", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short", hour12: false })
    .formatToParts(new Date());
  const g = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday"));
  return { date: `${g("year")}-${g("month")}-${g("day")}`, hour: Number(g("hour")) % 24, weekday: wd };
}

const money = (n: number, cur = "MKD") => `${n.toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur === "MKD" ? "ден." : cur}`;
const dmy = (d: string) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "");

// ───────────── што би се пратило ─────────────

export async function overdueInvoices(everyDays: number) {
  const rows = await q(`SELECT i.id, i.invoice_number, i.issue_date, i.due_date, i.total_amount, i.currency, c.name, c.company, c.email,
      i.total_amount
        - COALESCE((SELECT SUM(amount) FROM payment_allocations a WHERE a.doc_type = 'invoice' AND a.doc_id = i.id), 0)
        - COALESCE((SELECT SUM(amount) FROM cash_transactions ct WHERE ct.invoice_id = i.id AND ct.direction = 'in'), 0) AS open,
      (SELECT MAX(sent_at) FROM reminder_log r WHERE r.kind = 'overdue' AND r.doc_type = 'invoice' AND r.doc_id = i.id) AS last_sent
    FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
    WHERE i.invoice_type = 'standard' AND i.status NOT IN ('draft', 'cancelled', 'paid') AND i.due_date < CURRENT_DATE
    ORDER BY i.due_date`);
  return rows.filter(r => Number(r.open) > 0.5).map(r => ({
    id: Number(r.id), number: r.invoice_number, customer: r.company || r.name, email: r.email as string | null,
    issueDate: iso(r.issue_date), dueDate: iso(r.due_date), open: Number(r.open), currency: r.currency || "MKD",
    daysLate: Math.round((Date.now() - new Date(iso(r.due_date)).getTime()) / 86400000),
    due: !r.last_sent || (Date.now() - new Date(r.last_sent).getTime()) / 86400000 >= everyDays - 0.01,
  }));
}

export async function staleQuotes(days: number) {
  const rows = await q(`SELECT qt.id, qt.quote_number, qt.created_at, qt.total_amount, qt.currency, qt.status, c.name, c.company, c.email, c.phone
    FROM quotations qt LEFT JOIN customers c ON c.id = qt.customer_id
    WHERE qt.status IN ('draft', 'sent') AND qt.created_at < now() - ($1 || ' days')::interval
      AND NOT EXISTS (SELECT 1 FROM reminder_log r WHERE r.kind = 'quote_followup' AND r.doc_type = 'quotation' AND r.doc_id = qt.id)
    ORDER BY qt.created_at`, [String(days)]);
  return rows.map(r => ({ id: Number(r.id), number: r.quote_number, customer: r.company || r.name, email: r.email, phone: r.phone,
    date: iso(r.created_at), total: Number(r.total_amount), currency: r.currency || "MKD", status: r.status }));
}

export async function weeklyReport() {
  const one = async (sql: string, p: any[] = []) => (await q(sql, p))[0] ?? {};
  const inv = await one(`SELECT COUNT(*)::int n, COALESCE(SUM(subtotal) FILTER (WHERE currency = 'MKD'), 0) mkd, COUNT(*) FILTER (WHERE currency <> 'MKD')::int fx
    FROM invoices WHERE invoice_type = 'standard' AND status NOT IN ('draft','cancelled') AND issue_date >= CURRENT_DATE - 7`);
  const paid = await one(`SELECT
      COALESCE((SELECT SUM(a.amount) FROM payment_allocations a JOIN bank_transactions t ON t.id = a.tx_id WHERE a.doc_type = 'invoice' AND t.tx_date >= CURRENT_DATE - 7), 0)
    + COALESCE((SELECT SUM(amount) FROM cash_transactions WHERE direction = 'in' AND invoice_id IS NOT NULL AND tx_date >= CURRENT_DATE - 7), 0) AS s`);
  const quotes = await one(`SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE status IN ('accepted','converted'))::int won FROM quotations WHERE created_at >= now() - interval '7 days'`);
  const wos = await one(`SELECT COUNT(*) FILTER (WHERE status = 'completed' AND updated_at >= now() - interval '7 days')::int done,
      COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled') AND planned_end < CURRENT_DATE)::int late,
      COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled'))::int open FROM work_orders`);
  const overdue = await overdueInvoices(1);
  const cash = await one(`SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) b FROM cash_transactions`);
  const qual = await one(`SELECT COUNT(*) FILTER (WHERE status <> 'closed')::int open, COUNT(*) FILTER (WHERE issue_date >= CURRENT_DATE - 7)::int week FROM quality_issues`);
  const maint = await one(`SELECT COUNT(*)::int n FROM maintenance_plans WHERE is_active = 'active' AND (last_done IS NULL OR last_done + interval_days <= CURRENT_DATE)`);
  // мерни инструменти со истечена калибрација или во следните 14 дена; застои на машините оваа недела
  const cal = await q(`SELECT name, next_due FROM instruments WHERE status = 'active' AND next_due IS NOT NULL AND next_due <= CURRENT_DATE + 14 ORDER BY next_due`).catch(() => [] as any[]);
  const down = await one(`SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(end_at, now()) - GREATEST(start_at, now() - interval '7 days'))) / 3600), 0) AS h, COUNT(*)::int AS n
    FROM machine_downtime WHERE COALESCE(end_at, now()) >= now() - interval '7 days' AND reason NOT IN ('maintenance', 'no_work')`).catch(() => ({} as any));
  return {
    invoicedCount: inv.n ?? 0, invoicedMkd: Number(inv.mkd ?? 0), invoicedFx: inv.fx ?? 0,
    paymentsReceived: Number(paid.s ?? 0),
    quotesNew: quotes.n ?? 0, quotesWon: quotes.won ?? 0,
    woDone: wos.done ?? 0, woLate: wos.late ?? 0, woOpen: wos.open ?? 0,
    overdueCount: overdue.length, overdueMkd: overdue.filter(o => o.currency === "MKD").reduce((a, o) => a + o.open, 0), overdueTop: overdue.slice(0, 5),
    cashBalance: Number(cash.b ?? 0), qualityOpen: qual.open ?? 0, qualityWeek: qual.week ?? 0, maintenanceDue: maint.n ?? 0,
    calibrationDue: cal.map((c: any) => ({ name: String(c.name), due: iso(c.next_due) })),
    downtimeHours: Math.round(Number(down.h ?? 0) * 10) / 10, downtimeCount: Number(down.n ?? 0),
  };
}

// ───────────── праќање ─────────────

async function companyInfo() {
  const s = (await q(`SELECT name, bank_account, bank_name, iban, swift, phone, email FROM company_settings LIMIT 1`))[0] ?? {};
  return s;
}

export async function sendOverdue(s: ReminderSettings, force = false) {
  const list = (await overdueInvoices(s.overdueEveryDays)).filter(r => force || r.due);
  if (!s.overdueToCustomer) return { sent: 0, skipped: list.length };
  const { t, from } = await mailTransport();
  const co = await companyInfo();
  let sent = 0, skipped = 0;
  for (const r of list) {
    if (!r.email) { skipped++; continue; }
    const pay = r.currency === "MKD" ? `Жиро сметка: ${co.bank_account ?? ""}${co.bank_name ? " (" + co.bank_name + ")" : ""}` : `IBAN: ${co.iban ?? ""} · SWIFT: ${co.swift ?? ""}`;
    await t.sendMail({
      from, to: r.email, bcc: s.bossEmail || undefined,
      subject: `Потсетник за плаќање — фактура ${r.number}`,
      text: `Почитувани,\n\nВе потсетуваме дека фактурата ${r.number} од ${dmy(r.issueDate)} со рок на плаќање ${dmy(r.dueDate)} сè уште не е платена.\nОтворен износ: ${money(r.open, r.currency)}\n\n${pay}\nПовикување на број: ${r.number}\n\nАко плаќањето е веќе извршено, ве молиме занемарете ја оваа порака.\n\nСо почит,\n${co.name ?? ""}${co.phone ? "\n" + co.phone : ""}`,
    });
    await q(`INSERT INTO reminder_log (kind, doc_type, doc_id, sent_to) VALUES ('overdue', 'invoice', $1, $2)`, [r.id, r.email]);
    sent++;
  }
  return { sent, skipped };
}

export async function sendQuoteFollowup(s: ReminderSettings) {
  if (!s.bossEmail) return { sent: 0 };
  const list = await staleQuotes(s.quoteFollowupDays);
  if (!list.length) return { sent: 0 };
  const { t, from } = await mailTransport();
  const lines = list.map(x => `• ${x.number} — ${x.customer ?? ""} — ${money(x.total, x.currency)} (од ${dmy(x.date)})${x.phone ? " — тел. " + x.phone : ""}${x.email ? " — " + x.email : ""}`).join("\n");
  await t.sendMail({ from, to: s.bossEmail, subject: `${list.length} понуди без одговор повеќе од ${s.quoteFollowupDays} дена`,
    text: `Овие понуди сè уште немаат одговор од клиентот. Добро е да им се јавите:\n\n${lines}\n\nКога клиентот ќе одговори, сменете го статусот на понудата (прифатена / одбиена).` });
  for (const x of list) await q(`INSERT INTO reminder_log (kind, doc_type, doc_id, sent_to) VALUES ('quote_followup', 'quotation', $1, $2)`, [x.id, s.bossEmail]);
  return { sent: 1, quotes: list.length };
}

export async function sendWeekly(s: ReminderSettings) {
  if (!s.bossEmail) return { sent: 0 };
  const r = await weeklyReport();
  const { t, from } = await mailTransport();
  const top = r.overdueTop.map(o => `   • ${o.number} ${o.customer ?? ""}: ${money(o.open, o.currency)} (доцни ${o.daysLate} дена)`).join("\n");
  await t.sendMail({ from, to: s.bossEmail, subject: `Неделен извештај — ${dmy(skopjeNow().date)}`,
    text: `Неделен извештај (последни 7 дена)\n\n` +
      `ПРОДАЖБА\n  Фактурирано: ${r.invoicedCount} фактури, ${money(r.invoicedMkd)}${r.invoicedFx ? ` + ${r.invoicedFx} во странска валута` : ""}\n  Наплатено: ${money(r.paymentsReceived)}\n  Нови понуди: ${r.quotesNew}, од нив прифатени: ${r.quotesWon}\n\n` +
      `ПРОИЗВОДСТВО\n  Завршени налози: ${r.woDone}\n  Отворени: ${r.woOpen}, од нив доцнат: ${r.woLate}\n\n` +
      `НАПЛАТА\n  Фактури по рок: ${r.overdueCount} (${money(r.overdueMkd)} во денари)${top ? "\n" + top : ""}\n  Благајна: ${money(r.cashBalance)}\n\n` +
      `КВАЛИТЕТ И ОДРЖУВАЊЕ\n  Отворени неусогласености: ${r.qualityOpen} (нови оваа недела: ${r.qualityWeek})\n  Сервиси што доцнат: ${r.maintenanceDue}\n` +
      `  Застои на машините: ${r.downtimeCount} (${r.downtimeHours} ч)\n` +
      (r.calibrationDue.length ? `  Калибрација на мерни инструменти (истечена или во 14 дена):\n${r.calibrationDue.map((c) => `   • ${c.name} — ${dmy(c.due)}`).join("\n")}\n` : "") });
  return { sent: 1 };
}

/** Се повикува периодично од серверот. */
export async function runScheduledReminders() {
  const s = await getReminderSettings();
  if (!s.enabled) return;
  const now = skopjeNow();
  if (now.hour < s.sendHour) return;
  const done = async (key: string, fn: () => Promise<unknown>) => {
    if ((await kvGet(key)) === now.date) return;
    await kvSet(key, now.date); // прво означи (да не се прати двапати ако падне на половина)
    try { await fn(); } catch (e: any) { console.error(`[REMINDERS] ${key}:`, e?.message ?? e); }
  };
  await done("reminders:overdue", () => sendOverdue(s));
  if (s.quoteFollowup) await done("reminders:quotes", () => sendQuoteFollowup(s));
  if (s.weekly && now.weekday === s.weeklyWeekday) await done("reminders:weekly", () => sendWeekly(s));
}

export function startReminderScheduler() {
  const tick = () => runScheduledReminders().catch(e => console.error("[REMINDERS]", e?.message ?? e));
  setTimeout(tick, 60_000);
  setInterval(tick, 30 * 60_000);
}

// ───────────── рутер ─────────────

export const remindersRouter = createRouter({
  remindersGet: publicQuery.query(async () => getReminderSettings()),

  remindersSet: publicQuery
    .input(reminderSettingsSchema)
    .mutation(async ({ input }) => { await kvSet("reminders", JSON.stringify(input)); return { success: true }; }),

  remindersPreview: publicQuery.query(async () => {
    const s = await getReminderSettings();
    const [overdue, quotes, weekly] = await Promise.all([overdueInvoices(s.overdueEveryDays), staleQuotes(s.quoteFollowupDays), weeklyReport()]);
    return { overdue, quotes, weekly };
  }),

  remindersSendNow: publicQuery
    .input(z.object({ kind: z.enum(["overdue", "quotes", "weekly"]) }))
    .mutation(async ({ input }) => {
      const s = await getReminderSettings();
      if (input.kind !== "overdue" && !s.bossEmail) throw new Error("Внеси е-пошта на шефот во поставките за потсетници");
      if (input.kind === "overdue") return sendOverdue(s, true);
      if (input.kind === "quotes") return sendQuoteFollowup(s);
      return sendWeekly(s);
    }),
});
