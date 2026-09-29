// Распоредување на операции по машини и работни денови (капацитет во часови).
// Чиста функција: база нема -- ја користи серверот и тестовите.

export interface SchedMachine { id: number; hoursPerDay: number; operations: string[]; name?: string; type?: string | null }
export interface SchedOp {
  id: number; workOrderId: number; sequence: number; operation: string; hours: number;
  machineId: number | null; plannedDate: string | null; locked: boolean; // locked = веќе закажана или започната
  started?: boolean; // започната -- никогаш не се поместува
}
export interface SchedWO { id: number; priority: string; plannedEnd: string | null; createdAt: string }

const PRIO: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export const isWorkday = (d: string) => { const w = new Date(d + "T00:00:00Z").getUTCDay(); return w !== 0 && w !== 6; };
export const addDays = (d: string, n: number) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
export const nextWorkday = (d: string) => { let x = d; while (!isWorkday(x)) x = addDays(x, 1); return x; };

/** Клучни зборови во името/типот на машината за секоја операција (кога кај машината не се означени операции). */
export const OP_KEYWORDS: Record<string, string[]> = {
  cutting_laser: ["ласер", "laser", "фибер", "fiber"],
  cutting_plasma: ["плазма", "plasma"],
  bending: ["витк", "абкант", "свитк", "преса", "press", "bend", "кант"],
  welding_mig: ["mig", "mag", "завар", "weld", "апарат"],
  welding_tig: ["tig", "завар", "weld"],
  grinding: ["брус", "шлајф", "grind", "flex", "флекс"],
  drilling: ["дупч", "бушил", "drill", "стуб"],
  painting: ["бој", "фарб", "paint", "лакир", "прашкаст"],
  assembly: ["монтаж", "assembl"],
  quality_control: ["контрол", "мерн", "quality"],
  packaging: ["пакув", "pack"],
};

/** Дали машината ја работи операцијата: означените операции имаат предност, инаку по името/типот. */
export function machineDoes(m: SchedMachine, operation: string): boolean {
  if (m.operations.length) return m.operations.includes(operation);
  const text = `${m.name ?? ""} ${m.type ?? ""}`.toLowerCase();
  return (OP_KEYWORDS[operation] ?? []).some(k => text.includes(k));
}

/** Која машина ја работи операцијата: веќе зададена, или прва со означена операција, или прва по име; инаку null. */
export function pickMachine(op: SchedOp, machines: SchedMachine[]): number | null {
  if (op.machineId) return op.machineId;
  const m = machines.find(x => x.operations.includes(op.operation)) ?? machines.find(x => machineDoes(x, op.operation));
  return m ? m.id : null;
}

/** Операција подолга од денот се протега на следните работни денови: [{ден, часови}]. */
export function spreadHours(start: string, hours: number, capPerDay: number): { date: string; hours: number }[] {
  const cap = capPerDay > 0 ? capPerDay : 8;
  const out: { date: string; hours: number }[] = [];
  let left = Math.max(0, hours), d = nextWorkday(start), guard = 0;
  do {
    const h = Math.min(cap, left);
    out.push({ date: d, hours: Math.round(h * 100) / 100 });
    left -= h;
    d = nextWorkday(addDays(d, 1));
  } while (left > 1e-9 && guard++ < 400);
  return out;
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
  const addLoad = (mid: number | null, segs: { date: string; hours: number }[]) => {
    for (const s of segs) load.set(key(mid, s.date), (load.get(key(mid, s.date)) ?? 0) + s.hours);
  };
  for (const o of p.ops) {
    if (o.locked && o.plannedDate) addLoad(o.machineId, spreadHours(o.plannedDate, o.hours, cap(o.machineId)));
  }
  const wos = [...p.wos].sort((a, b) =>
    (PRIO[a.priority] ?? 2) - (PRIO[b.priority] ?? 2) ||
    (a.plannedEnd ?? "9999").localeCompare(b.plannedEnd ?? "9999") ||
    a.createdAt.localeCompare(b.createdAt));
  const result: { opId: number; machineId: number | null; plannedDate: string; endDate: string; overloaded: boolean }[] = [];
  // часови по налог и ден: операциите на ист налог одат една по друга, па во еден ден не собираат повеќе од денот
  const woDay = new Map<string, number>();
  const dayLen = p.defaultHours ?? 8;
  const start = nextWorkday(p.from);
  for (const wo of wos) {
    const ops = p.ops.filter(o => o.workOrderId === wo.id).sort((a, b) => a.sequence - b.sequence);
    let earliest = start;
    for (const op of ops) {
      if (op.locked && op.plannedDate) {
        const segs = spreadHours(op.plannedDate, op.hours, cap(op.machineId));
        // закажана пред да заврши претходната операција на налогот -> се поместува (освен ако е започната)
        if (!op.started && op.plannedDate < earliest) {
          for (const sg of segs) load.set(key(op.machineId, sg.date), (load.get(key(op.machineId, sg.date)) ?? 0) - sg.hours);
        } else {
          const end = segs[segs.length - 1].date;
          for (const sg of segs) woDay.set(`${wo.id}|${sg.date}`, (woDay.get(`${wo.id}|${sg.date}`) ?? 0) + sg.hours);
          if (end > earliest) earliest = end;
          continue;
        }
      }
      const mid = pickMachine(op, p.machines);
      const c = cap(mid);
      const h = Math.max(0, op.hours || 0);
      let d = nextWorkday(earliest);
      let segs = spreadHours(d, h, c);
      let guard = 0;
      // прв почеток од кој сите денови на операцијата имаат доволно слободни часови
      while (guard++ < 730) {
        segs = spreadHours(d, h, c);
        const ok = segs.every(sg => {
          const used = load.get(key(mid, sg.date)) ?? 0;
          const woUsed = woDay.get(`${wo.id}|${sg.date}`) ?? 0;
          return used + sg.hours <= c + 1e-9 && (woUsed === 0 || woUsed + sg.hours <= dayLen + 1e-9);
        });
        if (ok) break;
        d = nextWorkday(addDays(d, 1));
      }
      addLoad(mid, segs);
      for (const sg of segs) woDay.set(`${wo.id}|${sg.date}`, (woDay.get(`${wo.id}|${sg.date}`) ?? 0) + sg.hours);
      const end = segs[segs.length - 1].date;
      result.push({ opId: op.id, machineId: mid, plannedDate: d, endDate: end, overloaded: false });
      earliest = end;
    }
  }
  return result;
}
