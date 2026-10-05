import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Trash2, CalendarDays } from "lucide-react";

const KINDS: Record<string, string> = { annual: "Годишен одмор", sick: "Боледување", unpaid: "Неплатено отсуство", paid_other: "Платено отсуство (свадба, смрт...)", holiday: "Државен празник" };
const fmtD = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

/** Отсуства: годишен одмор (со преостанати денови), боледување, неплатено... */
export default function AbsencesTab() {
  const utils = trpc.useUtils();
  const [year, setYear] = useState(new Date().getFullYear());
  const { data } = trpc.hr.absenceList.useQuery({ year });
  const { data: emps } = trpc.hr.employeesList.useQuery({});
  const [f, setF] = useState({ employeeId: "", kind: "annual", from: "", to: "", days: "", note: "" });
  const save = trpc.hr.absenceSave.useMutation({ onSuccess: (r) => { toast.success(`Внесено (${r.days} работни дена)`); setF({ ...f, from: "", to: "", days: "", note: "" }); utils.hr.invalidate(); }, onError: (e) => toast.error(e.message) });
  const del = trpc.hr.absenceDelete.useMutation({ onSuccess: () => utils.hr.invalidate(), onError: (e) => toast.error(e.message) });
  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4 space-y-3">
        <p className="font-semibold flex items-center gap-2"><CalendarDays className="h-4 w-4 text-amber-600" />Ново отсуство</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label className="text-xs">Вработен</Label>
            <Select value={f.employeeId} onValueChange={(v) => setF({ ...f, employeeId: v })}><SelectTrigger className="h-9 w-56"><SelectValue placeholder="Избери" /></SelectTrigger>
              <SelectContent>{(emps ?? []).map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.fullName}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Вид</Label>
            <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v })}><SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(KINDS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Од</Label><DateInput className="h-9 w-40" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: f.to || e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">До</Label><DateInput className="h-9 w-40" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Денови</Label><Input className="h-9 w-20" placeholder="авто" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></div>
          <div className="space-y-1 flex-1 min-w-[10rem]"><Label className="text-xs">Белешка</Label><Input className="h-9" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          <Button className="h-9 bg-amber-500 hover:bg-amber-600" disabled={!f.employeeId || !f.from || !f.to || save.isPending}
            onClick={() => save.mutate({ employeeId: Number(f.employeeId), kind: f.kind, from: f.from, to: f.to, days: f.days ? parseFloat(f.days) : undefined, note: f.note || undefined })}>Внеси</Button>
        </div>
        <p className="text-xs text-gray-500">Деновите се бројат сами (работни денови, без сабота и недела); за празник во периодот внеси ги рачно.</p>
      </CardContent></Card>

      <Card><CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="font-semibold">Годишен одмор {year}</p>
          <Input type="number" className="h-8 w-24" value={year} onChange={(e) => setYear(parseInt(e.target.value) || new Date().getFullYear())} />
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-500 border-b"><th className="text-left font-medium py-1.5">Вработен</th><th className="text-right font-medium">Право</th><th className="text-right font-medium">Искористено</th><th className="text-right font-medium">Преостанато</th><th className="text-right font-medium">Боледување</th><th className="text-right font-medium">Неплатено</th></tr></thead>
          <tbody>{(data?.balance ?? []).map((b) => (
            <tr key={b.employeeId} className="border-b border-gray-100"><td className="py-1.5 font-medium">{b.name}</td><td className="text-right">{b.entitled}</td><td className="text-right">{b.annualUsed}</td>
              <td className={`text-right font-semibold ${b.annualLeft < 0 ? "text-red-600" : ""}`}>{b.annualLeft}</td><td className="text-right">{b.sick || "—"}</td><td className="text-right">{b.unpaid || "—"}</td></tr>
          ))}</tbody>
        </table>
      </CardContent></Card>

      {!!data?.absences.length && (
        <Card><CardContent className="p-4 space-y-1 text-sm">
          {data.absences.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 border-b last:border-b-0 py-1.5">
              <span className="w-44 font-medium">{a.name}</span><span className="w-52">{a.label}</span><span className="w-48 text-gray-600">{fmtD(a.from)} – {fmtD(a.to)}</span>
              <span className="w-20 text-right">{a.days} д.</span><span className="flex-1 text-xs text-gray-500">{a.note}</span>
              <button className="text-gray-400 hover:text-red-600" onClick={() => { if (confirm("Да се избрише?")) del.mutate({ id: a.id }); }}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </CardContent></Card>
      )}
    </div>
  );
}
