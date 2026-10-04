import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Trash2, Route } from "lucide-react";

export const OP_LABEL: Record<string, string> = {
  cutting_laser: "Ласерско сечење", cutting_plasma: "Плазма сечење", bending: "Виткање", welding_mig: "MIG/MAG заварување", welding_tig: "TIG заварување",
  grinding: "Брусење", drilling: "Дупчење", painting: "Бојосување", assembly: "Монтажа", quality_control: "Контрола", packaging: "Пакување",
};
type Step = { operation: string; description: string; machineId: string; setupMin: string; runMin: string };

/** Технолошка постапка на производ: операции по ред, машина, подготвително време и време по парче. */
export default function RoutingEditor({ productId }: { productId: number }) {
  const utils = trpc.useUtils();
  const { data } = trpc.mfg.routingList.useQuery({ productId });
  const { data: machines } = trpc.catalog.machineList.useQuery();
  const [steps, setSteps] = useState<Step[]>([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!data) return;
    setSteps(data.map((s) => ({ operation: s.operation, description: s.description ?? "", machineId: s.machineId ? String(s.machineId) : "", setupMin: String(s.setupMin), runMin: String(s.runMin) })));
    setDirty(false);
  }, [data]);
  const save = trpc.mfg.routingSave.useMutation({ onSuccess: (r) => { toast.success(`Постапката е зачувана (${r.count} операции)`); setDirty(false); utils.mfg.routingList.invalidate(); }, onError: (e) => toast.error(e.message) });
  const upd = (i: number, p: Partial<Step>) => { setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x))); setDirty(true); };
  const move = (i: number, d: -1 | 1) => { setSteps((s) => { const n = [...s]; const t = n[i]; n[i] = n[i + d]; n[i + d] = t; return n; }); setDirty(true); };
  const perUnit = steps.reduce((a, s) => a + (parseFloat(s.runMin) || 0), 0), setup = steps.reduce((a, s) => a + (parseFloat(s.setupMin) || 0), 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-semibold flex items-center gap-2"><Route className="h-4 w-4 text-amber-600" />Технолошка постапка</p>
        <span className="text-xs text-gray-500">подготовка {setup} мин · {perUnit} мин/ком</span>
      </div>
      <p className="text-xs text-gray-500">Кога ќе се отвори работен налог за овој производ, операциите се прават сами со пресметано време (подготовка + време по парче × количина) и цена на машината.</p>
      {steps.map((s, i) => (
        <div key={i} className="grid grid-cols-[1.5rem_9rem_1fr_9rem_4.5rem_4.5rem_4.5rem] gap-1.5 items-center">
          <span className="text-xs text-gray-400 text-right">{(i + 1) * 10}</span>
          <Select value={s.operation} onValueChange={(v) => upd(i, { operation: v })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(OP_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="h-8 text-xs" placeholder="Опис" value={s.description} onChange={(e) => upd(i, { description: e.target.value })} />
          <Select value={s.machineId || "none"} onValueChange={(v) => upd(i, { machineId: v === "none" ? "" : v })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Машина" /></SelectTrigger>
            <SelectContent><SelectItem value="none">— без машина —</SelectItem>{(machines ?? []).map((m: any) => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="h-8 text-xs" title="Подготовка (мин)" placeholder="подг." value={s.setupMin} onChange={(e) => upd(i, { setupMin: e.target.value })} />
          <Input className="h-8 text-xs" title="Време по парче (мин)" placeholder="мин/ком" value={s.runMin} onChange={(e) => upd(i, { runMin: e.target.value })} />
          <div className="flex">
            <button type="button" className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></button>
            <button type="button" className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></button>
            <button type="button" className="p-1 text-gray-400 hover:text-red-600" onClick={() => { setSteps(steps.filter((_, j) => j !== i)); setDirty(true); }}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      ))}
      <div className="flex justify-between">
        <Button size="sm" variant="ghost" onClick={() => { setSteps([...steps, { operation: "cutting_laser", description: "", machineId: "", setupMin: "0", runMin: "0" }]); setDirty(true); }}><Plus className="h-3.5 w-3.5 mr-1" />Операција</Button>
        <Button size="sm" className="bg-amber-500 hover:bg-amber-600" disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ productId, steps: steps.map((s) => ({ operation: s.operation as any, description: s.description || undefined, machineId: s.machineId ? Number(s.machineId) : null, setupMin: parseFloat(s.setupMin) || 0, runMin: parseFloat(s.runMin) || 0 })) })}>
          Зачувај постапка
        </Button>
      </div>
    </div>
  );
}
