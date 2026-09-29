import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CalendarDays, ChevronLeft, ChevronRight, Wand2, Settings2, AlertTriangle } from "lucide-react";

const OPS: Record<string, string> = {
  cutting_laser: "Ласерско сечење", cutting_plasma: "Плазма сечење", bending: "Виткање",
  welding_mig: "MIG заварување", welding_tig: "TIG заварување", grinding: "Брусење",
  drilling: "Дупчење", painting: "Бојадисување", assembly: "Монтажа",
  quality_control: "Контрола на квалитет", packaging: "Пакување",
};
const DAY = ["Нед", "Пон", "Вто", "Сре", "Чет", "Пет", "Саб"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const monday = () => { const d = new Date(); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return iso(d); };
const shift = (d: string, n: number) => iso(new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000));
const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

export default function ScheduleBoard() {
  const utils = trpc.useUtils();
  const [from, setFrom] = useState(monday());
  const { data, isLoading } = trpc.ops.scheduleBoard.useQuery({ from, days: 14 });
  const { data: machines } = trpc.ops.machinesForSchedule.useQuery();
  const auto = trpc.ops.scheduleAuto.useMutation({
    onSuccess: (r) => {
      utils.ops.scheduleBoard.invalidate();
      toast.success(`Закажани ${r.scheduled} операции${r.overloaded ? ` (${r.overloaded} подолги од еден ден)` : ""}`);
    },
    onError: (e) => toast.error(e.message),
  });
  const setOp = trpc.ops.scheduleSet.useMutation({ onSuccess: () => utils.ops.scheduleBoard.invalidate(), onError: (e) => toast.error(e.message) });
  const saveMachine = trpc.ops.machineScheduleSettings.useMutation({
    onSuccess: () => { utils.ops.machinesForSchedule.invalidate(); utils.ops.scheduleBoard.invalidate(); toast.success("Зачувано"); },
  });
  const [edit, setEdit] = useState<null | { opId: number; label: string; machineId: string; date: string }>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const noMachines = !machines?.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setFrom(shift(from, -7))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => setFrom(monday())}>Оваа недела</Button>
          <Button size="sm" variant="outline" onClick={() => setFrom(shift(from, 7))}><ChevronRight className="h-4 w-4" /></Button>
          <span className="text-sm text-gray-500 ml-2 flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{dm(from)} – {dm(shift(from, 13))}</span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setCfgOpen(true)}><Settings2 className="h-3.5 w-3.5 mr-1.5" />Машини и капацитет</Button>
          <Button size="sm" className="bg-amber-500 hover:bg-amber-600" onClick={() => auto.mutate({})} disabled={auto.isPending}>
            <Wand2 className="h-3.5 w-3.5 mr-1.5" />Закажи автоматски
          </Button>
        </div>
      </div>

      {noMachines && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Нема внесени машини. Внеси ги во <b>Каталог → Машини</b>, па овде постави колку часа дневно работат и кои операции ги прават.
        </div>
      )}

      <Card><CardContent className="p-0 overflow-x-auto">
        {isLoading || !data ? <p className="py-10 text-center text-gray-400 text-sm">Вчитување...</p> : (
          <table className="w-full text-xs border-collapse min-w-[1000px]">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white z-10 text-left px-3 py-2 w-40 border-b font-semibold text-gray-500">Машина</th>
                {data.days.map(d => {
                  const w = new Date(d + "T00:00:00Z").getUTCDay();
                  const we = w === 0 || w === 6;
                  const isToday = d === iso(new Date());
                  return <th key={d} className={`px-1 py-2 border-b font-medium ${we ? "bg-gray-50 text-gray-300" : "text-gray-500"} ${isToday ? "text-amber-700" : ""}`}>
                    {DAY[w]}<div className="font-normal">{dm(d)}</div></th>;
                })}
              </tr>
            </thead>
            <tbody>
              {data.lanes.filter(l => l.id !== 0 || data.cells.find(c => c.machineId === 0)?.days.some(d => d.items.length)).map(l => {
                const row = data.cells.find(c => c.machineId === l.id)!;
                return (
                  <tr key={l.id}>
                    <td className="sticky left-0 bg-white z-10 px-3 py-2 border-b align-top">
                      <div className="font-medium text-gray-800 text-sm">{l.name}</div>
                      <div className="text-gray-400">{l.hoursPerDay} ч/ден</div>
                    </td>
                    {row.days.map(cell => {
                      const w = new Date(cell.date + "T00:00:00Z").getUTCDay();
                      const we = w === 0 || w === 6;
                      const pct = l.hoursPerDay ? cell.hours / l.hoursPerDay : 0;
                      const bar = pct > 1 ? "bg-red-500" : pct > 0.8 ? "bg-amber-400" : "bg-emerald-500";
                      return (
                        <td key={cell.date} className={`border-b border-l align-top p-1 w-[7%] ${we ? "bg-gray-50" : ""}`}>
                          {cell.hours > 0 && (
                            <div className="mb-1">
                              <div className="h-1 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${bar}`} style={{ width: `${Math.min(100, pct * 100)}%` }} /></div>
                              <div className={`text-[10px] mt-0.5 ${pct > 1 ? "text-red-600 font-semibold" : "text-gray-400"}`}>{cell.hours}/{l.hoursPerDay} ч</div>
                            </div>
                          )}
                          <div className="space-y-1">
                            {cell.items.map(it => (
                              <button key={it.opId} className={`w-full text-left rounded px-1.5 py-1 border text-[10.5px] leading-tight hover:ring-2 hover:ring-amber-300
                                ${it.status === "in_progress" ? "bg-blue-50 border-blue-200" : it.priority === "urgent" ? "bg-red-50 border-red-200" : it.priority === "high" ? "bg-orange-50 border-orange-200" : "bg-white border-gray-200"}`}
                                onClick={() => setEdit({ opId: it.opId, label: `${it.woNumber} · ${OPS[it.operation] ?? it.operation}`, machineId: String(l.id || ""), date: cell.date })}>
                                <div className="font-mono font-semibold">{it.woNumber}</div>
                                <div className="text-gray-500 truncate">{OPS[it.operation] ?? it.operation} · {it.hours}ч</div>
                              </button>
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent></Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card><CardContent className="p-4">
          <p className="font-semibold text-sm mb-2">Незакажани операции <span className="text-gray-400 font-normal">({data?.unscheduled.length ?? 0})</span></p>
          {!data?.unscheduled.length ? <p className="text-sm text-gray-400">Сите отворени операции се закажани.</p> : (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {data.unscheduled.map(u => (
                <button key={u.opId} className="w-full flex items-center gap-2 text-left text-sm border rounded-lg px-3 py-1.5 hover:bg-amber-50"
                  onClick={() => setEdit({ opId: u.opId, label: `${u.woNumber} · ${OPS[u.operation] ?? u.operation}`, machineId: u.machineId ? String(u.machineId) : "", date: from })}>
                  <span className="font-mono text-xs font-semibold w-28">{u.woNumber}</span>
                  <span className="flex-1">{u.sequence}. {OPS[u.operation] ?? u.operation}</span>
                  <span className="text-xs text-gray-400">{u.hours} ч</span>
                  {u.priority === "urgent" && <Badge className="bg-red-100 text-red-700 text-[10px]">итно</Badge>}
                </button>
              ))}
            </div>
          )}
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="font-semibold text-sm mb-2">Можна испорака по налог</p>
          {!data?.promises.length ? <p className="text-sm text-gray-400">Нема отворени налози со операции.</p> : (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {data.promises.map(p => (
                <div key={p.workOrderId} className="flex items-center gap-2 text-sm border-b last:border-b-0 py-1.5">
                  <span className="font-mono text-xs font-semibold w-28">{p.woNumber}</span>
                  <span className="flex-1 text-gray-600">{p.date ? `готово на ${dm(p.date)}` : "незакажано"}{p.unscheduled > 0 && p.date ? ` (+${p.unscheduled} незакажани)` : ""}</span>
                  {p.plannedEnd && <span className="text-xs text-gray-400">рок {dm(p.plannedEnd)}</span>}
                  {p.late && <Badge className="bg-red-100 text-red-700 text-[10px] flex items-center gap-1"><AlertTriangle className="h-3 w-3" />доцни</Badge>}
                </div>
              ))}
            </div>
          )}
        </CardContent></Card>
      </div>

      {/* Преместување на операција */}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{edit?.label}</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3">
              <Select value={edit.machineId || "none"} onValueChange={(v) => setEdit({ ...edit, machineId: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Без машина</SelectItem>
                  {machines?.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} />
              <div className="flex gap-2">
                <Button className="flex-1 bg-amber-500 hover:bg-amber-600" onClick={() => { setOp.mutate({ opId: edit.opId, machineId: edit.machineId ? Number(edit.machineId) : null, plannedDate: edit.date }); setEdit(null); }}>Закажи</Button>
                <Button variant="outline" onClick={() => { setOp.mutate({ opId: edit.opId, machineId: edit.machineId ? Number(edit.machineId) : null, plannedDate: null }); setEdit(null); }}>Отстрани од распоред</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Поставки на машини */}
      <Dialog open={cfgOpen} onOpenChange={setCfgOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Машини: капацитет и операции</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-500">Автоматското закажување ја праќа секоја операција на првата машина што ја прави.</p>
          <div className="space-y-3">
            {machines?.map(m => (
              <div key={m.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-3">
                  <span className="font-medium flex-1">{m.name}</span>
                  <span className="text-xs text-gray-500">часа/ден</span>
                  <Input type="number" className="w-20 h-8" defaultValue={m.hoursPerDay}
                    onBlur={(e) => { const v = parseFloat(e.target.value); if (v !== m.hoursPerDay) saveMachine.mutate({ id: m.id, hoursPerDay: v || 0, operations: m.operations }); }} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(OPS).map(([k, v]) => {
                    const on = m.operations.includes(k);
                    return (
                      <button key={k} className={`text-xs rounded-full px-2.5 py-1 border ${on ? "bg-amber-100 border-amber-300 text-amber-900" : "bg-white text-gray-500"}`}
                        onClick={() => saveMachine.mutate({ id: m.id, hoursPerDay: m.hoursPerDay, operations: on ? m.operations.filter(x => x !== k) : [...m.operations, k] })}>{v}</button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
