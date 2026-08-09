import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
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
import { ASSET_CATEGORIES, rateFromLife, lifeFromRate } from "@contracts/depreciation";
import {
  Plus, Search, Pencil, Trash2, Archive, RotateCcw, Calculator,
  Building2, TrendingDown, Coins, Eye,
} from "lucide-react";

const den = (v: any) =>
  Number(v ?? 0).toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const emptyForm = () => ({
  inventoryNo: "", name: "", category: "machine", description: "", location: "",
  invoiceRef: "", acquisitionDate: new Date().toISOString().slice(0, 10),
  acquisitionValue: "", salvageValue: "0", usefulLifeYears: "5", rate: "20",
  depreciationStart: "",
});

export default function Assets() {
  const utils = trpc.useUtils();
  const thisYear = new Date().getFullYear();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<"all" | "active" | "disposed">("active");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState(emptyForm());
  const [detailId, setDetailId] = useState<number | null>(null);
  const [disposeFor, setDisposeFor] = useState<any>(null);
  const [disposal, setDisposal] = useState({ date: new Date().toISOString().slice(0, 10), value: "0", note: "" });
  const [runYear, setRunYear] = useState(thisYear);
  const [runOpen, setRunOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const { data: stats } = trpc.assets.assetsStats.useQuery({ year: thisYear });
  const { data: assets, isLoading } = trpc.assets.assetsList.useQuery({
    search: search || undefined, category, status,
  });
  const { data: detail } = trpc.assets.assetById.useQuery(
    { id: detailId ?? 0 }, { enabled: !!detailId }
  );
  const { data: run } = trpc.assets.depreciationRun.useQuery(
    { year: runYear, commit: false }, { enabled: runOpen }
  );

  const refresh = () => {
    utils.assets.assetsList.invalidate();
    utils.assets.assetsStats.invalidate();
    utils.assets.assetById.invalidate();
    utils.assets.depreciationRun.invalidate();
  };

  const createMut = trpc.assets.assetCreate.useMutation({
    onSuccess: () => { refresh(); setDialogOpen(false); setErr(null); },
    onError: (e) => setErr(e.message),
  });
  const updateMut = trpc.assets.assetUpdate.useMutation({
    onSuccess: () => { refresh(); setDialogOpen(false); setEditing(null); setErr(null); },
    onError: (e) => setErr(e.message),
  });
  const disposeMut = trpc.assets.assetDispose.useMutation({
    onSuccess: (r) => {
      refresh(); setDisposeFor(null);
      setMsg(
        `Расходувано. Сегашна вредност беше ${den(r.bookValue)} ден, ` +
        (r.gain >= 0 ? `добивка ${den(r.gain)} ден` : `загуба ${den(Math.abs(r.gain))} ден`)
      );
    },
  });
  const restoreMut = trpc.assets.assetRestore.useMutation({ onSuccess: refresh });
  const deleteMut = trpc.assets.assetDelete.useMutation({ onSuccess: refresh });
  const postMut = trpc.assets.depreciationPost.useMutation({
    onSuccess: (r) => { refresh(); setMsg(`Проведена амортизација за ${runYear}: ${r.count} средства, ${den(r.total)} ден`); },
  });
  const unpostMut = trpc.assets.depreciationUnpost.useMutation({
    onSuccess: (r) => { refresh(); setMsg(`Поништени ${r.removed} записи за ${runYear}`); },
  });

  const openNew = () => { setEditing(null); setForm(emptyForm()); setErr(null); setDialogOpen(true); };
  const openEdit = (a: any) => {
    setEditing(a);
    setForm({
      inventoryNo: a.inventoryNo, name: a.name, category: a.category,
      description: a.description ?? "", location: a.location ?? "",
      invoiceRef: a.invoiceRef ?? "",
      acquisitionDate: String(a.acquisitionDate).slice(0, 10),
      acquisitionValue: String(a.acquisitionValue), salvageValue: String(a.salvageValue),
      usefulLifeYears: String(a.usefulLifeYears), rate: String(a.rate),
      depreciationStart: a.depreciationStart ? String(a.depreciationStart).slice(0, 10) : "",
    });
    setErr(null);
    setDialogOpen(true);
  };

  const setRate = (r: string) => setForm({ ...form, rate: r, usefulLifeYears: String(lifeFromRate(Number(r) || 0)) });
  const setLife = (y: string) => setForm({ ...form, usefulLifeYears: y, rate: String(rateFromLife(Number(y) || 0)) });
  const setCat = (c: string) => {
    const d = ASSET_CATEGORIES[c]?.defaultRate ?? 20;
    setForm({ ...form, category: c, rate: String(d), usefulLifeYears: String(lifeFromRate(d)) });
  };

  const submit = () => {
    if (editing) {
      const { inventoryNo, ...rest } = form;
      updateMut.mutate({ id: editing.id, ...rest } as any);
    } else {
      createMut.mutate(form as any);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Основни средства</h2>
          <p className="text-gray-500 mt-1">Регистар, амортизација и расход</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setRunYear(thisYear); setRunOpen(true); }}>
            <Calculator className="h-4 w-4 mr-2" />Годишна амортизација
          </Button>
          <Button className="bg-amber-500 hover:bg-amber-600 text-white" onClick={openNew}>
            <Plus className="h-4 w-4 mr-2" />Ново средство
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-blue-50 p-2.5 rounded-lg"><Building2 className="h-5 w-5 text-blue-600" /></div>
          <div><p className="text-sm text-gray-500">Средства во употреба</p><p className="text-xl font-bold">{stats?.count ?? 0}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-gray-100 p-2.5 rounded-lg"><Coins className="h-5 w-5 text-gray-600" /></div>
          <div><p className="text-sm text-gray-500">Набавна вредност</p><p className="text-xl font-bold">{den(stats?.acquisition)}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-amber-50 p-2.5 rounded-lg"><TrendingDown className="h-5 w-5 text-amber-600" /></div>
          <div><p className="text-sm text-gray-500">Собрана амортизација</p><p className="text-xl font-bold text-amber-700">{den(stats?.accumulated)}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-emerald-50 p-2.5 rounded-lg"><Coins className="h-5 w-5 text-emerald-600" /></div>
          <div>
            <p className="text-sm text-gray-500">Сегашна вредност</p>
            <p className="text-xl font-bold text-emerald-700">{den(stats?.bookValue)}</p>
            <p className="text-[11px] text-gray-400">месечно {den(stats?.monthly)} ден</p>
          </div>
        </CardContent></Card>
      </div>

      {msg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-4 py-2.5 flex justify-between">
          <span>{msg}</span><button onClick={() => setMsg(null)} className="text-emerald-500 px-2">×</button>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input placeholder="Назив, инв. број, локација..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Сите категории</SelectItem>
            {Object.entries(ASSET_CATEGORIES).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as any)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Во употреба</SelectItem>
            <SelectItem value="disposed">Расходувани</SelectItem>
            <SelectItem value="all">Сите</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Инв. број</TableHead>
                <TableHead>Назив</TableHead>
                <TableHead className="w-24">Набавено</TableHead>
                <TableHead className="text-right w-32">Набавна</TableHead>
                <TableHead className="text-right w-32">Амортизација</TableHead>
                <TableHead className="text-right w-32">Сегашна</TableHead>
                <TableHead className="w-32">Акции</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">Вчитување...</TableCell></TableRow>
              ) : !assets || assets.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-12 text-gray-400">
                  Нема средства. Внеси ги машините, возилата и опремата.
                </TableCell></TableRow>
              ) : assets.map((a: any) => (
                <TableRow key={a.id} className={a.status === "disposed" ? "opacity-55" : ""}>
                  <TableCell className="font-mono text-xs">{a.inventoryNo}</TableCell>
                  <TableCell>
                    <div className="text-sm font-medium leading-tight">{a.name}</div>
                    <div className="text-[11px] text-gray-400">
                      {ASSET_CATEGORIES[a.category]?.label ?? a.category}
                      {a.location ? ` · ${a.location}` : ""}
                      {a.fullyDepreciated && <span className="text-amber-600"> · целосно амортизирано</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{String(a.acquisitionDate).slice(0, 10)}</TableCell>
                  <TableCell className="text-right text-sm">{den(a.acquisitionValue)}</TableCell>
                  <TableCell className="text-right text-sm">
                    <span className="text-amber-700">{den(a.accumulated)}</span>
                    <div className="text-[11px] text-gray-400">{a.rate}% год.</div>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-bold">{den(a.bookValue)}</span>
                    {a.finishesIn && !a.fullyDepreciated && (
                      <div className="text-[11px] text-gray-400">до {a.finishesIn}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" title="План на амортизација"
                        onClick={() => setDetailId(a.id)}><Eye className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" title="Измени"
                        onClick={() => openEdit(a)}><Pencil className="h-3.5 w-3.5" /></Button>
                      {a.status === "active" ? (
                        <Button size="sm" variant="outline" title="Расходувај"
                          onClick={() => { setDisposeFor(a); setDisposal({ date: new Date().toISOString().slice(0, 10), value: "0", note: "" }); }}>
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" title="Врати во употреба"
                          onClick={() => restoreMut.mutate({ id: a.id })}>
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="text-red-500"
                        onClick={() => { if (confirm(`Избриши ${a.inventoryNo}?`)) deleteMut.mutate({ id: a.id }); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Ново / измена */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? `Измени: ${editing.name}` : "Ново основно средство"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {err && <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-3 py-2">{err}</div>}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Инвентарен број *</Label>
                <Input value={form.inventoryNo} disabled={!!editing}
                  onChange={(e) => setForm({ ...form, inventoryNo: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Категорија</Label>
                <Select value={form.category} onValueChange={setCat}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ASSET_CATEGORIES).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label} · {v.defaultRate}%</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Назив *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Датум на набавка *</Label>
                <Input type="date" value={form.acquisitionDate}
                  onChange={(e) => setForm({ ...form, acquisitionDate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Набавна вредност (ден) *</Label>
                <Input type="number" step="0.01" value={form.acquisitionValue}
                  onChange={(e) => setForm({ ...form, acquisitionValue: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Стапка (% год.)</Label>
                <Input type="number" step="0.01" value={form.rate} onChange={(e) => setRate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Корисен век (год.)</Label>
                <Input type="number" step="0.5" value={form.usefulLifeYears} onChange={(e) => setLife(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Преостаната вредност</Label>
                <Input type="number" step="0.01" value={form.salvageValue}
                  onChange={(e) => setForm({ ...form, salvageValue: e.target.value })} />
              </div>
            </div>
            <p className="text-[11px] text-gray-400">
              Стапката и корисниот век се поврзани — менуваш едно, другото се пресметува.
              Месечна амортизација ≈ {den(((Number(form.acquisitionValue) || 0) - (Number(form.salvageValue) || 0)) * (Number(form.rate) || 0) / 100 / 12)} ден.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Локација</Label>
                <Input value={form.location} placeholder="хала, канцеларија, возен парк"
                  onChange={(e) => setForm({ ...form, location: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Фактура / документ</Label>
                <Input value={form.invoiceRef} onChange={(e) => setForm({ ...form, invoiceRef: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Опис</Label>
              <Textarea rows={2} value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Откажи</Button>
              <Button className="bg-amber-500 hover:bg-amber-600 text-white"
                disabled={!form.name || !form.inventoryNo || !form.acquisitionValue || createMut.isPending || updateMut.isPending}
                onClick={submit}>
                {createMut.isPending || updateMut.isPending ? "Зачувување..." : "Зачувај"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* План на амортизација */}
      <Dialog open={!!detailId} onOpenChange={(v) => { if (!v) setDetailId(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>План на амортизација — {detail?.name}</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                  <div className="text-[11px] text-gray-500">Набавна</div>
                  <div className="font-bold">{den(detail.acquisitionValue)}</div>
                </div>
                <div className="bg-amber-50 rounded-lg px-3 py-2">
                  <div className="text-[11px] text-amber-700">Собрана амортизација</div>
                  <div className="font-bold text-amber-800">{den(detail.accumulated)}</div>
                </div>
                <div className="bg-emerald-50 rounded-lg px-3 py-2">
                  <div className="text-[11px] text-emerald-700">Сегашна вредност</div>
                  <div className="font-bold text-emerald-800">{den(detail.bookValue)}</div>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Година</TableHead>
                    <TableHead className="w-20">Месеци</TableHead>
                    <TableHead className="text-right">Амортизација</TableHead>
                    <TableHead className="text-right">Собрано</TableHead>
                    <TableHead className="text-right">Сегашна</TableHead>
                    <TableHead className="w-24">Проведено</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(detail.schedule ?? []).map((r: any) => {
                    const posted = (detail.posted ?? []).find((p: any) => p.year === r.year);
                    return (
                      <TableRow key={r.year} className={r.year === thisYear ? "bg-amber-50/60" : ""}>
                        <TableCell className="font-medium">{r.year}</TableCell>
                        <TableCell className="text-sm text-gray-500">{r.months}</TableCell>
                        <TableCell className="text-right">{den(r.amount)}</TableCell>
                        <TableCell className="text-right text-gray-500">{den(r.accumulated)}</TableCell>
                        <TableCell className="text-right font-medium">{den(r.bookValue)}</TableCell>
                        <TableCell>
                          {posted ? <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50">да</Badge> : <span className="text-gray-300 text-xs">—</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Расход */}
      <Dialog open={!!disposeFor} onOpenChange={(v) => { if (!v) setDisposeFor(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Расход на {disposeFor?.name}</DialogTitle></DialogHeader>
          {disposeFor && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg px-4 py-2.5 text-sm">
                Сегашна вредност: <b>{den(disposeFor.bookValue)} ден</b>
              </div>
              <div className="space-y-2">
                <Label>Датум на расход</Label>
                <Input type="date" value={disposal.date}
                  onChange={(e) => setDisposal({ ...disposal, date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Продажна вредност (0 ако е отпис)</Label>
                <Input type="number" step="0.01" value={disposal.value}
                  onChange={(e) => setDisposal({ ...disposal, value: e.target.value })} />
                <p className="text-[11px] text-gray-500">
                  {Number(disposal.value) - Number(disposeFor.bookValue) >= 0
                    ? `Добивка ${den(Number(disposal.value) - Number(disposeFor.bookValue))} ден`
                    : `Загуба ${den(Number(disposeFor.bookValue) - Number(disposal.value))} ден`}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Забелешка</Label>
                <Textarea rows={2} value={disposal.note}
                  onChange={(e) => setDisposal({ ...disposal, note: e.target.value })} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDisposeFor(null)}>Откажи</Button>
                <Button className="bg-amber-500 hover:bg-amber-600 text-white"
                  onClick={() => disposeMut.mutate({
                    id: disposeFor.id, disposalDate: disposal.date,
                    disposalValue: disposal.value, disposalNote: disposal.note || undefined,
                  })}>Расходувај</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Годишна амортизација */}
      <Dialog open={runOpen} onOpenChange={setRunOpen}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Годишна амортизација</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Label>Година</Label>
              <Input type="number" className="w-28" value={runYear}
                onChange={(e) => setRunYear(Number(e.target.value) || thisYear)} />
              <div className="ml-auto text-sm">
                Вкупно: <b>{den(run?.total)} ден</b>
                {run && <span className="text-gray-400 ml-2">({run.newCount} непроведени)</span>}
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Инв. број</TableHead>
                  <TableHead>Назив</TableHead>
                  <TableHead className="w-16">Мес.</TableHead>
                  <TableHead className="text-right">Амортизација</TableHead>
                  <TableHead className="text-right">Сегашна</TableHead>
                  <TableHead className="w-24">Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!run || run.lines.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-10 text-gray-400">
                    Нема средства со амортизација за {runYear}
                  </TableCell></TableRow>
                ) : run.lines.map((l: any) => (
                  <TableRow key={l.assetId}>
                    <TableCell className="font-mono text-xs">{l.inventoryNo}</TableCell>
                    <TableCell className="text-sm">{l.name}</TableCell>
                    <TableCell className="text-sm text-gray-500">{l.months}</TableCell>
                    <TableCell className="text-right font-medium">{den(l.amount)}</TableCell>
                    <TableCell className="text-right text-gray-600">{den(l.bookValue)}</TableCell>
                    <TableCell>
                      {l.alreadyPosted
                        ? <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50">проведено</Badge>
                        : <span className="text-xs text-gray-400">ново</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex justify-between items-center">
              <p className="text-[11px] text-gray-400 max-w-md">
                Проведувањето ја запишува пресметката за таа година. Веќе проведените не се повторуваат.
              </p>
              <div className="flex gap-2">
                <Button variant="outline"
                  onClick={() => { if (confirm(`Поништи ги записите за ${runYear}?`)) unpostMut.mutate({ year: runYear }); }}>
                  Поништи година
                </Button>
                <Button className="bg-amber-500 hover:bg-amber-600 text-white"
                  disabled={!run || run.newCount === 0 || postMut.isPending}
                  onClick={() => postMut.mutate({ year: runYear })}>
                  {postMut.isPending ? "..." : `Проведи (${run?.newCount ?? 0})`}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
