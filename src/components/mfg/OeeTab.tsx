import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/utils";
import { Gauge, PauseCircle, PlayCircle, Trash2 } from "lucide-react";

export const DOWNTIME_REASONS: Record<string, string> = {
  breakdown: "Дефект / расипување", setup: "Подесување / промена на алат", no_material: "Нема материјал", no_operator: "Нема оператор",
  maintenance: "Планирано одржување", no_work: "Нема работа", other: "Друго",
};
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const tone = (v: number | null) => (v === null ? "text-gray-400" : v >= 0.85 ? "text-emerald-700" : v >= 0.6 ? "text-amber-700" : "text-red-600");

/** Застои на машините и OEE по машина (достапност × учинок × квалитет). */
export default function OeeTab() {
  const utils = trpc.useUtils();
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(1); return ymd(d); });
  const [to, setTo] = useState(ymd(new Date()));
  const { data: oee } = trpc.mfg.oee.useQuery({ from, to });
  const { data: log } = trpc.mfg.downtimeList.useQuery({ from, to });
  const { data: machines } = trpc.catalog.machineList.useQuery();
  const [machineId, setMachineId] = useState(""); const [reason, setReason] = useState("breakdown"); const [note, setNote] = useState("");
  const [past, setPast] = useState(false); const [st, setSt] = useState(""); const [en, setEn] = useState("");
  const inv = () => utils.mfg.invalidate();
  const start = trpc.mfg.downtimeStart.useMutation({ onSuccess: () => { toast.success(past ? "Застојот е внесен" : "Застојот тече — заврши го кога машината ќе проработи"); setNote(""); inv(); }, onError: (e) => toast.error(e.message) });
  const end = trpc.mfg.downtimeEnd.useMutation({ onSuccess: () => { toast.success("Машината работи"); inv(); } });
  const del = trpc.mfg.downtimeDelete.useMutation({ onSuccess: inv, onError: (e) => toast.error(e.message) });
  const running = (log ?? []).filter((d) => !d.endAt);

  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4 space-y-3">
        <p className="font-semibold flex items-center gap-2"><PauseCircle className="h-4 w-4 text-red-600" />Пријави застој</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label className="text-xs">Машина</Label>
            <Select value={machineId} onValueChange={setMachineId}><SelectTrigger className="h-9 w-56"><SelectValue placeholder="Избери машина" /></SelectTrigger>
              <SelectContent>{(machines ?? []).map((m: any) => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Причина</Label>
            <Select value={reason} onValueChange={setReason}><SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(DOWNTIME_REASONS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1 flex-1 min-w-[10rem]"><Label className="text-xs">Белешка</Label><Input className="h-9" value={note} onChange={(e) => setNote(e.target.value)} placeholder="што се случи" /></div>
          <label className="flex items-center gap-1.5 text-xs h-9"><input type="checkbox" checked={past} onChange={(e) => setPast(e.target.checked)} />веќе завршен</label>
          {past && <>
            <div className="space-y-1"><Label className="text-xs">Од</Label><Input type="datetime-local" className="h-9 w-48" value={st} onChange={(e) => setSt(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">До</Label><Input type="datetime-local" className="h-9 w-48" value={en} onChange={(e) => setEn(e.target.value)} /></div>
          </>}
          <Button className="h-9 bg-red-600 hover:bg-red-700" disabled={!machineId || start.isPending || (past && (!st || !en))}
            onClick={() => start.mutate({ machineId: Number(machineId), reason, note: note || undefined, ...(past ? { startAt: new Date(st).toISOString(), endAt: new Date(en).toISOString() } : {}) })}>
            {past ? "Внеси" : "Застој почнува сега"}
          </Button>
        </div>
        {running.map((d) => (
          <div key={d.id} className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <b>{d.machine}</b><span>{d.reasonLabel}</span><span className="text-gray-500">од {formatDateTime(d.startAt)} · {d.minutes} мин</span>
            <span className="flex-1" />
            <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700" onClick={() => end.mutate({ id: d.id })}><PlayCircle className="h-3.5 w-3.5 mr-1" />Машината работи</Button>
          </div>
        ))}
      </CardContent></Card>

      <Card><CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <p className="font-semibold flex items-center gap-2"><Gauge className="h-4 w-4 text-amber-600" />OEE по машина</p>
          <div className="flex gap-2">
            <div className="space-y-1"><Label className="text-xs">Од</Label><DateInput className="h-9 w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">До</Label><DateInput className="h-9 w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b">
              <th className="text-left font-medium py-2">Машина</th><th className="text-right font-medium">Планирано ч</th><th className="text-right font-medium">Застои ч</th>
              <th className="text-right font-medium">Достапност</th><th className="text-right font-medium">Учинок</th><th className="text-right font-medium">Квалитет</th><th className="text-right font-medium">OEE</th>
            </tr></thead>
            <tbody>
              {(oee ?? []).map((m) => (
                <tr key={m.machineId} className="border-b border-gray-100">
                  <td className="py-2 font-medium">{m.machine}<div className="text-[11px] text-gray-400 font-normal">{m.opsCompleted} операции · {m.estHours} ч норма / {m.actualHours} ч вистински{m.qualityIssues ? ` · ${m.qualityIssues} неусогл.` : ""}</div></td>
                  <td className="text-right tabular-nums">{m.plannedHours}{m.excludedHours ? <div className="text-[11px] text-gray-400">−{m.excludedHours} план./нема работа</div> : null}</td>
                  <td className="text-right tabular-nums">{m.downtimeHours}</td>
                  <td className={`text-right tabular-nums ${tone(m.availability)}`}>{pct(m.availability)}</td>
                  <td className={`text-right tabular-nums ${tone(m.performance)}`}>{pct(m.performance)}</td>
                  <td className={`text-right tabular-nums ${tone(m.quality)}`}>{pct(m.quality)}</td>
                  <td className={`text-right tabular-nums text-base font-bold ${tone(m.oee)}`}>{pct(m.oee)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500">Достапност = планирано време (работни денови × часови на машината) минус застоите; планираното одржување и „нема работа“ не се сметаат за губиток. Учинок = нормирано / вистинско време на завршените операции. Квалитет = налози без неусогласеност. Светска класа е околу 85%; „—“ значи дека нема доволно податоци.</p>
      </CardContent></Card>

      {!!log?.length && (
        <Card><CardContent className="p-4 space-y-1 text-sm">
          <p className="font-semibold mb-1">Дневник на застои</p>
          {log.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-3 border-t py-1.5">
              <span className="w-36 text-gray-500 text-xs">{formatDateTime(d.startAt)}</span>
              <span className="w-40 font-medium">{d.machine}</span>
              <span className="w-48">{d.reasonLabel}</span>
              <span className="w-20 text-right tabular-nums">{d.endAt ? `${d.minutes} мин` : "тече"}</span>
              <span className="flex-1 text-xs text-gray-500 truncate">{d.note}{d.createdBy ? ` · ${d.createdBy}` : ""}</span>
              <button className="text-gray-400 hover:text-red-600" onClick={() => { if (confirm("Да се избрише записот?")) del.mutate({ id: d.id }); }}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </CardContent></Card>
      )}
    </div>
  );
}
