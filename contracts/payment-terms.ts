// Услови за плаќање по рати: „50% авансно, 50% пред испорака“, „100% 30 дена по испорака“...
// Се чуваат како JSON (payment_schedule) на понуда и фактура; текстот се генерира на МК или EN.

export type PaymentWhen =
  | "advance"          // авансно, при нарачка
  | "before_delivery"  // пред испорака
  | "on_delivery"      // при испорака
  | "after_delivery"   // X дена по испорака
  | "after_invoice";   // X дена по фактура

export interface Installment {
  percent: number;
  when: PaymentWhen;
  days?: number;
}

export const WHEN_OPTIONS: { value: PaymentWhen; mk: string; en: string; needsDays: boolean }[] = [
  { value: "advance", mk: "авансно (при нарачка)", en: "in advance (with order)", needsDays: false },
  { value: "before_delivery", mk: "пред испорака", en: "before delivery", needsDays: false },
  { value: "on_delivery", mk: "при испорака", en: "on delivery", needsDays: false },
  { value: "after_delivery", mk: "дена по испорака", en: "days after delivery", needsDays: true },
  { value: "after_invoice", mk: "дена по фактура", en: "days after invoice date", needsDays: true },
];

export const PAYMENT_PRESETS: { label: string; schedule: Installment[] }[] = [
  { label: "100% авансно", schedule: [{ percent: 100, when: "advance" }] },
  { label: "50% аванс / 50% пред испорака", schedule: [{ percent: 50, when: "advance" }, { percent: 50, when: "before_delivery" }] },
  { label: "30% аванс / 70% пред испорака", schedule: [{ percent: 30, when: "advance" }, { percent: 70, when: "before_delivery" }] },
  { label: "50% аванс / 50% 15 дена по испорака", schedule: [{ percent: 50, when: "advance" }, { percent: 50, when: "after_delivery", days: 15 }] },
  { label: "100% 30 дена по испорака", schedule: [{ percent: 100, when: "after_delivery", days: 30 }] },
];

export const needsDays = (w: PaymentWhen) => w === "after_delivery" || w === "after_invoice";

export function scheduleTotal(s: Installment[]): number {
  return Math.round(s.reduce((a, i) => a + (Number(i.percent) || 0), 0) * 100) / 100;
}

/** Опис на една рата: „50% авансно (при нарачка)“ / „50% 30 days after delivery“ */
export function describeInstallment(i: Installment, lang: "mk" | "en" = "mk"): string {
  const opt = WHEN_OPTIONS.find(o => o.value === i.when);
  const label = opt ? opt[lang] : i.when;
  const pct = `${Number(i.percent) || 0}%`;
  return needsDays(i.when) ? `${pct} ${Number(i.days) || 0} ${label}` : `${pct} ${label}`;
}

/** Цел распоред како еден ред текст, за полето „Плаќање“ */
export function describeSchedule(s: Installment[], lang: "mk" | "en" = "mk"): string {
  return s.map(i => describeInstallment(i, lang)).join(", ");
}

/** Безбедно читање од базата (JSON текст) — враќа null ако нема или е неисправно */
export function parseSchedule(raw: unknown): Installment[] | null {
  if (!raw) return null;
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(v) || v.length === 0) return null;
    const ok = v.every(i => i && typeof i.percent === "number" && WHEN_OPTIONS.some(o => o.value === i.when));
    return ok ? (v as Installment[]) : null;
  } catch {
    return null;
  }
}

/** Процент што се плаќа однапред (авансните рати) — за про-фактура */
export function advancePercent(s: Installment[]): number {
  return s.filter(i => i.when === "advance").reduce((a, i) => a + (Number(i.percent) || 0), 0);
}
