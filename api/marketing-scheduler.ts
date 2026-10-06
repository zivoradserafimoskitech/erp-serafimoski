// Маркетинг позадински задачи: усогласување на изворот (понуда → нарачка → фактура).
// Редицата за кампањи (М2) се закачува преку marketingTasks.
import { syncAttribution } from "./marketing-leads";
import { processCampaignQueue } from "./marketing-campaigns";

export const marketingTasks: { name: string; everyMs: number; run: () => Promise<unknown>; last?: number }[] = [
  { name: "attribution", everyMs: 10 * 60_000, run: syncAttribution },
  // редица за е-пошта кампањи: секоја минута по rate_per_minute пораки по кампања
  { name: "campaign-queue", everyMs: 0, run: processCampaignQueue },
];

let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;

export async function marketingTick(now = Date.now()) {
  if (busy) return;
  busy = true;
  try {
    for (const t of marketingTasks) {
      if (t.last && now - t.last < t.everyMs) continue;
      t.last = now;
      await t.run().catch((e) => console.error(`[MKT] ${t.name}:`, e?.message ?? e));
    }
  } finally { busy = false; }
}

export function startMarketingScheduler() {
  if (timer) return;
  timer = setInterval(() => void marketingTick(), 60_000);
  setTimeout(() => void marketingTick(), 30_000);
  console.log("[MKT] scheduler started");
}
