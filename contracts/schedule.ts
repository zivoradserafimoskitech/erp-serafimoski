// Распоредување на операции по машини и работни денови (капацитет во часови).
// Чиста функција: база нема -- ја користи серверот и тестовите.

export interface SchedMachine { id: number; hoursPerDay: number; operations: string[] }
export interface SchedOp {
  id: number; workOrderId: number; sequence: number; operation: string; hours: number;
  machineId: number | null; plannedDate: string | null; locked: boolean; // locked = веќе закажана или започната
}
export interface SchedWO { id: number; priority: string; plannedEnd: string | null; createdAt: string }

const PRIO: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export const isWorkday = (d: string) => { const w = new Date(d + "T00:00:00Z").getUTCDay(); return w !== 0 && w !== 6; };
export const addDays = (d: string, n: number) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
export const nextWorkday = (d: string) => { let x = d; while (!isWorkday(x)) x = addDays(x, 1); return x; };

/** Која машина ја работи операцијата: веќе зададена, или прва што ја има во листата, или null. */
export function pickMachine(op: SchedOp, machines: SchedMachine[]): number | null {
  if (op.machineId) return op.machineId;
  const m = machines.find(x => x.operations.includes(op.operation));
  return m ? m.id : null;
}

/**
 * Закажи ги незакажаните операции од денот `from`, по приоритет на налогот и по редослед на операциите.
 * Операција не почнува пред претходната во истиот налог. Товарот од веќе закажаните операции се почитува.
 * Операција подолга од капацитетот на денот зазема цел ден (и се означува како преоптоварена).
 */
export function autoSchedule(p: { from: string; machines: SchedMachine[]; wos: SchedWO[]; ops: SchedOp[]; defaultHours?: number }) {
  const load = new Map<string, number>(); // `${machineId}|${date}` -> часови
  const cap = (mid: number | null) => (mid ? p.machines.find(m => m.id === mid)?.hoursPerDay : undefined) ?? p.defaultHours ?? 8;
  const key = (mid: number | null, d: string) => `${mid ?? 0}|${d}`;
  for (const o of p.ops) {
    if (o.locked && o.plannedDate) load.set(key(o.machineId, o.plannedDate), (load.get(key(o.machineId, o.plannedDate)) ?? 0) + o.hours);
  }
  const wos = [...p.wos].sort((a, b) =>
    (PRIO[a.priority] ?? 2) - (PRIO[b.priority] ?? 2) ||
    (a.plannedEnd ?? "9999").localeCompare(b.plannedEnd ?? "9999") ||
    a.createdAt.localeCompare(b.createdAt));
  const result: { opId: number; machineId: number | null; plannedDate: string; overloaded: boolean }[] = [];
  // часови по налог и ден: операциите на ист налог одат една по друга, па во еден ден не собираат повеќе од денот
  const woDay = new Map<string, number>();
  const dayLen = p.defaultHours ?? 8;
  const start = nextWorkday(p.from);
  for (const wo of wos) {
    const ops = p.ops.filter(o => o.workOrderId === wo.id).sort((a, b) => a.sequence - b.sequence);
    let earliest = start;
    for (const op of ops) {
      if (op.locked && op.plannedDate) { if (op.plannedDate > earliest) earliest = op.plannedDate; continue; }
      const mid = pickMachine(op, p.machines);
      const c = cap(mid);
      const h = Math.max(0, op.hours || 0);
      let d = nextWorkday(earliest);
      let guard = 0;
      // прв ден со доволно слободни часови (или празен ден за подолги операции)
      while (guard++ < 730) {
        const used = load.get(key(mid, d)) ?? 0;
        const woUsed = woDay.get(`${wo.id}|${d}`) ?? 0;
        const machineOk = used + h <= c + 1e-9 || (h > c && used === 0);
        const woOk = woUsed === 0 || woUsed + h <= dayLen + 1e-9;
        if (machineOk && woOk) break;
        d = nextWorkday(addDays(d, 1));
      }
      load.set(key(mid, d), (load.get(key(mid, d)) ?? 0) + h);
      woDay.set(`${wo.id}|${d}`, (woDay.get(`${wo.id}|${d}`) ?? 0) + h);
      result.push({ opId: op.id, machineId: mid, plannedDate: d, overloaded: h > c });
      earliest = d;
    }
  }
  return result;
}
