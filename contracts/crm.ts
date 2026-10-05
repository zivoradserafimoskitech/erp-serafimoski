// CRM — чиста логика (без база), заедничка за серверот и интерфејсот. Покриена со тестови.

export const DEAL_STAGES = ["new", "contacted", "quoting", "quoted", "won", "lost"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];
export const OPEN_STAGES: DealStage[] = ["new", "contacted", "quoting", "quoted"];

export const DEAL_STAGE_LABEL: Record<DealStage, string> = {
  new: "Ново барање",
  contacted: "Во контакт",
  quoting: "Се прави понуда",
  quoted: "Понуда пратена",
  won: "Добиена",
  lost: "Изгубена",
};

/** Предлог-веројатност по фаза (ако корисникот не внесе своја). */
export const STAGE_PROBABILITY: Record<DealStage, number> = {
  new: 10, contacted: 25, quoting: 40, quoted: 60, won: 100, lost: 0,
};

export const ACTIVITY_KINDS = ["call", "meeting", "email", "visit", "note", "task"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** Промена на фаза: нова веројатност и дали зделката се затвора. */
export function stageChange(from: string, to: DealStage, currentProbability: number) {
  const closing = to === "won" || to === "lost";
  const reopening = (from === "won" || from === "lost") && !closing;
  const auto = currentProbability === STAGE_PROBABILITY[from as DealStage];
  return {
    probability: closing || auto || reopening ? STAGE_PROBABILITY[to] : currentProbability,
    closed: closing,
    needsLostReason: to === "lost",
  };
}

export type TaskLike = { id: number; dueDate: string | null; doneAt?: string | Date | null };

/** „Мои задачи“: доцнат / денес / наскоро (следни 7 дена) / подоцна-без рок. Завршените се исклучени. */
export function bucketTasks<T extends TaskLike>(tasks: T[], today: string) {
  const plus7 = addDays(today, 7);
  const out = { overdue: [] as T[], today: [] as T[], upcoming: [] as T[], later: [] as T[] };
  for (const t of tasks) {
    if (t.doneAt) continue;
    if (!t.dueDate) out.later.push(t);
    else if (t.dueDate < today) out.overdue.push(t);
    else if (t.dueDate === today) out.today.push(t);
    else if (t.dueDate <= plus7) out.upcoming.push(t);
    else out.later.push(t);
  }
  const byDue = (a: T, b: T) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.id - b.id;
  out.overdue.sort(byDue); out.today.sort(byDue); out.upcoming.sort(byDue); out.later.sort(byDue);
  return out;
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string | Date, b: string | Date): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.round(ms / 86400000);
}

/** Метрики за извештај од листа на затворени зделки. */
export function dealMetrics(deals: { stage: string; createdAt: string | Date; closedAt: string | Date | null; value: number }[]) {
  const won = deals.filter((d) => d.stage === "won");
  const lost = deals.filter((d) => d.stage === "lost");
  const closedWon = won.filter((d) => d.closedAt);
  const avgDaysToClose = closedWon.length
    ? Math.round((closedWon.reduce((s, d) => s + Math.max(0, daysBetween(d.createdAt, d.closedAt!)), 0) / closedWon.length) * 10) / 10
    : null;
  return {
    won: won.length,
    lost: lost.length,
    winRate: won.length + lost.length ? won.length / (won.length + lost.length) : null,
    wonValue: won.reduce((s, d) => s + d.value, 0),
    avgDaysToClose,
  };
}

export function parseTags(s: string | null | undefined): string[] {
  return Array.from(new Set((s ?? "").split(/[,;]/).map((x) => x.trim()).filter(Boolean))).slice(0, 20);
}
