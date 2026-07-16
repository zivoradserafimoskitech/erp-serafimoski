import { useState, useEffect } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Trash2, Eye, ArrowRight, FileText, Wrench, Package } from "lucide-react";

// Status configs
const qStatus: Record<string, { label: string; cls: string }> = {
  draft: { label: "Нацрт", cls: "bg-gray-100 text-gray-700" },
  sent: { label: "Испратена", cls: "bg-blue-100 text-blue-700" },
  accepted: { label: "Прифатена", cls: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "Одбиена", cls: "bg-red-100 text-red-700" },
  expired: { label: "Истечена", cls: "bg-amber-100 text-amber-700" },
  converted: { label: "Конвертирана", cls: "bg-purple-100 text-purple-700" },
};

const svcTypes: Record<string, string> = {
  laser_cutting: "Ласерско сечење", plasma_cutting: "Плазма сечење", bending: "Виткање",
  mig_welding: "MIG заварување", tig_welding: "TIG заварување", grinding: "Брусење",
  drilling: "Дупчење", electrostatic_paint: "Електростатско фарбање", wet_paint: "Мокро бојадисување",
  galvanizing: "Галванизација", cnc_machining: "ЦНЦ обработка", labor: "Работна рака",
  design: "Проектирање", transport: "Транспорт", installation: "Монтажа", other: "Други",
};
const svcUnits: Record<string, string> = { m2: "м²", m: "м", kg: "кг", hour: "час", pcs: "ком", job: "посебно" };

const prodCats: Record<string, string> = {
  laser_fence: "Ласер ЦНЦ ограда", decorative_fence: "Декоративна ограда", metal_fence: "Метална ограда",
  balcony_railing: "Балконски огради", stair_railing: "Скалилшни огради", gate: "Порта/Капија",
  pergola: "Пергола", canopy: "Надвес/Настрешница", metal_door: "Метална врата",
  industrial_product: "Индустриски производ", custom_metalwork: "Сопствен метален производ",
  shelf: "Полица", worktable: "Работна маса", other: "Други",
};
const prodUnits: Record<string, string> = { m2: "м²", m: "м", kg: "кг", pcs: "ком", set: "комплет" };

const matTypes: Record<string, string> = {
  steel_sheet: "Челичен лим", steel_profile: "Челичен профил", steel_bar: "Челична прачка",
  aluminum_sheet: "Алуминиумски лим", aluminum_profile: "Алуминиумски профил",
  stainless_sheet: "Нерѓосувачки лим", pipe: "Цевка", angle: "Аголник",
  channel: "Канал", screws: "Завртки", welding: "Заварување", paint: "Боја", other: "Други",
};
const matUnits: Record<string, string> = { kg: "кг", m: "м", m2: "м²", pcs: "ком", l: "л" };

export default function Quotations() {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState("quotations");
  const [search, setSearch] = useState("");

  const { data: quotationsData } = trpc.quotation.quotationList.useQuery({ search: search || undefined });
  const { data: servicesData } = trpc.quotation.serviceList.useQuery({ search: search || undefined });
  const { data: productsData } = trpc.quotation.productList.useQuery({ search: search || undefined });

  const [qDialog, setQDialog] = useState(false);
  const { data: nextQNum } = trpc.quotation.quotationNextNumber.useQuery(undefined, { enabled: qDialog });
  const [svcDialog, setSvcDialog] = useState(false);
  const [prodDialog, setProdDialog] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [convertDialog, setConvertDialog] = useState(false);
  const [selQ, setSelQ] = useState<number | null>(null);
  const [convOrderNum, setConvOrderNum] = useState("");

  const { data: qDetail } = trpc.quotation.quotationById.useQuery({ id: selQ! }, { enabled: !!selQ });

  const [qForm, setQForm] = useState({
    quoteNumber: "", customerId: "", validUntil: "", deliveryDays: "14",
    paymentTerms: "14 дена", notes: "", currency: "MKD", vatRate: "18",
  });
  const [qItems, setQItems] = useState<Array<{
    itemType: "material" | "service" | "product"; referenceId: number | null;
    description: string; quantity: string; unit: string; unitPrice: string;
    totalPrice: string; notes: string; sortOrder: number;
  }>>([]);

  const [svcForm, setSvcForm] = useState({ name: "", code: "", type: "laser_cutting" as keyof typeof svcTypes, unit: "m2" as keyof typeof svcUnits, description: "", saleRate: "0", costRate: "0" });
  const [prodForm, setProdForm] = useState({ name: "", code: "", category: "laser_fence" as keyof typeof prodCats, unit: "m2" as keyof typeof prodUnits, description: "", defaultPrice: "0", materialCost: "0", laborCost: "0" });

  // BOM Estimator state
  const [estDialog, setEstDialog] = useState(false);
  const [estProduct, setEstProduct] = useState<number | null>(null);
  const [estForm, setEstForm] = useState({ area: "", perimeter: "", length: "", quantity: "1" });
  const { data: estimateData } = trpc.quotation.estimateFromProduct.useQuery(
    { productId: estProduct!, area: estForm.area, perimeter: estForm.perimeter || undefined, length: estForm.length || undefined, quantity: estForm.quantity },
    { enabled: !!estProduct && !!estForm.area }
  );

  const { data: customers } = trpc.customers.customerList.useQuery({});
  const { data: materialsData } = trpc.quotation.materialList.useQuery({});

  const createQ = trpc.quotation.quotationCreate.useMutation({
    onSuccess: () => { utils.quotation.quotationList.invalidate(); setQDialog(false); resetQForm(); },
  });
  const createSvc = trpc.quotation.serviceCreate.useMutation({
    onSuccess: () => { utils.quotation.serviceList.invalidate(); setSvcDialog(false); setSvcForm({ name: "", code: "", type: "laser_cutting", unit: "m2", description: "", saleRate: "0", costRate: "0" }); },
  });
  const createProd = trpc.quotation.productCreate.useMutation({
    onSuccess: () => { utils.quotation.productList.invalidate(); setProdDialog(false); setProdForm({ name: "", code: "", category: "laser_fence", unit: "m2", description: "", defaultPrice: "0", materialCost: "0", laborCost: "0" }); },
  });
  const delQ = trpc.quotation.quotationDelete.useMutation({ onSuccess: () => utils.quotation.quotationList.invalidate() });
  const delSvc = trpc.quotation.serviceDelete.useMutation({ onSuccess: () => utils.quotation.serviceList.invalidate() });
  const delProd = trpc.quotation.productDelete.useMutation({ onSuccess: () => utils.quotation.productList.invalidate() });
  const updateQ = trpc.quotation.quotationUpdate.useMutation({ onSuccess: () => { utils.quotation.quotationList.invalidate(); utils.quotation.quotationById.invalidate(); } });
  const convertQ = trpc.quotation.quotationConvert.useMutation({
    onSuccess: () => { utils.quotation.quotationList.invalidate(); setConvertDialog(false); setConvOrderNum(""); },
  });

  useEffect(() => {
    if (qDialog && nextQNum && !qForm.quoteNumber) {
      setQForm(prev => ({ ...prev, quoteNumber: nextQNum }));
    }
  }, [qDialog, nextQNum]);

  const resetQForm = () => {
    setQForm({ quoteNumber: "", customerId: "", validUntil: "", deliveryDays: "14", paymentTerms: "14 дена", notes: "", currency: "MKD", vatRate: "18" });
    setQItems([]);
  };

  const addItem = (type: "material" | "service" | "product", refId: number | null, desc: string, unit: string, price: string) => {
    const newItem = {
      itemType: type, referenceId: refId, description: desc, quantity: "1",
      unit, unitPrice: price, totalPrice: price, notes: "", sortOrder: qItems.length,
    };
    setQItems([...qItems, newItem]);
  };

  const updateItem = (idx: number, field: string, value: string) => {
    const items = [...qItems];
    (items[idx] as any)[field] = value;
    if (field === "quantity" || field === "unitPrice") {
      const q = parseFloat(items[idx].quantity) || 0;
      const p = parseFloat(items[idx].unitPrice) || 0;
      items[idx].totalPrice = (q * p).toFixed(2);
    }
    setQItems(items);
  };

  const removeItem = (idx: number) => setQItems(qItems.filter((_, i) => i !== idx));

  const calcTotals = () => {
    const sub = qItems.reduce((s, i) => s + parseFloat(i.totalPrice), 0);
    const vatR = parseFloat(qForm.vatRate) || 18;
    const vat = sub * vatR / 100;
    return { subtotal: sub.toFixed(2), vatAmount: vat.toFixed(2), total: (sub + vat).toFixed(2) };
  };

  const handleQSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = calcTotals();
    createQ.mutate({
      quoteNumber: qForm.quoteNumber,
      customerId: parseInt(qForm.customerId),
      validUntil: qForm.validUntil || undefined,
      deliveryDays: parseInt(qForm.deliveryDays) || 14,
      paymentTerms: qForm.paymentTerms,
      notes: qForm.notes || undefined,
      subtotal: t.subtotal,
      vatRate: qForm.vatRate,
      vatAmount: t.vatAmount,
      totalAmount: t.total,
      currency: qForm.currency,
      items: qItems.map(i => ({ ...i, referenceId: i.referenceId ?? undefined })),
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Понуди</h2>
          <p className="text-gray-500 mt-1">Креирање понуди со материјали, услуги и производи</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {tab === "quotations" && (
            <Dialog open={qDialog} onOpenChange={(open) => {
              setQDialog(open);
              if (open) {
                const d = new Date(); d.setDate(d.getDate() + 30);
                setQForm(prev => ({ ...prev, validUntil: prev.validUntil || d.toISOString().slice(0, 10) }));
              }
            }}>
              <DialogTrigger asChild><Button className="bg-amber-500 hover:bg-amber-600 text-white"><Plus className="h-4 w-4 mr-2" />Нова понуда</Button></DialogTrigger>
              <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Нова понуда</DialogTitle></DialogHeader>
                <form onSubmit={handleQSubmit} className="space-y-4">
                  {/* Basic info */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-2"><Label>Број на понуда *</Label><Input value={qForm.quoteNumber} onChange={e => setQForm({ ...qForm, quoteNumber: e.target.value })} required placeholder="ПОН-2026-001" /></div>
                    <div className="space-y-2"><Label>Клиент *</Label><Select value={qForm.customerId} onValueChange={v => setQForm({ ...qForm, customerId: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{customers?.map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.name} {c.company ? `(${c.company})` : ""}</SelectItem>)}</SelectContent></Select></div>
                    <div className="space-y-2"><Label>Важи до</Label><Input type="date" value={qForm.validUntil} onChange={e => setQForm({ ...qForm, validUntil: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-2"><Label>Испорака (денови)</Label><Input value={qForm.deliveryDays} onChange={e => setQForm({ ...qForm, deliveryDays: e.target.value })} /></div>
                    <div className="space-y-2"><Label>Плаќање</Label><Input value={qForm.paymentTerms} onChange={e => setQForm({ ...qForm, paymentTerms: e.target.value })} /></div>
                    <div className="space-y-2"><Label>Валута</Label><Select value={qForm.currency} onValueChange={v => setQForm({ ...qForm, currency: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="MKD">MKD</SelectItem><SelectItem value="EUR">EUR</SelectItem><SelectItem value="USD">USD</SelectItem></SelectContent></Select></div>
                  </div>

                  {/* Add items section */}
                  <div className="border rounded-lg p-3 space-y-3 bg-gray-50">
                    <h4 className="font-semibold text-sm">Додади ставки во понуда</h4>
                    <div className="grid grid-cols-3 gap-2">
                      {/* Materials */}
                      <div className="space-y-1">
                        <Label className="text-xs text-gray-500">Материјали</Label>
                        <Select onValueChange={v => { const m = materialsData?.find(x => x.id.toString() === v); if (m) addItem("material", m.id, m.name, matUnits[m.unit] || m.unit, "0"); }}>
                          <SelectTrigger className="text-xs"><SelectValue placeholder="Избери материјал" /></SelectTrigger>
                          <SelectContent className="max-h-60">
                            {materialsData?.map(m => <SelectItem key={m.id} value={m.id.toString()}>{m.name} ({matTypes[m.type]}) - {m.currentStock} {matUnits[m.unit]}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      {/* Services */}
                      <div className="space-y-1">
                        <Label className="text-xs text-gray-500">Услуги</Label>
                        <Select onValueChange={v => { const s = servicesData?.find(x => x.id.toString() === v); if (s) addItem("service", s.id, s.name, svcUnits[s.unit] || s.unit, s.saleRate); }}>
                          <SelectTrigger className="text-xs"><SelectValue placeholder="Избери услуга" /></SelectTrigger>
                          <SelectContent className="max-h-60">
                            {servicesData?.map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name} ({svcTypes[s.type]}) - {s.saleRate} ден/{svcUnits[s.unit]}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      {/* Products with BOM estimator */}
                      <div className="space-y-1">
                        <Label className="text-xs text-gray-500">Производи (со естиматор)</Label>
                        <Select onValueChange={v => { const p = productsData?.find(x => x.id.toString() === v); if (p) { setEstProduct(p.id); setEstForm({ area: "", perimeter: "", length: "", quantity: "1" }); setEstDialog(true); } }}>
                          <SelectTrigger className="text-xs"><SelectValue placeholder="Избери производ за естимација" /></SelectTrigger>
                          <SelectContent className="max-h-60">
                            {productsData?.map(p => <SelectItem key={p.id} value={p.id.toString()}>{p.name} ({prodCats[p.category]}) - {p.defaultPrice} ден/{prodUnits[p.unit]}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Items table */}
                    {qItems.length > 0 && (
                      <div className="space-y-2">
                        <Table>
                          <TableHeader>
                            <TableRow className="text-xs"><TableHead>Тип</TableHead><TableHead>Опис</TableHead><TableHead>Кол</TableHead><TableHead>Ед</TableHead><TableHead>Цена</TableHead><TableHead>Вкупно</TableHead><TableHead></TableHead></TableRow>
                          </TableHeader>
                          <TableBody>
                            {qItems.map((item, idx) => (
                              <TableRow key={idx}>
                                <TableCell className="text-xs"><Badge variant="outline">{item.itemType === "material" ? "Мат" : item.itemType === "service" ? "Усл" : "Прд"}</Badge></TableCell>
                                <TableCell><Input className="h-7 text-xs" value={item.description} onChange={e => updateItem(idx, "description", e.target.value)} /></TableCell>
                                <TableCell><Input className="h-7 text-xs w-16" type="number" step="0.001" value={item.quantity} onChange={e => updateItem(idx, "quantity", e.target.value)} /></TableCell>
                                <TableCell className="text-xs text-gray-500">{item.unit}</TableCell>
                                <TableCell><Input className="h-7 text-xs w-20" type="number" step="0.01" value={item.unitPrice} onChange={e => updateItem(idx, "unitPrice", e.target.value)} /></TableCell>
                                <TableCell className="font-medium text-xs">{item.totalPrice}</TableCell>
                                <TableCell><Button size="sm" variant="ghost" className="h-6 text-red-500" onClick={() => removeItem(idx)}>×</Button></TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        <div className="flex justify-end gap-4 text-sm">
                          <span className="text-gray-500">Нето: <b>{calcTotals().subtotal}</b> {qForm.currency}</span>
                          <span className="text-gray-500">ДДВ ({qForm.vatRate}%): <b>{calcTotals().vatAmount}</b></span>
                          <span className="text-gray-800 font-bold">ВКУПНО: {calcTotals().total} {qForm.currency}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2"><Label>Белешки / Опис на понуда</Label><Textarea value={qForm.notes} onChange={e => setQForm({ ...qForm, notes: e.target.value })} placeholder="Технички детали, услови, напомени..." /></div>
                  <div className="space-y-1">
                    <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600" disabled={createQ.isPending || !qForm.customerId || qItems.length === 0}>{createQ.isPending ? "Зачувување..." : "Креирај понуда"}</Button>
                    {!qForm.customerId && <p className="text-xs text-red-500 text-center">Избери клиент за да продолжиш</p>}
                    {qForm.customerId && qItems.length === 0 && <p className="text-xs text-red-500 text-center">Додади барем една ставка (материјал, услуга или производ)</p>}
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          )}
          {tab === "services" && (
            <Dialog open={svcDialog} onOpenChange={setSvcDialog}>
              <DialogTrigger asChild><Button className="bg-amber-500 hover:bg-amber-600 text-white"><Plus className="h-4 w-4 mr-2" />Нова услуга</Button></DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Нова услуга</DialogTitle></DialogHeader>
                <form onSubmit={e => { e.preventDefault(); createSvc.mutate(svcForm as any); }} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Назив *</Label><Input value={svcForm.name} onChange={e => setSvcForm({ ...svcForm, name: e.target.value })} required /></div>
                    <div className="space-y-2"><Label>Код *</Label><Input value={svcForm.code} onChange={e => setSvcForm({ ...svcForm, code: e.target.value })} required /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Тип</Label>
                      <Select value={svcForm.type} onValueChange={v => setSvcForm({ ...svcForm, type: v as any })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(svcTypes).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
                    </div>
                    <div className="space-y-2"><Label>Единица</Label>
                      <Select value={svcForm.unit} onValueChange={v => setSvcForm({ ...svcForm, unit: v as any })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(svcUnits).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
                    </div>
                  </div>
                  <div className="space-y-2"><Label>Цена на чинење</Label><Input type="number" step="0.01" value={svcForm.costRate} onChange={e => setSvcForm({ ...svcForm, costRate: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Продажна цена</Label><Input type="number" step="0.01" value={svcForm.saleRate} onChange={e => setSvcForm({ ...svcForm, saleRate: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Опис</Label><Textarea value={svcForm.description} onChange={e => setSvcForm({ ...svcForm, description: e.target.value })} /></div>
                  <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600" disabled={createSvc.isPending}>{createSvc.isPending ? "Зачувување..." : "Зачувај услуга"}</Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
          {tab === "products" && (
            <Dialog open={prodDialog} onOpenChange={setProdDialog}>
              <DialogTrigger asChild><Button className="bg-amber-500 hover:bg-amber-600 text-white"><Plus className="h-4 w-4 mr-2" />Нов производ</Button></DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Нов производ</DialogTitle></DialogHeader>
                <form onSubmit={e => { e.preventDefault(); createProd.mutate(prodForm as any); }} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Назив *</Label><Input value={prodForm.name} onChange={e => setProdForm({ ...prodForm, name: e.target.value })} required /></div>
                    <div className="space-y-2"><Label>Код *</Label><Input value={prodForm.code} onChange={e => setProdForm({ ...prodForm, code: e.target.value })} required /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Категорија</Label>
                      <Select value={prodForm.category} onValueChange={v => setProdForm({ ...prodForm, category: v as any })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(prodCats).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
                    </div>
                    <div className="space-y-2"><Label>Единица</Label>
                      <Select value={prodForm.unit} onValueChange={v => setProdForm({ ...prodForm, unit: v as any })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(prodUnits).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-2"><Label>Продажна цена</Label><Input type="number" step="0.01" value={prodForm.defaultPrice} onChange={e => setProdForm({ ...prodForm, defaultPrice: e.target.value })} /></div>
                    <div className="space-y-2"><Label>Трошок материјал</Label><Input type="number" step="0.01" value={prodForm.materialCost} onChange={e => setProdForm({ ...prodForm, materialCost: e.target.value })} /></div>
                    <div className="space-y-2"><Label>Трошок работа</Label><Input type="number" step="0.01" value={prodForm.laborCost} onChange={e => setProdForm({ ...prodForm, laborCost: e.target.value })} /></div>
                  </div>
                  <div className="space-y-2"><Label>Опис</Label><Textarea value={prodForm.description} onChange={e => setProdForm({ ...prodForm, description: e.target.value })} /></div>
                  <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600" disabled={createProd.isPending}>{createProd.isPending ? "Зачувување..." : "Зачувај производ"}</Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" /><Input placeholder="Пребарувај..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {[
          { key: "quotations", label: "Понуди", icon: FileText },
          { key: "services", label: "Услуги", icon: Wrench },
          { key: "products", label: "Производи", icon: Package },
        ].map(t => {
          const Icon = t.icon;
          return (<button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-1 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? "border-amber-500 text-amber-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}><Icon className="h-4 w-4" />{t.label}</button>);
        })}
      </div>

      {/* ===== QUOTATIONS ===== */}
      {tab === "quotations" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Број</TableHead><TableHead>Клиент</TableHead><TableHead>Статус</TableHead><TableHead>Вкупно</TableHead><TableHead>Испорака</TableHead><TableHead>Важи до</TableHead><TableHead>Акции</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {!quotationsData?.length ? <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">Нема понуди</TableCell></TableRow> :
                  quotationsData.map(q => (
                    <TableRow key={q.id}>
                      <TableCell className="font-mono text-sm font-medium">{q.quoteNumber}</TableCell>
                      <TableCell>{q.customerName} {q.customerCompany ? `(${q.customerCompany})` : ""}</TableCell>
                      <TableCell><Badge className={qStatus[q.status]?.cls}>{qStatus[q.status]?.label}</Badge></TableCell>
                      <TableCell className="font-medium">{q.totalAmount} {q.currency}</TableCell>
                      <TableCell className="text-gray-500">{q.deliveryDays} дена</TableCell>
                      <TableCell className="text-gray-500">{q.validUntil ? String(q.validUntil).split("T")[0] : "-"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => { setSelQ(q.id); setDetailOpen(true); }}><Eye className="h-3.5 w-3.5" /></Button>
                          {q.status === "accepted" && (
                            <Button size="sm" variant="outline" className="text-purple-600" onClick={() => { setSelQ(q.id); setConvertDialog(true); }}><ArrowRight className="h-3.5 w-3.5" /></Button>
                          )}
                          <Button size="sm" variant="ghost" className="text-red-500" onClick={() => { if (confirm("Дали сте сигурни?")) delQ.mutate({ id: q.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ===== SERVICES ===== */}
      {tab === "services" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Код</TableHead><TableHead>Назив</TableHead><TableHead>Тип</TableHead><TableHead>Единица</TableHead><TableHead>Цена</TableHead><TableHead>Акции</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {!servicesData?.length ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-400">Нема услуги</TableCell></TableRow> :
                  servicesData.map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-sm">{s.code}</TableCell>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell><Badge variant="outline">{svcTypes[s.type]}</Badge></TableCell>
                      <TableCell>{svcUnits[s.unit] || s.unit}</TableCell>
                      <TableCell className="font-medium">{s.saleRate} ден.</TableCell>
                      <TableCell><Button size="sm" variant="ghost" className="text-red-500" onClick={() => { if (confirm("Дали сте сигурни?")) delSvc.mutate({ id: s.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button></TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ===== PRODUCTS ===== */}
      {tab === "products" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Код</TableHead><TableHead>Назив</TableHead><TableHead>Категорија</TableHead><TableHead>Ед</TableHead><TableHead>Прод.цена</TableHead><TableHead>Трошок</TableHead><TableHead>Акции</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {!productsData?.length ? <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">Нема производи</TableCell></TableRow> :
                  productsData.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-sm">{p.code}</TableCell>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell><Badge variant="outline">{prodCats[p.category]}</Badge></TableCell>
                      <TableCell>{prodUnits[p.unit] || p.unit}</TableCell>
                      <TableCell className="font-medium">{p.defaultPrice} ден.</TableCell>
                      <TableCell className="text-gray-500">{p.materialCost}+{p.laborCost}</TableCell>
                      <TableCell><Button size="sm" variant="ghost" className="text-red-500" onClick={() => { if (confirm("Дали сте сигурни?")) delProd.mutate({ id: p.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button></TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Понуда {qDetail?.quoteNumber}</DialogTitle></DialogHeader>
          {qDetail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">Клиент:</span> {qDetail.customer?.name}</div>
                <div><span className="text-gray-500">Статус:</span> <Badge className={qStatus[qDetail.status]?.cls}>{qStatus[qDetail.status]?.label}</Badge></div>
                <div><span className="text-gray-500">Нето:</span> <b>{qDetail.subtotal} {qDetail.currency}</b></div>
                <div><span className="text-gray-500">ДДВ ({qDetail.vatRate}%):</span> {qDetail.vatAmount}</div>
                <div><span className="text-gray-500">ВКУПНО:</span> <b className="text-lg">{qDetail.totalAmount} {qDetail.currency}</b></div>
                <div><span className="text-gray-500">Испорака:</span> {qDetail.deliveryDays} дена</div>
                <div><span className="text-gray-500">Плаќање:</span> {qDetail.paymentTerms}</div>
                <div><span className="text-gray-500">Важи до:</span> {qDetail.validUntil ? String(qDetail.validUntil).split("T")[0] : "-"}</div>
              </div>
              {qDetail.items && qDetail.items.length > 0 && (
                <div className="border-t pt-3">
                  <h4 className="font-semibold mb-2">Ставки</h4>
                  <Table>
                    <TableHeader><TableRow className="text-xs"><TableHead>Тип</TableHead><TableHead>Опис</TableHead><TableHead>Кол</TableHead><TableHead>Цена</TableHead><TableHead>Вкупно</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {qDetail.items.map(i => (
                        <TableRow key={i.id}>
                          <TableCell className="text-xs"><Badge variant="outline">{i.itemType === "material" ? "Мат" : i.itemType === "service" ? "Усл" : "Прд"}</Badge></TableCell>
                          <TableCell className="text-sm">{i.description}</TableCell>
                          <TableCell className="text-sm">{i.quantity} {i.unit}</TableCell>
                          <TableCell className="text-sm">{i.unitPrice}</TableCell>
                          <TableCell className="text-sm font-medium">{i.totalPrice}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <div className="flex gap-2">
                <Select value={qDetail.status} onValueChange={v => updateQ.mutate({ id: qDetail.id, status: v as any })}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(qStatus).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
                {qDetail.status === "accepted" && (
                  <Button className="bg-purple-500 hover:bg-purple-600 text-white" onClick={() => { setSelQ(qDetail.id); setConvertDialog(true); }}><ArrowRight className="h-4 w-4 mr-1" />Конвертирај во нарачка</Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Convert Dialog */}
      <Dialog open={convertDialog} onOpenChange={setConvertDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Конвертирај понуда во нарачка</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Понудата ќе се конвертира во потврдена нарачка. Потоа може да се креира работен налог.</p>
            <div className="space-y-2">
              <Label>Број на нарачка *</Label>
              <Input value={convOrderNum} onChange={e => setConvOrderNum(e.target.value)} placeholder="на пр. ORD-2026-001" required />
            </div>
            <Button className="w-full bg-purple-500 hover:bg-purple-600" disabled={convertQ.isPending || !convOrderNum} onClick={() => convertQ.mutate({ quotationId: selQ!, orderNumber: convOrderNum })}>
              {convertQ.isPending ? "Конвертирање..." : "Конвертирај во нарачка"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* BOM Estimator Dialog */}
      <Dialog open={estDialog} onOpenChange={setEstDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Естиматор за производ</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div className="space-y-1"><Label>Површина (m2) *</Label><Input type="number" step="0.01" value={estForm.area} onChange={e => setEstForm({ ...estForm, area: e.target.value })} placeholder="пр. 15.5" /></div>
              <div className="space-y-1"><Label>Периметар (м)</Label><Input type="number" step="0.01" value={estForm.perimeter} onChange={e => setEstForm({ ...estForm, perimeter: e.target.value })} placeholder="пр. 24" /></div>
              <div className="space-y-1"><Label>Должина (м)</Label><Input type="number" step="0.01" value={estForm.length} onChange={e => setEstForm({ ...estForm, length: e.target.value })} placeholder="пр. 5" /></div>
              <div className="space-y-1"><Label>Количина</Label><Input type="number" value={estForm.quantity} onChange={e => setEstForm({ ...estForm, quantity: e.target.value })} /></div>
            </div>
            {estimateData && (
              <div className="space-y-3">
                <div className="flex gap-4 text-sm">
                  <span className="text-gray-600">Материјал: <b>{estimateData.materialCost} ден</b></span>
                  <span className="text-gray-600">Услуги: <b>{estimateData.serviceCost} ден</b></span>
                  <span className="text-gray-800 font-bold">ВКУПНО: {estimateData.totalCost} ден</span>
                </div>
                <Table>
                  <TableHeader><TableRow className="text-xs"><TableHead>Тип</TableHead><TableHead>Опис</TableHead><TableHead>Кол</TableHead><TableHead>Ед</TableHead><TableHead>Цена</TableHead><TableHead>Вкупно</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {estimateData.lineItems.map((li: any, idx: number) => (
                      <TableRow key={idx}><TableCell className="text-xs"><Badge variant="outline">{li.itemType === "material" ? "Мат" : "Усл"}</Badge></TableCell>
                        <TableCell className="text-xs">{li.description}</TableCell><TableCell className="text-xs">{li.quantity}</TableCell>
                        <TableCell className="text-xs">{li.unit}</TableCell><TableCell className="text-xs">{li.unitCost}</TableCell>
                        <TableCell className="text-xs font-medium">{li.totalCost}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={() => {
                  const p = productsData?.find(x => x.id === estProduct);
                  if (p && estimateData) {
                    // Add product header item
                    addItem("product", p.id, `${p.name} (${estForm.area}m2)`, prodUnits[p.unit] || "m2", estimateData.totalCost);
                    // Add breakdown items
                    estimateData.lineItems.forEach((li: any) => {
                      addItem(li.itemType as any, li.referenceId, li.description, li.unit, li.totalCost);
                    });
                    setEstDialog(false);
                  }
                }}>Додади ставки во понуда</Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
