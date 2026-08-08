// Препознавање на димензии од името на материјалот → тежина по единица мера.
// Сите формули и густини доаѓаат од @contracts/weight-geometry — тука само парсирање.

import {
  DENSITIES, detectDensity, INCH_OD,
  areaRoundBar, areaSquareBar, areaFlat, areaRectTube, areaRoundTube, areaAngle,
  kgPerMeter, kgPerSquareMeter, kgPerSheet,
  type DensityKey,
} from "@contracts/weight-geometry";

export type ParseResult = {
  weightPerUnit: number;
  shape: string;
  dims: string;
  confidence: "high" | "medium";
  material: string;
  materialKey: DensityKey;
  materialExplicit: boolean;   // не е челик
  materialFromField: boolean;  // избран во картонот, не погоден од името
  note?: string;
};

// ── Нормализација: кирилично х → x, децимална запирка → точка ──────────────
function norm(s: string): string {
  return s
    .replace(/[хХ]/g, "x")
    .replace(/(\d),(\d)/g, "$1.$2")
    .toLowerCase()
    .trim();
}

function inchToOd(text: string): { od: number; label: string } | null {
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

function nums(s: string): number[] {
  return (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/**
 * Обид за препознавање. Враќа null ако името не е доволно јасно —
 * подобро ништо отколку погрешна бројка.
 */
export function parseWeightFromName(
  rawName: string,
  unit: string,
  densityKeyOverride?: string | null
): ParseResult | null {
  const n = norm(rawName);

  if (unit === "kg") {
    return {
      weightPerUnit: 1, shape: "Се води во килограми", dims: "—",
      confidence: "high", material: "—", materialKey: "steel",
      materialExplicit: false, materialFromField: false,
    };
  }

  // ── Кој материјал е? ──
  // Предност има полето на самиот материјал; името се користи само како резерва.
  const override =
    densityKeyOverride && DENSITIES[densityKeyOverride]
      ? { key: densityKeyOverride as DensityKey, explicit: true, fromField: true }
      : null;
  const det = override ?? { ...detectDensity(rawName), fromField: false };
  const rho = DENSITIES[det.key].value;
  const matLabel = DENSITIES[det.key].label;

  const nonSteel = det.key !== "steel";
  // Ако материјалот е избран во картонот — тоа е одлука на човек, не погодување.
  const needsCheck = nonSteel && !det.fromField;
  const baseConfidence: "high" | "medium" = needsCheck ? "medium" : "high";
  const baseNote = needsCheck
    ? `Погоден од името како ${matLabel.toLowerCase()} (${rho} кг/м³) — потврди пред запишување.`
    : undefined;

  const ok = (
    r: Omit<ParseResult, "material" | "materialKey" | "materialExplicit" | "materialFromField">
  ): ParseResult => ({
    ...r,
    confidence: r.confidence === "medium" ? "medium" : baseConfidence,
    note: r.note ?? baseNote,
    material: matLabel,
    materialKey: det.key,
    materialExplicit: nonSteel,
    materialFromField: det.fromField,
  });

  const isPerMeter = unit === "m";
  const isPerPiece = unit === "pcs" || unit === "sheet";
  const isPerM2 = unit === "m2";

  // ══════ ЛИМ ══════
  if (/лим/.test(n)) {
    const isRifel = /рифел/.test(n);
    const triple = n.match(/(\d+(?:\.\d+)?)\s*x\s*(\d{3,4})\s*x\s*(\d{3,4})/);
    if (triple) {
      const t = Number(triple[1]), w = Number(triple[2]), l = Number(triple[3]);
      if (t > 0 && t < 60 && w > 0 && l > 0) {
        if (isPerPiece) {
          return ok({
            weightPerUnit: kgPerSheet(t, w, l, rho),
            shape: isRifel ? "Рифел лим — цела табла" : "Лим — цела табла",
            dims: `${t}×${w}×${l} mm`,
            confidence: isRifel ? "medium" : "high",
            note: isRifel
              ? "Ребрата додаваат тежина преку теоретската — провери со фактура."
              : baseNote,
          });
        }
        if (isPerM2) {
          return ok({
            weightPerUnit: kgPerSquareMeter(t, rho),
            shape: isRifel ? "Рифел лим — по m²" : "Лим — по m²",
            dims: `дебелина ${t} mm`,
            confidence: isRifel ? "medium" : "high",
            note: isRifel ? "Ребрата додаваат тежина преку теоретската." : baseNote,
          });
        }
      }
    }
    if (isPerM2) {
      const v = nums(n);
      if (v.length >= 1 && v[0] > 0 && v[0] < 60) {
        return ok({
          weightPerUnit: kgPerSquareMeter(v[0], rho),
          shape: "Лим — по m²", dims: `дебелина ${v[0]} mm`,
          confidence: "medium",
          note: "Дебелината е прочитана како прв број во името — провери.",
        });
      }
    }
    return null;
  }

  if (!isPerMeter) return null;

  // ══════ ЦЕВКА ══════
  if (/цевка/.test(n)) {
    const fi = n.match(/(?:фи|ф|ø)\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/);
    if (fi) {
      const d = Number(fi[1]), t = Number(fi[2]);
      if (d > t && t > 0) {
        return ok({
          weightPerUnit: kgPerMeter(areaRoundTube(d, t), rho),
          shape: "Тркалезна цевка", dims: `Ø${d}×${t} mm`, confidence: "high",
        });
      }
    }
    const inch = inchToOd(n);
    if (inch) {
      const after = n.split('"')[1] ?? "";
      const wallM = after.match(/x\s*(\d+(?:\.\d+)?)/);
      if (wallM) {
        const t = Number(wallM[1]);
        if (t > 0 && t < inch.od / 2) {
          return ok({
            weightPerUnit: kgPerMeter(areaRoundTube(inch.od, t), rho),
            shape: "Тркалезна цевка (цолна)",
            dims: `${inch.label} (Ø${inch.od}) ×${t} mm`, confidence: "high",
          });
        }
      }
      return null;
    }
    return null;
  }

  // ══════ ВИНКЛА ══════
  if (/винкла|аголник/.test(n)) {
    const v = nums(n);
    if (v.length >= 3) {
      const [a, b, t] = v;
      if (a > 0 && b > 0 && t > 0 && t < Math.min(a, b)) {
        return ok({
          weightPerUnit: kgPerMeter(areaAngle(a, b, t), rho),
          shape: "Аголник L", dims: `${a}×${b}×${t} mm`, confidence: "high",
        });
      }
    }
    return null;
  }

  // ══════ КУТИЈА ══════
  if (/правоаголен профил|квадратен профил|кутија/.test(n)) {
    const v = nums(n);
    if (v.length >= 3) {
      const [a, b, t] = v;
      if (a > 0 && b > 0 && t > 0 && t < Math.min(a, b) / 2) {
        return ok({
          weightPerUnit: kgPerMeter(areaRectTube(a, b, t), rho),
          shape: /квадратен/.test(n) ? "Квадратна кутија" : "Правоаголна кутија",
          dims: `${a}×${b}×${t} mm`, confidence: "high",
        });
      }
    }
    return null;
  }

  // ══════ АРМАТУРА / ТРКАЛЕЗНА ПРАЧКА ══════
  if (/арматура|(?:^|\s)фи\s*\d/.test(n) && !/цевка/.test(n)) {
    const m = n.match(/(?:фи|ф|ø)\s*(\d+(?:\.\d+)?)/);
    if (m) {
      const d = Number(m[1]);
      if (d > 0 && d < 200) {
        return ok({
          weightPerUnit: kgPerMeter(areaRoundBar(d), rho),
          shape: "Тркалезна прачка (арматура)", dims: `Ø${d} mm`, confidence: "high",
        });
      }
    }
    return null;
  }

  // ══════ КВАДРАТНО ЖЕЛЕЗО ══════
  if (/квадратно железо/.test(n)) {
    const v = nums(n);
    if (v.length >= 1 && v[0] > 0 && v[0] < 200) {
      return ok({
        weightPerUnit: kgPerMeter(areaSquareBar(v[0]), rho),
        shape: "Квадратна прачка", dims: `${v[0]}×${v[0]} mm`, confidence: "high",
      });
    }
    return null;
  }

  // ══════ ТРАКА / ПЛОСНАТО ══════
  if (/трака|плоснат|флах/.test(n)) {
    const v = nums(n);
    if (v.length >= 2) {
      const [b, t] = v;
      if (b > 0 && t > 0 && t <= b) {
        return ok({
          weightPerUnit: kgPerMeter(areaFlat(b, t), rho),
          shape: "Плоснато железо", dims: `${b}×${t} mm`, confidence: "high",
        });
      }
    }
    return null;
  }

  return null;
}
