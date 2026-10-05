import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Ruler, ClipboardCheck, Award, Plus, Trash2, Pencil, AlertTriangle } from "lucide-react";

const fmtD = (d?: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "—");
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/** ISO 9001: мерни инструменти и калибрации, план на контрола, оценка на добавувачи. */
export default function QualitySystemTab() {
  const [view, setView] = useState<"instruments" | "plan" | "suppliers">("instruments");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-lg border bg-white p-0.5 w-fit">
        <Button size="sm" variant={view === "instruments" ? "default" : "ghost"} className="h-8" onClick={() => setView("instruments")}><Ruler className="h-4 w-4 mr-1.5" />Мерни инструменти</Button>
        <Button size="sm" variant={view === "plan" ? "default" : "ghost"} className="h-8" onClick={() => setView("plan")}><ClipboardCheck className="h-4 w-4 mr-1.5" />План на контрола</Button>
        <Button size="sm" variant={view === "suppliers" ? "default" : "ghost"} className="h-8" onClick={() => setView("suppliers")}><Award className="h-4 w-4 mr-1.5" />Оценка на добавувачи</Button>
      </div>
      {view === "instruments" && <Instruments />}
      {view === "plan" && <InspectionPlan />}
      {view === "suppliers" && <SupplierRating />}
    </div>
  );
}

// ───────────── Инструменти ─────────────
type InsForm = { id?: number; name: string; code: string; serialNo: string; range: string; location: string; intervalMonths: string; lastCalibration: string; status: "active" | "out" | "retired"; notes: string };
const EMPTY: InsForm = { name: "", code: "", serialNo: "", range: "", location: "", intervalMonths: "12", lastCalibration: "", status: "active", notes: "" };
const ST: Record<string, string> = { active: "во употреба", out: "надвор од употреба", retired: "отпишан" };

function Instruments() {
  const utils = trpc.useUtils();
  const { data } = trpc.mfg.instrumentList.useQuery();
  const [form, setForm] = useState<InsForm | null>(null);
  const [calFor, setCalFor] = useState<any | null>(null);
  const save = trpc.mfg.instrumentSave.useMutation({ onSuccess: () => { toast.success("Зачувано"); setForm(null); utils.mfg.instrumentList.invalidate(); }, onError: (e) => toast.error(e.message) });
  const del = trpc.mfg.instrumentDelete.useMutation({ onSuccess: () => utils.mfg.instrumentList.invalidate(), onError: (e) => toast.error(e.message) });
  const overdue = (data ?? []).filter((i) => i.overdue), soon = (data ?? []).filter((i) => i.dueSoon);
  return (
    <div className="space-y-3">
      {(overdue.length > 0 || soon.length > 0) && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{overdue.length ? `Истечена калибрација: ${overdue.map((i) => i.name).join(", ")} — мерењата со нив не се примаат. ` : ""}{soon.length ? `Во следните 30 дена: ${soon.map((i) => `${i.name} (${fmtD(i.nextDue)})`).join(", ")}.` : ""}</span>
        </div>
      )}
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-600">Секој мерен инструмент (шублер, микрометар, аголник, метар...) со рок на калибрација. Со неважечка калибрација не може да се внесе мерење.</p>
        <Button className="bg-amber-500 hover:bg-amber-600" onClick={() => setForm({ ...EMPTY })}><Plus className="h-4 w-4 mr-1.5" />Инструмент</Button>
      </div>
      <Card><CardContent className="p-0">
        {!data?.length ? <p className="py-8 text-center text-sm text-gray-400">Нема внесени инструменти</p> : data.map((i) => (
          <div key={i.id} className={`flex flex-wrap items-center gap-3 border-b last:border-b-0 px-4 py-2 text-sm ${i.status !== "active" ? "opacity-60" : ""}`}>
            <span className="font-mono text-xs w-20">{i.code ?? ""}</span>
            <span className="flex-1 min-w-[12rem]"><b>{i.name}</b> <span className="text-xs text-gray-500">{[i.serialNo && `сер. ${i.serialNo}`, i.range, i.location].filter(Boolean).join(" · ")}</span></span>
            <span className="text-xs w-44">калибриран {fmtD(i.lastCalibration)}<br /><span className={i.overdue ? "text-red-600 font-semibold" : i.dueSoon ? "text-amber-700" : "text-gray-500"}>следна {fmtD(i.nextDue)}</span></span>
            <span className="text-xs w-28 text-gray-500">{ST[i.status]}</span>
            <Button size="sm" variant="outline" className="h-7" onClick={() => setCalFor(i)}>Калибрација</Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setForm({ id: i.id, name: i.name, code: i.code ?? "", serialNo: i.serialNo ?? "", range: i.range ?? "", location: i.location ?? "", intervalMonths: String(i.intervalMonths), lastCalibration: i.lastCalibration ?? "", status: i.status, notes: i.notes ?? "" })}><Pencil className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-gray-400 hover:text-red-600" onClick={() => { if (confirm(`Да се избрише ${i.name}?`)) del.mutate({ id: i.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
      </CardContent></Card>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>{form?.id ? "Измени инструмент" : "Нов мерен инструмент"}</DialogTitle>
          {form && <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="col-span-2 space-y-1"><Label className="text-xs">Назив *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Шублер 0–150 mm" /></div>
            <div className="space-y-1"><Label className="text-xs">Ознака</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="ШУ-01" /></div>
            <div className="space-y-1"><Label className="text-xs">Сериски број</Label><Input value={form.serialNo} onChange={(e) => setForm({ ...form, serialNo: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Опсег / точност</Label><Input value={form.range} onChange={(e) => setForm({ ...form, range: e.target.value })} placeholder="0–150 mm, 0,02" /></div>
            <div className="space-y-1"><Label className="text-xs">Локација</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Калибрација на (месеци)</Label><Input type="number" value={form.intervalMonths} onChange={(e) => setForm({ ...form, intervalMonths: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Последна калибрација</Label><DateInput value={form.lastCalibration} onChange={(e) => setForm({ ...form, lastCalibration: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Статус</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as any })}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(ST).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="col-span-2 flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setForm(null)}>Откажи</Button>
              <Button className="bg-amber-500 hover:bg-amber-600" disabled={!form.name || save.isPending} onClick={() => save.mutate({
                id: form.id, name: form.name, code: form.code || undefined, serialNo: form.serialNo || undefined, range: form.range || undefined, location: form.location || undefined,
                intervalMonths: parseInt(form.intervalMonths) || 12, lastCalibration: form.lastCalibration || null, status: form.status, notes: form.notes || undefined })}>Зачувај</Button>
            </div>
          </div>}
        </DialogContent>
      </Dialog>
      {calFor && <CalibrationDialog ins={calFor} onClose={() => setCalFor(null)} />}
    </div>
  );
}

function CalibrationDialog({ ins, onClose }: { ins: any; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data } = trpc.mfg.calibrationList.useQuery({ instrumentId: ins.id });
  const [date, setDate] = useState(ymd(new Date())); const [result, setResult] = useState<"pass" | "fail">("pass");
  const [cert, setCert] = useState(""); const [provider, setProvider] = useState("");
  const add = trpc.mfg.calibrationAdd.useMutation({ onSuccess: (r) => { toast.success(r.nextDue ? `Следна калибрација ${fmtD(r.nextDue)}` : "Инструментот е изваден од употреба"); setCert(""); utils.mfg.invalidate(); }, onError: (e) => toast.error(e.message) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Калибрации — {ins.name}</DialogTitle>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="space-y-1"><Label className="text-xs">Датум</Label><DateInput value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Резултат</Label>
            <Select value={result} onValueChange={(v) => setResult(v as any)}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="pass">Во ред</SelectItem><SelectItem value="fail">Не одговара — вон употреба</SelectItem></SelectContent></Select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Број на сертификат</Label><Input value={cert} onChange={(e) => setCert(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Лабораторија</Label><Input value={provider} onChange={(e) => setProvider(e.target.value)} /></div>
          <Button className="col-span-2 bg-amber-500 hover:bg-amber-600" disabled={add.isPending} onClick={() => add.mutate({ instrumentId: ins.id, date, result, certificateNo: cert || undefined, provider: provider || undefined })}>Запиши калибрација</Button>
        </div>
        <div className="text-sm space-y-1 border-t pt-2">
          {(data ?? []).map((c) => <p key={c.id} className="text-xs"><b>{fmtD(c.date)}</b> · {c.result === "pass" ? "во ред" : <span className="text-red-600">не одговара</span>}{c.certificateNo ? ` · серт. ${c.certificateNo}` : ""}{c.provider ? ` · ${c.provider}` : ""}{c.nextDue ? ` · следна ${fmtD(c.nextDue)}` : ""}</p>)}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── План на контрола ─────────────
type PlanRow = { characteristic: string; operation: string; nominal: string; tolPlus: string; tolMinus: string; unit: string; instrumentId: string; frequency: string };
function InspectionPlan() {
  const utils = trpc.useUtils();
  const { data: products } = trpc.quotation.productList.useQuery();
  const { data: instruments } = trpc.mfg.instrumentList.useQuery();
  const [productId, setProductId] = useState<string>("general");
  const pid = productId === "general" ? null : Number(productId);
  const { data } = trpc.mfg.inspectionPlanList.useQuery({ productId: pid });
  const [rows, setRows] = useState<PlanRow[]>([]);
  useEffect(() => {
    if (!data) return;
    setRows(data.map((r) => ({ characteristic: r.characteristic, operation: r.operation ?? "", nominal: r.nominal === null ? "" : String(r.nominal), tolPlus: r.tolPlus === null ? "" : String(r.tolPlus),
      tolMinus: r.tolMinus === null ? "" : String(r.tolMinus), unit: r.unit ?? "mm", instrumentId: r.instrumentId ? String(r.instrumentId) : "", frequency: r.frequency ?? "" })));
  }, [data]);
  const save = trpc.mfg.inspectionPlanSave.useMutation({ onSuccess: () => { toast.success("Планот е зачуван"); utils.mfg.inspectionPlanList.invalidate(); }, onError: (e) => toast.error(e.message) });
  const num = (s: string) => (s.trim() === "" ? null : parseFloat(s.replace(",", ".")));
  const upd = (i: number, p: Partial<PlanRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <Card><CardContent className="p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Label className="text-xs">За</Label>
          <Select value={productId} onValueChange={setProductId}><SelectTrigger className="h-9 w-72"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="general">Сите налози (општ план)</SelectItem>{(products ?? []).map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent></Select>
        </div>
        <p className="text-xs text-gray-500 flex-1">Што се мери, номинална мерка со толеранција и со кој инструмент. На работниот налог мерењата се внесуваат во „Контрола“ и резултатот (во ред / не) се пресметува сам.</p>
      </div>
      <div className="space-y-1.5">
        <div className="grid grid-cols-[1fr_6rem_6rem_6rem_4rem_10rem_8rem_1.5rem] gap-1.5 text-[11px] text-gray-500"><span>Карактеристика</span><span>Номинал</span><span>+ толер.</span><span>− толер.</span><span>ЕМ</span><span>Инструмент</span><span>Колку често</span><span /></div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_6rem_6rem_6rem_4rem_10rem_8rem_1.5rem] gap-1.5">
            <Input className="h-8 text-xs" value={r.characteristic} placeholder="на пр. Должина, Агол на виткање, Визуелно — завар" onChange={(e) => upd(i, { characteristic: e.target.value })} />
            <Input className="h-8 text-xs" value={r.nominal} onChange={(e) => upd(i, { nominal: e.target.value })} />
            <Input className="h-8 text-xs" value={r.tolPlus} onChange={(e) => upd(i, { tolPlus: e.target.value })} />
            <Input className="h-8 text-xs" value={r.tolMinus} onChange={(e) => upd(i, { tolMinus: e.target.value })} />
            <Input className="h-8 text-xs" value={r.unit} onChange={(e) => upd(i, { unit: e.target.value })} />
            <Select value={r.instrumentId || "none"} onValueChange={(v) => upd(i, { instrumentId: v === "none" ? "" : v })}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">—</SelectItem>{(instruments ?? []).map((x) => <SelectItem key={x.id} value={String(x.id)}>{x.name}</SelectItem>)}</SelectContent></Select>
            <Input className="h-8 text-xs" value={r.frequency} placeholder="прво парче, 1/10" onChange={(e) => upd(i, { frequency: e.target.value })} />
            <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
      <div className="flex justify-between">
        <Button size="sm" variant="ghost" onClick={() => setRows([...rows, { characteristic: "", operation: "", nominal: "", tolPlus: "", tolMinus: "", unit: "mm", instrumentId: "", frequency: "" }])}><Plus className="h-3.5 w-3.5 mr-1" />Карактеристика</Button>
        <Button size="sm" className="bg-amber-500 hover:bg-amber-600" disabled={save.isPending || rows.some((r) => !r.characteristic.trim())}
          onClick={() => save.mutate({ productId: pid, items: rows.map((r) => ({ characteristic: r.characteristic.trim(), operation: r.operation || null, nominal: num(r.nominal), tolPlus: num(r.tolPlus), tolMinus: num(r.tolMinus), unit: r.unit || "mm", instrumentId: r.instrumentId ? Number(r.instrumentId) : null, frequency: r.frequency || undefined })) })}>
          Зачувај план
        </Button>
      </div>
    </CardContent></Card>
  );
}

// ───────────── Оценка на добавувачи ─────────────
function SupplierRating() {
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(ymd(new Date()));
  const { data } = trpc.mfg.supplierRating.useQuery({ from, to });
  const GR: Record<string, string> = { A: "bg-emerald-100 text-emerald-800", B: "bg-lime-100 text-lime-800", C: "bg-amber-100 text-amber-800", D: "bg-red-100 text-red-700" };
  return (
    <Card><CardContent className="p-4 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-sm text-gray-600 max-w-2xl">Годишна оценка (ISO 9001, 8.4): точност на испорака (прием до очекуваниот датум на набавната нарачка) 40%, квалитет (неусогласености по прием) 40%, цена (отстапување од нарачаната) 20%. A ≥ 90%, B ≥ 75%, C ≥ 60%.</p>
        <div className="flex gap-2">
          <div className="space-y-1"><Label className="text-xs">Од</Label><DateInput className="h-9 w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">До</Label><DateInput className="h-9 w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-gray-500 border-b"><th className="text-left font-medium py-2">Добавувач</th><th className="text-right font-medium">Приеми</th><th className="text-right font-medium">Навреме</th><th className="text-right font-medium">Неусогл.</th><th className="text-right font-medium">Цена</th><th className="text-right font-medium">Оценка</th></tr></thead>
        <tbody>
          {!data?.length ? <tr><td colSpan={6} className="py-8 text-center text-gray-400">Нема приеми во периодот</td></tr> : data.map((r) => (
            <tr key={r.supplierId} className="border-b border-gray-100">
              <td className="py-2 font-medium">{r.supplier}</td>
              <td className="text-right tabular-nums">{r.receipts}</td>
              <td className="text-right tabular-nums">{pct(r.delivery)}{r.withDate ? <span className="text-[11px] text-gray-400"> ({r.onTime}/{r.withDate})</span> : null}</td>
              <td className="text-right tabular-nums">{r.issues}</td>
              <td className="text-right tabular-nums">{r.priceDeviation === null ? "—" : `${r.priceDeviation >= 0 ? "+" : ""}${(r.priceDeviation * 100).toFixed(1)}%`}</td>
              <td className="text-right">{r.grade ? <span className={`rounded px-2 py-0.5 font-bold ${GR[r.grade]}`}>{r.grade} · {pct(r.score)}</span> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </CardContent></Card>
  );
}
