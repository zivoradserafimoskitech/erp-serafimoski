import { useEffect, useMemo, useState } from "react";
import { DateInput } from "@/components/ui/date-input";
import { trpc } from "@/providers/trpc";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Factory, ShoppingCart, CalendarDays, User, Flag, Hash, AlertTriangle, Check, Loader2, StickyNote, X } from "lucide-react";

const PRIORITIES = [
  { key: "low", label: "Низок", dot: "bg-gray-400", on: "border-gray-400 bg-gray-50 text-gray-800" },
  { key: "normal", label: "Нормален", dot: "bg-blue-500", on: "border-blue-400 bg-blue-50 text-blue-800" },
  { key: "high", label: "Висок", dot: "bg-orange-500", on: "border-orange-400 bg-orange-50 text-orange-800" },
  { key: "urgent", label: "Итен", dot: "bg-red-500", on: "border-red-400 bg-red-50 text-red-800" },
];
const NO_ORDER = "none";
const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, d: number) => { const x = new Date(iso + "T00:00:00"); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
const empty = { woNumber: "", orderId: NO_ORDER, description: "", priority: "normal", plannedStart: "", plannedEnd: "", assignedTo: "", notes: "" };

/** Нов работен налог: поврзување со нарачка, приоритет, рокови. По креирањето се отвора налогот за операции и материјали. */
export default function WorkOrderCreateDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: number) => void }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState(empty);
  const [showNotes, setShowNotes] = useState(false);
  const set = (p: Partial<typeof empty>) => setForm(f => ({ ...f, ...p }));

  const { data: nextNum } = trpc.settings.nextDocNumber.useQuery({ kind: "workOrder" }, { enabled: open });
  const { data: orders } = trpc.customers.orderList.useQuery({}, { enabled: open });
  const { data: wos } = trpc.production.workOrderList.useQuery({}, { enabled: open });

  useEffect(() => { if (!open) { setForm(empty); setShowNotes(false); } }, [open]);
  useEffect(() => { if (open && nextNum && !form.woNumber) set({ woNumber: nextNum }); }, [open, nextNum]); // eslint-disable-line react-hooks/exhaustive-deps

  // Нарачки што сè уште немаат налог
  const withWo = useMemo(() => new Set((wos ?? []).map((w: any) => w.orderId).filter(Boolean)), [wos]);
  const openOrders = useMemo(() => (orders ?? []).filter((o: any) => !["delivered", "cancelled"].includes(o.status) && !withWo.has(o.id)), [orders, withWo]);
  const operators = useMemo(() => Array.from(new Set((wos ?? []).map((w: any) => w.assignedTo).filter(Boolean))) as string[], [wos]);
  const numberTaken = !!form.woNumber && (wos ?? []).some((w: any) => w.woNumber === form.woNumber.trim());

  const pickOrder = (id: string) => {
    if (id === NO_ORDER) { set({ orderId: NO_ORDER }); return; }
    const o: any = (orders ?? []).find((x: any) => String(x.id) === id);
    if (!o) return;
    const who = o.customerCompany || o.customerName || "";
    set({
      orderId: id,
      description: form.description || `Налог за нарачка ${o.orderNumber}${who ? ` · ${who}` : ""}`,
      priority: o.priority ?? form.priority,
      plannedStart: form.plannedStart || todayIso(),
      plannedEnd: o.deliveryDate ? String(o.deliveryDate).slice(0, 10) : form.plannedEnd,
    });
  };

  const create = trpc.production.workOrderCreate.useMutation({
    onSuccess: (r) => {
      toast.success(`Налогот ${form.woNumber} е креиран — додади операции и материјали`);
      utils.production.workOrderList.invalidate(); utils.production.productionStats.invalidate(); utils.customers.orderList.invalidate(); utils.ops.dealList.invalidate();
      onOpenChange(false);
      onCreated(r.id);
    },
    onError: (e) => toast.error(e.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (numberTaken) { toast.error(`Бројот ${form.woNumber} веќе постои`); return; }
    if (form.plannedStart && form.plannedEnd && form.plannedEnd < form.plannedStart) { toast.error("Крајот е пред почетокот"); return; }
    create.mutate({
      woNumber: form.woNumber.trim(), description: form.description.trim(), priority: form.priority as any,
      orderId: form.orderId !== NO_ORDER ? Number(form.orderId) : undefined,
      plannedStart: form.plannedStart || undefined, plannedEnd: form.plannedEnd || undefined,
      assignedTo: form.assignedTo.trim() || undefined, notes: form.notes.trim() || undefined,
    });
  };

  const selOrder: any = form.orderId !== NO_ORDER ? (orders ?? []).find((x: any) => String(x.id) === form.orderId) : null;
  const days = form.plannedStart && form.plannedEnd ? Math.round((new Date(form.plannedEnd).getTime() - new Date(form.plannedStart).getTime()) / 86400000) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden max-h-[92vh] flex flex-col [&>button]:hidden">
        {/* Заглавие */}
        <div className="flex items-start gap-3 px-6 py-5 bg-gradient-to-r from-primary/10 to-white border-b">
          <div className="h-11 w-11 rounded-xl bg-primary text-white flex items-center justify-center shadow-sm shrink-0"><Factory className="h-5 w-5" /></div>
          <div className="flex-1 min-w-0">
            <DialogTitle className="text-lg font-semibold text-gray-900">Нов работен налог</DialogTitle>
            <DialogDescription className="text-sm text-gray-500 mt-0.5">Операциите и материјалите ги додаваш веднаш по креирањето</DialogDescription>
          </div>
          <div className="text-right">
            <div className="relative">
              <Hash className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <Input value={form.woNumber} onChange={(e) => set({ woNumber: e.target.value })} required
                className={`h-9 w-40 pl-7 font-mono text-sm font-semibold ${numberTaken ? "border-red-400 text-red-700 focus-visible:ring-red-300" : ""}`} />
            </div>
            <div className={`mt-1 text-[11px] flex items-center justify-end gap-1 ${numberTaken ? "text-red-600" : "text-emerald-600"}`}>
              {form.woNumber ? numberTaken ? <><AlertTriangle className="h-3 w-3" />Бројот е зафатен</> : <><Check className="h-3 w-3" />Слободен број</> : null}
            </div>
          </div>
          <button type="button" onClick={() => onOpenChange(false)} className="text-gray-400 hover:text-gray-600 -mr-2 -mt-1 p-1" aria-label="Затвори"><X className="h-4 w-4" /></button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto">
          <div className="px-6 py-5 space-y-5">
            {/* Нарачка */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-gray-700"><ShoppingCart className="h-4 w-4 text-gray-400" />Нарачка <span className="text-gray-400 font-normal">(незадолжително)</span></Label>
              <Select value={form.orderId} onValueChange={pickOrder}>
                <SelectTrigger className="h-11 w-full"><SelectValue placeholder="Без нарачка (внатрешен налог)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ORDER}><span className="text-gray-500">Без нарачка — внатрешен налог</span></SelectItem>
                  {openOrders.map((o: any) => (
                    <SelectItem key={o.id} value={String(o.id)}>
                      <span className="font-mono text-xs font-semibold">{o.orderNumber}</span>
                      <span className="text-gray-600"> · {o.customerCompany || o.customerName}</span>
                      {o.deliveryDate && <span className="text-gray-400"> · рок {formatDate(o.deliveryDate)}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selOrder ? (
                <p className="text-xs text-emerald-700 bg-emerald-50 rounded-md px-3 py-2">Налогот ќе биде поврзан со <b>{selOrder.orderNumber}</b>. Потоа од него ќе можеш да направиш испратница и фактура, а нарачката оди во „Во производство“.</p>
              ) : openOrders.length > 0 ? (
                <p className="text-xs text-gray-400">{openOrders.length} нарачки чекаат налог</p>
              ) : null}
            </div>

            {/* Опис */}
            <div className="space-y-2">
              <Label className="text-gray-700">Што се произведува *</Label>
              <Textarea value={form.description} onChange={(e) => set({ description: e.target.value })} required rows={3}
                placeholder="пр. Челична конструкција за надстрешница 6×4 m, поцинкувана" className="resize-none" />
            </div>

            {/* Приоритет */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-gray-700"><Flag className="h-4 w-4 text-gray-400" />Приоритет</Label>
              <div className="grid grid-cols-4 gap-2">
                {PRIORITIES.map(p => (
                  <button key={p.key} type="button" onClick={() => set({ priority: p.key })}
                    className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${form.priority === p.key ? `${p.on} font-medium ring-1 ring-inset` : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                    <span className={`h-2 w-2 rounded-full ${p.dot}`} />{p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Рокови */}
            <div className="rounded-xl border bg-gray-50/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-gray-700"><CalendarDays className="h-4 w-4 text-gray-400" />Рокови</Label>
                {days !== null && days >= 0 && <span className="text-xs text-gray-500">{days === 0 ? "ист ден" : `${days} ${days === 1 ? "ден" : "дена"}`}</span>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-xs text-gray-500">Почеток</span>
                  <DateInput value={form.plannedStart} onChange={(e) => set({ plannedStart: e.target.value })} className="bg-white" />
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-gray-500">Крај</span>
                  <DateInput value={form.plannedEnd} min={form.plannedStart || undefined} onChange={(e) => set({ plannedEnd: e.target.value })} className="bg-white" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-gray-400 mr-1">Брзо:</span>
                {[{ l: "Од денес", d: -1 }, { l: "+3 дена", d: 3 }, { l: "+1 недела", d: 7 }, { l: "+2 недели", d: 14 }, { l: "+1 месец", d: 30 }].map(x => (
                  <button key={x.l} type="button" className="rounded-full border bg-white px-2.5 py-0.5 text-xs text-gray-600 hover:border-primary/50 hover:text-primary"
                    onClick={() => { const start = form.plannedStart || todayIso(); x.d < 0 ? set({ plannedStart: todayIso() }) : set({ plannedStart: start, plannedEnd: addDays(start, x.d) }); }}>
                    {x.l}
                  </button>
                ))}
              </div>
            </div>

            {/* Одговорен */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-gray-700"><User className="h-4 w-4 text-gray-400" />Одговорен / оператер</Label>
              <Input list="wo-operators" value={form.assignedTo} onChange={(e) => set({ assignedTo: e.target.value })} placeholder="Име на одговорниот за налогот" />
              <datalist id="wo-operators">{operators.map(o => <option key={o} value={o} />)}</datalist>
            </div>

            {/* Белешки */}
            {showNotes || form.notes ? (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-gray-700"><StickyNote className="h-4 w-4 text-gray-400" />Белешки</Label>
                <Textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} className="resize-none" placeholder="Напомени за подот, цртежи, посебни барања..." autoFocus />
              </div>
            ) : (
              <button type="button" onClick={() => setShowNotes(true)} className="text-sm text-primary hover:underline flex items-center gap-1.5"><StickyNote className="h-4 w-4" />Додади белешка</button>
            )}
          </div>

          {/* Подножје */}
          <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t bg-white px-6 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Откажи</Button>
            <Button type="submit" className="min-w-[180px]" disabled={create.isPending || numberTaken || !form.description.trim()}>
              {create.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Factory className="h-4 w-4 mr-2" />}Креирај налог
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
