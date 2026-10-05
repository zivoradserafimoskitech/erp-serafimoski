import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { MaterialPicker } from "@/components/MaterialPicker";
import { isLowStock } from "@contracts/stock";
import { toast } from "sonner";
import { ShoppingCart, Truck, CalendarDays, Hash, Check, AlertTriangle, Plus, Trash2, Loader2, UserPlus, StickyNote, X, PackageSearch } from "lucide-react";

const UNIT_MK: Record<string, string> = { kg: "кг", m: "м", m2: "м²", pcs: "ком", l: "л", sheet: "табла", hour: "ч", m_cut: "м", bend: "свив." };
const VAT = 0.18;
type Row = { key: number; materialId: string; description: string; quantity: string; unitPrice: string };
const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const money = (n: number) => n.toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let rowKey = 1;
const emptyRow = (): Row => ({ key: rowKey++, materialId: "", description: "", quantity: "", unitPrice: "" });

/** Нова набавна нарачка: добавувач (или нов на лице место), ставки со материјали од магацин, рок и збир со ДДВ. */
export default function PurchaseOrderCreateDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (id: number) => void }) {
  const utils = trpc.useUtils();
  const [poNumber, setPoNumber] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [newSup, setNewSup] = useState<null | { name: string; phone: string; email: string }>(null);

  const { data: nextNum } = trpc.settings.nextDocNumber.useQuery({ kind: "po" }, { enabled: open });
  const { data: suppliers } = trpc.procurement.supplierList.useQuery(undefined, { enabled: open });
  const { data: pos } = trpc.procurement.poList.useQuery({}, { enabled: open });
  const { data: materials } = trpc.storage.materialList.useQuery({}, { enabled: open });

  useEffect(() => {
    if (!open) { setPoNumber(""); setSupplierId(""); setExpectedDate(""); setNotes(""); setShowNotes(false); setRows([emptyRow()]); setNewSup(null); }
  }, [open]);
  useEffect(() => { if (open && nextNum && !poNumber) setPoNumber(nextNum); }, [open, nextNum]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeSuppliers = useMemo(() => (suppliers ?? []).filter((s: any) => s.isActive !== "inactive"), [suppliers]);
  const sup: any = activeSuppliers.find((s: any) => String(s.id) === supplierId);
  const numberTaken = !!poNumber && (pos ?? []).some((p: any) => p.poNumber === poNumber.trim());
  const matById = useMemo(() => new Map<string, any>((materials ?? []).map((m: any) => [String(m.id), m])), [materials]);
  const lowStock = useMemo(() => (materials ?? []).filter((m: any) => isLowStock(m)), [materials]);

  const filled = rows.filter(r => r.materialId && parseFloat(r.quantity) > 0);
  const net = filled.reduce((s, r) => s + (parseFloat(r.quantity) || 0) * (parseFloat(r.unitPrice) || 0), 0);
  const halfRows = rows.filter(r => (r.materialId || r.quantity || r.unitPrice) && !(r.materialId && parseFloat(r.quantity) > 0));

  const setRow = (key: number, p: Partial<Row>) => setRows(rs => rs.map(r => r.key === key ? { ...r, ...p } : r));
  const pickMaterial = (key: number, m: any) => {
    const price = parseFloat(m.lastPurchasePrice) || parseFloat(m.avgCost) || 0;
    setRows(rs => {
      const next = rs.map(r => r.key === key ? { ...r, materialId: String(m.id), description: m.name, unitPrice: r.unitPrice || (price ? String(price) : "") } : r);
      // последниот ред е пополнет -> додади празен за следниот материјал
      return next[next.length - 1].materialId ? [...next, emptyRow()] : next;
    });
  };
  const addLowStock = () => {
    const have = new Set(rows.map(r => r.materialId));
    const add = lowStock.filter((m: any) => !have.has(String(m.id))).map((m: any) => {
      const need = Math.max(0, (parseFloat(m.minStock) || 0) * 2 - (parseFloat(m.currentStock) || 0));
      return { ...emptyRow(), materialId: String(m.id), description: m.name, quantity: need ? String(Math.ceil(need)) : "", unitPrice: String(parseFloat(m.lastPurchasePrice) || parseFloat(m.avgCost) || "") };
    });
    if (!add.length) { toast.info("Сите материјали под минимум се веќе во нарачката"); return; }
    setRows(rs => [...rs.filter(r => r.materialId || r.quantity), ...add, emptyRow()]);
    toast.success(`Додадени ${add.length} материјали под минимум`);
  };

  const supCreate = trpc.procurement.supplierCreate.useMutation({
    onSuccess: async (r) => {
      await utils.procurement.supplierList.invalidate();
      if (r.id) setSupplierId(String(r.id));
      toast.success(`Добавувачот ${newSup?.name} е додаден`);
      setNewSup(null);
    },
    onError: (e) => toast.error(e.message),
  });
  const create = trpc.procurement.poCreate.useMutation({
    onSuccess: (r) => {
      toast.success(`Набавната нарачка ${poNumber} е креирана`);
      utils.procurement.poList.invalidate();
      onOpenChange(false);
      onCreated?.(r.id);
    },
    onError: (e) => toast.error(e.message),
  });

  const blocker = !supplierId ? "Избери добавувач" : !filled.length ? "Додади барем еден материјал со количина"
    : halfRows.length ? `${halfRows.length} ${halfRows.length === 1 ? "ставка нема" : "ставки немаат"} материјал или количина` : numberTaken ? "Бројот е зафатен" : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (blocker) { toast.error(blocker); return; }
    create.mutate({
      poNumber: poNumber.trim(), supplierId: Number(supplierId), expectedDate: expectedDate || undefined, notes: notes.trim() || undefined,
      items: filled.map(r => {
        const q = parseFloat(r.quantity) || 0, p = parseFloat(r.unitPrice) || 0;
        return { materialId: Number(r.materialId), description: r.description.trim() || matById.get(r.materialId)?.name || "Материјал", quantity: String(q), unitPrice: p.toFixed(2), totalPrice: (q * p).toFixed(2) };
      }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl p-0 gap-0 overflow-hidden max-h-[94vh] flex flex-col [&>button]:hidden">
        {/* Заглавие */}
        <div className="flex items-start gap-3 px-6 py-5 bg-gradient-to-r from-primary/10 to-white border-b">
          <div className="h-11 w-11 rounded-xl bg-primary text-white flex items-center justify-center shadow-sm shrink-0"><ShoppingCart className="h-5 w-5" /></div>
          <div className="flex-1 min-w-0">
            <DialogTitle className="text-lg font-semibold text-gray-900">Нова набавна нарачка</DialogTitle>
            <DialogDescription className="text-sm text-gray-500 mt-0.5">Нарачка до добавувач — при прием се прави приемница и залихата се зголемува</DialogDescription>
          </div>
          <div className="text-right">
            <div className="relative">
              <Hash className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} required
                className={`h-9 w-40 pl-7 font-mono text-sm font-semibold ${numberTaken ? "border-red-400 text-red-700" : ""}`} />
            </div>
            {poNumber && <div className={`mt-1 text-[11px] flex items-center justify-end gap-1 ${numberTaken ? "text-red-600" : "text-emerald-600"}`}>
              {numberTaken ? <><AlertTriangle className="h-3 w-3" />Бројот е зафатен</> : <><Check className="h-3 w-3" />Слободен број</>}</div>}
          </div>
          <button type="button" onClick={() => onOpenChange(false)} className="text-gray-400 hover:text-gray-600 -mr-2 -mt-1 p-1" aria-label="Затвори"><X className="h-4 w-4" /></button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto flex flex-col">
          <div className="px-6 py-5 space-y-5 flex-1">
            {/* Добавувач + рок */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="md:col-span-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5 text-gray-700"><Truck className="h-4 w-4 text-gray-400" />Добавувач *</Label>
                  {!newSup && <button type="button" className="text-xs text-primary hover:underline flex items-center gap-1" onClick={() => setNewSup({ name: "", phone: "", email: "" })}><UserPlus className="h-3.5 w-3.5" />Нов добавувач</button>}
                </div>
                {newSup ? (
                  <div className="rounded-lg border border-primary/20 bg-primary/10 p-3 space-y-2">
                    <Input autoFocus placeholder="Назив на фирмата *" value={newSup.name} onChange={(e) => setNewSup({ ...newSup, name: e.target.value })} className="bg-white" />
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="Телефон" value={newSup.phone} onChange={(e) => setNewSup({ ...newSup, phone: e.target.value })} className="bg-white" />
                      <Input placeholder="Е-пошта" type="email" value={newSup.email} onChange={(e) => setNewSup({ ...newSup, email: e.target.value })} className="bg-white" />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setNewSup(null)}>Откажи</Button>
                      <Button type="button" size="sm" disabled={!newSup.name.trim() || supCreate.isPending}
                        onClick={() => supCreate.mutate({ name: newSup.name.trim(), phone: newSup.phone || undefined, email: newSup.email || undefined, country: "Македонија" } as any)}>
                        {supCreate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}Зачувај и избери
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Select value={supplierId} onValueChange={setSupplierId}>
                    <SelectTrigger className="h-11 w-full"><SelectValue placeholder={activeSuppliers.length ? "Избери добавувач" : "Нема добавувачи — додади нов →"} /></SelectTrigger>
                    <SelectContent>
                      {activeSuppliers.map((s: any) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          <span className="font-medium">{s.name}</span>{s.city && <span className="text-gray-400"> · {s.city}</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {sup && !newSup && (
                  <p className="text-xs text-gray-500 flex flex-wrap gap-x-3">
                    {sup.contactPerson && <span>{sup.contactPerson}</span>}{sup.phone && <span>{sup.phone}</span>}{sup.email && <span>{sup.email}</span>}
                    {sup.paymentTerms && <span>Плаќање: {sup.paymentTerms}</span>}
                  </p>
                )}
              </div>
              <div className="md:col-span-2 space-y-2">
                <Label className="flex items-center gap-1.5 text-gray-700"><CalendarDays className="h-4 w-4 text-gray-400" />Очекуван прием</Label>
                <DateInput value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} min={todayIso()} />
                <div className="flex flex-wrap gap-1.5">
                  {[{ l: "+3 дена", d: 3 }, { l: "+1 недела", d: 7 }, { l: "+2 недели", d: 14 }].map(x => (
                    <button key={x.l} type="button" onClick={() => setExpectedDate(addDays(x.d))}
                      className="rounded-full border bg-white px-2.5 py-0.5 text-xs text-gray-600 hover:border-primary/50 hover:text-primary">{x.l}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* Ставки */}
            <div className="rounded-xl border overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-gray-50 border-b">
                <span className="font-medium text-sm text-gray-800">Ставки <span className="text-gray-400 font-normal">({filled.length})</span></span>
                <div className="flex gap-2">
                  {lowStock.length > 0 && (
                    <Button type="button" size="sm" variant="outline" className="h-8 text-foreground/80 border-primary/40 hover:bg-accent" onClick={addLowStock}>
                      <PackageSearch className="h-3.5 w-3.5 mr-1.5" />Под минимум ({lowStock.length})
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => setRows(rs => [...rs, emptyRow()])}><Plus className="h-3.5 w-3.5 mr-1" />Ставка</Button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b">
                      <th className="text-left font-medium px-3 py-2 w-8">#</th>
                      <th className="text-left font-medium px-2 py-2 w-[30%]">Материјал</th>
                      <th className="text-left font-medium px-2 py-2">Опис</th>
                      <th className="text-right font-medium px-2 py-2 w-36">Количина</th>
                      <th className="text-right font-medium px-2 py-2 w-28">Цена / ед.</th>
                      <th className="text-right font-medium px-2 py-2 w-28">Вкупно</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const m: any = matById.get(r.materialId);
                      const line = (parseFloat(r.quantity) || 0) * (parseFloat(r.unitPrice) || 0);
                      const unit = m ? UNIT_MK[m.unit] ?? m.unit : "";
                      const half = (r.materialId || r.quantity || r.unitPrice) && !(r.materialId && parseFloat(r.quantity) > 0);
                      return (
                        <tr key={r.key} className={`border-b last:border-b-0 align-top ${half ? "bg-red-50/40" : ""}`}>
                          <td className="px-3 py-2.5 text-xs text-gray-400">{i + 1}</td>
                          <td className="px-2 py-2">
                            <MaterialPicker materials={materials as any} value={r.materialId} onSelect={(mm) => pickMaterial(r.key, mm)} placeholder="Избери материјал…" />
                            {m && (
                              <div className={`mt-1 text-[11px] ${isLowStock(m) ? "text-red-600" : "text-gray-400"}`}>
                                На залиха {parseFloat(m.currentStock) || 0} {unit}{parseFloat(m.minStock) > 0 ? ` · мин. ${parseFloat(m.minStock)}` : ""}
                                {parseFloat(m.lastPurchasePrice) > 0 && <> · последна цена {money(parseFloat(m.lastPurchasePrice))}</>}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2"><Input value={r.description} onChange={(e) => setRow(r.key, { description: e.target.value })} placeholder="пр. лим 3mm S235, 1500×3000" /></td>
                          <td className="px-2 py-2">
                            <div className="relative">
                              <Input type="number" step="0.001" min="0" inputMode="decimal" value={r.quantity} onChange={(e) => setRow(r.key, { quantity: e.target.value })}
                                className={`text-right tabular-nums ${unit ? "pr-12" : ""}`} placeholder="0" />
                              {unit && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">{unit}</span>}
                            </div>
                          </td>
                          <td className="px-2 py-2"><Input type="number" step="0.01" min="0" inputMode="decimal" value={r.unitPrice} onChange={(e) => setRow(r.key, { unitPrice: e.target.value })} className="text-right tabular-nums" placeholder="0.00" /></td>
                          <td className="px-2 py-2.5 text-right tabular-nums font-medium text-gray-800">{line ? money(line) : <span className="text-gray-300">—</span>}</td>
                          <td className="px-1 py-2 text-center">
                            <button type="button" aria-label="Отстрани" className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                              onClick={() => setRows(rs => rs.length > 1 ? rs.filter(x => x.key !== r.key) : [emptyRow()])}><Trash2 className="h-4 w-4" /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end border-t bg-gray-50/60 px-4 py-3">
                <dl className="text-sm grid grid-cols-[auto_auto] gap-x-6 gap-y-1">
                  <dt className="text-gray-500">Износ без ДДВ</dt><dd className="text-right tabular-nums">{money(net)} ден.</dd>
                  <dt className="text-gray-500">ДДВ 18%</dt><dd className="text-right tabular-nums">{money(net * VAT)} ден.</dd>
                  <dt className="font-semibold text-gray-900">Вкупно со ДДВ</dt><dd className="text-right tabular-nums font-semibold text-gray-900">{money(net * (1 + VAT))} ден.</dd>
                </dl>
              </div>
            </div>

            {showNotes || notes ? (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-gray-700"><StickyNote className="h-4 w-4 text-gray-400" />Белешки за добавувачот</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="resize-none" placeholder="Услови за испорака, атести, сечење на мерка..." autoFocus />
              </div>
            ) : (
              <button type="button" onClick={() => setShowNotes(true)} className="text-sm text-primary hover:underline flex items-center gap-1.5"><StickyNote className="h-4 w-4" />Додади белешка</button>
            )}
          </div>

          {/* Подножје */}
          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t bg-white px-6 py-4">
            <span className={`text-sm flex items-center gap-1.5 ${blocker ? "text-primary" : "text-emerald-700"}`}>
              {blocker ? <><AlertTriangle className="h-4 w-4" />{blocker}</> : <><Check className="h-4 w-4" />Спремно · {filled.length} {filled.length === 1 ? "ставка" : "ставки"}</>}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Откажи</Button>
              <Button type="submit" className="min-w-[200px]" disabled={create.isPending || !!blocker}>
                {create.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShoppingCart className="h-4 w-4 mr-2" />}Креирај нарачка
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
