// Препознавање на димензии од името на материјалот → тежина по единица мера.
// Работи само врз имињата од каталогот; ништо не се погодува „од око“.

const RHO_STEEL = 7850; // кг/м³

export type ParseResult = {
  weightPerUnit: number;   // кг по единица мера на материјалот
  shape: string;           // што препознал (за приказ)
  dims: string;            // димензиите што ги прочитал
  confidence: "high" | "medium";
  note?: string;           // предупредување кога пресметката е приближна
};

// ── Нормализација: кирилично х → x, децимална запирка → точка ──────────────
function norm(s: string): string {
  return s
    .replace(/[хХ]/g, "x")
    .replace(/[Х]/g, "x")
    .replace(/(\d),(\d)/g, "$1.$2")
    .toLowerCase()
    .trim();
}

// Надворешен дијаметар на цевка според цолови (EN 10255 / DIN 2440)
const INCH_OD: Record<string, number> = {
  "0.25": 13.5,   // 1/4"
  "0.375": 17.2,  // 3/8"
  "0.5": 21.3,    // 1/2"
  "0.75": 26.9,   // 3/4"
  "1": 33.7,      // 1"
  "1.25": 42.4,   // 5/4"
  "1.5": 48.3,    // 6/4"
  "2": 60.3,      // 2"
  "2.5": 76.1,    // 5/2"
  "3": 88.9,      // 3"
  "4": 114.3,     // 4"
  "5": 139.7,     // 5"
  "6": 168.3,     // 6"
};

function inchToOd(text: string): { od: number; label: string } | null {
  // 3/8"  |  5/4"  |  1"  |  2"
  const frac = text.match(/(\d+)\s*\/\s*(\d+)\s*"/);
  if (frac) {
    const v = Number(frac[1]) / Number(frac[2]);
    const od = INCH_OD[String(Math.round(v * 1000) / 1000)];
    if (od) return { od, label: `${frac[1]}/${frac[2]}"` };
    return null;
  }
  const whole = text.match(/(?:^|[^\d/.])(\d+)\s*"/);
  if (whole) {
    const od = INCH_OD[whole[1]];
    if (od) return { od, label: `${whole[1]}"` };
  }
  return null;
}

// ── Геометриски формули: плоштина на пресек во mm² ─────────────────────────
const areaRoundBar = (d: number) => Math.PI * Math.pow(d / 2, 2);
const areaSquareBar = (a: number) => a * a;
const areaFlat = (b: number, t: number) => b * t;
const areaRectTube = (a: number, b: number, t: number) =>
  Math.max(0, a * b - Math.max(0, a - 2 * t) * Math.max(0, b - 2 * t));
const areaRoundTube = (d: number, t: number) => Math.PI * t * Math.max(0, d - t);
const areaAngle = (a: number, b: number, t: number) => Math.max(0, t * (a + b - t));

const kgPerM = (areaMm2: number) => Math.round((areaMm2 / 1e6) * RHO_STEEL * 10000) / 10000;

// Сите броеви во низа (по нормализација)
function nums(s: string): number[] {
  return (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/**
 * Обид за препознавање. Враќа null ако името не е доволно јасно —
 * подобро ништо отколку погрешна бројка.
 */
export function parseWeightFromName(
  rawName: string,
  unit: string
): ParseResult | null {
  const n = norm(rawName);

  // Материјалот се води во кг → тежината по единица е секогаш 1
  if (unit === "kg") {
    return { weightPerUnit: 1, shape: "Се води во килограми", dims: "—", confidence: "high" };
  }

  const isPerMeter = unit === "m";
  const isPerPiece = unit === "pcs" || unit === "sheet";
  const isPerM2 = unit === "m2";

  // ══════ ЛИМ ══════ (дебелина x ширина x должина)
  if (/лим/.test(n)) {
    const isRifel = /рифел/.test(n);
    const v = nums(n.replace(/\d+\s*x\s*\d+\s*\)/g, "")); // отфрли „(50x20)“ шеми
    // очекуваме барем 3 броја: t, W, L
    const triple = n.match(/(\d+(?:\.\d+)?)\s*x\s*(\d{3,4})\s*x\s*(\d{3,4})/);
    if (triple) {
      const t = Number(triple[1]);
      const w = Number(triple[2]);
      const l = Number(triple[3]);
      if (t > 0 && t < 60 && w > 0 && l > 0) {
        if (isPerPiece) {
          const kg = Math.round(((t * w * l) / 1e9) * RHO_STEEL * 10000) / 10000;
          return {
            weightPerUnit: kg,
            shape: isRifel ? "Рифел лим — цела табла" : "Лим — цела табла",
            dims: `${t}×${w}×${l} mm`,
            confidence: isRifel ? "medium" : "high",
            note: isRifel ? "Ребрата додаваат тежина преку теоретската — провери со фактура." : undefined,
          };
        }
        if (isPerM2) {
          const kg = Math.round((t / 1000) * RHO_STEEL * 10000) / 10000;
          return {
            weightPerUnit: kg,
            shape: isRifel ? "Рифел лим — по m²" : "Лим — по m²",
            dims: `дебелина ${t} mm`,
            confidence: isRifel ? "medium" : "high",
            note: isRifel ? "Ребрата додаваат тежина преку теоретската." : undefined,
          };
        }
      }
    }
    // лим по m² каде во името стои само дебелина
    if (isPerM2 && v.length >= 1 && v[0] > 0 && v[0] < 60) {
      const kg = Math.round((v[0] / 1000) * RHO_STEEL * 10000) / 10000;
      return {
        weightPerUnit: kg, shape: "Лим — по m²",
        dims: `дебелина ${v[0]} mm`, confidence: "medium",
        note: "Дебелината е прочитана како прв број во името — провери.",
      };
    }
    return null;
  }

  if (!isPerMeter) return null; // сè што следи има смисла само по метар

  // ══════ ЦЕВКА ══════
  if (/цевка/.test(n)) {
    // фи 42 x 2
    const fi = n.match(/(?:фи|ф|ø)\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/);
    if (fi) {
      const d = Number(fi[1]), t = Number(fi[2]);
      if (d > t && t > 0) {
        return {
          weightPerUnit: kgPerM(areaRoundTube(d, t)),
          shape: "Тркалезна цевка", dims: `Ø${d}×${t} mm`, confidence: "high",
        };
      }
    }
    // цолови: 3/8"x1.2
    const inch = inchToOd(n);
    if (inch) {
      const after = n.split('"')[1] ?? "";
      const wallM = after.match(/x\s*(\d+(?:\.\d+)?)/);
      if (wallM) {
        const t = Number(wallM[1]);
        if (t > 0 && t < inch.od / 2) {
          return {
            weightPerUnit: kgPerM(areaRoundTube(inch.od, t)),
            shape: "Тркалезна цевка (цолна)",
            dims: `${inch.label} (Ø${inch.od}) ×${t} mm`,
            confidence: "high",
          };
        }
      }
      return null; // цол без дебелина — не погодувам
    }
    return null;
  }

  // ══════ ВИНКЛА (аголник) ══════
  if (/винкла|аголник/.test(n)) {
    const v = nums(n);
    if (v.length >= 3) {
      const [a, b, t] = v;
      if (a > 0 && b > 0 && t > 0 && t < Math.min(a, b)) {
        return {
          weightPerUnit: kgPerM(areaAngle(a, b, t)),
          shape: "Аголник L", dims: `${a}×${b}×${t} mm`, confidence: "high",
        };
      }
    }
    return null;
  }

  // ══════ ПРАВОАГОЛЕН / КВАДРАТЕН ПРОФИЛ (кутија) ══════
  if (/правоаголен профил|квадратен профил|кутија/.test(n)) {
    const v = nums(n);
    if (v.length >= 3) {
      const [a, b, t] = v;
      if (a > 0 && b > 0 && t > 0 && t < Math.min(a, b) / 2) {
        return {
          weightPerUnit: kgPerM(areaRectTube(a, b, t)),
          shape: /квадратен/.test(n) ? "Квадратна кутија" : "Правоаголна кутија",
          dims: `${a}×${b}×${t} mm`, confidence: "high",
        };
      }
    }
    return null;
  }

  // ══════ АРМАТУРА / ТРКАЛЕЗНО ЖЕЛЕЗО ══════
  if (/арматура|(?:^|\s)фи\s*\d/.test(n) && !/цевка/.test(n)) {
    const m = n.match(/(?:фи|ф|ø)\s*(\d+(?:\.\d+)?)/);
    if (m) {
      const d = Number(m[1]);
      if (d > 0 && d < 200) {
        return {
          weightPerUnit: kgPerM(areaRoundBar(d)),
          shape: "Тркалезна прачка (арматура)", dims: `Ø${d} mm`, confidence: "high",
        };
      }
    }
    return null;
  }

  // ══════ КВАДРАТНО ЖЕЛЕЗО (полн пресек) ══════
  if (/квадратно железо/.test(n)) {
    const v = nums(n);
    if (v.length >= 1) {
      const a = v[0];
      if (a > 0 && a < 200) {
        return {
          weightPerUnit: kgPerM(areaSquareBar(a)),
          shape: "Квадратна прачка", dims: `${a}×${a} mm`, confidence: "high",
        };
      }
    }
    return null;
  }

  // ══════ ТРАКА / ПЛОСНАТО ══════
  if (/трака|плоснат|флах/.test(n)) {
    const v = nums(n);
    if (v.length >= 2) {
      const [b, t] = v;
      if (b > 0 && t > 0 && t <= b) {
        return {
          weightPerUnit: kgPerM(areaFlat(b, t)),
          shape: "Плоснато железо", dims: `${b}×${t} mm`, confidence: "high",
        };
      }
    }
    return null;
  }

  // Сè друго (ЗП профил, мрежи, жица, истегнат метал) — рачно.
  return null;
}
