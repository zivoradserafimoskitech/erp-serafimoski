// Пресметка на амортизација. Едно место — за да не се разидат серверот и екранот.

export const ASSET_CATEGORIES: Record<string, { label: string; defaultRate: number }> = {
  machine: { label: "Машини и опрема", defaultRate: 20 },
  vehicle: { label: "Возила", defaultRate: 20 },
  building: { label: "Градежни објекти", defaultRate: 2.5 },
  tools: { label: "Алат и инвентар", defaultRate: 25 },
  it: { label: "Компјутерска опрема", defaultRate: 25 },
  furniture: { label: "Мебел", defaultRate: 10 },
  other: { label: "Друго", defaultRate: 20 },
};

export type AssetInput = {
  acquisitionValue: number;
  salvageValue: number;
  rate: number;                 // % годишно
  acquisitionDate: string;      // YYYY-MM-DD
  depreciationStart?: string | null;
  status?: string;
  disposalDate?: string | null;
};

export type YearRow = {
  year: number;
  months: number;
  amount: number;
  accumulated: number;
  bookValue: number;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Од која дата тргнува амортизацијата — по правило од месецот на ставање во употреба */
function startOf(a: AssetInput): Date {
  const s = a.depreciationStart || a.acquisitionDate;
  return new Date(s + "T00:00:00");
}

/**
 * Линеарна амортизација по месеци.
 * Основицата е набавна вредност намалена за преостаната вредност.
 * Последната година се крати за да не се слезе под преостанатата вредност.
 */
export function depreciationSchedule(a: AssetInput, untilYear?: number): YearRow[] {
  const base = Math.max(0, (a.acquisitionValue || 0) - (a.salvageValue || 0));
  const rate = (a.rate || 0) / 100;
  if (base <= 0 || rate <= 0) return [];

  const perYear = base * rate;
  const perMonth = perYear / 12;

  const start = startOf(a);
  const startYear = start.getFullYear();
  const startMonth = start.getMonth(); // 0-11

  const endLimit = untilYear ?? new Date().getFullYear();
  const disposal = a.disposalDate ? new Date(a.disposalDate + "T00:00:00") : null;

  const rows: YearRow[] = [];
  let accumulated = 0;
  let year = startYear;

  // најмногу 60 години, за секој случај
  for (let guard = 0; guard < 60; guard++) {
    if (year > endLimit + 40) break;

    let months = 12;
    if (year === startYear) months = 12 - startMonth;
    if (disposal && year === disposal.getFullYear()) {
      const upto = disposal.getMonth() + 1;
      months = year === startYear ? upto - startMonth : upto;
    }
    if (months <= 0) break;

    let amount = round2(perMonth * months);
    const remaining = round2(base - accumulated);
    if (amount >= remaining) amount = remaining;

    if (amount > 0) {
      accumulated = round2(accumulated + amount);
      rows.push({
        year,
        months,
        amount,
        accumulated,
        bookValue: round2((a.acquisitionValue || 0) - accumulated),
      });
    }

    if (accumulated >= base - 0.005) break;
    if (disposal && year >= disposal.getFullYear()) break;
    year++;
  }

  return rows;
}

/** Состојба на денешен ден (или на крајот на дадена година) */
export function assetState(a: AssetInput, asOfYear?: number) {
  const y = asOfYear ?? new Date().getFullYear();
  const sched = depreciationSchedule(a, y);
  const upTo = sched.filter((r) => r.year <= y);
  const accumulated = upTo.length ? upTo[upTo.length - 1].accumulated : 0;
  const bookValue = round2((a.acquisitionValue || 0) - accumulated);
  const thisYear = sched.find((r) => r.year === y);
  const fullyDepreciated = accumulated >= (a.acquisitionValue || 0) - (a.salvageValue || 0) - 0.005;
  return {
    accumulated,
    bookValue,
    currentYearAmount: thisYear?.amount ?? 0,
    monthlyAmount: round2(
      ((a.acquisitionValue || 0) - (a.salvageValue || 0)) * ((a.rate || 0) / 100) / 12
    ),
    fullyDepreciated,
    finishesIn: sched.length ? sched[sched.length - 1].year : null,
  };
}

/** Годишна стапка од корисен век и обратно */
export const rateFromLife = (years: number) => (years > 0 ? round2(100 / years) : 0);
export const lifeFromRate = (rate: number) => (rate > 0 ? round2(100 / rate) : 0);
