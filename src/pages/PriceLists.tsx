import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SearchPick from "@/components/SearchPick";
import PageHeader from "@/components/layout/PageHeader";
import { toast } from "sonner";
import { Tags, Trash2 } from "lucide-react";

const fmt = (n: number) => n.toLocaleString("mk-MK", { maximumFractionDigits: 2 });

/** Ценовници / услови по клиент — првокласен екран врз customer_prices. */
export default function PriceLists() {
  const utils = trpc.useUtils();
  const { data: customers } = trpc.customers.customerList.useQuery();
  const [customerId, setCustomerId] = useState<number | null>(null);
  const { data: terms } = trpc.crm.customerTerms.useQuery({ customerId: customerId! }, { enabled: !!customerId });
  const custItems = useMemo(() => (customers ?? []).map((c: any) => ({ id: c.id as number, label: c.company || c.name, sub: c.city ?? null })), [customers]);

  const [t, setT] = useState({ discountPct: "0", creditLimit: "", paymentDays: "" });
  const [p, setP] = useState<{ itemType: "material" | "service" | "product"; refId: number | null; price: string; discountPct: string }>({ itemType: "product", refId: null, price: "", discountPct: "" });

  useEffect(() => {
    if (terms) setT({ discountPct: String(terms.discountPct ?? 0), creditLimit: terms.creditLimit == null ? "" : String(terms.creditLimit), paymentDays: terms.paymentDays == null ? "" : String(terms.paymentDays) });
  }, [terms]);

  const { data: products } = trpc.quotation.productList.useQuery(undefined, { enabled: p.itemType === "product" });
  const { data: services } = trpc.quotation.serviceList.useQuery(undefined, { enabled: p.itemType === "service" });
  const { data: materials } = trpc.quotation.materialList.useQuery(undefined, { enabled: p.itemType === "material" });
  const refItems = useMemo(() => {
    const src = p.itemType === "product" ? products : p.itemType === "service" ? services : materials;
    return (src ?? []).map((x: any) => ({ id: x.id as number, label: x.name, sub: x.code ?? null }));
  }, [p.itemType, products, services, materials]);

  const saveTerms = trpc.crm.customerTermsSave.useMutation({ onSuccess: () => { toast.success("Условите се зачувани"); utils.crm.customerTerms.invalidate(); }, onError: (e) => toast.error(e.message) });
  const savePrice = trpc.crm.customerPriceSave.useMutation({ onSuccess: () => { setP({ ...p, refId: null, price: "", discountPct: "" }); utils.crm.customerTerms.invalidate(); toast.success("Цената е зачувана"); }, onError: (e) => toast.error(e.message) });
  const delPrice = trpc.crm.customerPriceDelete.useMutation({ onSuccess: () => utils.crm.customerTerms.invalidate() });

  return (
    <div className="space-y-6">
      <PageHeader title="Ценовници" description="Општ попуст, кредитен лимит и посебни цени по клиент (ист извор како CRM дијалогот)." icon={<Tags className="h-6 w-6 text-amber-600" />} />
      <Card><CardContent className="p-4 space-y-4">
        <div className="max-w-md space-y-1"><Label className="text-xs">Клиент</Label><SearchPick items={custItems} value={customerId} onChange={(v) => setCustomerId(v)} placeholder="Избери клиент" /></div>
        {!customerId ? <p className="text-sm text-gray-400">Избери клиент за да ги видиш условите и цените.</p> : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1"><Label className="text-xs">Општ попуст %</Label><Input className="h-9 w-24" value={t.discountPct} onChange={(e) => setT({ ...t, discountPct: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Кредитен лимит</Label><Input className="h-9 w-36" value={t.creditLimit} onChange={(e) => setT({ ...t, creditLimit: e.target.value })} placeholder="празно = без" /></div>
              <div className="space-y-1"><Label className="text-xs">Денови плаќање</Label><Input className="h-9 w-28" value={t.paymentDays} onChange={(e) => setT({ ...t, paymentDays: e.target.value })} /></div>
              <Button className="h-9" variant="outline" disabled={saveTerms.isPending} onClick={() => saveTerms.mutate({ customerId, discountPct: parseFloat(t.discountPct) || 0, creditLimit: t.creditLimit ? parseFloat(t.creditLimit) : null, paymentDays: t.paymentDays ? parseInt(t.paymentDays) : null })}>Зачувај услови</Button>
            </div>
            {terms && (
              <p className="text-xs text-gray-500">Отворено салдо: <b>{fmt(terms.openBalance)}</b> ден{terms.creditLimit != null ? ` · лимит ${fmt(terms.creditLimit)}` : ""}{terms.avgDaysLate != null ? ` · прос. доцнење ${terms.avgDaysLate} дена` : ""}</p>
            )}
            <div className="border-t pt-3 space-y-2">
              <p className="text-sm font-semibold">Посебни цени / попусти</p>
              <div className="flex flex-wrap gap-2 items-end">
                <Select value={p.itemType} onValueChange={(v) => setP({ ...p, itemType: v as any, refId: null })}><SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="product">Производ</SelectItem><SelectItem value="service">Услуга</SelectItem><SelectItem value="material">Материјал</SelectItem></SelectContent></Select>
                <div className="min-w-[14rem] flex-1"><SearchPick items={refItems} value={p.refId} onChange={(v) => setP({ ...p, refId: v })} placeholder="Ставка" /></div>
                <Input className="h-9 w-28" placeholder="Цена" value={p.price} onChange={(e) => setP({ ...p, price: e.target.value })} />
                <Input className="h-9 w-24" placeholder="или %" value={p.discountPct} onChange={(e) => setP({ ...p, discountPct: e.target.value })} />
                <Button className="h-9" disabled={!p.refId || (!p.price && !p.discountPct)} onClick={() => savePrice.mutate({ customerId, itemType: p.itemType, refId: p.refId!, price: p.price ? parseFloat(p.price) : null, discountPct: p.discountPct ? parseFloat(p.discountPct) : null })}>Додај</Button>
              </div>
              <div className="space-y-1">
                {(terms?.prices ?? []).map((x) => (
                  <div key={x.id} className="flex items-center gap-2 text-sm border-b py-1.5">
                    <span className="text-xs text-gray-400 w-16">{x.itemType}</span>
                    <span className="flex-1">{x.item}</span>
                    <span className="w-32 text-right">{x.price !== null ? `${fmt(x.price)} ден` : `−${x.discountPct}%`}</span>
                    <Button size="sm" variant="ghost" className="text-red-500 h-7 w-7 p-0" onClick={() => delPrice.mutate({ id: x.id })}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                ))}
                {!terms?.prices?.length && <p className="text-xs text-gray-400">Нема посебни цени за овој клиент.</p>}
              </div>
            </div>
          </>
        )}
      </CardContent></Card>
    </div>
  );
}
