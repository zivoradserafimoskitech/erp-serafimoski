import { useState, useEffect } from "react";
import { formatDate } from "@/lib/utils";
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
import ListLimitNote from "@/components/ListLimitNote";
import { printWorkOrder, printRequisition } from "@/lib/print-documents";
import { Search, Plus, Trash2, Eye, Package, Layers, ArrowDownLeft, FileText, Printer, ClipboardList, Truck, Clock } from "lucide-react";
import { MaterialPicker } from "@/components/MaterialPicker";
import ScheduleBoard from "@/components/ScheduleBoard";
import { useSearchParams } from "react-router";

const statusCfg: Record<string, { label: string; cls: string }> = {
  pending: { label: "На чекање", cls: "bg-gray-100 text-gray-700" },
  in_progress: { label: "Во тек", cls: "bg-blue-100 text-blue-700" },
  on_hold: { label: "Паузиран", cls: "bg-amber-100 text-amber-700" },
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

function LiveElapsed({ since }: { since: string | Date }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const total = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
  return <span className="font-mono tabular-nums">{h > 0 ? `${h}:` : ""}{String(m).padStart(2, "0")}:{String(sec).padStart(2, "0")}</span>;
}

export default function Production() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: nextWorkOrderNum } = trpc.settings.nextDocNumber.useQuery({ kind: "workOrder" }, { enabled: dialogOpen });
  const [detailOpen, setDetailOpen] = useState(false);
  const [view, setView] = useState<"list" | "schedule">("list");
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = Number(params.get("open"));
    if (id) { setSelWO(id); setDetailOpen(true); params.delete("open"); setParams(params, { replace: true }); }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const chainInv = trpc.production.workOrderToInvoice.useMutation({ onSuccess: (d) => { toast.success(`Креирана фактура ${d.invoiceNumber} (нацрт)`); utils.accounting.invoiceList.invalidate(); }, onError: (e) => toast.error(e.message) });
  const chainDN = trpc.production.workOrderToDeliveryNote.useMutation({
    onSuccess: (d: any) => {
      toast.success(`Креирана испратница ${d.dnNumber} — готовиот производ е испорачан од ГЛ-ПРОД`);
      utils.accounting.deliveryNoteList.invalidate(); utils.accounting.finishedGoodsList.invalidate(); utils.production.workOrderList.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const { data: woDetail, isLoading: woLoading, error: woError } = trpc.production.workOrderById.useQuery({ id: selWO! }, { enabled: !!selWO });
  const { data: materialsData } = trpc.storage.materialList.useQuery();
  // Редниот број на новата операција = следниот по ред
  useEffect(() => {
    if (woDetail) setOpForm(f => ({ ...f, sequence: (woDetail.operations?.length ?? 0) + 1 }));
  }, [woDetail?.id, woDetail?.operations?.length]);
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
    const avail = parseFloat(String((mat as any)?.availableQty ?? "NaN"));
    if (Number.isFinite(avail) && qty > avail) {
      toast.warning(`Слободна залиха е само ${avail} ${mat?.unit ?? ""} (останатото е резервирано за други налози). Материјалот ќе фали — провери во Набавка.`);
    }
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
      || warehousesData?.find((w: any) => w.type === "raw_materials")
      || warehousesData?.[0];
    if (!matWh) { toast.error("Нема магацин за материјали — провери во Магацини"); return; }
    issueMut.mutate({
      materialId: woMaterial.materialId, warehouseId: matWh.id,
      quantity: woMaterial.quantity, sourceDocType: "work_order", sourceDocId: selWO!,
      reference: woDetail?.woNumber, woMaterialId: woMaterial.id,
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

      <div className="inline-flex rounded-lg bg-gray-100 p-1">
        <button className={`px-4 py-1.5 text-sm rounded-md ${view === "list" ? "bg-white shadow-sm font-medium" : "text-gray-500"}`} onClick={() => setView("list")}>Работни налози</button>
        <button className={`px-4 py-1.5 text-sm rounded-md ${view === "schedule" ? "bg-white shadow-sm font-medium" : "text-gray-500"}`} onClick={() => setView("schedule")}>Распоред по машини</button>
      </div>

      {view === "schedule" && <ScheduleBoard />}

      {view === "list" && (<>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {[
          { label: "Вкупно", value: stats?.total ?? 0, cls: "text-gray-700" },
          { label: "На чекање", value: stats?.pending ?? 0, cls: "text-gray-600" },
          { label: "Во тек", value: stats?.inProgress ?? 0, cls: "text-blue-600" },
          { label: "Паузирани", value: stats?.onHold ?? 0, cls: "text-amber-600" },
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
              <ListLimitNote count={workOrders?.length} />
        </CardContent>
      </Card>

      </>)}

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
        <DialogContent className="sm:max-w-5xl w-[96vw] max-h-[92vh] overflow-y-auto overflow-x-hidden p-0 gap-0">
          {/* Заглавие */}
          <div className="sticky top-0 z-10 bg-gradient-to-b from-gray-50 to-white border-b px-6 pt-6 pb-4">
            <DialogHeader className="p-0 space-y-2 text-left">
              <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
                <div className="min-w-0">
                  <DialogTitle className="text-2xl font-bold tracking-tight text-gray-900">
                    Работен налог <span className="font-mono text-amber-600">{woDetail?.woNumber}</span>
                  </DialogTitle>
                  <p className="text-sm text-gray-500 mt-1 truncate">
                    {woDetail?.description}
                    {woDetail?.orderNumber && !String(woDetail?.description ?? "").includes(woDetail.orderNumber) && <span className="text-gray-400"> · нарачка {woDetail.orderNumber}</span>}
                  </p>
                </div>
                {woDetail && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={`${priorityCfg[woDetail.priority]?.cls} px-2.5 py-1`}>{priorityCfg[woDetail.priority]?.label}</Badge>
                    <Select value={woDetail.status} onValueChange={(v) => {
                      if (v === "completed" && woDetail.status !== "completed") { setCompleteForm({ producedQty: "1", producedUnit: "ком" }); setCompleteWO({ id: woDetail.id, woNumber: woDetail.woNumber }); }
                      else updateMut.mutate({ id: woDetail.id, status: v as any });
                    }}>
                      <SelectTrigger className={`h-8 w-36 font-medium border-0 ${statusCfg[woDetail.status]?.cls}`}><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(statusCfg).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </DialogHeader>
            <div className="flex flex-wrap gap-2 mt-4">
              <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white" onClick={() => woDetail && chainInv.mutate({ workOrderId: woDetail.id })} disabled={chainInv.isPending}><FileText className="h-3.5 w-3.5 mr-1.5" />Кон фактура</Button>
              {woDetail?.status === "completed" && (
                <Button size="sm" variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => woDetail && chainDN.mutate({ workOrderId: woDetail.id })} disabled={chainDN.isPending}><Truck className="h-3.5 w-3.5 mr-1.5" />Кон испратница</Button>
              )}
              <Button size="sm" variant="outline" onClick={() => woDetail && printRequisition(woDetail, companySettings)}><ClipboardList className="h-3.5 w-3.5 mr-1.5" />Требовање</Button>
              <Button size="sm" variant="outline" onClick={() => { if (woDetail) void printWorkOrder(woDetail, companySettings); }}><Printer className="h-3.5 w-3.5 mr-1.5" />Печати / PDF</Button>
            </div>
          </div>

          {!woDetail && woLoading && (
            <p className="py-16 text-center text-gray-400 text-sm">Вчитување на налогот...</p>
          )}

          {!woDetail && woError && (
            <div className="py-10 px-4 text-center space-y-3">
              <p className="text-sm font-medium text-red-700">Деталите не можат да се вчитаат</p>
              <p className="text-xs text-gray-500 max-w-md mx-auto">{woError.message}</p>
            </div>
          )}

          {woDetail && (() => {
            const ops: any[] = woDetail.operations ?? [];
            const mats: any[] = woDetail.materials ?? [];
            const logs: any[] = woDetail.scanSummary?.timeLogs ?? [];
            const opsCost = ops.reduce((a, o) => a + (parseFloat(o.costAmount ?? "0") || 0), 0);
            const matsCost = mats.reduce((a, m) => a + (parseFloat(m.totalCost ?? "0") || 0), 0);
            const doneOps = ops.filter((o) => o.status === "completed" || o.status === "skipped").length;
            const pct = ops.length ? Math.round((doneOps / ops.length) * 100) : 0;
            const den = (n: number) => n.toLocaleString("mk-MK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
            const opStatus: Record<string, string> = {
              pending: "bg-gray-100 text-gray-700", in_progress: "bg-blue-100 text-blue-700",
              completed: "bg-emerald-100 text-emerald-700", skipped: "bg-gray-100 text-gray-400 line-through",
            };
            return (
            <div className="space-y-6 px-6 py-5">
              {/* Преглед */}
              <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr] gap-3">
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-5 py-4">
                  <p className="text-[11px] uppercase tracking-wider text-amber-700/80 font-semibold">Цена на налог</p>
                  <p className="text-3xl font-bold text-amber-700 tracking-tight mt-1">{den(parseFloat(woDetail.costAmount ?? "0"))} <span className="text-base font-semibold">ден</span></p>
                  <div className="flex items-center justify-between gap-2 mt-2">
                    <p className="text-xs text-amber-800/70">Материјали {den(matsCost)} · Операции {den(opsCost)}</p>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-amber-800 hover:bg-amber-100" onClick={() => costUpdateMut.mutate({ id: woDetail.id })} disabled={costUpdateMut.isPending}>
                      Пресметај
                    </Button>
                  </div>
                </div>
                <div className="rounded-xl border px-5 py-4">
                  <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Напредок</p>
                  <p className="text-2xl font-bold text-gray-800 mt-1">{doneOps}<span className="text-gray-400 text-base font-medium"> / {ops.length} операции</span></p>
                  <div className="h-1.5 rounded-full bg-gray-100 mt-3 overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  {(woDetail.scanSummary?.totalLoggedMinutes ?? 0) > 0 && (
                    <p className="text-xs text-gray-500 mt-2">Скенирано: {Math.floor(woDetail.scanSummary.totalLoggedMinutes / 60)}ч {woDetail.scanSummary.totalLoggedMinutes % 60}мин
                      {woDetail.scanSummary.runningOps > 0 && <span className="text-blue-700 font-medium"> · {woDetail.scanSummary.runningOps} во тек</span>}</p>
                  )}
                </div>
                <div className="rounded-xl border px-5 py-4 space-y-2 text-sm">
                  <div className="flex justify-between gap-2"><span className="text-gray-400">Доделено на</span><span className="font-medium text-gray-800 truncate">{woDetail.assignedTo || "—"}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-gray-400">Почеток</span><span className="font-medium text-gray-800">{formatDate(woDetail.plannedStart)}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-gray-400">Крај</span><span className="font-medium text-gray-800">{formatDate(woDetail.plannedEnd)}</span></div>
                </div>
              </div>

              {woDetail.scanSummary?.allDone && woDetail.status !== "completed" && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3">
                  <div className="text-sm text-emerald-900">
                    <b>Сите операции се завршени.</b> Затвори го налогот за готовиот производ да влезе во ГЛ-ПРОД.
                  </div>
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => { setCompleteForm({ producedQty: "1", producedUnit: "ком" }); setCompleteWO({ id: woDetail.id, woNumber: woDetail.woNumber }); }}>
                    Заврши налог
                  </Button>
                </div>
              )}

              <Tabs defaultValue="operations">
                <TabsList className="bg-gray-100">
                  <TabsTrigger value="operations"><Layers className="h-4 w-4 mr-1.5" />Операции <span className="ml-1.5 text-xs text-gray-400">{ops.length}</span></TabsTrigger>
                  <TabsTrigger value="materials"><Package className="h-4 w-4 mr-1.5" />Материјали <span className="ml-1.5 text-xs text-gray-400">{mats.length}</span></TabsTrigger>
                  <TabsTrigger value="timelogs"><Clock className="h-4 w-4 mr-1.5" />Сесии <span className="ml-1.5 text-xs text-gray-400">{logs.length}</span></TabsTrigger>
                </TabsList>

                {/* ОПЕРАЦИИ */}
                <TabsContent value="operations" className="space-y-4 mt-4">
                  {ops.length === 0 ? (
                    <div className="rounded-xl border border-dashed py-8 text-center">
                      <Layers className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm font-medium text-gray-600">Сè уште нема операции</p>
                      <p className="text-xs text-gray-400 mt-1">Додади ги чекорите (сечење, виткање, заварување...) — цената се пресметува од време × цена по час.</p>
                    </div>
                  ) : (
                    <div className="rounded-xl border overflow-hidden">
                      <div className="hidden md:grid grid-cols-[2.5rem_1fr_6rem_11rem_6.5rem_8rem] gap-3 px-4 py-2 bg-gray-50 text-[11px] uppercase tracking-wider text-gray-400 font-semibold">
                        <span>#</span><span>Операција</span><span className="text-right">План</span><span className="text-center">Реално ч × ден/ч</span><span className="text-right">Цена</span><span>Статус</span>
                      </div>
                      {ops.map((op: any) => (
                        <div key={op.id} className="grid grid-cols-1 md:grid-cols-[2.5rem_1fr_6rem_11rem_6.5rem_8rem] gap-3 items-center px-4 py-3 border-t first:border-t-0 md:first:border-t">
                          <span className="h-7 w-7 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">{op.sequence}</span>
                          <div className="min-w-0">
                            <p className="font-medium text-sm text-gray-800">{opList[op.operation] || op.operation}</p>
                            {op.description && <p className="text-xs text-gray-400 truncate">{op.description}</p>}
                            {op.openLog && (
                              <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                                <LiveElapsed since={op.openLog.startedAt} />
                                {op.openLog.operator && <span className="font-normal text-blue-600">· {op.openLog.operator}</span>}
                              </span>
                            )}
                            {!op.openLog && op.timeFromScan && (
                              <p className="text-[11px] text-gray-400">скенирано · {op.sessionCount} {op.sessionCount === 1 ? "сесија" : "сесии"}{op.operators?.length > 0 && ` · ${op.operators.join(", ")}`}</p>
                            )}
                          </div>
                          <span className="text-sm text-gray-500 md:text-right">{op.estimatedTime ? `${parseFloat(op.estimatedTime)} ч` : "—"}</span>
                          <div className="flex items-center gap-1 text-xs md:justify-center">
                            <Input type="number" step="0.25" className={`h-8 w-16 text-xs text-right ${op.timeFromScan ? "bg-blue-50 border-blue-200" : ""}`}
                              placeholder="ч"
                              title={op.timeFromScan ? "Времето доаѓа од скенирање на подот. Рачната измена ќе биде прегазена при следното скенирање." : "Реално време (часови)"}
                              defaultValue={op.actualTime && parseFloat(op.actualTime) > 0 ? parseFloat(op.actualTime) : ""}
                              onBlur={(e) => {
                                const v = e.target.value;
                                if (v === String(op.actualTime ?? "")) return;
                                if (op.timeFromScan && !confirm(
                                  `Времето на оваа операција доаѓа од скенирање (${op.sessionCount} сесии).\n\n` +
                                  `Ако го смениш рачно, вредноста ќе се врати назад штом работникот следниот пат скенира.\n\nСепак да го сменам?`
                                )) { e.target.value = op.actualTime ? String(parseFloat(op.actualTime)) : ""; return; }
                                opUpdateMut.mutate({ id: op.id, actualTime: v || "0" } as any);
                              }} />
                            <span className="text-gray-400">×</span>
                            <Input type="number" step="10" className="h-8 w-20 text-xs text-right" placeholder="ден/ч" title="Цена по час (ден.)"
                              defaultValue={op.costRate && parseFloat(op.costRate) > 0 ? parseFloat(op.costRate) : ""}
                              onBlur={(e) => { const v = e.target.value; if (v !== String(op.costRate ?? "")) opUpdateMut.mutate({ id: op.id, costRate: v || "0" } as any); }} />
                          </div>
                          <span className="text-sm font-semibold text-amber-700 md:text-right whitespace-nowrap">{den(parseFloat(op.costAmount ?? "0"))} ден</span>
                          <Select value={op.status} onValueChange={(v) => opUpdateMut.mutate({ id: op.id, status: v as any })}>
                            <SelectTrigger className={`h-8 text-xs border-0 ${opStatus[op.status] ?? opStatus.pending}`}><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="pending">На чекање</SelectItem><SelectItem value="in_progress">Во тек</SelectItem><SelectItem value="completed">Завршено</SelectItem><SelectItem value="skipped">Прескокнато</SelectItem></SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  )}

                  <form onSubmit={handleOpSubmit} className="rounded-xl border border-dashed border-amber-300 bg-amber-50/40 p-4">
                    <p className="text-sm font-semibold text-amber-800 mb-3 flex items-center gap-1.5"><Plus className="h-4 w-4" />Нова операција</p>
                    <div className="grid grid-cols-2 md:grid-cols-[4rem_1.3fr_1.5fr_7rem_7rem_auto] gap-3 items-end">
                      <div className="space-y-1"><Label className="text-xs text-gray-500">Ред. бр.</Label>
                        <Input type="number" min={1} className="bg-white" value={opForm.sequence} onChange={(e) => setOpForm({ ...opForm, sequence: parseInt(e.target.value) || 1 })} /></div>
                      <div className="space-y-1"><Label className="text-xs text-gray-500">Операција</Label>
                        <Select value={opForm.operation} onValueChange={(v) => setOpForm({ ...opForm, operation: v as keyof typeof opList })}>
                          <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                          <SelectContent>{Object.entries(opList).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                        </Select></div>
                      <div className="space-y-1 col-span-2 md:col-span-1"><Label className="text-xs text-gray-500">Опис</Label>
                        <Input className="bg-white" placeholder="на пр. лим 3мм, 24 парчиња" value={opForm.description} onChange={(e) => setOpForm({ ...opForm, description: e.target.value })} /></div>
                      <div className="space-y-1"><Label className="text-xs text-gray-500">План (ч)</Label>
                        <Input type="number" step="0.25" className="bg-white" placeholder="0" value={opForm.estimatedTime} onChange={(e) => setOpForm({ ...opForm, estimatedTime: e.target.value })} /></div>
                      <div className="space-y-1"><Label className="text-xs text-gray-500">Цена/час</Label>
                        <Input type="number" step="10" className="bg-white" placeholder="ден" value={opForm.costRate} onChange={(e) => setOpForm({ ...opForm, costRate: e.target.value })} /></div>
                      <Button type="submit" className="bg-amber-500 hover:bg-amber-600 col-span-2 md:col-span-1" disabled={opCreateMut.isPending}><Plus className="h-4 w-4 mr-1" />Додади</Button>
                    </div>
                  </form>
                </TabsContent>

                {/* СЕСИИ */}
                <TabsContent value="timelogs" className="space-y-3 mt-4">
                  {logs.length === 0 ? (
                    <div className="rounded-xl border border-dashed py-8 text-center">
                      <Clock className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm font-medium text-gray-600">Нема скенирани сесии</p>
                      <p className="text-xs text-gray-400 mt-1">Работниците ги создаваат со скенирање на QR кодот од печатениот налог.</p>
                    </div>
                  ) : (
                    <div className="rounded-xl border overflow-hidden">
                      {logs.map((l: any) => {
                        const op = ops.find((o: any) => o.id === l.operationId);
                        const mins = Number(l.minutes ?? 0);
                        return (
                          <div key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 border-t first:border-t-0 text-sm">
                            <span className="font-medium min-w-[130px]">{op ? (opList[op.operation] || op.operation) : `Операција #${l.operationId}`}</span>
                            <span className="text-gray-600 text-xs">{l.operator || "—"}</span>
                            <span className="text-gray-400 text-xs">
                              {new Date(l.startedAt).toLocaleString("mk-MK", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                              {l.endedAt && ` → ${new Date(l.endedAt).toLocaleTimeString("mk-MK", { hour: "2-digit", minute: "2-digit" })}`}
                            </span>
                            <span className="ml-auto font-semibold">
                              {l.endedAt ? (mins >= 60 ? `${Math.floor(mins / 60)}ч ${Math.round(mins % 60)}мин` : `${Math.round(mins)} мин`) : (
                                <span className="text-blue-700 flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" /><LiveElapsed since={l.startedAt} /></span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </TabsContent>

                {/* МАТЕРИЈАЛИ */}
                <TabsContent value="materials" className="space-y-4 mt-4">
                  {woDetail.weightSummary && (woDetail.weightSummary.plannedKg > 0 || woDetail.weightSummary.actualKg > 0) && (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-xl border bg-gray-50 px-4 py-3">
                        <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Планирано</div>
                        <div className="text-lg font-bold">{woDetail.weightSummary.plannedKg.toLocaleString("mk-MK")} <span className="text-xs text-gray-400">кг</span></div>
                      </div>
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                        <div className="text-[11px] uppercase tracking-wider text-emerald-700 font-semibold">Реално потрошено</div>
                        <div className="text-lg font-bold text-emerald-800">{woDetail.weightSummary.actualKg.toLocaleString("mk-MK")} <span className="text-xs text-emerald-600">кг</span></div>
                      </div>
                      <div className={`rounded-xl border px-4 py-3 ${woDetail.weightSummary.diffKg > 0 ? "border-red-200 bg-red-50" : woDetail.weightSummary.diffKg < 0 ? "border-blue-200 bg-blue-50" : "bg-gray-50"}`}>
                        <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Разлика</div>
                        <div className={`text-lg font-bold ${woDetail.weightSummary.diffKg > 0 ? "text-red-700" : woDetail.weightSummary.diffKg < 0 ? "text-blue-700" : ""}`}>
                          {woDetail.weightSummary.diffKg > 0 ? "+" : ""}{woDetail.weightSummary.diffKg.toLocaleString("mk-MK")} <span className="text-xs text-gray-400">кг</span>
                        </div>
                      </div>
                    </div>
                  )}
                  {mats.length === 0 ? (
                    <div className="rounded-xl border border-dashed py-8 text-center">
                      <Package className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm font-medium text-gray-600">Сè уште нема материјали</p>
                      <p className="text-xs text-gray-400 mt-1">Додади го планираниот материјал, па со „Испорачај“ издади го од магацин.</p>
                    </div>
                  ) : (
                    <div className="rounded-xl border overflow-hidden">
                      <div className="hidden md:grid grid-cols-[1fr_7rem_6rem_7rem_6rem_7.5rem_2.5rem] gap-3 px-4 py-2 bg-gray-50 text-[11px] uppercase tracking-wider text-gray-400 font-semibold">
                        <span>Материјал</span><span className="text-right">Количина</span><span className="text-right">Цена</span><span className="text-right">Вкупно</span><span>Статус</span><span /><span />
                      </div>
                      {mats.map((wm: any) => (
                        <div key={wm.id} className="grid grid-cols-2 md:grid-cols-[1fr_7rem_6rem_7rem_6rem_7.5rem_2.5rem] gap-3 items-center px-4 py-3 border-t first:border-t-0 md:first:border-t text-sm">
                          <div className="min-w-0 col-span-2 md:col-span-1">
                            <p className="font-medium text-gray-800 truncate">{wm.materialName || wm.materialCode}</p>
                            {Number(wm.weightKg ?? 0) > 0 && <p className="text-xs text-gray-400">{Number(wm.weightKg).toFixed(1)} кг</p>}
                          </div>
                          <span className="md:text-right text-gray-700">{parseFloat(wm.quantity)} <span className="text-gray-400 text-xs">{wm.materialUnit}</span></span>
                          <span className="md:text-right text-gray-500">{den(parseFloat(wm.unitCost ?? "0"))}</span>
                          <span className="md:text-right font-semibold text-gray-800">{den(parseFloat(wm.totalCost ?? "0"))} ден</span>
                          <Badge className={wm.isActual === "actual" ? "bg-emerald-100 text-emerald-800 w-fit" : "bg-gray-100 text-gray-600 w-fit"}>
                            {wm.isActual === "actual" ? "Издадено" : "Планирано"}
                          </Badge>
                          <div>
                            {wm.isActual !== "actual" && (
                              <Button size="sm" variant="outline" className="h-8 text-amber-700 border-amber-300 hover:bg-amber-50 text-xs" onClick={() => handleIssue(wm)} disabled={issueMut.isPending}>
                                <ArrowDownLeft className="h-3 w-3 mr-1" /> Испорачај
                              </Button>
                            )}
                          </div>
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-gray-400 hover:text-red-500" onClick={() => { if (confirm("Да се отстрани материјалот од налогот?")) matDeleteMut.mutate({ id: wm.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <form onSubmit={handleMatSubmit} className="rounded-xl border border-dashed border-amber-300 bg-amber-50/40 p-4">
                    <p className="text-sm font-semibold text-amber-800 mb-3 flex items-center gap-1.5"><Plus className="h-4 w-4" />Нов материјал</p>
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem_auto] gap-3 items-end">
                      <div className="space-y-1"><Label className="text-xs text-gray-500">Материјал</Label>
                        <MaterialPicker materials={materialsData as any} value={matForm.materialId || null}
                          placeholder="Пребарај материјал…" title="Избери материјал"
                          onSelect={(m: any) => setMatForm({ ...matForm, materialId: String(m.id) })} /></div>
                      <div className="space-y-1"><Label className="text-xs text-gray-500">Количина</Label>
                        <Input type="number" step="0.001" className="bg-white" placeholder="0" value={matForm.quantity} onChange={(e) => setMatForm({ ...matForm, quantity: e.target.value })} /></div>
                      <Button type="submit" className="bg-amber-500 hover:bg-amber-600" disabled={matCreateMut.isPending || !matForm.materialId || !matForm.quantity}><Plus className="h-4 w-4 mr-1" />Додади</Button>
                    </div>
                  </form>
                </TabsContent>
              </Tabs>
            </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
