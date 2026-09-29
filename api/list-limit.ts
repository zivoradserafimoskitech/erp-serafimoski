// Големите листи: без филтер/пребарување се враќаат само најновите записи (побрзо вчитување);
// со филтер или пребарување се пребарува низ сите записи, за ништо да не се „изгуби“.
export const DEFAULT_LIST_LIMIT = 500;

export function listLimit(input: Record<string, unknown> | undefined | null): number {
  if (!input) return DEFAULT_LIST_LIMIT;
  const filtered = Object.entries(input).some(([k, v]) => k !== "limit" && v !== undefined && v !== null && v !== "");
  if (filtered) return 1_000_000;
  const l = Number(input.limit);
  return Number.isFinite(l) && l > 0 ? Math.min(l, 1_000_000) : DEFAULT_LIST_LIMIT;
}
