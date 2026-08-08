import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Calculator } from "lucide-react";
import {
  DENSITIES, areaRoundBar, areaSquareBar, areaFlat,
  areaRectTube, areaRoundTube, areaAngle,
  kgPerMeter, kgPerSquareMeter, kgPerSheet,
} from "@contracts/weight-geometry";

// Реекспорт за постојните повикувачи
export { lineWeightKg, unitMeta } from "@contracts/weight-geometry";
export type { UnitMeta } from "@contracts/weight-geometry";

type Field = { key: string; label: string; hint?: string };

type Shape = {
  key: string;
  label: string;
  unit: "m" | "m2";
  fields: Field[];
  // враќа плоштина на пресек во mm² (за unit=m), или дебелина во mm (за unit=m2)
  area: (v: Record<string, number>) => number;
};

const SHAPES: Shape[] = [
  {
    key: "round_bar", label: "Тркалезна прачка (Ø)", unit: "m",
    fields: [{ key: "d", label: "Ø дијаметар (mm)" }],
    area: (v) => areaRoundBar(v.d),
  },
  {
    key: "square_bar", label: "Квадратна прачка", unit: "m",
    fields: [{ key: "a", label: "Страна a (mm)" }],
    area: (v) => areaSquareBar(v.a),
  },
  {
    key: "flat", label: "Плоснато железо / трака", unit: "m",
    fields: [{ key: "b", label: "Ширина b (mm)" }, { key: "t", label: "Дебелина t (mm)" }],
    area: (v) => areaFlat(v.b, v.t),
  },
  {
    key: "square_tube", label: "Квадратна цевка (кутија)", unit: "m",
    fields: [{ key: "a", label: "Страна a (mm)" }, { key: "t", label: "Дебелина ѕид t (mm)" }],
    area: (v) => areaRectTube(v.a, v.a, v.t),
  },
  {
    key: "rect_tube", label: "Правоаголна цевка (кутија)", unit: "m",
    fields: [
      { key: "a", label: "Страна a (mm)" },
      { key: "b", label: "Страна b (mm)" },
      { key: "t", label: "Дебелина ѕид t (mm)" },
    ],
    area: (v) => areaRectTube(v.a, v.b, v.t),
  },
  {
    key: "round_tube", label: "Тркалезна цевка", unit: "m",
    fields: [{ key: "d", label: "Надв. Ø D (mm)" }, { key: "t", label: "Дебелина ѕид t (mm)" }],
    area: (v) => areaRoundTube(v.d, v.t),
  },
  {
    key: "angle", label: "Аголник L", unit: "m",
    fields: [
      { key: "a", label: "Крак a (mm)" },
      { key: "b", label: "Крак b (mm)" },
      { key: "t", label: "Дебелина t (mm)" },
    ],
    area: (v) => areaAngle(v.a, v.b, v.t),
  },
  {
    key: "sheet_m2", label: "Лим — по m²", unit: "m2",
    fields: [{ key: "t", label: "Дебелина t (mm)" }],
    area: (v) => v.t,
  },
  {
    key: "sheet_pcs", label: "Лим — цела табла (по ком)", unit: "m",
    fields: [
      { key: "L", label: "Должина (mm)" },
      { key: "W", label: "Ширина (mm)" },
      { key: "t", label: "Дебелина t (mm)" },
    ],
    // тука „area“ враќа тежина директно во кг преку посебна гранка подолу
    area: (v) => v.L * v.W * v.t,
  },
];

export function WeightCalculator({
  onApply,
  buttonLabel = "Калкулатор",
  defaultDensity = "steel",
}: {
  onApply: (kgPerUnit: number, note: string) => void;
  buttonLabel?: string;
  defaultDensity?: string;
}) {
  const [open, setOpen] = useState(false);
  const [shapeKey, setShapeKey] = useState("square_tube");
  const [density, setDensity] = useState(defaultDensity);
  const [vals, setVals] = useState<Record<string, string>>({});

  const shape = SHAPES.find((s) => s.key === shapeKey)!;
  const rho = DENSITIES[density].value;

  const result = useMemo(() => {
    const v: Record<string, number> = {};
    let ok = true;
    for (const f of shape.fields) {
      const n = Number(vals[f.key]);
      if (!Number.isFinite(n) || n <= 0) ok = false;
      v[f.key] = n || 0;
    }
    if (!ok) return null;

    if (shape.key === "sheet_pcs") {
      const kg = kgPerSheet(v.t, v.W, v.L, rho);
      return { kg, unitLabel: "кг/ком", desc: `${v.L}×${v.W}×${v.t} mm` };
    }
    if (shape.unit === "m2") {
      const kg = kgPerSquareMeter(v.t, rho);
      return { kg, unitLabel: "кг/м²", desc: `дебелина ${v.t} mm` };
    }
    const kg = kgPerMeter(shape.area(v), rho);
    const desc = shape.fields.map((f) => v[f.key]).join("×") + " mm";
    return { kg, unitLabel: "кг/м", desc };
  }, [shape, vals, rho]);

  const apply = () => {
    if (!result) return;
    onApply(
      Math.round(result.kg * 10000) / 10000,
      `${shape.label} ${result.desc} · ${DENSITIES[density].label}`
    );
    setOpen(false);
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm"
        onClick={() => { setDensity(defaultDensity); setOpen(true); }}>
        <Calculator className="h-3.5 w-3.5 mr-1.5" />{buttonLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Пресметка на тежина</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">Форма</Label>
                <Select value={shapeKey} onValueChange={(v) => { setShapeKey(v); setVals({}); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SHAPES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Материјал</Label>
                <Select value={density} onValueChange={setDensity}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(DENSITIES).map(([k, d]) => (
                      <SelectItem key={k} value={k}>{d.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {shape.fields.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label className="text-xs">{f.label}</Label>
                  <Input type="number" step="0.1" min="0" value={vals[f.key] ?? ""}
                    onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
                </div>
              ))}
            </div>

            <div className={`rounded-lg px-4 py-3 text-center ${result ? "bg-amber-50 border border-amber-200" : "bg-gray-50 border border-gray-200"}`}>
              {result ? (
                <>
                  <div className="text-2xl font-bold text-amber-700">
                    {result.kg.toFixed(3)} <span className="text-sm font-semibold text-amber-600">{result.unitLabel}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1">{shape.label} · {result.desc}</div>
                </>
              ) : (
                <div className="text-sm text-gray-400">Внеси ги димензиите</div>
              )}
            </div>

            <p className="text-[11px] text-gray-400 leading-relaxed">
              Пресметката е теоретска (без радиуси на аглите кај кутиите и без толеранции).
              Разликата од каталошката тежина е обично под 2%.
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Откажи</Button>
              <Button className="bg-amber-500 hover:bg-amber-600 text-white" disabled={!result} onClick={apply}>
                Пренеси
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
