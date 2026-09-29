// Курсна листа од базата и помошни функции за датуми (заеднички за финансии и извештаи)
import { getPool } from "./queries/connection";
import type { RateLookup } from "@contracts/finance";

export const iso = (d: any): string => {
  if (!d) return "";
  if (d instanceof Date) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }
  return String(d).slice(0, 10);
};

export async function loadRates(): Promise<RateLookup> {
  const rows = (await getPool().query(`SELECT rate_date, currency, rate FROM exchange_rates ORDER BY currency, rate_date`)).rows as any[];
  const byCur = new Map<string, { d: string; r: number }[]>();
  for (const r of rows) {
    const list = byCur.get(r.currency) ?? [];
    list.push({ d: iso(r.rate_date), r: Number(r.rate) });
    byCur.set(r.currency, list);
  }
  // Курсот важи до следната објава (викенди, празници) -- земи го последниот до тој датум, најмногу 10 дена назад
  return (cur, date) => {
    const list = byCur.get(cur.toUpperCase());
    if (!list) return null;
    let best: { d: string; r: number } | null = null;
    for (const x of list) { if (x.d <= date) best = x; else break; }
    if (!best) return null;
    const age = (new Date(date).getTime() - new Date(best.d).getTime()) / 86400000;
    return age <= 10 ? best.r : null;
  };
}

