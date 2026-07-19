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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { printWorkOrder, printRequisition } from "@/lib/print-documents";
import { Search, Plus, Trash2, Eye, Package, Layers, ArrowDownLeft, FileText, Printer, ClipboardList, Truck } from "lucide-react";
import { MaterialPicker } from "@/components/MaterialPicker";

const statusCfg: Record<string, { label: string; cls: string }> = {
  pending: { label: "На чекање", cls: "bg-gray-100 text-gray-700" },
  in_progress: { label: "Во тек", cls: "bg-blue-100 text-blue-700" },
  on_hold: { label: "На удар", cls: "bg-amber-100 text-amber-700" },
  completed: { label: "Завршено", cls: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Откажано", cls: "bg-red-100 text-red-700" },
};

const priorityCfg: Record<string, { label: string; cls: string }> = {
  low: { label: "Низок", cls: "bg-gray-100 text-gray-600" },
  normal: { label: "Нормален", cls: "bg-blue-100 text-blue-600" },
  high: { label: "Висок", cls: "bg-orange-100 text-orange-600" },
  urgent: { label: "Итен", cls: "bg-red-100 text-red-600" },
};

const opList: Record<string, string> = {
  cutting_laser: "Ласерско сечење", cutting_plasma: "Плазма сечење", bending: "Виткање",
  welding_mig: "MIG заварување", welding_tig: "TIG заварување", grinding: "Брусење",
  drilling: "Дупчење", painting: "Бојадисување", assembly: "Монтажа",
  quality_control: "Контрола на квалитет", packaging: "Пакување",
};

export default function Production() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: nextWorkOrderNum } = trpc.settings.nextDocNumber.useQuery({ kind: "workOrder" }, { enabled: dialogOpen });
  const [detailOpen, setDetailOpen] = useState(false);
  const [selWO, setSelWO] = useState<number | null>(null);
  const [completeWO, setCompleteWO] = useState<{ id: number; woNumber: string } | null>(null);
  const [completeForm, setCompleteForm] = useState({ producedQty: "1", producedUnit: "ком" });

  const [form, setForm] = useState({ woNumber: "", description: "", priority: "normal", plannedStart: "", plannedEnd: "", assignedTo: "", notes: "" });
  const [opForm, setOpForm] = useState({ operation: "cutting_laser" as keyof typeof opList, sequence: 1, description: "", estimatedTime: "", operator: "", costRate: "" });
  const [matForm, setMatForm] = useState({ materialId: "", quantity: "", notes: "" });

  const { data: workOrders, isLoading } = trpc.production.workOrderList.useQuery({
    search: search || undefined, status: statusFilter === "all" ? undefined : statusFilter,
  });
  const { data: stats } = trpc.production.productionStats.useQuery();
  const { data: companySettings } = trpc.settings.settingsGet.useQuery();
  const chainInv = trpc.production.workOrderToInvoice.useMutation({ onSuccess: (d) => { toast.success(`Креирана фактура ${d.invoiceNumber} (нацрт, +30% маржа)`); } });
  const chainDN = trpc.production.workOrderToDeliveryNote.useMutation({
    onSuccess: (d: any) => {
      toast.success(`Креирана испратница ${d.dnNumber} — готовиот производ е испорачан од ГЛ-ПРОД`);
      utils.accounting.deliveryNoteList.invalidate(); utils.accounting.finishedGoodsList.invalidate(); utils.production.workOrderList.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const { data: woDetail } = trpc.production.workOrderById.useQuery({ id: selWO! }, { enabled: !!selWO });
  const { data: materialsData } = trpc.storage.materialList.useQuery();
  const { data: warehousesData } = trpc.warehouse.warehouseList.useQuery();

  const createMut = trpc.production.workOrderCreate.useMutation({
    onSuccess: () => { utils.production.workOrderList.invalidate(); utils.production.productionStats.invalidate(); setDialogOpen(false); setForm({ woNumber: "", description: "", priority: "normal", plannedStart: "", plannedEnd: "", assignedTo: "", notes: "" }); },
  });
  const updateMut = trpc.production.workOrderUpdate.useMutation({
    onSuccess: (data: any) => {
      utils.production.workOrderList.invalidate(); utils.production.productionStats.invalidate(); utils.production.workOrderById.invalidate(); utils.accounting.finishedGoodsList.invalidate();
      if (data?.finishedGoodsRegistered) toast.success("Налогот е завршен — готовиот производ е заведен во магацинот ГЛ-ПРОД 📦");
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.production.workOrderDelete.useMutation({
    onSuccess: () => { utils.production.workOrderList.invalidate(); utils.production.productionStats.invalidate(); },
  });
  const opCreateMut = trpc.production.operationCreate.useMutation({
    onSuccess: () => { utils.production.workOrderById.invalidate(); },
  });
  const opUpdateMut = trpc.production.operationUpdate.useMutation({
    onSuccess: () => { utils.production.workOrderById.invalidate(); },
  });
  const matCreateMut = trpc.production.woMaterialCreate.useMutation({
    onSuccess: () => { utils.production.workOrderById.invalidate(); setMatForm({ materialId: "", quantity: "", notes: "" }); },
  });
  const matDeleteMut = trpc.production.woMaterialDelete.useMutation({
    onSuccess: () => { utils.production.workOrderById.invalidate(); },
  });
  const issueMut = trpc.storage.issueMaterial.useMutation({
    onSuccess: (data) => {
      utils.production.workOrderById.invalidate();
      utils.storage.materialList.invalidate();
      utils.storage.storageStats.invalidate();
      toast.success(`Материјалот е испорачан (ед.цена: ${data.unitCost} ден)`);
    },
    onError: (e) => toast.error(e.message),
  });
  const costUpdateMut = trpc.production.workOrderUpdateCost.useMutation({
    onSuccess: (data) => { utils.production.workOrderById.invalidate(); toast.success(`Цена на налогот: ${data.totalCost} ден`); },
  });

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); createMut.mutate(form as any); };

  const handleOpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selWO) return;
    opCreateMut.mutate({ ...opForm, costRate: opForm.costRate || "0", workOrderId: selWO } as any);
    setOpForm({ operation: "cutting_laser", sequence: (woDetail?.operations?.length || 0) + 1, description: "", estimatedTime: "", operator: "", costRate: opForm.costRate });
  };

  const handleMatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selWO || !matForm.materialId || !matForm.quantity) return;
    const mat = materialsData?.find(m => m.id.toString() === matForm.materialId);
    const qty = parseFloat(matForm.quantity);
    const cost = parseFloat(mat?.avgCost ?? "0");
    matCreateMut.mutate({
      workOrderId: selWO, materialId: parseInt(matForm.materialId),
      quantity: matForm.quantity, unitCost: mat?.avgCost ?? "0",
      totalCost: (qty * cost).toFixed(2), notes: matForm.notes, isActual: "planned",
    });
  };

  const handleIssue = (woMaterial: any) => {
    // Материјалите се издаваат од магацинот за материјали (ГЛ-МАТ)
    const matWh = warehousesData?.find((w: any) => w.code === "GL-MAT")
      || warehousesData?.find((w: any) => w.type === "materials")
      || warehousesData?.[0];
    if (!matWh) { toast.error("Нема магацин за материјали — провери во Магацини"); return; }
    issueMut.mutate({
      materialId: woMaterial.materialId, warehouseId: matWh.id,
      quantity: woMaterial.quantity, sourceDocType: "work_order", sourceDocId: selWO!,
      reference: woDetail?.woNumber,
    });
  };

  useEffect(() => {
    if (dialogOpen && nextWorkOrderNum && !form.woNumber) {
      setForm(prev => ({ ...prev, woNumber: nextWorkOrderNum }));
    }
  }, [dialogOpen, nextWorkOrderNum]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Производство</h2>
          <p className="text-gray-500 mt-1">Работни налози, операции и материјали</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-amber-500 hover:bg-amber-600 text-white"><Plus className="h-4 w-4 mr-2" />Нов работен налог</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Нов работен налог</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2"><Label>Број на налог *</Label><Input value={form.woNumber} onChange={(e) => setForm({ ...form, woNumber: e.target.value })} required placeholder="РН-001/2025" /></div>
              <div className="space-y-2"><Label>Опис *</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required /></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Приоритет</Label><Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(priorityCfg).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Доделено на</Label><Input value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} placeholder="Име на оператер" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Планиран почеток</Label><Input type="date" value={form.plannedStart} onChange={(e) => setForm({ ...form, plannedStart: e.target.value })} /></div>
                <div className="space-y-2"><Label>Планиран крај</Label><Input type="date" value={form.plannedEnd} onChange={(e) => setForm({ ...form, plannedEnd: e.target.value })} /></div>
              </div>
              <div className="space-y-2"><Label>Белешки</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
              <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600" disabled={createMut.isPending}>{createMut.isPending ? "Зачувување..." : "Креирај налог"}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {[
          { label: "Вкупно", value: stats?.total ?? 0, cls: "text-gray-700" },
          { label: "На чекање", value: stats?.pending ?? 0, cls: "text-gray-600" },
          { label: "Во тек", value: stats?.inProgress ?? 0, cls: "text-blue-600" },
          { label: "На удар", value: stats?.onHold ?? 0, cls: "text-amber-600" },
          { label: "Завршени", value: stats?.completed ?? 0, cls: "text-emerald-600" },
        ].map((s) => (
          <Card key={s.label}><CardContent className="p-4"><p className="text-sm text-gray-500">{s.label}</p><p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p></CardContent></Card>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" /><Input placeholder="Пребарувај работни налози..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" /></div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Сите статуси" /></SelectTrigger>
          <SelectContent>{Object.entries(statusCfg).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Број</TableHead><TableHead>Опис</TableHead><TableHead>Статус</TableHead><TableHead>Приоритет</TableHead><TableHead>Доделено</TableHead><TableHead>Цена</TableHead><TableHead>Акции</TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading ? (<TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">Вчитување...</TableCell></TableRow>)
                : !workOrders || workOrders.length === 0 ? (<TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">Нема работни налози</TableCell></TableRow>)
                : workOrders.map((wo) => {
                    const st = statusCfg[wo.status] || statusCfg.pending;
                    const pr = priorityCfg[wo.priority] || priorityCfg.normal;
                    return (
                      <TableRow key={wo.id}>
                        <TableCell className="font-mono text-sm font-medium">{wo.woNumber}</TableCell>
                        <TableCell>{wo.description}</TableCell>
                        <TableCell><Badge className={st.cls}>{st.label}</Badge></TableCell>
                        <TableCell><Badge className={pr.cls}>{pr.label}</Badge></TableCell>
                        <TableCell>{wo.assignedTo || "-"}</TableCell>
                        <TableCell className="text-gray-500">{parseFloat(wo.costAmount ?? "0").toFixed(2)} ден</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Select value={wo.status} onValueChange={(v) => { if (v === "completed" && wo.status !== "completed") { setCompleteForm({ producedQty: "1", producedUnit: "ком" }); setCompleteWO({ id: wo.id, woNumber: wo.woNumber }); } else { updateMut.mutate({ id: wo.id, status: v as any }); } }}>
                              <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                              <SelectContent>{Object.entries(statusCfg).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                            </Select>
                            <Button size="sm" variant="outline" onClick={() => { setSelWO(wo.id); setDetailOpen(true); }}><Eye className="h-3.5 w-3.5" /></Button>
                            <Button size="sm" variant="outline" className="text-red-500" onClick={() => { if (confirm("Дали сте сигурни?")) deleteMut.mutate({ id: wo.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Дијалог за завршување на налог — произведена количина */}
      <Dialog open={!!completeWO} onOpenChange={(o) => { if (!o) setCompleteWO(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Заврши налог {completeWO?.woNumber}</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-500">Произведеното автоматски влегува во магацинот за готови производи (ГЛ-ПРОД).</p>
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div className="space-y-2"><Label>Произведена количина *</Label><Input type="number" step="0.001" min="0.001" value={completeForm.producedQty} onChange={(e) => setCompleteForm({ ...completeForm, producedQty: e.target.value })} /></div>
            <div className="space-y-2"><Label>Единица</Label>
              <Select value={completeForm.producedUnit} onValueChange={(v) => setCompleteForm({ ...completeForm, producedUnit: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ком">ком</SelectItem><SelectItem value="kg">кг</SelectItem><SelectItem value="m">м</SelectItem><SelectItem value="m2">м²</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={updateMut.isPending || !parseFloat(completeForm.producedQty)}
            onClick={() => { if (!completeWO) return; updateMut.mutate({ id: completeWO.id, status: "completed", producedQty: completeForm.producedQty, producedUnit: completeForm.producedUnit } as any); setCompleteWO(null); }}>
            {updateMut.isPending ? "Се зачувува..." : "Заврши и заведи во ГЛ-ПРОД"}
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-5xl w-[96vw] max-h-[92vh] overflow-y-auto overflow-x-hidden p-0">
          {/* Заглавие */}
          <div className="sticky top-0 z-10 bg-white border-b px-6 pt-5 pb-4 space-y-3">
            <DialogHeader className="p-0 space-y-1">
              <DialogTitle className="text-xl">
                Работен налог <span className="font-mono text-amber-600">{woDetail?.woNumber}</span>
              </DialogTitle>
              <p className="text-sm text-gray-500">
                {woDetail?.description}
                {woDetail?.orderNumber && <span className="ml-2 text-gray-400">· од нарачка {woDetail.orderNumber}</span>}
              </p>
            </DialogHeader>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => woDetail && chainInv.mutate({ workOrderId: woDetail.id })} disabled={chainInv.isPending}><FileText className="h-3.5 w-3.5 mr-1.5" />Кон фактура</Button>
              {woDetail?.status === "completed" && (
                <Button size="sm" variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => woDetail && chainDN.mutate({ workOrderId: woDetail.id })} disabled={chainDN.isPending}><Truck className="h-3.5 w-3.5 mr-1.5" />Кон испратница</Button>
              )}
              <Button size="sm" variant="outline" onClick={() => woDetail && printRequisition(woDetail, companySettings)}><ClipboardList className="h-3.5 w-3.5 mr-1.5" />Требовање</Button>
              <Button size="sm" variant="outline" onClick={() => woDetail && printWorkOrder(woDetail, companySettings)}><Printer className="h-3.5 w-3.5 mr-1.5" />Печати / PDF</Button>
            </div>
          </div>
          {woDetail && (
            <div className="space-y-5 px-6 pb-6">
              {/* Инфо мрежа */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <div className="bg-gray-50 rounded-lg px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Статус</p>
                  <Badge className={statusCfg[woDetail.status]?.cls}>{statusCfg[woDetail.status]?.label}</Badge>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Приоритет</p>
                  <Badge className={priorityCfg[woDetail.priority]?.cls}>{priorityCfg[woDetail.priority]?.label}</Badge>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Доделено на</p>
                  <p className="text-sm font-medium truncate">{woDetail.assignedTo || "—"}</p>
                </div>
                <div className="bg-amber-50 rounded-lg px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-amber-600 font-semibold mb-1">Цена на налог</p>
                  <p className="text-sm font-bold text-amber-700">{parseFloat(woDetail.costAmount ?? "0").toFixed(2)} ден</p>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Планиран почеток</p>
                  <p className="text-sm font-medium">{woDetail.plannedStart ? String(woDetail.plannedStart).split("T")[0] : "—"}</p>
                </div>
              </div>

              <Tabs defaultValue="operations">
                <TabsList className="bg-amber-50">
                  <TabsTrigger value="operations"><Layers className="h-4 w-4 mr-1" /> Операции</TabsTrigger>
                  <TabsTrigger value="materials"><Package className="h-4 w-4 mr-1" /> Материјали</TabsTrigger>
                </TabsList>

                <TabsContent value="operations" className="space-y-4">
                  {!woDetail.operations || woDetail.operations.length === 0 ? (<p className="text-gray-400 text-sm">Нема операции</p>) : (
                    <div className="space-y-2">
                      {woDetail.operations.map((op: any) => (
                        <div key={op.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2.5 bg-gray-50 rounded-lg">
                          <span className="text-xs font-mono bg-gray-200 px-1.5 py-0.5 rounded">{op.sequence}</span>
                          <div className="flex-1 min-w-[140px]">
                            <span className="font-medium text-sm">{opList[op.operation] || op.operation}</span>
                            {op.description && <span className="text-gray-400 text-xs ml-2">{op.description}</span>}
                            {op.estimatedTime && <span className="text-blue-500 text-xs ml-2">план {parseFloat(op.estimatedTime)}ч</span>}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs">
                            <Input type="number" step="0.25" className="h-7 w-20 text-xs" placeholder="реално ч."
                              defaultValue={op.actualTime ? parseFloat(op.actualTime) : ""}
                              onBlur={(e) => { const v = e.target.value; if (v !== String(op.actualTime ?? "")) opUpdateMut.mutate({ id: op.id, actualTime: v || "0" } as any); }} />
                            <span className="text-gray-400">ч ×</span>
                            <Input type="number" step="10" className="h-7 w-24 text-xs" placeholder="ден/час"
                              defaultValue={op.costRate && parseFloat(op.costRate) > 0 ? parseFloat(op.costRate) : ""}
                              onBlur={(e) => { const v = e.target.value; if (v !== String(op.costRate ?? "")) opUpdateMut.mutate({ id: op.id, costRate: v || "0" } as any); }} />
                            <span className="font-semibold text-amber-700 whitespace-nowrap">= {parseFloat(op.costAmount ?? "0").toFixed(0)} ден</span>
                          </div>
                          <Select value={op.status} onValueChange={(v) => opUpdateMut.mutate({ id: op.id, status: v as any })}>
                            <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="pending">На чекање</SelectItem><SelectItem value="in_progress">Во тек</SelectItem><SelectItem value="completed">Завршено</SelectItem><SelectItem value="skipped">Прескокнато</SelectItem></SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  )}
                  <form onSubmit={handleOpSubmit} className="mt-4 p-3 bg-amber-50 rounded-lg space-y-3">
                    <h5 className="text-sm font-medium text-amber-800">Додади операција</h5>
                    <div className="grid grid-cols-2 gap-3">
                      <Select value={opForm.operation} onValueChange={(v) => setOpForm({ ...opForm, operation: v as keyof typeof opList })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(opList).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input type="number" placeholder="Редослед" value={opForm.sequence} onChange={(e) => setOpForm({ ...opForm, sequence: parseInt(e.target.value) || 1 })} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Input placeholder="Опис" value={opForm.description} onChange={(e) => setOpForm({ ...opForm, description: e.target.value })} />
                      <Input type="number" step="0.25" placeholder="Проценето време (час.)" value={opForm.estimatedTime} onChange={(e) => setOpForm({ ...opForm, estimatedTime: e.target.value })} />
                      <Input type="number" step="10" placeholder="Цена по час (ден.)" value={opForm.costRate} onChange={(e) => setOpForm({ ...opForm, costRate: e.target.value })} />
                    </div>
                    <Button type="submit" size="sm" className="bg-amber-500 hover:bg-amber-600" disabled={opCreateMut.isPending}><Plus className="h-3.5 w-3.5 mr-1" />Додади</Button>
                  </form>
                </TabsContent>

                <TabsContent value="materials" className="space-y-4">
                  {(!woDetail.materials || woDetail.materials.length === 0) ? (<p className="text-gray-400 text-sm">Нема материјали</p>) : (
                    <div className="space-y-2">
                      {woDetail.materials.map((wm: any) => (
                        <div key={wm.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2.5 bg-gray-50 rounded-lg">
                          <Package className="h-4 w-4 text-amber-600" />
                          <div className="flex-1">
                            <span className="font-medium text-sm">{wm.materialName || wm.materialCode}</span>
                            <span className="text-gray-400 text-xs ml-2">{wm.quantity} {wm.materialUnit}</span>
                            <span className="text-blue-500 text-xs ml-2">@ {wm.unitCost} ден</span>
                            <span className="font-semibold text-xs ml-2">= {wm.totalCost} ден</span>
                            <Badge className={wm.isActual === "actual" ? "bg-emerald-100 text-emerald-800 ml-2" : "bg-gray-100 text-gray-600 ml-2"}>
                              {wm.isActual === "actual" ? "Реално" : "Планирано"}
                            </Badge>
                          </div>
                          {wm.isActual === "planned" && (
                            <Button size="sm" variant="outline" className="text-amber-700 text-xs" onClick={() => handleIssue(wm)} disabled={issueMut.isPending}>
                              <ArrowDownLeft className="h-3 w-3 mr-1" /> Испорачај
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="text-red-500" onClick={() => matDeleteMut.mutate({ id: wm.id })}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <form onSubmit={handleMatSubmit} className="mt-4 p-4 bg-amber-50 rounded-lg space-y-3">
                    <h5 className="text-sm font-medium text-amber-800">Додади материјал</h5>
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem_auto] gap-3">
                      <MaterialPicker materials={materialsData as any} value={matForm.materialId || null}
                        placeholder="Пребарај материјал…" title="Избери материјал"
                        onSelect={(m: any) => setMatForm({ ...matForm, materialId: String(m.id) })} />
                      <Input type="number" step="0.001" placeholder="Количина" value={matForm.quantity} onChange={(e) => setMatForm({ ...matForm, quantity: e.target.value })} />
                      <Button type="submit" size="sm" variant="outline" disabled={matCreateMut.isPending || !matForm.materialId || !matForm.quantity}>Додади</Button>
                    </div>
                  </form>
                  <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => costUpdateMut.mutate({ id: selWO! })} disabled={costUpdateMut.isPending}>
                    Пресметај цена на налогот
                  </Button>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
