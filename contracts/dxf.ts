// DXF (ASCII) → геометрија за калкулација на ласерско/плазма сечење.
// Се читаат: LINE, ARC, CIRCLE, LWPOLYLINE (со bulge), POLYLINE/VERTEX, SPLINE, ELLIPSE и INSERT (блокови).
// Текст, коти и шрафури не се сечат и се прескокнуваат. Сè се враќа во милиметри.
//
// Резултат: должина на сечење, број на пробивања (затворени контури + отворени патеки), нето површина
// (надворешна контура минус отвори), габарит. Од нив се пресметува време, тежина и цена.

export type Pt = { x: number; y: number };
export type Path = { pts: Pt[]; closed: boolean; length: number; layer: string };
export type DxfResult = {
  units: string;
  scale: number; // множител до mm
  paths: Path[];
  layers: { name: string; length: number; count: number }[];
  skipped: Record<string, number>;
  warnings: string[];
};
export type DxfStats = {
  cutLength: number; // mm
  pierces: number;
  closedContours: number;
  openPaths: number;
  netArea: number; // mm²
  bbox: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
};

const UNITS: Record<number, [string, number]> = {
  0: ["без единица (се зема mm)", 1], 1: ["инчи", 25.4], 2: ["стапки", 304.8], 4: ["mm", 1], 5: ["cm", 10], 6: ["m", 1000], 14: ["dm", 100],
};

type Pair = [number, string];
function pairs(text: string): Pair[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const c = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(c)) { i -= 1; continue; } // празен ред — порамни
    out.push([c, lines[i + 1].trim()]);
  }
  return out;
}

type Ent = { type: string; layer: string; g: Map<number, string[]> };
const num = (e: Ent, c: number, d = 0) => { const v = e.g.get(c)?.[0]; const n = v === undefined ? NaN : parseFloat(v); return Number.isFinite(n) ? n : d; };
const nums = (e: Ent, c: number) => (e.g.get(c) ?? []).map(parseFloat);

/** Ентитети од листа на парови (до ENDSEC/ENDBLK). VERTEX/SEQEND се врзуваат за POLYLINE. */
function readEntities(p: Pair[], start: number, endMarks: string[]): { ents: (Ent & { vertices?: Ent[]; order?: Pair[] })[]; next: number } {
  const ents: (Ent & { vertices?: Ent[]; order?: Pair[] })[] = [];
  let i = start;
  let cur: (Ent & { vertices?: Ent[]; order?: Pair[] }) | null = null;
  let poly: (Ent & { vertices?: Ent[] }) | null = null;
  for (; i < p.length; i++) {
    const [c, v] = p[i];
    if (c === 0) {
      if (endMarks.includes(v)) break;
      const e = { type: v, layer: "0", g: new Map<number, string[]>(), order: [] as Pair[] };
      if (v === "VERTEX" && poly) { poly.vertices!.push(e); cur = e; continue; }
      if (v === "SEQEND") { poly = null; cur = null; continue; }
      if (v === "POLYLINE") { (e as any).vertices = []; poly = e; }
      ents.push(e); cur = e;
      continue;
    }
    if (!cur) continue;
    if (c === 8) cur.layer = v;
    const arr = cur.g.get(c); if (arr) arr.push(v); else cur.g.set(c, [v]);
    cur.order?.push([c, v]);
  }
  return { ents, next: i };
}

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const polyLen = (pts: Pt[], closed: boolean) => { let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); if (closed && pts.length > 1) s += dist(pts[pts.length - 1], pts[0]); return s; };

/** Лак како точки (агли во радијани, спротивно од стрелките на часовникот). */
function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, ccw = true): Pt[] {
  let sweep = ccw ? a1 - a0 : a0 - a1;
  while (sweep <= 1e-9) sweep += 2 * Math.PI;
  const n = Math.max(4, Math.ceil(sweep / (Math.PI / 36)) + Math.ceil(r / 50)); // ~5° или погусто за големи
  const out: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + (ccw ? 1 : -1) * sweep * (k / n);
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

/** Сегмент со bulge (LWPOLYLINE/POLYLINE): точки и точна должина. */
function bulgeSeg(a: Pt, b: Pt, bulge: number): { pts: Pt[]; len: number } {
  if (Math.abs(bulge) < 1e-9) return { pts: [b], len: dist(a, b) };
  const chord = dist(a, b);
  const theta = 4 * Math.atan(bulge); // централен агол, со знак
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const d = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
  const ux = (b.x - a.x) / chord, uy = (b.y - a.y) / chord;
  // центарот е лево од тетивата за позитивен bulge (лак спротивно од часовникот) кога |θ|<π
  const sgn = (bulge > 0 ? 1 : -1) * (Math.abs(theta) > Math.PI ? -1 : 1);
  const cx = mx - uy * d * sgn, cy = my + ux * d * sgn;
  const a0 = Math.atan2(a.y - cy, a.x - cx), a1 = Math.atan2(b.y - cy, b.x - cx);
  const pts = arcPts(cx, cy, r, a0, a1, bulge > 0).slice(1);
  pts[pts.length - 1] = b;
  return { pts, len: r * Math.abs(theta) };
}

function polyWithBulges(verts: Pt[], bulges: number[], closed: boolean): { pts: Pt[]; len: number } {
  if (!verts.length) return { pts: [], len: 0 };
  const pts: Pt[] = [verts[0]];
  let len = 0;
  const n = verts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    const s = bulgeSeg(a, b, bulges[i] ?? 0);
    pts.push(...s.pts); len += s.len;
  }
  if (closed && pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < 1e-6) pts.pop();
  return { pts, len };
}

/** Мазна крива низ точките (Catmull-Rom) — за сплајн зададен само со точки низ кои минува. */
function throughPts(fit: Pt[]): Pt[] {
  if (fit.length < 3) return fit;
  const out: Pt[] = [fit[0]];
  for (let i = 0; i < fit.length - 1; i++) {
    const p0 = fit[Math.max(0, i - 1)], p1 = fit[i], p2 = fit[i + 1], p3 = fit[Math.min(fit.length - 1, i + 2)];
    for (let s = 1; s <= 12; s++) {
      const t = s / 12, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  return out;
}

/** B-сплајн (de Boor) со дадени јазли; без јазли — мазна крива низ точките. */
function splinePts(ctrl: Pt[], knots: number[], degree: number, fit: Pt[]): Pt[] {
  if (ctrl.length < 2) return fit.length >= 2 ? throughPts(fit) : ctrl;
  const k = Math.max(1, Math.min(degree || 3, ctrl.length - 1));
  if (knots.length !== ctrl.length + k + 1) return fit.length >= 2 ? throughPts(fit) : ctrl;
  const lo = knots[k], hi = knots[knots.length - k - 1];
  const N = Math.max(16, ctrl.length * 12);
  const out: Pt[] = [];
  for (let s = 0; s <= N; s++) {
    const t = lo + (hi - lo) * (s / N) - (s === N ? 1e-9 : 0);
    let span = k;
    while (span < ctrl.length - 1 && knots[span + 1] <= t) span++;
    const d = Array.from({ length: k + 1 }, (_, j) => ({ ...ctrl[span - k + j] }));
    for (let r = 1; r <= k; r++) {
      for (let j = k; j >= r; j--) {
        const i = span - k + j;
        const den = knots[i + k + 1 - r] - knots[i];
        const alpha = den === 0 ? 0 : (t - knots[i]) / den;
        d[j] = { x: (1 - alpha) * d[j - 1].x + alpha * d[j].x, y: (1 - alpha) * d[j - 1].y + alpha * d[j].y };
      }
    }
    out.push(d[k]);
  }
  return out;
}

type Xf = { tx: number; ty: number; sx: number; sy: number; rot: number };
const ID: Xf = { tx: 0, ty: 0, sx: 1, sy: 1, rot: 0 };
const apply = (p: Pt, f: Xf): Pt => {
  const x = p.x * f.sx, y = p.y * f.sy, c = Math.cos(f.rot), s = Math.sin(f.rot);
  return { x: x * c - y * s + f.tx, y: x * s + y * c + f.ty };
};

export function parseDxf(text: string): DxfResult {
  if (/^AutoCAD Binary DXF/.test(text.slice(0, 22))) throw new Error("Бинарен DXF не е поддржан — зачувај го цртежот како ASCII DXF");
  const p = pairs(text);
  if (!p.some(([c, v]) => c === 0 && v === "SECTION")) throw new Error("Датотеката не е DXF цртеж");
  const warnings: string[] = [];
  // заглавие: единици
  let insUnits = 0;
  for (let i = 0; i < p.length - 1; i++) if (p[i][0] === 9 && p[i][1] === "$INSUNITS") { insUnits = parseInt(p[i + 1][1], 10) || 0; break; }
  const [unitName, scale] = UNITS[insUnits] ?? ["непознати (се зема mm)", 1];
  // блокови и ентитети
  const blocks = new Map<string, { base: Pt; ents: any[] }>();
  let entities: any[] = [];
  for (let i = 0; i < p.length; i++) {
    if (p[i][0] === 0 && p[i][1] === "SECTION" && p[i + 1]?.[0] === 2) {
      const name = p[i + 1][1];
      if (name === "ENTITIES") { const r = readEntities(p, i + 2, ["ENDSEC"]); entities = r.ents; i = r.next; }
      else if (name === "BLOCKS") {
        let j = i + 2;
        while (j < p.length && !(p[j][0] === 0 && p[j][1] === "ENDSEC")) {
          if (p[j][0] === 0 && p[j][1] === "BLOCK") {
            let bname = "", bx = 0, by = 0, k = j + 1;
            for (; k < p.length && p[k][0] !== 0; k++) { if (p[k][0] === 2) bname = p[k][1]; if (p[k][0] === 10) bx = parseFloat(p[k][1]); if (p[k][0] === 20) by = parseFloat(p[k][1]); }
            const r = readEntities(p, k, ["ENDBLK"]);
            blocks.set(bname, { base: { x: bx, y: by }, ents: r.ents });
            j = r.next + 1;
          } else j++;
        }
        i = j;
      }
    }
  }
  const paths: Path[] = [];
  const skipped: Record<string, number> = {};
  const S: Xf = { ...ID, sx: scale, sy: scale };

  let uniform = true; // нееднакво скалиран блок: должината се мери од точките
  const emit = (pts: Pt[], closed: boolean, layer: string, tf: (p: Pt) => Pt, exactLen?: number) => {
    if (pts.length < 2 && !(closed && pts.length >= 1)) return;
    const tp = pts.map(tf);
    // точната должина важи само при еднакво скалирање; инаку од точките
    const len = exactLen !== undefined && uniform ? exactLen : polyLen(tp, closed);
    paths.push({ pts: tp, closed, length: len, layer });
  };

  const walk = (ents: any[], tf: (p: Pt) => Pt, k: number, depth: number, layerOverride?: string) => {
    for (const e of ents as (Ent & { vertices?: Ent[]; order?: Pair[] })[]) {
      const layer = e.layer === "0" && layerOverride ? layerOverride : e.layer;
      switch (e.type) {
        case "LINE": emit([{ x: num(e, 10), y: num(e, 20) }, { x: num(e, 11), y: num(e, 21) }], false, layer, tf, dist({ x: num(e, 10), y: num(e, 20) }, { x: num(e, 11), y: num(e, 21) }) * k); break;
        case "CIRCLE": { const r = num(e, 40); emit(arcPts(num(e, 10), num(e, 20), r, 0, 2 * Math.PI).slice(0, -1), true, layer, tf, 2 * Math.PI * r * k); break; }
        case "ARC": {
          const r = num(e, 40), a0 = num(e, 50) * Math.PI / 180, a1 = num(e, 51) * Math.PI / 180;
          let sw = a1 - a0; while (sw <= 0) sw += 2 * Math.PI;
          // ако е огледално (отрицателно скалирање во блокот), насоката се менува, должината не
          emit(arcPts(num(e, 10), num(e, 20), r, a0, a1), false, layer, tf, r * sw * k); break;
        }
        case "LWPOLYLINE": {
          const closed = (num(e, 70) & 1) === 1;
          // bulge (42) припаѓа на темето пред него — по редослед
          const verts: Pt[] = [], bul: number[] = [];
          let cx: number | null = null;
          for (const [c, v] of e.order ?? []) {
            if (c === 10) { cx = parseFloat(v); }
            else if (c === 20 && cx !== null) { verts.push({ x: cx, y: parseFloat(v) }); bul.push(0); cx = null; }
            else if (c === 42 && verts.length) bul[verts.length - 1] = parseFloat(v);
          }
          const r = polyWithBulges(verts, bul, closed);
          emit(r.pts, closed, layer, tf, r.len * k); break;
        }
        case "POLYLINE": {
          const flags = num(e, 70);
          if (flags & (16 | 64)) { skipped["3D мрежа"] = (skipped["3D мрежа"] ?? 0) + 1; break; }
          const vs = (e.vertices ?? []).filter((v) => !(num(v, 70) & 16)); // без контролни точки на изгладување
          const r = polyWithBulges(vs.map((v) => ({ x: num(v, 10), y: num(v, 20) })), vs.map((v) => num(v, 42)), (flags & 1) === 1);
          emit(r.pts, (flags & 1) === 1, layer, tf, r.len * k); break;
        }
        case "SPLINE": {
          const xs = nums(e, 10), ys = nums(e, 20), fx = nums(e, 11), fy = nums(e, 21);
          const ctrl = xs.map((x, i) => ({ x, y: ys[i] ?? 0 })), fit = fx.map((x, i) => ({ x, y: fy[i] ?? 0 }));
          const pts = splinePts(ctrl, nums(e, 40), num(e, 71, 3), fit);
          const closed = (num(e, 70) & 1) === 1 || (pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < 1e-6);
          emit(closed && dist(pts[0], pts[pts.length - 1]) < 1e-6 ? pts.slice(0, -1) : pts, closed, layer, tf); break;
        }
        case "ELLIPSE": {
          const cx = num(e, 10), cy = num(e, 20), mx = num(e, 11), my = num(e, 21), ratio = num(e, 40, 1);
          let t0 = num(e, 41, 0), t1 = num(e, 42, 2 * Math.PI);
          const full = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-6 || (t0 === 0 && t1 === 0);
          if (full) { t0 = 0; t1 = 2 * Math.PI; }
          while (t1 <= t0) t1 += 2 * Math.PI;
          const a = Math.hypot(mx, my), rot = Math.atan2(my, mx), b = a * ratio;
          const n = Math.max(24, Math.ceil((t1 - t0) / (Math.PI / 72)));
          const pts: Pt[] = [];
          for (let s = 0; s <= n; s++) {
            const t = t0 + (t1 - t0) * (s / n);
            const x = a * Math.cos(t), y = b * Math.sin(t);
            pts.push({ x: cx + x * Math.cos(rot) - y * Math.sin(rot), y: cy + x * Math.sin(rot) + y * Math.cos(rot) });
          }
          emit(full ? pts.slice(0, -1) : pts, full, layer, tf); break;
        }
        case "INSERT": {
          const b = blocks.get(e.g.get(2)?.[0] ?? "");
          if (!b) { skipped["непознат блок"] = (skipped["непознат блок"] ?? 0) + 1; break; }
          if (depth > 6) { warnings.push("Блоковите се вгнездени предлабоко — дел се прескокнати"); break; }
          const sx = num(e, 41, 1), sy = num(e, 42, 1), rot = num(e, 50, 0) * Math.PI / 180;
          const cols = Math.max(1, num(e, 70, 1)), rows = Math.max(1, num(e, 71, 1)), dc = num(e, 44, 0), dr = num(e, 45, 0);
          for (let ci = 0; ci < cols; ci++) for (let ri = 0; ri < rows; ri++) {
            const inner: Xf = { tx: num(e, 10) + ci * dc, ty: num(e, 20) + ri * dr, sx, sy, rot };
            const base = b.base;
            const f = (q: Pt) => tf(apply({ x: q.x - base.x, y: q.y - base.y }, inner));
            const prev = uniform;
            if (Math.abs(Math.abs(sx) - Math.abs(sy)) > 1e-9) uniform = false;
            walk(b.ents, f, k * Math.abs(sx), depth + 1, layer);
            uniform = prev;
          }
          break;
        }
        case "TEXT": case "MTEXT": case "DIMENSION": case "HATCH": case "POINT": case "ATTDEF": case "ATTRIB": case "LEADER": case "SOLID": case "VIEWPORT": case "IMAGE": case "WIPEOUT":
          skipped[e.type] = (skipped[e.type] ?? 0) + 1; break;
        default:
          skipped[e.type] = (skipped[e.type] ?? 0) + 1;
      }
    }
  };
  walk(entities, (q) => apply(q, S), scale, 0);
  if (!paths.length) warnings.push("Во цртежот нема линии за сечење");
  const lm = new Map<string, { length: number; count: number }>();
  for (const pth of paths) { const g = lm.get(pth.layer) ?? { length: 0, count: 0 }; g.length += pth.length; g.count++; lm.set(pth.layer, g); }
  return { units: unitName, scale, paths, layers: [...lm].map(([name, g]) => ({ name, ...g })).sort((a, b) => b.length - a.length), skipped, warnings };
}

// ───────────── контури, површина, габарит ─────────────

const area = (pts: Pt[]) => { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.y - b.x * a.y; } return s / 2; };
function inside(p: Pt, poly: Pt[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** Отворените патеки што се допираат на краевите се спојуваат во контури (цртежи од поединечни линии и лакови). */
export function chainPaths(paths: Path[], tol = 0.05): Path[] {
  const closed = paths.filter((p) => p.closed);
  const open = paths.filter((p) => !p.closed).map((p) => ({ ...p, pts: [...p.pts] }));
  const out: Path[] = [...closed];
  const used = new Array(open.length).fill(false);
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const chain = { ...open[i], pts: [...open[i].pts] };
    let grew = true;
    while (grew) {
      grew = false;
      const head = chain.pts[0], tail = chain.pts[chain.pts.length - 1];
      if (dist(head, tail) <= tol && chain.pts.length > 2) break;
      for (let j = 0; j < open.length; j++) {
        if (used[j]) continue;
        const q = open[j], qa = q.pts[0], qb = q.pts[q.pts.length - 1];
        if (dist(tail, qa) <= tol) { chain.pts.push(...q.pts.slice(1)); }
        else if (dist(tail, qb) <= tol) { chain.pts.push(...[...q.pts].reverse().slice(1)); }
        else if (dist(head, qb) <= tol) { chain.pts.unshift(...q.pts.slice(0, -1)); }
        else if (dist(head, qa) <= tol) { chain.pts.unshift(...[...q.pts].reverse().slice(0, -1)); }
        else continue;
        chain.length += q.length; used[j] = true; grew = true; break;
      }
    }
    const isClosed = chain.pts.length > 2 && dist(chain.pts[0], chain.pts[chain.pts.length - 1]) <= tol;
    if (isClosed) chain.pts.pop();
    out.push({ ...chain, closed: isClosed });
  }
  return out;
}

export function dxfStats(paths: Path[]): DxfStats {
  const chained = chainPaths(paths);
  const closed = chained.filter((p) => p.closed && p.pts.length >= 3);
  const open = chained.filter((p) => !p.closed || p.pts.length < 3);
  // нето површина: парност на вгнездување (надворешна +, отвор −, остров во отвор + ...)
  let net = 0;
  for (const c of closed) {
    const a = Math.abs(area(c.pts));
    const probe = c.pts[0];
    const depth = closed.filter((o) => o !== c && Math.abs(area(o.pts)) > a && inside(probe, o.pts)).length;
    net += depth % 2 === 0 ? a : -a;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths) for (const q of p.pts) { if (q.x < minX) minX = q.x; if (q.y < minY) minY = q.y; if (q.x > maxX) maxX = q.x; if (q.y > maxY) maxY = q.y; }
  if (!Number.isFinite(minX)) { minX = minY = maxX = maxY = 0; }
  return {
    cutLength: paths.reduce((s, p) => s + p.length, 0),
    pierces: closed.length + open.length,
    closedContours: closed.length,
    openPaths: open.length,
    netArea: Math.max(0, net),
    bbox: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY },
  };
}

// ───────────── калкулација ─────────────

/** Типична брзина на фибер ласер за црн челик (m/min) по дебелина (mm) — почетен предлог, се менува по машина. */
export const DEFAULT_CUT_TABLE: { t: number; speed: number; pierce: number }[] = [
  { t: 1, speed: 20, pierce: 0.2 }, { t: 2, speed: 10, pierce: 0.3 }, { t: 3, speed: 6, pierce: 0.5 }, { t: 4, speed: 4.5, pierce: 0.7 },
  { t: 5, speed: 3.5, pierce: 1 }, { t: 6, speed: 2.8, pierce: 1.2 }, { t: 8, speed: 1.9, pierce: 1.8 }, { t: 10, speed: 1.3, pierce: 2.5 },
  { t: 12, speed: 1, pierce: 3 }, { t: 15, speed: 0.75, pierce: 4 }, { t: 20, speed: 0.5, pierce: 6 },
];

/** Брзина и пробивање за дебелина (линеарно меѓу редовите од табелата). */
export function cutParamsFor(thickness: number, table = DEFAULT_CUT_TABLE) {
  const t = [...table].sort((a, b) => a.t - b.t);
  if (!t.length) return { speed: 1, pierce: 1 };
  if (thickness <= t[0].t) return { speed: t[0].speed, pierce: t[0].pierce };
  for (let i = 1; i < t.length; i++) if (thickness <= t[i].t) {
    const f = (thickness - t[i - 1].t) / (t[i].t - t[i - 1].t);
    return { speed: t[i - 1].speed + f * (t[i].speed - t[i - 1].speed), pierce: t[i - 1].pierce + f * (t[i].pierce - t[i - 1].pierce) };
  }
  return { speed: t[t.length - 1].speed, pierce: t[t.length - 1].pierce };
}

export type CalcInput = {
  stats: DxfStats; quantity: number; thickness: number; density: number; // kg/dm³ (челик 7.85)
  speed: number; pierceSec: number; machinePerHour: number; machinePerMeter: number;
  pricePerKg: number; materialBasis: "net" | "bbox"; margin: number; // кг од нето површина или од габаритот (+рабови)
  edge: number; // додаток околу габаритот, mm
  setupMin?: number; // подготовка на машината за целата нарачка, минути
};
export function calcCutting(i: CalcInput) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const cutM = i.stats.cutLength / 1000;
  const cutMin = i.speed > 0 ? cutM / i.speed : 0;
  const pierceMin = (i.stats.pierces * i.pierceSec) / 60;
  const minutes = cutMin + pierceMin; // по парче
  const areaDm2 = i.materialBasis === "net"
    ? i.stats.netArea / 10_000
    : ((i.stats.bbox.width + 2 * i.edge) * (i.stats.bbox.height + 2 * i.edge)) / 10_000;
  const kg = areaDm2 * (i.thickness / 100) * i.density; // dm² × dm × kg/dm³
  const netKg = (i.stats.netArea / 10_000) * (i.thickness / 100) * i.density;
  const machine = (minutes / 60) * i.machinePerHour + cutM * i.machinePerMeter;
  const setup = ((i.setupMin ?? 0) / 60) * i.machinePerHour / Math.max(1, i.quantity);
  const material = kg * i.pricePerKg;
  const unitCost = machine + setup + material;
  const unitPrice = unitCost * (1 + i.margin / 100);
  return {
    cutM: r2(cutM), minutes: Math.round(minutes * 100) / 100, kg: Math.round(kg * 1000) / 1000, netKg: Math.round(netKg * 1000) / 1000,
    machine: r2(machine + setup), material: r2(material), unitCost: r2(unitCost), unitPrice: r2(unitPrice),
    totalMinutes: Math.round((minutes * i.quantity + (i.setupMin ?? 0)) * 10) / 10, totalCost: r2(unitCost * i.quantity), totalPrice: r2(unitPrice * i.quantity),
  };
}

/** SVG преглед (y нагоре како во CAD). */
export function dxfSvg(paths: Path[], bbox: DxfStats["bbox"], hiddenLayers: Set<string> = new Set()): string {
  const pad = Math.max(bbox.width, bbox.height) * 0.03 || 1;
  const vb = `${bbox.minX - pad} ${-(bbox.maxY + pad)} ${bbox.width + 2 * pad} ${bbox.height + 2 * pad}`;
  const sw = Math.max(bbox.width, bbox.height) / 400 || 0.5;
  const d = paths.filter((p) => !hiddenLayers.has(p.layer)).map((p) => `M${p.pts.map((q) => `${q.x.toFixed(2)} ${(-q.y).toFixed(2)}`).join("L")}${p.closed ? "Z" : ""}`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet"><path d="${d}" fill="none" stroke="currentColor" stroke-width="${sw.toFixed(3)}" stroke-linejoin="round"/></svg>`;
}
