import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Plus,
  Clock,
  CheckCircle,
  PauseCircle,
  PlayCircle,
  Trash2,
  Eye,
} from "lucide-react";

const statusConfig: Record<string, { label: string; className: string; icon: any }> = {
  pending: { label: "На чекање", className: "bg-gray-100 text-gray-700", icon: Clock },
  in_progress: { label: "Во тек", className: "bg-blue-100 text-blue-700", icon: PlayCircle },
  on_hold: { label: "На удар", className: "bg-amber-100 text-amber-700", icon: PauseCircle },
  completed: { label: "Завршено", className: "bg-emerald-100 text-emerald-700", icon: CheckCircle },
  cancelled: { label: "Откажано", className: "bg-red-100 text-red-700", icon: Trash2 },
};

const priorityConfig: Record<string, { label: string; className: string }> = {
  low: { label: "Низок", className: "bg-gray-100 text-gray-600" },
  normal: { label: "Нормален", className: "bg-blue-100 text-blue-600" },
  high: { label: "Висок", className: "bg-orange-100 text-orange-600" },
  urgent: { label: "Итен", className: "bg-red-100 text-red-600" },
};

const operationsList: Record<string, string> = {
  cutting_laser: "Ласерско сечење",
  cutting_plasma: "Плазма сечење",
  bending: "Виткање",
  welding_mig: "MIG заварување",
  welding_tig: "TIG заварување",
  grinding: "Брусење",
  drilling: "Дупчење",
  painting: "Бојадисување",
  assembly: "Монтажа",
  quality_control: "Контрола на квалитет",
  packaging: "Пакување",
};

export default function Production() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedWO, setSelectedWO] = useState<number | null>(null);

  const [form, setForm] = useState({
    woNumber: "",
    description: "",
    priority: "normal",
    plannedStart: "",
    plannedEnd: "",
    assignedTo: "",
    notes: "",
  });

  const [opForm, setOpForm] = useState({
    operation: "cutting_laser",
    sequence: 1,
    description: "",
    estimatedTime: "",
    operator: "",
  });

  const { data: workOrders, isLoading } = trpc.production.workOrderList.useQuery({
    search: search || undefined,
    status: statusFilter || undefined,
  });

  const { data: stats } = trpc.production.productionStats.useQuery();
  const { data: woDetail } = trpc.production.workOrderById.useQuery(
    { id: selectedWO! },
    { enabled: !!selectedWO }
  );

  const createMutation = trpc.production.workOrderCreate.useMutation({
    onSuccess: () => {
      utils.production.workOrderList.invalidate();
      utils.production.productionStats.invalidate();
      setDialogOpen(false);
      setForm({ woNumber: "", description: "", priority: "normal", plannedStart: "", plannedEnd: "", assignedTo: "", notes: "" });
    },
  });

  const updateMutation = trpc.production.workOrderUpdate.useMutation({
    onSuccess: () => {
      utils.production.workOrderList.invalidate();
      utils.production.productionStats.invalidate();
      utils.production.workOrderById.invalidate();
    },
  });

  const deleteMutation = trpc.production.workOrderDelete.useMutation({
    onSuccess: () => {
      utils.production.workOrderList.invalidate();
      utils.production.productionStats.invalidate();
    },
  });

  const opCreateMutation = trpc.production.operationCreate.useMutation({
    onSuccess: () => {
      utils.production.workOrderById.invalidate();
    },
  });

  const opUpdateMutation = trpc.production.operationUpdate.useMutation({
    onSuccess: () => {
      utils.production.workOrderById.invalidate();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(form as any);
  };

  const handleOpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWO) return;
    opCreateMutation.mutate({ ...opForm, workOrderId: selectedWO } as any);
    setOpForm({ operation: "cutting_laser", sequence: (woDetail?.operations?.length || 0) + 1, description: "", estimatedTime: "", operator: "" });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Производство</h2>
          <p className="text-gray-500 mt-1">Работни налози и операции</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-amber-500 hover:bg-amber-600 text-white">
              <Plus className="h-4 w-4 mr-2" />
              Нов работен налог
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Нов работен налог</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Број на налог *</Label>
                <Input value={form.woNumber} onChange={(e) => setForm({ ...form, woNumber: e.target.value })} required placeholder="на пр. WO-2026-001" />
              </div>
              <div className="space-y-2">
                <Label>Опис *</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Приоритет</Label>
                  <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(priorityConfig).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Доделено на</Label>
                  <Input value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} placeholder="Име на оператер" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Планиран почеток</Label>
                  <Input type="date" value={form.plannedStart} onChange={(e) => setForm({ ...form, plannedStart: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Планиран крај</Label>
                  <Input type="date" value={form.plannedEnd} onChange={(e) => setForm({ ...form, plannedEnd: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Белешки</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Зачувување..." : "Креирај налог"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Вкупно", value: stats?.total ?? 0, color: "text-gray-700", bg: "bg-gray-50" },
          { label: "На чекање", value: stats?.pending ?? 0, color: "text-gray-600", bg: "bg-gray-50" },
          { label: "Во тек", value: stats?.inProgress ?? 0, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Завршени", value: stats?.completed ?? 0, color: "text-emerald-600", bg: "bg-emerald-50" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input placeholder="Пребарувај работни налози..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Сите статуси" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Сите статуси</SelectItem>
            {Object.entries(statusConfig).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Work Orders Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Број</TableHead>
                <TableHead>Опис</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Приоритет</TableHead>
                <TableHead>Доделено</TableHead>
                <TableHead>Планиран почеток</TableHead>
                <TableHead>Акции</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">Вчитување...</TableCell></TableRow>
              ) : workOrders?.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">Нема работни налози</TableCell></TableRow>
              ) : (
                workOrders?.map((wo) => {
                  const st = statusConfig[wo.status] || statusConfig.pending;
                  const pr = priorityConfig[wo.priority] || priorityConfig.normal;
                  const StatusIcon = st.icon;
                  return (
                    <TableRow key={wo.id}>
                      <TableCell className="font-mono text-sm font-medium">{wo.woNumber}</TableCell>
                      <TableCell>{wo.description}</TableCell>
                      <TableCell>
                        <Badge className={st.className}>
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {st.label}
                        </Badge>
                      </TableCell>
                      <TableCell><Badge className={pr.className}>{pr.label}</Badge></TableCell>
                      <TableCell>{wo.assignedTo || "-"}</TableCell>
                      <TableCell className="text-gray-500">{wo.plannedStart ? String(wo.plannedStart).split("T")[0] : "-"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Select
                            value={wo.status}
                            onValueChange={(v) => updateMutation.mutate({ id: wo.id, status: v as any })}
                          >
                            <SelectTrigger className="h-8 w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(statusConfig).map(([k, v]) => (
                                <SelectItem key={k} value={k}>{v.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button size="sm" variant="outline" onClick={() => { setSelectedWO(wo.id); setDetailOpen(true); }}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-500" onClick={() => { if (confirm("Дали сте сигурни?")) deleteMutation.mutate({ id: wo.id }); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Детали за работен налог {woDetail?.woNumber}</DialogTitle>
          </DialogHeader>

          {woDetail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-gray-500">Опис:</span> {woDetail.description}</div>
                <div><span className="text-gray-500">Статус:</span> <Badge className={statusConfig[woDetail.status]?.className}>{statusConfig[woDetail.status]?.label}</Badge></div>
                <div><span className="text-gray-500">Приоритет:</span> <Badge className={priorityConfig[woDetail.priority]?.className}>{priorityConfig[woDetail.priority]?.label}</Badge></div>
                <div><span className="text-gray-500">Доделено на:</span> {woDetail.assignedTo || "-"}</div>
                <div><span className="text-gray-500">Планиран почеток:</span> {woDetail.plannedStart ? String(woDetail.plannedStart).split("T")[0] : "-"}</div>
                <div><span className="text-gray-500">Планиран крај:</span> {woDetail.plannedEnd ? String(woDetail.plannedEnd).split("T")[0] : "-"}</div>
              </div>

              {/* Operations */}
              <div className="border-t pt-4">
                <h4 className="font-semibold mb-3">Операции</h4>
                {woDetail.operations?.length === 0 ? (
                  <p className="text-gray-400 text-sm">Нема операции</p>
                ) : (
                  <div className="space-y-2">
                    {woDetail.operations?.map((op) => (
                      <div key={op.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                        <span className="text-xs font-mono bg-gray-200 px-1.5 py-0.5 rounded">{op.sequence}</span>
                        <div className="flex-1">
                          <span className="font-medium text-sm">{operationsList[op.operation] || op.operation}</span>
                          {op.description && <span className="text-gray-400 text-xs ml-2">{op.description}</span>}
                        </div>
                        <Select
                          value={op.status}
                          onValueChange={(v) => opUpdateMutation.mutate({ id: op.id, status: v as any })}
                        >
                          <SelectTrigger className="h-7 w-28 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">На чекање</SelectItem>
                            <SelectItem value="in_progress">Во тек</SelectItem>
                            <SelectItem value="completed">Завршено</SelectItem>
                            <SelectItem value="skipped">Прескокнато</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add Operation Form */}
                <form onSubmit={handleOpSubmit} className="mt-4 p-3 bg-amber-50 rounded-lg space-y-3">
                  <h5 className="text-sm font-medium text-amber-800">Додади операција</h5>
                  <div className="grid grid-cols-2 gap-3">
                    <Select value={opForm.operation} onValueChange={(v) => setOpForm({ ...opForm, operation: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(operationsList).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input type="number" placeholder="Редослед" value={opForm.sequence} onChange={(e) => setOpForm({ ...opForm, sequence: parseInt(e.target.value) || 1 })} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Input placeholder="Опис" value={opForm.description} onChange={(e) => setOpForm({ ...opForm, description: e.target.value })} />
                    <Input placeholder="Проценето време (час.)" value={opForm.estimatedTime} onChange={(e) => setOpForm({ ...opForm, estimatedTime: e.target.value })} />
                  </div>
                  <Button type="submit" size="sm" className="bg-amber-500 hover:bg-amber-600" disabled={opCreateMutation.isPending}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Додади операција
                  </Button>
                </form>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
