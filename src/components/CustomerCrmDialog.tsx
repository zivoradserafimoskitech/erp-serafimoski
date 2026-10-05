import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateInput } from "@/components/ui/date-input";
import SearchPick from "@/components/SearchPick";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/utils";
import { ACT } from "@/pages/Crm";
import { Link2, Copy, Trash2, StickyNote, AlertTriangle } from "lucide-react";

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("mk-MK", { maximumFractionDigits: 2 }));
const fmtD = (d?: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "");

/** Картон на клиент: продажни услови и посебни цени, активности, таен линк за порталот. */
export default function CustomerCrmDialog({ customer, onClose }: { customer: { id: number; name: string } | null; onClose: () => void }) {
  const [tab, setTab] = useState<"terms" | "sales" | "activity" | "portal">("terms");
  if (!customer) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogTitle className="flex flex-wrap items-center gap-3">{customer.name}<a href={`/crm/firmi/${customer.id}`} className="text-xs font-normal text-primary hover:underline">Отвори 360° преглед →</a></DialogTitle>
        <div className="flex flex-wrap gap-1 rounded-lg border bg-white p-0.5 w-fit">
          <Button size="sm" variant={tab === "terms" ? "default" : "ghost"} className="h-8" onClick={() => setTab("terms")}>Услови и цени</Button>
          <Button size="sm" variant={tab === "sales" ? "default" : "ghost"} className="h-8" onClick={() => setTab("sales")}>Зделки</Button>
          <Button size="sm" variant={tab === "activity" ? "default" : "ghost"} className="h-8" onClick={() => setTab("activity")}>Активности</Button>
          <Button size="sm" variant={tab === "portal" ? "default" : "ghost"} className="h-8" onClick={() => setTab("portal")}>Портал</Button>
        </div>
        {tab === "terms" && <Terms customerId={customer.id} />}
        {tab === "sales" && <PotentialSales customerId={customer.id} />}
        {tab === "activity" && <Activities customerId={customer.id} />}
        {tab === "portal" && <PortalLinks customerId={customer.id} />}
      </DialogContent>
    </Dialog>
  );
}

function PotentialSales({ customerId }: { customerId: number }) {
  const { data, isLoading } = trpc.crm.oppList.useQuery({ customerId, includeClosed: true });
  const fmt = (n: number) => n.toLocaleString("mk-MK", { maximumFractionDigits: 0 });
  if (isLoading) return <p className="text-sm text-gray-400 py-4">Се вчитува…</p>;
  if (!data?.length) {
    return (
      <p className="text-sm text-gray-500 py-4">
        Нема зделки за овој клиент.{" "}
        <a className="text-primary hover:underline" href={`/crm?new=1&customerId=${customerId}`}>Додај зделка</a>.
      </p>
    );
  }
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-muted-foreground">Отворени и затворени зделки поврзани со клиентот.</p>
      {data.map((o) => (
        <div key={o.id} className="flex items-start justify-between gap-2 border rounded-lg px-3 py-2">
          <div>
            <p className="font-medium">{o.title}</p>
            <p className="text-xs text-gray-500">
              {(o as any).products ? `${(o as any).products} · ` : ""}
              {fmt(o.value)} ден · фаза: {o.stage}
              {o.quoteNumber ? ` · понуда ${o.quoteNumber}` : ""}
              {o.owner ? ` · ${o.owner}` : ""}
            </p>
          </div>
          <a className="text-xs text-primary hover:underline shrink-0" href={`/crm?deal=${o.id}`}>Отвори</a>
        </div>
      ))}
    </div>
  );
}

function Terms({ customerId }: { customerId: number }) {
  const utils = trpc.useUtils();
  const { data } = trpc.crm.customerTerms.useQuery({ customerId });
  const { data: materials } = trpc.quotation.materialList.useQuery({});
  const { data: services } = trpc.quotation.serviceList.useQuery();
  const { data: products } = trpc.quotation.productList.useQuery();
  const [t, setT] = useState({ discountPct: "0", creditLimit: "", paymentDays: "" });
  useEffect(() => { if (data) setT({ discountPct: String(data.discountPct), creditLimit: data.creditLimit === null ? "" : String(data.creditLimit), paymentDays: data.paymentDays === null || data.paymentDays === undefined ? "" : String(data.paymentDays) }); }, [data]);
  const save = trpc.crm.customerTermsSave.useMutation({ onSuccess: () => { toast.success("Зачувано"); utils.crm.invalidate(); }, onError: (e) => toast.error(e.message) });
  const [p, setP] = useState<{ itemType: "material" | "service" | "product"; refId: number | null; price: string; discountPct: string }>({ itemType: "material", refId: null, price: "", discountPct: "" });
  const savePrice = trpc.crm.customerPriceSave.useMutation({ onSuccess: () => { setP({ ...p, refId: null, price: "", discountPct: "" }); utils.crm.customerTerms.invalidate(); }, onError: (e) => toast.error(e.message) });
  const delPrice = trpc.crm.customerPriceDelete.useMutation({ onSuccess: () => utils.crm.customerTerms.invalidate() });
  const items = useMemo(() => {
    const src: any[] = p.itemType === "material" ? (materials ?? []) : p.itemType === "service" ? (services ?? []) : (products ?? []);
    return src.map((x) => ({ id: x.id as number, label: x.name, sub: x.code ?? null }));
  }, [p.itemType, materials, services, products]);
  if (!data) return null;
  const over = data.creditLimit !== null && data.openBalance > data.creditLimit;
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border p-2"><p className="text-[11px] text-gray-500">Отворено сега</p><p className={`font-semibold ${over ? "text-red-600" : ""}`}>{fmt(data.openBalance)} ден</p></div>
        <div className="rounded-lg border p-2"><p className="text-[11px] text-gray-500">Просечно доцнење (12 мес.)</p><p className="font-semibold">{data.avgDaysLate === null ? "—" : `${data.avgDaysLate} дена`}<span className="text-xs text-gray-400"> · {data.paidInvoices} фактури</span></p></div>
        <div className="rounded-lg border p-2"><p className="text-[11px] text-gray-500">Кредитен лимит</p><p className="font-semibold">{data.creditLimit === null ? "без лимит" : `${fmt(data.creditLimit)} ден`}</p></div>
      </div>
      {over && <p className="text-xs text-red-700 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Клиентот е над кредитниот лимит — при нова понуда/фактура се прикажува предупредување.</p>}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Label className="text-xs">Општ попуст %</Label><Input className="h-9 w-24" value={t.discountPct} onChange={(e) => setT({ ...t, discountPct: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs">Кредитен лимит (ден)</Label><Input className="h-9 w-36" placeholder="без лимит" value={t.creditLimit} onChange={(e) => setT({ ...t, creditLimit: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs">Рок на плаќање (денови)</Label><Input className="h-9 w-24" value={t.paymentDays} onChange={(e) => setT({ ...t, paymentDays: e.target.value })} /></div>
        <Button className="h-9" variant="outline" disabled={save.isPending} onClick={() => save.mutate({ customerId, discountPct: parseFloat(t.discountPct) || 0, creditLimit: t.creditLimit ? parseFloat(t.creditLimit) : null, paymentDays: t.paymentDays ? parseInt(t.paymentDays) : null })}>Зачувај услови</Button>
      </div>
      <div className="border-t pt-3 space-y-2">
        <p className="font-semibold">Посебни цени</p>
        <p className="text-xs text-gray-500">Кога на понуда за овој клиент се додава ставката, се зема посебната цена (или посебниот попуст), инаку општиот попуст.</p>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={p.itemType} onValueChange={(v) => setP({ ...p, itemType: v as any, refId: null })}><SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="material">Материјал</SelectItem><SelectItem value="service">Услуга</SelectItem><SelectItem value="product">Производ</SelectItem></SelectContent></Select>
          <div className="flex-1 min-w-[14rem]"><SearchPick items={items} value={p.refId} onChange={(v) => setP({ ...p, refId: v })} placeholder="Ставка" /></div>
          <Input className="h-9 w-28" placeholder="цена" value={p.price} onChange={(e) => setP({ ...p, price: e.target.value })} />
          <Input className="h-9 w-24" placeholder="или %" value={p.discountPct} onChange={(e) => setP({ ...p, discountPct: e.target.value })} />
          <Button className="h-9" disabled={!p.refId || (!p.price && !p.discountPct)} onClick={() => savePrice.mutate({ customerId, itemType: p.itemType, refId: p.refId!, price: p.price ? parseFloat(p.price) : null, discountPct: p.discountPct ? parseFloat(p.discountPct) : null })}>Додај</Button>
        </div>
        {data.prices.map((x) => (
          <div key={x.id} className="flex items-center gap-2 text-xs border-t pt-1">
            <span className="w-20 text-gray-500">{x.itemType === "material" ? "материјал" : x.itemType === "service" ? "услуга" : "производ"}</span>
            <span className="flex-1">{x.item}</span><span className="w-32 text-right">{x.price !== null ? `${fmt(x.price)} ден` : `−${x.discountPct}%`}</span>
            <button className="text-gray-400 hover:text-red-600" onClick={() => delPrice.mutate({ id: x.id })}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Activities({ customerId }: { customerId: number }) {
  const utils = trpc.useUtils();
  const { data } = trpc.crm.activityList.useQuery({ customerId });
  const [a, setA] = useState({ kind: "call", subject: "", notes: "", dueDate: "" });
  const add = trpc.crm.activitySave.useMutation({ onSuccess: () => { setA({ ...a, subject: "", notes: "", dueDate: "" }); utils.crm.invalidate(); }, onError: (e) => toast.error(e.message) });
  const done = trpc.crm.activityDone.useMutation({ onSuccess: () => utils.crm.invalidate() });
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-1.5">
        <Select value={a.kind} onValueChange={(v) => setA({ ...a, kind: v })}><SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(ACT).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select>
        <Input className="h-9 flex-1 min-w-[14rem]" placeholder="Наслов" value={a.subject} onChange={(e) => setA({ ...a, subject: e.target.value })} />
        {a.kind === "task" && <DateInput className="h-9 w-40" value={a.dueDate} onChange={(e) => setA({ ...a, dueDate: e.target.value })} />}
        <Input className="h-9 w-full" placeholder="Белешка (што е договорено)" value={a.notes} onChange={(e) => setA({ ...a, notes: e.target.value })} />
        <Button className="h-9" disabled={a.subject.length < 2 || add.isPending} onClick={() => add.mutate({ customerId, kind: a.kind as any, subject: a.subject, notes: a.notes || undefined, dueDate: a.dueDate || null })}>Запиши</Button>
      </div>
      {!data?.length ? <p className="text-gray-400 text-center py-4">Нема записи</p> : data.map((x) => { const I = ACT[x.kind]?.icon ?? StickyNote; return (
        <div key={x.id} className="flex items-start gap-2 border-t pt-1.5">
          <I className="h-4 w-4 text-gray-400 mt-0.5" />
          <div className="flex-1"><p className={x.kind === "task" && x.doneAt ? "line-through text-gray-400" : ""}>{x.subject}</p>{x.notes && <p className="text-xs text-gray-500">{x.notes}</p>}
            <p className="text-[11px] text-gray-400">{formatDateTime(x.createdAt)}{x.createdBy ? ` · ${x.createdBy}` : ""}{x.opportunity ? ` · ${x.opportunity}` : ""}</p></div>
          {x.kind === "task" && <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={!!x.doneAt} onChange={(e) => done.mutate({ id: x.id, done: e.target.checked })} />{x.dueDate ? `до ${fmtD(x.dueDate)}` : "готово"}</label>}
        </div>
      ); })}
    </div>
  );
}

function PortalLinks({ customerId }: { customerId: number }) {
  const utils = trpc.useUtils();
  const { data } = trpc.crm.portalLinks.useQuery({ customerId });
  const [fresh, setFresh] = useState<string | null>(null);
  const create = trpc.crm.portalLinkCreate.useMutation({ onSuccess: (r) => { setFresh(`${window.location.origin}${r.path}`); utils.crm.portalLinks.invalidate(); }, onError: (e) => toast.error(e.message) });
  const revoke = trpc.crm.portalLinkRevoke.useMutation({ onSuccess: () => utils.crm.portalLinks.invalidate() });
  return (
    <div className="space-y-3 text-sm">
      <p className="text-gray-600">Клиентот со таен линк (без лозинка) ги гледа своите нарачки и докле се, фактурите (со PDF) и колку е отворено, сертификатите за материјал — и може да прати барање за понуда со цртеж. Линкот важи една година; може да се поништи во секое време.</p>
      <Button disabled={create.isPending} onClick={() => create.mutate({ customerId, days: 365 })}><Link2 className="h-4 w-4 mr-1.5" />Нов линк за порталот</Button>
      {fresh && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-1">
          <p className="text-xs text-emerald-800">Копирај го и прати го на клиентот — подоцна не може повторно да се види (се чува само шифриран).</p>
          <div className="flex gap-2"><Input readOnly className="h-8 font-mono text-xs" value={fresh} onFocus={(e) => e.target.select()} />
            <Button size="sm" variant="outline" className="h-8" onClick={() => { void navigator.clipboard?.writeText(fresh); toast.success("Копирано"); }}><Copy className="h-3.5 w-3.5" /></Button></div>
        </div>
      )}
      {(data ?? []).map((l) => (
        <div key={l.id} className={`flex items-center gap-3 border-t pt-1.5 text-xs ${l.revokedAt ? "opacity-50" : ""}`}>
          <span className="flex-1">создаден {formatDateTime(l.createdAt)}{l.createdBy ? ` · ${l.createdBy}` : ""} · {l.revokedAt ? "поништен" : l.lastUsedAt ? `последно отворен ${formatDateTime(l.lastUsedAt)}` : "уште не е отворен"}</span>
          {!l.revokedAt && <Button size="sm" variant="ghost" className="h-7 text-red-600" onClick={() => { if (confirm("Да се поништи линкот? Клиентот повеќе нема да може да го отвори.")) revoke.mutate({ id: l.id }); }}>Поништи</Button>}
        </div>
      ))}
    </div>
  );
}
