import { useState, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { MaterialPicker } from "@/components/MaterialPicker";
import { printRemnantLabels } from "@/lib/print-documents";
import {
  Search, Plus, Ruler, Printer, Scissors, Trash2, RotateCcw, Settings2, Weight, Coins,
} from "lucide-react";

const STATUS_MK: Record<string, string> = {
  available: "Достапен",
  used: "Искористен",
  scrapped: "Отпишан",
};

export default function RemnantsTab() {
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"available" | "used" | "scrapped" | "all">("available");
  const [materialFilter, setMaterialFilter] = useState<number | null>(null);
  const [minLen, setMinLen] = useState("");
  const [minKg, setMinKg] = useState("");

  const [newOpen, setNewOpen] = useState(false);
  const [useOpen, setUseOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const [form, setForm] = useState({
    materialId: "" as string | number,
    lengthMm: "",
    quantity: "1",
    location: "",
    notes: "",
  });

  const [useForm, setUseForm] = useState({ usedLengthMm: "", ref: "", keepRemainder: true });
  const [paramForm, setParamForm] = useState({ kerf: "", minRemnant: "" });

  const { data: materials } = trpc.storage.materialList.useQuery({});
  const { data: settings } = trpc.settings.settingsGet.useQuery();
  const { data: cutParams } = trpc.remnants.cutParamsGet.useQuery();
  const { data: stats } = trpc.remnants.remnantStats.useQuery();
  const { data: remnants, isLoading } = trpc.remnants.remnantList.useQuery({
    search: search || undefined,
    status: statusFilter,
    materialId: materialFilter ?? undefined,
    minLengthMm: minLen ? Number(minLen) : undefined,
    minWeightKg: minKg ? Number(minKg) : undefined,
  });

  const invalidateAll = () => {
    utils.remnants.remnantList.invalidate();
    utils.remnants.remnantStats.invalidate();
  };

  const createMutation = trpc.remnants.remnantCreate.useMutation({
    onSuccess: (res) => {
      invalidateAll();
      setNewOpen(false);
      setLastResult(`Регистриран остаток ${res.code}`);
      setForm({ materialId: "", lengthMm: "", quantity: "1", location: form.location, notes: "" });
    },
  });

  const useMutation = trpc.remnants.remnantUse.useMutation({
    onSuccess: (res) => {
      invalidateAll();
      setUseOpen(false);
      setSelected(null);
      setUseForm({ usedLengthMm: "", ref: "", keepRemainder: true });
      if (res.newCode) {
        setLastResult(`Останаа ${res.restMm} mm → нов остаток ${res.newCode}`);
      } else if (res.scrapMm > 0) {
        setLastResult(`Останаа ${res.scrapMm} mm — под минимумот (${res.minRemnant} mm), не е регистриран`);
      } else {
        setLastResult("Остатокот е целосно искористен");
      }
    },
    onError: (e) => setLastResult(`Грешка: ${e.message}`),
  });

  const scrapMutation = trpc.remnants.remnantScrap.useMutation({ onSuccess: invalidateAll });
  const restoreMutation = trpc.remnants.remnantRestore.useMutation({ onSuccess: invalidateAll });
  const deleteMutation = trpc.remnants.remnantDelete.useMutation({ onSuccess: invalidateAll });
  const paramsMutation = trpc.remnants.cutParamsSet.useMutation({
    onSuccess: () => {
      utils.remnants.cutParamsGet.invalidate();
      setParamsOpen(false);
    },
  });

  // Материјали што имаат остатоци — за филтерот
  const materialsWithRemnants = useMemo(() => {
    const seen = new Map<number, string>();
    (remnants ?? []).forEach((r: any) => {
      if (r.materialId && !seen.has(r.materialId)) seen.set(r.materialId, r.materialName ?? "");
    });
    return Array.from(seen.entries());
  }, [remnants]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.materialId || !form.lengthMm) return;
    createMutation.mutate({
      materialId: Number(form.materialId),
      lengthMm: Number(form.lengthMm),
      quantity: Number(form.quantity) || 1,
      location: form.location || undefined,
      notes: form.notes || undefined,
    });
  };

  const handleUse = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !useForm.usedLengthMm) return;
    useMutation.mutate({
      id: selected.id,
      usedLengthMm: Number(useForm.usedLengthMm),
      ref: useForm.ref || undefined,
      keepRemainder: useForm.keepRemainder,
    });
  };

  const openParams = () => {
    setParamForm({
      kerf: String(cutParams?.kerf ?? 2),
      minRemnant: String(cutParams?.minRemnant ?? 300),
    });
    setParamsOpen(true);
  };

  const printAll = () => {
    const list = (remnants ?? []).filter((r: any) => r.status === "available");
    if (list.length === 0) return;
    printRemnantLabels(list, settings);
  };

  return (
    <div className="space-y-5">
      {/* Статистика */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-amber-50 p-2.5 rounded-lg"><Scissors className="h-5 w-5 text-amber-600" /></div>
          <div><p className="text-sm text-gray-500">Достапни парчиња</p><p className="text-xl font-bold">{stats?.totalPieces ?? 0}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-blue-50 p-2.5 rounded-lg"><Ruler className="h-5 w-5 text-blue-600" /></div>
          <div><p className="text-sm text-gray-500">Вкупна должина</p><p className="text-xl font-bold">{stats?.totalMeters ?? 0} м</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-slate-100 p-2.5 rounded-lg"><Weight className="h-5 w-5 text-slate-600" /></div>
          <div>
            <p className="text-sm text-gray-500">Тежина</p>
            <p className="text-xl font-bold">
              {(stats?.totalWeightKg ?? 0).toLocaleString("mk-MK")} <span className="text-sm font-semibold text-gray-400">кг</span>
            </p>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-emerald-50 p-2.5 rounded-lg"><Coins className="h-5 w-5 text-emerald-600" /></div>
          <div>
            <p className="text-sm text-gray-500">Приближна вредност</p>
            <p className="text-xl font-bold text-emerald-700">
              {(stats?.totalValue ?? 0).toLocaleString("mk-MK")} <span className="text-sm font-semibold text-gray-400">ден</span>
            </p>
          </div>
        </CardContent></Card>
      </div>

      {(stats?.unweighable ?? 0) > 0 && (
        <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2">
          {stats?.unweighable} {stats?.unweighable === 1 ? "остаток нема" : "остатоци немаат"} пресметана тежина —
          материјалот или не се води во метри, или нема внесена тежина по метар во каталогот.
        </div>
      )}

      {lastResult && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-2.5">
          <span>{lastResult}</span>
          <button onClick={() => setLastResult(null)} className="text-amber-500 hover:text-amber-700 px-2">×</button>
        </div>
      )}

      {/* Алатки */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input placeholder="Код, материјал, локација..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="available">Достапни</SelectItem>
            <SelectItem value="used">Искористени</SelectItem>
            <SelectItem value="scrapped">Отпишани</SelectItem>
            <SelectItem value="all">Сите</SelectItem>
          </SelectContent>
        </Select>
        <Select value={materialFilter ? String(materialFilter) : "all"} onValueChange={(v) => setMaterialFilter(v === "all" ? null : Number(v))}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Сите материјали" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Сите материјали</SelectItem>
            {materialsWithRemnants.map(([id, name]) => (
              <SelectItem key={id} value={String(id)}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="number" placeholder="Мин. mm" value={minLen} onChange={(e) => setMinLen(e.target.value)} className="w-24" />
        <Input type="number" placeholder="Мин. кг" value={minKg} onChange={(e) => setMinKg(e.target.value)} className="w-24" />
        <Button variant="outline" onClick={printAll} title="Печати етикети за достапните">
          <Printer className="h-4 w-4 mr-2" />Етикети
        </Button>
        <Button variant="outline" onClick={openParams} title="Ширина на рез и минимален остаток">
          <Settings2 className="h-4 w-4" />
        </Button>
        <Button className="bg-amber-500 hover:bg-amber-600 text-white" onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />Нов остаток
        </Button>
      </div>

      {/* Табела */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Код</TableHead>
                <TableHead>Материјал</TableHead>
                <TableHead className="w-28 text-right">Должина</TableHead>
                <TableHead className="w-24 text-right">Тежина</TableHead>
                <TableHead className="w-16 text-center">Кол.</TableHead>
                <TableHead className="w-36">Локација</TableHead>
                <TableHead className="w-28">Статус</TableHead>
                <TableHead className="w-40">Акции</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-400">Вчитување...</TableCell></TableRow>
              ) : !remnants || remnants.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-10 text-gray-400">
                  Нема евидентирани остатоци. Кликни „Нов остаток“ по секое сечење.
                </TableCell></TableRow>
              ) : (
                remnants.map((r: any) => (
                  <TableRow key={r.id} className={r.status !== "available" ? "opacity-55" : ""}>
                    <TableCell className="font-mono text-xs font-semibold text-amber-700">{r.code}</TableCell>
                    <TableCell>
                      <div className="font-medium text-sm leading-tight">{r.materialName ?? "—"}</div>
                      <div className="text-[11px] text-gray-400 font-mono">{r.materialCode ?? ""}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-bold">{Number(r.lengthMm).toFixed(0)}</span>
                      <span className="text-xs text-gray-400 ml-1">mm</span>
                      <div className="text-[11px] text-gray-400">{(Number(r.lengthMm) / 1000).toFixed(2)} м</div>
                    </TableCell>
                    <TableCell className="text-right">
                      {Number(r.weightKg ?? 0) > 0 ? (
                        <>
                          <span className="font-medium">{Number(r.weightKg).toFixed(1)}</span>
                          <span className="text-xs text-gray-400 ml-1">кг</span>
                          {Number(r.estValue ?? 0) > 0 && (
                            <div className="text-[11px] text-emerald-600">
                              ≈ {Number(r.estValue).toLocaleString("mk-MK")} ден
                            </div>
                          )}
                        </>
                      ) : <span className="text-gray-300">—</span>}
                    </TableCell>
                    <TableCell className="text-center">{r.quantity ?? 1}</TableCell>
                    <TableCell className="text-sm text-gray-600">{r.location || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        r.status === "available" ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                          : r.status === "used" ? "border-gray-300 text-gray-500"
                          : "border-red-300 text-red-600 bg-red-50"
                      }>{STATUS_MK[r.status] ?? r.status}</Badge>
                      {r.usedInRef && <div className="text-[11px] text-gray-400 mt-0.5">{r.usedInRef}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {r.status === "available" ? (
                          <>
                            <Button size="sm" variant="outline" title="Искористи"
                              onClick={() => { setSelected(r); setUseForm({ usedLengthMm: "", ref: "", keepRemainder: true }); setUseOpen(true); }}>
                              <Scissors className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="outline" title="Печати етикета"
                              onClick={() => printRemnantLabels([r], settings)}>
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="outline" className="text-red-500 hover:text-red-600" title="Отпиши"
                              onClick={() => { if (confirm(`Отпиши ${r.code}?`)) scrapMutation.mutate({ id: r.id }); }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" title="Врати во достапни"
                              onClick={() => restoreMutation.mutate({ id: r.id })}>
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="outline" className="text-red-500 hover:text-red-600" title="Избриши"
                              onClick={() => { if (confirm(`Трајно избриши ${r.code}?`)) deleteMutation.mutate({ id: r.id }); }}>
                              ×
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Дијалог: нов остаток */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Нов остаток</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>Материјал *</Label>
              <MaterialPicker
                materials={materials as any}
                value={form.materialId}
                onSelect={(m) => setForm({ ...form, materialId: m.id })}
                placeholder="Избери профил…"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Должина (mm) *</Label>
                <Input type="number" step="1" min="1" value={form.lengthMm} autoFocus
                  onChange={(e) => setForm({ ...form, lengthMm: e.target.value })} required />
                {form.lengthMm && (
                  <p className="text-[11px] text-gray-400">{(Number(form.lengthMm) / 1000).toFixed(3)} м</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Количина</Label>
                <Input type="number" min="1" value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Локација</Label>
              <Input value={form.location} placeholder="полица А / двор / кај пилата"
                onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Забелешка</Label>
              <Textarea rows={2} value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setNewOpen(false)}>Откажи</Button>
              <Button type="submit" className="bg-amber-500 hover:bg-amber-600 text-white" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Се зачувува..." : "Зачувај"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Дијалог: искористи */}
      <Dialog open={useOpen} onOpenChange={setUseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Искористи остаток {selected?.code}</DialogTitle></DialogHeader>
          {selected && (
            <form onSubmit={handleUse} className="space-y-4">
              <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm">
                <div className="font-medium">{selected.materialName}</div>
                <div className="text-gray-500">
                  Расположиво: <b>{Number(selected.lengthMm).toFixed(0)} mm</b>
                  {Number(selected.weightKg ?? 0) > 0 && <> · <b>{Number(selected.weightKg).toFixed(1)} кг</b></>}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Искористена должина (mm) *</Label>
                <Input type="number" step="1" min="1" max={Number(selected.lengthMm)} autoFocus
                  value={useForm.usedLengthMm}
                  onChange={(e) => setUseForm({ ...useForm, usedLengthMm: e.target.value })} required />
                {useForm.usedLengthMm && (
                  <p className="text-[11px] text-gray-500">
                    Останува ≈ {Math.max(0, Number(selected.lengthMm) - Number(useForm.usedLengthMm) - (cutParams?.kerf ?? 2)).toFixed(0)} mm
                    <span className="text-gray-400"> (по рез од {cutParams?.kerf ?? 2} mm)</span>
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>За налог / опис</Label>
                <Input value={useForm.ref} placeholder="РН-012/2026"
                  onChange={(e) => setUseForm({ ...useForm, ref: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={useForm.keepRemainder}
                  onChange={(e) => setUseForm({ ...useForm, keepRemainder: e.target.checked })} />
                Регистрирај го новиот остаток (ако е над {cutParams?.minRemnant ?? 300} mm)
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => setUseOpen(false)}>Откажи</Button>
                <Button type="submit" className="bg-amber-500 hover:bg-amber-600 text-white" disabled={useMutation.isPending}>
                  {useMutation.isPending ? "..." : "Потврди"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Дијалог: параметри */}
      <Dialog open={paramsOpen} onOpenChange={setParamsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Параметри за кроење</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Ширина на рез — kerf (mm)</Label>
              <Input type="number" step="0.5" min="0" value={paramForm.kerf}
                onChange={(e) => setParamForm({ ...paramForm, kerf: e.target.value })} />
              <p className="text-[11px] text-gray-400">Колку материјал „изеде“ секој рез. Лентова пила ≈ 2 mm.</p>
            </div>
            <div className="space-y-2">
              <Label>Минимален употреблив остаток (mm)</Label>
              <Input type="number" step="10" min="0" value={paramForm.minRemnant}
                onChange={(e) => setParamForm({ ...paramForm, minRemnant: e.target.value })} />
              <p className="text-[11px] text-gray-400">Под оваа должина парчето се смета за отпад.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setParamsOpen(false)}>Откажи</Button>
              <Button className="bg-amber-500 hover:bg-amber-600 text-white"
                onClick={() => paramsMutation.mutate({ kerf: Number(paramForm.kerf) || 0, minRemnant: Number(paramForm.minRemnant) || 0 })}>
                Зачувај
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
