import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import SearchPick from "@/components/SearchPick";
import { toast } from "sonner";
import { Plus, Trash2, Mail, CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("mk-MK", { maximumFractionDigits: 2 }));
const fmtD = (d?: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "—");
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ST: Record<string, string> = { draft: "нацрт", sent: "пратено", answered: "има одговори", ordered: "нарачано" };

// ───────────── Барања за понуда ─────────────
export function RfqTab() {
  const utils = trpc.useUtils();
  const { data } = trpc.purch.rfqList.useQuery();
  const [open, setOpen] = useState<number | null>(null);
  const [create, setCreate] = useState(false);
  const del = trpc.purch.rfqDelete.useMutation({ onSuccess: () => utils.purch.rfqList.invalidate() });
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-600">Барање за цена до повеќе добавувачи одеднаш — одговорите се споредуваат по ставка, а избраната понуда станува набавна нарачка.</p>
        <Button className="bg-amber-500 hover:bg-amber-600" onClick={() => setCreate(true)}><Plus className="h-4 w-4 mr-1.5" />Ново барање</Button>
      </div>
      <Card><CardContent className="p-0">
        {!data?.length ? <p className="py-8 text-center text-sm text-gray-400">Нема барања</p> : data.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 border-b last:border-b-0 px-4 py-2 text-sm">
            <button className="font-mono text-xs w-28 text-left text-amber-700 hover:underline" onClick={() => setOpen(r.id)}>{r.number}</button>
            <span className="flex-1 font-medium">{r.title}</span>
            <span className="text-xs text-gray-500">{r.answered}/{r.suppliers} одговори{r.neededBy ? ` · потребно ${fmtD(r.neededBy)}` : ""}</span>
            <span className="text-xs rounded bg-gray-100 px-1.5 py-0.5">{ST[r.status] ?? r.status}{r.poNumber ? ` ${r.poNumber}` : ""}</span>
            {!r.poNumber && <button className="text-gray-400 hover:text-red-600" onClick={() => { if (confirm("Да се избрише барањето?")) del.mutate({ id: r.id }); }}><Trash2 className="h-3.5 w-3.5" /></button>}
          </div>
        ))}
      </CardContent></Card>
      {create && <RfqCreate onClose={(id) => { setCreate(false); if (id) setOpen(id); }} />}
      {open && <RfqDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function RfqCreate({ onClose }: { onClose: (id?: number) => void }) {
  const utils = trpc.useUtils();
  const { data: mats } = trpc.quotation.materialList.useQuery({});
  const { data: sups } = trpc.procurement.supplierList.useQuery({});
  const [title, setTitle] = useState(""); const [neededBy, setNeededBy] = useState("");
  const [items, setItems] = useState<{ materialId: number | null; description: string; quantity: string; unit: string }[]>([{ materialId: null, description: "", quantity: "", unit: "" }]);
  const [selSup, setSelSup] = useState<number[]>([]);
  const matItems = useMemo(() => (mats ?? []).map((m: any) => ({ id: m.id as number, label: m.name, sub: m.code })), [mats]);
  const create = trpc.purch.rfqCreate.useMutation({ onSuccess: (r) => { toast.success(`Барање ${r.number}`); utils.purch.rfqList.invalidate(); onClose(r.id); }, onError: (e) => toast.error(e.message) });
  const valid = title.length >= 2 && selSup.length > 0 && items.every((i) => i.description && parseFloat(i.quantity) > 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogTitle>Ново барање за понуда</DialogTitle>
        <div className="grid grid-cols-[1fr_11rem] gap-2 text-sm">
          <div className="space-y-1"><Label className="text-xs">Наслов *</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="на пр. Лимови за нарачка НАР-012" /></div>
          <div className="space-y-1"><Label className="text-xs">Потребно до</Label><DateInput value={neededBy} onChange={(e) => setNeededBy(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5 text-sm">
          <p className="text-xs font-semibold text-gray-500">Ставки</p>
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_6rem_4rem_1.5rem] gap-1.5">
              <SearchPick items={matItems} value={it.materialId} onChange={(v) => { const m = (mats ?? []).find((x: any) => x.id === v); setItems(items.map((x, j) => j === i ? { ...x, materialId: v, description: x.description || (m?.name ?? ""), unit: m?.unit ?? x.unit } : x)); }} placeholder="Материјал" />
              <Input className="h-9" placeholder="Опис" value={it.description} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
              <Input className="h-9" placeholder="Количина" value={it.quantity} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} />
              <Input className="h-9" placeholder="ЕМ" value={it.unit} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))} />
              <button className="text-gray-400 hover:text-red-600" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setItems([...items, { materialId: null, description: "", quantity: "", unit: "" }])}><Plus className="h-3.5 w-3.5 mr-1" />Ставка</Button>
        </div>
        <div className="text-sm space-y-1">
          <p className="text-xs font-semibold text-gray-500">До кои добавувачи</p>
          <div className="flex flex-wrap gap-1.5">{(sups ?? []).map((s: any) => (
            <button key={s.id} type="button" onClick={() => setSelSup(selSup.includes(s.id) ? selSup.filter((x) => x !== s.id) : [...selSup, s.id])}
              className={`rounded-full border px-2.5 py-1 text-xs ${selSup.includes(s.id) ? "bg-amber-100 border-amber-400" : "bg-white"}`}>{s.name}</button>
          ))}</div>
        </div>
        <Button className="bg-amber-500 hover:bg-amber-600" disabled={!valid || create.isPending} onClick={() => create.mutate({ title, neededBy: neededBy || null,
          items: items.map((i) => ({ materialId: i.materialId, description: i.description, quantity: parseFloat(i.quantity), unit: i.unit || undefined })), supplierIds: selSup })}>Направи барање</Button>
      </DialogContent>
    </Dialog>
  );
}

function RfqDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data } = trpc.purch.rfqGet.useQuery({ id });
  const { data: settings } = trpc.settings.settingsGet.useQuery(undefined, { staleTime: 300_000 });
  const [resp, setResp] = useState<Record<number, Record<number, string>>>({});
  const [days, setDays] = useState<Record<number, string>>({});
  const inv = () => utils.purch.invalidate();
  const sent = trpc.purch.rfqMarkSent.useMutation({ onSuccess: inv });
  const respond = trpc.purch.rfqRespond.useMutation({ onSuccess: () => { toast.success("Одговорот е внесен"); inv(); }, onError: (e) => toast.error(e.message) });
  const choose = trpc.purch.rfqChoose.useMutation({ onSuccess: (r) => { toast.success(`Направена набавна нарачка ${r.poNumber} (нацрт)`); inv(); utils.procurement.poList.invalidate(); }, onError: (e) => toast.error(e.message) });
  if (!data) return null;
  const mailto = (o: any) => {
    const body = `Почитувани,\n\nВе молиме за понуда (цена по единица и рок на испорака) за:\n\n${data.items.map((i, k) => `${k + 1}. ${i.description} — ${i.quantity} ${i.unit ?? ""}`).join("\n")}\n${data.neededBy ? `\nПотребно до: ${fmtD(data.neededBy)}\n` : ""}\nБарање бр. ${data.number}\n\nСо почит,\n${settings?.name ?? ""}`;
    window.location.href = `mailto:${o.email ?? ""}?subject=${encodeURIComponent(`Барање за понуда ${data.number} — ${data.title}`)}&body=${encodeURIComponent(body)}`;
    sent.mutate({ rfqSupplierId: o.id });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogTitle>{data.number} — {data.title}</DialogTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b"><th className="text-left font-medium py-2">Ставка</th><th className="text-right font-medium">Кол.</th>
              {data.offers.map((o) => <th key={o.id} className={`text-right font-medium px-2 ${o.chosen ? "text-emerald-700" : ""}`}>{o.name}</th>)}</tr></thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id} className="border-b border-gray-100">
                  <td className="py-1.5">{i.description}</td><td className="text-right">{i.quantity} {i.unit}</td>
                  {data.offers.map((o) => {
                    const p = o.prices[i.id]; const best = data.best[i.id];
                    return <td key={o.id} className="text-right px-2">{o.respondedAt && !resp[o.id] ? <span className={p && p === best ? "font-bold text-emerald-700" : ""}>{fmt(p)}</span>
                      : <Input className="h-7 w-24 ml-auto text-right text-xs" placeholder="цена" value={resp[o.id]?.[i.id] ?? (p ? String(p) : "")} onChange={(e) => setResp({ ...resp, [o.id]: { ...(resp[o.id] ?? {}), [i.id]: e.target.value } })} />}</td>;
                  })}
                </tr>
              ))}
              <tr className="font-semibold"><td className="py-2">Вкупно</td><td />{data.offers.map((o) => <td key={o.id} className="text-right px-2">{fmt(o.total)}{o.deliveryDays !== null ? <div className="text-[11px] font-normal text-gray-500">рок {o.deliveryDays} д.</div> : null}</td>)}</tr>
              <tr><td colSpan={2} className="text-xs text-gray-500">Рок (денови)</td>{data.offers.map((o) => <td key={o.id} className="px-2"><Input className="h-7 w-20 ml-auto text-right text-xs" value={days[o.id] ?? (o.deliveryDays ?? "")} onChange={(e) => setDays({ ...days, [o.id]: e.target.value })} /></td>)}</tr>
              <tr><td colSpan={2} />{data.offers.map((o) => (
                <td key={o.id} className="px-2 py-2 text-right space-y-1">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => mailto(o)}><Mail className="h-3 w-3 mr-1" />{o.sentAt ? "пратено" : "прати"}</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => respond.mutate({ rfqSupplierId: o.id, deliveryDays: days[o.id] ? parseInt(days[o.id]) : o.deliveryDays,
                    prices: Object.fromEntries(data.items.map((i) => [String(i.id), parseFloat(resp[o.id]?.[i.id] ?? String(o.prices[i.id] ?? 0)) || 0])) })}>Зачувај одговор</Button>
                  {!data.poId && o.complete && <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => { if (confirm(`Да се нарача од ${o.name}?`)) choose.mutate({ rfqSupplierId: o.id }); }}><CheckCircle2 className="h-3 w-3 mr-1" />Избери</Button>}
                </td>
              ))}</tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500">Најдобрата цена по ставка е задебелена. Цените од одговорите се запишуваат во ценовникот на добавувачот.</p>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Ценовници ─────────────
export function PricesTab() {
  const utils = trpc.useUtils();
  const [materialId, setMaterialId] = useState<number | null>(null);
  const { data } = trpc.purch.priceList.useQuery(materialId ? { materialId } : undefined);
  const { data: mats } = trpc.quotation.materialList.useQuery({});
  const { data: sups } = trpc.procurement.supplierList.useQuery({});
  const matItems = useMemo(() => (mats ?? []).map((m: any) => ({ id: m.id as number, label: m.name, sub: m.code })), [mats]);
  const supItems = useMemo(() => (sups ?? []).map((s: any) => ({ id: s.id as number, label: s.name })), [sups]);
  const [f, setF] = useState<{ supplierId: number | null; materialId: number | null; price: string; leadDays: string }>({ supplierId: null, materialId: null, price: "", leadDays: "" });
  const save = trpc.purch.priceSave.useMutation({ onSuccess: () => { setF({ ...f, price: "" }); utils.purch.priceList.invalidate(); }, onError: (e) => toast.error(e.message) });
  const del = trpc.purch.priceDelete.useMutation({ onSuccess: () => utils.purch.priceList.invalidate() });
  const fromRec = trpc.purch.pricesFromReceipts.useMutation({ onSuccess: (r) => { toast.success(`Ажурирани ${r.updated} цени од приемниците`); utils.purch.priceList.invalidate(); } });
  const best = new Map<number, number>();
  for (const r of data ?? []) if (!best.has(r.materialId) || r.price < best.get(r.materialId)!) best.set(r.materialId, r.price);
  return (
    <div className="space-y-3">
      <Card><CardContent className="p-4 space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-56"><SearchPick items={supItems} value={f.supplierId} onChange={(v) => setF({ ...f, supplierId: v })} placeholder="Добавувач" /></div>
          <div className="flex-1 min-w-[14rem]"><SearchPick items={matItems} value={f.materialId} onChange={(v) => setF({ ...f, materialId: v })} placeholder="Материјал" /></div>
          <Input className="h-9 w-28" placeholder="Цена" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          <Input className="h-9 w-24" placeholder="Рок д." value={f.leadDays} onChange={(e) => setF({ ...f, leadDays: e.target.value })} />
          <Button className="h-9" disabled={!f.supplierId || !f.materialId || !(parseFloat(f.price) > 0)} onClick={() => save.mutate({ supplierId: f.supplierId!, materialId: f.materialId!, price: parseFloat(f.price), leadDays: f.leadDays ? parseInt(f.leadDays) : null })}>Зачувај</Button>
          <Button className="h-9" variant="outline" disabled={fromRec.isPending} onClick={() => fromRec.mutate()}>Од приемниците</Button>
        </div>
      </CardContent></Card>
      <div className="w-80"><SearchPick items={matItems} value={materialId} onChange={setMaterialId} placeholder="Филтрирај по материјал" /></div>
      <Card><CardContent className="p-0">
        {!data?.length ? <p className="py-8 text-center text-sm text-gray-400">Нема цени</p> : data.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 border-b last:border-b-0 px-4 py-1.5 text-sm">
            <span className="flex-1">{r.material}</span><span className="w-48">{r.supplier}</span>
            <span className={`w-32 text-right tabular-nums ${best.get(r.materialId) === r.price ? "font-bold text-emerald-700" : ""}`}>{fmt(r.price)} {r.currency === "MKD" ? "ден" : r.currency}/{r.unit}</span>
            <span className="w-20 text-xs text-gray-500">{r.leadDays !== null ? `${r.leadDays} д.` : ""}</span>
            <span className="w-36 text-xs text-gray-400">{r.source} · {fmtD(r.validFrom)}</span>
            <button className="text-gray-400 hover:text-red-600" onClick={() => del.mutate({ id: r.id })}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </CardContent></Card>
    </div>
  );
}

// ───────────── Нарачка ↔ приемница ↔ фактура ─────────────
export function MatchTab() {
  const [from, setFrom] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 2); return ymd(d); });
  const [to, setTo] = useState(ymd(new Date()));
  const { data } = trpc.purch.threeWayMatch.useQuery({ from, to });
  const bad = (data ?? []).filter((r) => !r.ok);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Label className="text-xs">Од</Label><DateInput className="h-9 w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">До</Label><DateInput className="h-9 w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <p className="text-xs text-gray-500 flex-1">Пред плаќање: дали фактурираното одговара на нарачаното (цена) и на примено (количина). Се проверуваат влезните фактури поврзани со набавна нарачка или приемница.</p>
      </div>
      {bad.length > 0 && <p className="text-sm text-red-700 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />{bad.length} фактури со разлики — проверете пред плаќање.</p>}
      <Card><CardContent className="p-0">
        {!data?.length ? <p className="py-8 text-center text-sm text-gray-400">Нема влезни фактури поврзани со нарачка/приемница во периодот</p> : data.map((r) => (
          <div key={r.invoiceId} className="border-b last:border-b-0 px-4 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              {r.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-red-600" />}
              <span className="font-mono text-xs w-28">{r.invoice}</span><span className="w-48">{r.supplier}</span><span className="text-xs text-gray-500 w-24">{fmtD(r.date)}</span>
              <span className="text-xs text-gray-500">нарачка {r.poNumber ?? "—"} · приемници {r.receipts}</span>
              <span className="flex-1" /><span className="tabular-nums">{fmt(r.invoiced)}</span><span className="text-xs text-gray-500">очекувано {fmt(r.expected)}</span>
            </div>
            {r.issues.map((x, i) => <p key={i} className="text-xs text-red-700 ml-7">{x}</p>)}
          </div>
        ))}
      </CardContent></Card>
    </div>
  );
}

// ───────────── Одобрување ─────────────
export function ApprovalsBar() {
  const utils = trpc.useUtils();
  const { data } = trpc.purch.pendingApprovals.useQuery();
  const { data: me } = trpc.appUsers.appUsersMe.useQuery();
  const [thr, setThr] = useState("");
  const [edit, setEdit] = useState(false);
  const approve = trpc.purch.poApprove.useMutation({ onSuccess: () => { toast.success("Одобрено"); utils.purch.invalidate(); }, onError: (e) => toast.error(e.message) });
  const saveThr = trpc.purch.approvalSettingsSave.useMutation({ onSuccess: () => { toast.success("Зачувано"); setEdit(false); utils.purch.invalidate(); }, onError: (e) => toast.error(e.message) });
  const isAdmin = !me || me.role === "admin";
  return (
    <div className="rounded-lg border bg-white px-3 py-2 text-sm space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-amber-600" />
        <span>{data?.threshold ? `Набавни нарачки над ${fmt(data.threshold)} ден бараат одобрување од администратор пред праќање.` : "Нема праг за одобрување на набавни нарачки."}</span>
        {isAdmin && !edit && <Button size="sm" variant="ghost" className="h-7" onClick={() => { setThr(data?.threshold ? String(data.threshold) : ""); setEdit(true); }}>Промени</Button>}
        {edit && <><Input className="h-7 w-32" placeholder="праг (ден)" value={thr} onChange={(e) => setThr(e.target.value)} /><Button size="sm" className="h-7" onClick={() => saveThr.mutate({ threshold: thr ? parseFloat(thr) : null })}>Зачувај</Button></>}
      </div>
      {(data?.list ?? []).map((p) => (
        <div key={p.id} className="flex items-center gap-3 border-t pt-1.5">
          <span className="font-mono text-xs w-28">{p.number}</span><span className="flex-1">{p.supplier}</span><span className="tabular-nums">{fmt(p.total)} ден</span>
          {isAdmin ? <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700" onClick={() => approve.mutate({ poId: p.id, approve: true })}>Одобри</Button> : <span className="text-xs text-amber-700">чека одобрување</span>}
        </div>
      ))}
    </div>
  );
}
