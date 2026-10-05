import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { parseDxf, dxfStats, calcCutting, cutParamsFor, dxfSvg, type DxfResult } from "@contracts/dxf";
import { DENSITIES } from "@contracts/weight-geometry";
import { FileUp, Ruler, Settings2, Plus, Trash2, AlertTriangle } from "lucide-react";

const fmt = (n: number, d = 2) => n.toLocaleString("mk-MK", { minimumFractionDigits: d, maximumFractionDigits: d });
const thicknessFromName = (s: string) => { const m = s.match(/(\d+(?:[.,]\d+)?)\s*(?:мм|mm)/i); return m ? parseFloat(m[1].replace(",", ".")) : null; };

export type DxfItem = { description: string; quantity: string; unit: string; unitPrice: string; unitCost: string; weightPerUnit: string; notes: string };

/**
 * Калкулација од DXF цртеж: должина на сечење, пробивања, површина → време на машината, тежина, цена.
 * Резултатот се додава како ставка во понудата; цртежот се чува.
 */
export default function DxfCalcDialog({ open, onOpenChange, materials, onAdd }: {
  open: boolean; onOpenChange: (o: boolean) => void; materials: any[] | undefined; onAdd: (item: DxfItem) => void;
}) {
  const utils = trpc.useUtils();
  const { data: st } = trpc.quotation.dxfSettingsGet.useQuery(undefined, { enabled: open });
  const saveSettings = trpc.quotation.dxfSettingsSave.useMutation({ onSuccess: () => { toast.success("Табелата е зачувана"); utils.quotation.dxfSettingsGet.invalidate(); }, onError: (e) => toast.error(e.message) });
  const saveDrawing = trpc.quotation.drawingSave.useMutation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [res, setRes] = useState<DxfResult | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [materialId, setMaterialId] = useState<string>("");
  const [thickness, setThickness] = useState("3");
  const [densityKey, setDensityKey] = useState("steel");
  const [pricePerKg, setPricePerKg] = useState("0");
  const [machineId, setMachineId] = useState<string>("");
  const [speed, setSpeed] = useState(""); const [pierce, setPierce] = useState("");
  const [speedTouched, setSpeedTouched] = useState(false);
  const [qty, setQty] = useState("1");
  const [margin, setMargin] = useState("30"); const [edge, setEdge] = useState("5"); const [setupMin, setSetupMin] = useState("10");
  const [basis, setBasis] = useState<"net" | "bbox">("bbox");
  const [showTable, setShowTable] = useState(false);
  const [table, setTable] = useState<{ t: string; speed: string; pierce: string }[]>([]);

  useEffect(() => {
    if (!st || !open) return;
    setMargin(String(st.margin)); setEdge(String(st.edge)); setSetupMin(String(st.setupMin)); setBasis(st.materialBasis);
    const m = st.machineId ? st.machines.find((x) => x.id === st.machineId) : st.machines.find((x) => /ласер|laser|fiber/i.test(`${x.name} ${x.type}`)) ?? st.machines[0];
    if (m) setMachineId(String(m.id));
    setTable(st.table.map((r) => ({ t: String(r.t), speed: String(r.speed), pierce: String(r.pierce) })));
  }, [st, open]);
  useEffect(() => { if (!open) { setRes(null); setText(""); setFileName(""); setHidden(new Set()); setSpeedTouched(false); setQty("1"); } }, [open]);
  // брзина и пробивање од табелата за дебелината (додека корисникот не ги смени рачно)
  useEffect(() => {
    if (!st || speedTouched) return;
    const p = cutParamsFor(parseFloat(thickness) || 0, st.table);
    setSpeed(p.speed.toFixed(2)); setPierce(p.pierce.toFixed(1));
  }, [thickness, st, speedTouched]);

  const pickMaterial = (id: string) => {
    setMaterialId(id);
    const m = materials?.find((x: any) => String(x.id) === id);
    if (!m) return;
    const t = thicknessFromName(String(m.name)); if (t) setThickness(String(t));
    if (m.densityKey && DENSITIES[m.densityKey]) setDensityKey(m.densityKey);
    // цена по кг: лимовите се водат во кг
    const price = Number(m.avgCost) || Number(m.lastPurchasePrice) || 0;
    if (m.unit === "kg") setPricePerKg(String(price));
    else if (Number(m.weightPerUnit) > 0) setPricePerKg((price / Number(m.weightPerUnit)).toFixed(2));
  };

  const onFile = async (f: File) => {
    try {
      const t = await f.text();
      const r = parseDxf(t);
      setText(t); setFileName(f.name); setRes(r);
      // слоеви што очигледно не се сечат (коти, текст, рамка)
      setHidden(new Set(r.layers.map((l) => l.name).filter((n) => /dim|кот|text|текст|title|рамк|frame|border|hatch/i.test(n))));
    } catch (e: any) { toast.error(e.message); }
  };

  const visible = useMemo(() => (res ? res.paths.filter((p) => !hidden.has(p.layer)) : []), [res, hidden]);
  const stats = useMemo(() => (visible.length ? dxfStats(visible) : null), [visible]);
  const machine = st?.machines.find((m) => String(m.id) === machineId);
  const calc = useMemo(() => stats && calcCutting({
    stats, quantity: Math.max(1, parseFloat(qty) || 1), thickness: parseFloat(thickness) || 0, density: (DENSITIES[densityKey]?.value ?? 7850) / 1000,
    speed: parseFloat(speed) || 0, pierceSec: parseFloat(pierce) || 0, machinePerHour: machine?.perHour ?? 0, machinePerMeter: machine?.perMeter ?? 0,
    pricePerKg: parseFloat(pricePerKg) || 0, materialBasis: basis, margin: parseFloat(margin) || 0, edge: parseFloat(edge) || 0, setupMin: parseFloat(setupMin) || 0,
  }), [stats, qty, thickness, densityKey, speed, pierce, machine, pricePerKg, basis, margin, edge, setupMin]);
  const svg = useMemo(() => (res && stats ? dxfSvg(res.paths, stats.bbox, hidden) : ""), [res, stats, hidden]);
  const mat = materials?.find((x: any) => String(x.id) === materialId);

  const add = async () => {
    if (!stats || !calc) return;
    let drawingId: number | null = null;
    try { drawingId = (await saveDrawing.mutateAsync({ fileName, dxf: text, stats, calc })).id; } catch (e: any) { toast.error(`Цртежот не е зачуван: ${e.message}`); }
    const name = fileName.replace(/\.dxf$/i, "");
    onAdd({
      description: `Ласерско сечење по цртеж ${name} — ${thickness} mm${mat ? ` ${mat.name}` : ""} (${fmt(stats.bbox.width, 0)}×${fmt(stats.bbox.height, 0)} mm)`.slice(0, 500),
      quantity: String(Math.max(1, parseFloat(qty) || 1)), unit: "ком",
      unitPrice: calc.unitPrice.toFixed(2), unitCost: calc.unitCost.toFixed(2), weightPerUnit: calc.kg.toFixed(4),
      notes: `${drawingId ? `Цртеж #${drawingId} · ` : ""}рез ${fmt(calc.cutM)} m · ${stats.pierces} пробивања · ${fmt(calc.minutes)} мин/ком · машина ${fmt(calc.machine)} + материјал ${fmt(calc.material)} ден/ком`,
    });
    toast.success("Додадено во понудата");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[94vh] overflow-y-auto">
        <DialogTitle className="flex items-center gap-2"><Ruler className="h-5 w-5 text-primary" />Калкулација од DXF цртеж</DialogTitle>
        <DialogDescription>Програмата ги мери линиите за сечење, бројот на пробивања и површината, па ги пресметува времето на машината, тежината и цената.</DialogDescription>
        <input ref={fileRef} type="file" accept=".dxf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
        {!res ? (
          <button type="button" onClick={() => fileRef.current?.click()} className="w-full rounded-lg border-2 border-dashed p-10 text-center hover:border-primary/50 hover:bg-accent/40">
            <FileUp className="h-8 w-8 mx-auto text-primary" />
            <p className="mt-2 font-medium">Избери DXF датотека</p>
            <p className="text-xs text-gray-500">од AutoCAD, SolidWorks, Inventor, QCAD... (ASCII DXF, мерки во mm или инчи)</p>
          </button>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-4">
            <div className="space-y-3">
              <div className="rounded-lg border bg-white text-slate-800 h-80 p-2 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: svg }} />
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                <span className="font-mono">{fileName}</span><span>· единици: {res.units}</span>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => fileRef.current?.click()}>Друг цртеж</Button>
              </div>
              {stats && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                  <div className="rounded-lg border p-2"><p className="text-[11px] text-gray-500">Должина на сечење</p><p className="font-semibold">{fmt(stats.cutLength / 1000, 3)} m</p></div>
                  <div className="rounded-lg border p-2"><p className="text-[11px] text-gray-500">Пробивања</p><p className="font-semibold">{stats.pierces}</p><p className="text-[10px] text-gray-400">{stats.closedContours} контури{stats.openPaths ? ` + ${stats.openPaths} отворени` : ""}</p></div>
                  <div className="rounded-lg border p-2"><p className="text-[11px] text-gray-500">Габарит</p><p className="font-semibold">{fmt(stats.bbox.width, 1)} × {fmt(stats.bbox.height, 1)} mm</p></div>
                  <div className="rounded-lg border p-2"><p className="text-[11px] text-gray-500">Нето површина</p><p className="font-semibold">{fmt(stats.netArea / 1e6, 4)} m²</p></div>
                </div>
              )}
              {res.layers.length > 1 && (
                <div className="rounded-lg border p-2 text-xs space-y-1">
                  <p className="text-gray-500">Слоеви — исклучи ги оние што не се сечат (коти, рамка, гравура):</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {res.layers.map((l) => (
                      <label key={l.name} className="flex items-center gap-1.5">
                        <input type="checkbox" checked={!hidden.has(l.name)} onChange={(e) => setHidden((h) => { const n = new Set(h); if (e.target.checked) n.delete(l.name); else n.add(l.name); return n; })} />
                        <span className="font-mono">{l.name}</span><span className="text-gray-400">{fmt(l.length / 1000, 2)} m</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {(res.warnings.length > 0 || Object.keys(res.skipped).length > 0) && (
                <p className="text-xs text-gray-500 flex items-start gap-1"><AlertTriangle className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                  {[...res.warnings, Object.keys(res.skipped).length ? `Прескокнато (не се сече): ${Object.entries(res.skipped).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>

            <div className="space-y-2.5 text-sm">
              <div className="space-y-1"><Label className="text-xs">Материјал (лим)</Label>
                <Select value={materialId} onValueChange={pickMaterial}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Избери од магацин (не е задолжително)" /></SelectTrigger>
                  <SelectContent>{(materials ?? []).filter((m: any) => /sheet|лим/i.test(`${m.type} ${m.name}`)).map((m: any) => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1"><Label className="text-xs">Дебелина mm</Label><Input className="h-9" value={thickness} onChange={(e) => setThickness(e.target.value)} /></div>
                <div className="space-y-1 col-span-2"><Label className="text-xs">Вид</Label>
                  <Select value={densityKey} onValueChange={setDensityKey}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(DENSITIES).map(([k, d]) => <SelectItem key={k} value={k}>{d.label}</SelectItem>)}</SelectContent></Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label className="text-xs">Цена материјал ден/кг</Label><Input className={`h-9 ${!(parseFloat(pricePerKg) > 0) ? "border-primary/50" : ""}`} value={pricePerKg} onChange={(e) => setPricePerKg(e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs">Материјал се наплаќа по</Label>
                  <Select value={basis} onValueChange={(v) => setBasis(v as any)}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="bbox">габарит + раб</SelectItem><SelectItem value="net">нето (без отвори)</SelectItem></SelectContent></Select>
                </div>
              </div>
              <div className="space-y-1"><Label className="text-xs">Машина</Label>
                <Select value={machineId} onValueChange={setMachineId}><SelectTrigger className="h-9"><SelectValue placeholder="Избери машина" /></SelectTrigger>
                  <SelectContent>{(st?.machines ?? []).map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.name} · {fmt(m.perHour, 0)} ден/ч{m.perMeter ? ` + ${fmt(m.perMeter)} ден/m` : ""}</SelectItem>)}</SelectContent></Select>
                {st && !st.machines.length && <p className="text-[11px] text-primary">Внеси машина со цена по час во Каталог → Машини.</p>}
                {machine && !machine.perHour && !machine.perMeter && <p className="text-[11px] text-primary">Машината нема цена по час — пресметај ја во Каталог → Машини (амортизација, струја, гас, сервис), инаку сечењето излегува 0.</p>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label className="text-xs">Брзина m/min</Label><Input className="h-9" value={speed} onChange={(e) => { setSpeed(e.target.value); setSpeedTouched(true); }} /></div>
                <div className="space-y-1"><Label className="text-xs">Пробивање сек.</Label><Input className="h-9" value={pierce} onChange={(e) => { setPierce(e.target.value); setSpeedTouched(true); }} /></div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div className="space-y-1"><Label className="text-xs">Парчиња</Label><Input className="h-9" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs">Маржа %</Label><Input className="h-9" value={margin} onChange={(e) => setMargin(e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs">Раб mm</Label><Input className="h-9" value={edge} onChange={(e) => setEdge(e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs">Подгот. мин</Label><Input className="h-9" value={setupMin} onChange={(e) => setSetupMin(e.target.value)} /></div>
              </div>
              {calc && (
                <div className="rounded-lg border border-primary/20 bg-primary/10 p-3 space-y-1">
                  <div className="flex justify-between"><span className="text-gray-600">Време по парче</span><b>{fmt(calc.minutes)} мин</b></div>
                  <div className="flex justify-between"><span className="text-gray-600">Тежина по парче</span><b>{fmt(calc.kg, 3)} кг</b></div>
                  <div className="flex justify-between"><span className="text-gray-600">Машина / материјал</span><span>{fmt(calc.machine)} / {fmt(calc.material)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">Трошок по парче</span><span>{fmt(calc.unitCost)} ден</span></div>
                  <div className="flex justify-between text-base"><span>Цена по парче</span><b>{fmt(calc.unitPrice)} ден</b></div>
                  <div className="flex justify-between text-xs text-gray-600"><span>Вкупно {qty} ком · {fmt(calc.totalMinutes, 1)} мин</span><span>{fmt(calc.totalPrice)} ден</span></div>
                </div>
              )}
              <Button className="w-full" disabled={!calc || saveDrawing.isPending} onClick={add}><Plus className="h-4 w-4 mr-1.5" />Додај во понудата</Button>
              <button type="button" className="text-xs text-gray-500 flex items-center gap-1 hover:text-gray-800" onClick={() => setShowTable(!showTable)}><Settings2 className="h-3.5 w-3.5" />Табела на брзини по дебелина</button>
              {showTable && (
                <div className="rounded-lg border p-2 space-y-1 text-xs">
                  <div className="grid grid-cols-[1fr_1fr_1fr_1.5rem] gap-1 text-gray-500"><span>mm</span><span>m/min</span><span>пробив. сек</span><span /></div>
                  {table.map((r, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1.5rem] gap-1">
                      {(["t", "speed", "pierce"] as const).map((k) => <Input key={k} className="h-7 text-xs" value={r[k]} onChange={(e) => setTable(table.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />)}
                      <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => setTable(table.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                  <div className="flex justify-between pt-1">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setTable([...table, { t: "", speed: "", pierce: "" }])}>+ ред</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={saveSettings.isPending} onClick={() => saveSettings.mutate({
                      table: table.map((r) => ({ t: parseFloat(r.t), speed: parseFloat(r.speed), pierce: parseFloat(r.pierce) || 0 })).filter((r) => r.t > 0 && r.speed > 0),
                      machineId: machineId ? Number(machineId) : null, margin: parseFloat(margin) || 0, edge: parseFloat(edge) || 0, setupMin: parseFloat(setupMin) || 0, materialBasis: basis,
                    })}>Зачувај како стандард</Button>
                  </div>
                  <p className="text-[11px] text-gray-500">Почетните вредности се типични за фибер ласер и црн челик — внеси ги вистинските од вашата машина.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
