// Единствен извор на вистина за пресметка на тежина.
// Го користат и рачниот калкулатор (frontend) и автоматскиот парсер (backend).
// Ако формулата се менува — се менува само тука.

// ══════════════ ГУСТИНИ (кг/м³) ══════════════
export const DENSITIES: Record<string, { label: string; value: number }> = {
  steel: { label: "Челик / железо", value: 7850 },
  stainless: { label: "Нерѓосувачки (INOX)", value: 7900 },
  aluminum: { label: "Алуминиум", value: 2700 },
  copper: { label: "Бакар", value: 8960 },
  brass: { label: "Месинг", value: 8500 },
};

export type DensityKey = keyof typeof DENSITIES;

// Зборови во името што укажуваат на материјал различен од челик.
const MATERIAL_HINTS: { key: DensityKey; words: RegExp }[] = [
  { key: "aluminum", words: /алуминиум|алуминиј|aluminij|alu\b|ал\.проф/i },
  { key: "stainless", words: /инокс|inox|нерѓ|нерг|прохром|рос(ф|)фрај|а4\b|aisi/i },
  { key: "copper", words: /бакар|бакарн|copper|cu\b/i },
  { key: "brass", words: /месинг|месинган|brass|латун/i },
];

/**
 * Ја погодува густината од името. Враќа "steel" кога нема експлицитен знак —
 * челикот е стандард во каталогот. `explicit` кажува дали материјалот е
 * навистина именуван, за да може повикувачот да побара потврда.
 */
export function detectDensity(name: string): { key: DensityKey; explicit: boolean } {
  for (const h of MATERIAL_HINTS) {
    if (h.words.test(name)) return { key: h.key, explicit: true };
  }
  return { key: "steel", explicit: false };
}

// ══════════════ ПЛОШТИНА НА ПРЕСЕК (mm²) ══════════════
export const areaRoundBar = (d: number) => Math.PI * Math.pow(d / 2, 2);
export const areaSquareBar = (a: number) => a * a;
export const areaFlat = (b: number, t: number) => b * t;
export const areaRectTube = (a: number, b: number, t: number) =>
  Math.max(0, a * b - Math.max(0, a - 2 * t) * Math.max(0, b - 2 * t));
export const areaRoundTube = (d: number, t: number) => Math.PI * t * Math.max(0, d - t);
export const areaAngle = (a: number, b: number, t: number) => Math.max(0, t * (a + b - t));

const round4 = (v: number) => Math.round(v * 10000) / 10000;

// ══════════════ ПРЕТВОРАЊЕ ВО ТЕЖИНА ══════════════
/** Плоштина на пресек (mm²) → кг по метар */
export const kgPerMeter = (areaMm2: number, density = DENSITIES.steel.value) =>
  round4((areaMm2 / 1e6) * density);

/** Дебелина (mm) → кг по m² */
export const kgPerSquareMeter = (thicknessMm: number, density = DENSITIES.steel.value) =>
  round4((thicknessMm / 1000) * density);

/** Димензии на табла (mm) → кг по парче */
export const kgPerSheet = (t: number, w: number, l: number, density = DENSITIES.steel.value) =>
  round4(((t * w * l) / 1e9) * density);

/** Тежина на ставка: тежина по единица × количина */
export function lineWeightKg(weightPerUnit: any, quantity: any): number {
  const w = Number(weightPerUnit ?? 0);
  const q = Number(quantity ?? 0);
  if (!Number.isFinite(w) || !Number.isFinite(q)) return 0;
  return Math.round(w * q * 1000) / 1000;
}

// ══════════════ ДИЈАМЕТРИ НА ЦЕВКИ ПО ЦОЛОВИ (DIN 2440 / EN 10255) ══════════════
export const INCH_OD: Record<string, number> = {
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

// ══════════════ ЗНАЧЕЊЕ НА ПОЛЕТО СПОРЕД МЕРНАТА ЕДИНИЦА ══════════════
export type UnitMeta = {
  applicable: boolean;
  locked: boolean;
  fixedValue?: string;
  label: string;
  hint: string;
  shortLabel: string;
};

export function unitMeta(unit: string): UnitMeta {
  switch (unit) {
    case "m":
      return {
        applicable: true, locked: false,
        label: "Тежина по метар (кг/м)",
        hint: "Колку тежи 1 метар од профилот. Користи го калкулаторот ако не ја знаеш.",
        shortLabel: "кг/м",
      };
    case "m2":
      return {
        applicable: true, locked: false,
        label: "Тежина по м² (кг/м²)",
        hint: "Колку тежи 1 м² лим. За челик: дебелина во mm × 7.85.",
        shortLabel: "кг/м²",
      };
    case "pcs":
    case "sheet":
      return {
        applicable: true, locked: false,
        label: `Тежина по ${unit === "sheet" ? "табла" : "парче"} (кг)`,
        hint: "Колку тежи едно парче. За профил купен на должина: должина во m × кг/м.",
        shortLabel: unit === "sheet" ? "кг/табла" : "кг/ком",
      };
    case "kg":
      return {
        applicable: true, locked: true, fixedValue: "1",
        label: "Тежина по единица (кг/кг)",
        hint: "Материјалот веќе се води во килограми — вредноста е секогаш 1.",
        shortLabel: "кг/кг",
      };
    default:
      return {
        applicable: false, locked: true, fixedValue: "0",
        label: "Тежина по единица",
        hint: "Не е применливо за оваа мерна единица.",
        shortLabel: "—",
      };
  }
}
