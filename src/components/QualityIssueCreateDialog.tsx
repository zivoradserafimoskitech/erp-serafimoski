import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import SearchPick from "@/components/SearchPick";
import { toast } from "sonner";
import { ShieldAlert, Factory, UserX, Truck, Link2, Loader2 } from "lucide-react";

export type QualityPreset = { kind?: "internal" | "complaint" | "supplier"; workOrderId?: number; customerId?: number; supplierId?: number; materialId?: number; title?: string };
const today = () => new Date().toISOString().slice(0, 10);
const KINDS = [
  { key: "internal", label: "Грешка во производство", hint: "налог, машина, работник", icon: Factory },
  { key: "complaint", label: "Рекламација од клиент", hint: "клиентот пријавил проблем", icon: UserX },
  { key: "supplier", label: "Проблем со добавувач", hint: "лош материјал, доцнење, атест", icon: Truck },
] as const;

/** Нова неусогласеност: видот одредува кои врски се бараат; налог -> клиент и материјал -> добавувач се пополнуваат сами. */
export default function QualityIssueCreateDialog({ open, onOpenChange, preset, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; preset?: QualityPreset | null; onCreated?: (id: number) => void;
}) {
  const utils = trpc.useUtils();
  const { data: opt } = trpc.ops.qualityLinkOptions.useQuery(undefined, { enabled: open });
  const blank = { date: today(), kind: "internal" as string, title: "", description: "", workOrderId: null as number | null, customerId: null as number | null,
    supplierId: null as number | null, materialId: null as number | null, cost: "", responsible: "" };
  const [f, setF] = useState(blank);
  const set = (p: Partial<typeof blank>) => setF(x => ({ ...x, ...p }));
  useEffect(() => { if (open) setF({ ...blank, ...(preset ?? {}), kind: preset?.kind ?? (preset?.supplierId || preset?.materialId ? "supplier" : "internal"), title: preset?.title ?? "" }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const wos = opt?.wos ?? [];
  const woItems = useMemo(() => wos.filter(w => f.kind !== "complaint" || !f.customerId || w.customerId === f.customerId)
    .map(w => ({ id: w.id, label: w.number, sub: [w.customer, w.description].filter(Boolean).join(" · ").slice(0, 80) })), [wos, f.kind, f.customerId]);
  const custItems = (opt?.customers ?? []).map(c => ({ id: c.id, label: c.name }));
  const supItems = (opt?.suppliers ?? []).map(s => ({ id: s.id, label: s.name }));
  const matItems = (opt?.materials ?? []).map(m => ({ id: m.id, label: m.name, sub: m.code }));
  const wo = wos.find(w => w.id === f.workOrderId);
  const linkedNote = [wo?.customer && f.kind !== "supplier" ? `клиент: ${wo.customer}` : null].filter(Boolean).join(" · ");

  const pickWo = (id: number | null) => { const w = wos.find(x => x.id === id); set({ workOrderId: id, ...(w?.customerId && f.kind !== "supplier" ? { customerId: w.customerId } : {}) }); };
  const pickMat = (id: number | null) => { const m = opt?.materials.find(x => x.id === id); set({ materialId: id, ...(m?.supplierId && !f.supplierId ? { supplierId: m.supplierId } : {}) }); };

  const create = trpc.ops.qualityCreate.useMutation({
    onSuccess: (r) => { toast.success(`Внесена ${r.number}`); utils.ops.qualityList.invalidate(); utils.ops.qualityStats.invalidate(); onOpenChange(false); onCreated?.(r.id); },
    onError: (e) => toast.error(e.message),
  });
  const blocker = f.title.trim().length < 3 ? "Внеси кратко што е проблемот"
    : f.kind === "complaint" && !f.customerId ? "Избери клиент"
    : f.kind === "supplier" && !f.supplierId ? "Избери добавувач" : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-start gap-3 px-6 py-5 bg-gradient-to-r from-amber-50 to-white border-b">
          <div className="h-11 w-11 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0"><ShieldAlert className="h-5 w-5" /></div>
          <div><DialogTitle className="text-lg font-semibold">Нова неусогласеност</DialogTitle>
            <DialogDescription className="text-sm text-gray-500">Поврзи ја со налог, клиент или добавувач — потоа одовде се прави налог за доработка или се праќа рекламација.</DialogDescription></div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {KINDS.map(k => { const I = k.icon; const on = f.kind === k.key; return (
              <button key={k.key} type="button" onClick={() => set({ kind: k.key })}
                className={`text-left rounded-lg border p-3 transition ${on ? "border-amber-400 bg-amber-50 ring-1 ring-amber-300" : "hover:bg-gray-50"}`}>
                <div className="flex items-center gap-1.5 text-sm font-medium"><I className={`h-4 w-4 ${on ? "text-amber-600" : "text-gray-400"}`} />{k.label}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">{k.hint}</div>
              </button>); })}
          </div>

          <div className="space-y-1"><Label>Што е проблемот? *</Label>
            <Input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="пр. Погрешна мера на отвори, 12 парчиња" /></div>

          {/* Врски според видот */}
          <div className="rounded-xl border bg-gray-50/60 p-4 space-y-3">
            <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700"><Link2 className="h-4 w-4 text-gray-400" />Поврзано со</div>
            {f.kind === "complaint" && (
              <div className="space-y-1"><Label className="text-xs">Клиент *</Label>
                <SearchPick items={custItems} value={f.customerId} onChange={(id) => set({ customerId: id, workOrderId: null })} placeholder="Избери клиент" /></div>
            )}
            {f.kind === "supplier" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Материјал</Label>
                  <SearchPick items={matItems} value={f.materialId} onChange={pickMat} placeholder="Кој материјал?" /></div>
                <div className="space-y-1"><Label className="text-xs">Добавувач *</Label>
                  <SearchPick items={supItems} value={f.supplierId} onChange={(id) => set({ supplierId: id })} placeholder="Избери добавувач" /></div>
              </div>
            ) : null}
            <div className="space-y-1"><Label className="text-xs">Работен налог {f.kind === "supplier" ? "(каде се појавил проблемот)" : ""}</Label>
              <SearchPick items={woItems} value={f.workOrderId} onChange={pickWo} placeholder={f.kind === "complaint" && f.customerId ? "Налози на овој клиент" : "Избери налог"} />
              {linkedNote && <p className="text-[11px] text-emerald-700">Пополнето само — {linkedNote}</p>}
            </div>
          </div>

          <div className="space-y-1"><Label>Опис</Label><Textarea rows={3} value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="Што се случи, колку парчиња, како е забележано..." className="resize-none" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1"><Label className="text-xs">Датум</Label><DateInput value={f.date} onChange={(e) => set({ date: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Трошок (ден)</Label><Input type="number" min="0" value={f.cost} onChange={(e) => set({ cost: e.target.value })} placeholder="отпад, доработка" /></div>
            <div className="space-y-1"><Label className="text-xs">Одговорен</Label><Input value={f.responsible} onChange={(e) => set({ responsible: e.target.value })} /></div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
          <span className={`text-sm ${blocker ? "text-amber-700" : "text-emerald-700"}`}>{blocker ?? "Спремно"}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Откажи</Button>
            <Button className="bg-amber-500 hover:bg-amber-600 min-w-[140px]" disabled={!!blocker || create.isPending}
              onClick={() => create.mutate({ date: f.date, kind: f.kind as any, title: f.title.trim(), description: f.description || undefined,
                workOrderId: f.workOrderId ?? undefined, customerId: f.customerId ?? undefined, supplierId: f.supplierId ?? undefined, materialId: f.materialId ?? undefined,
                cost: parseFloat(f.cost) || 0, responsible: f.responsible || undefined })}>
              {create.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Внеси
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
