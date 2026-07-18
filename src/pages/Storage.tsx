import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, AlertTriangle, ArrowDownLeft, Package } from "lucide-react";

const materialTypes: Record<string, string> = {
  steel_sheet: "Челичен лим", steel_profile: "Челичен профил", steel_bar: "Челична прачка",
  aluminum_sheet: "Алуминиумски лим", aluminum_profile: "Алуминиумски профил",
  stainless_sheet: "Нерѓосувачки лим", pipe: "Цевка", angle: "Аголник",
  channel: "Канал", screws: "Завртки", welding: "Заварување", paint: "Боја", other: "Други",
};
const units: Record<string, string> = { kg: "кг", m: "м", m2: "м²", pcs: "ком", l: "л" };

export default function Storage() {
  const utils = trpc.useUtils();
  const [mainTab, setMainTab] = useState<"materials" | "finished">("materials");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showLowStock, setShowLowStock] = useState(false);
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<number | null>(null);

  const [form, setForm] = useState({
    name: "", code: "", type: "steel_sheet", unit: "kg",
    description: "", minStock: "0", currentStock: "0", location: "",
  });

  const [txForm, setTxForm] = useState({
    type: "receipt" as "receipt" | "issue" | "adjustment" | "return" | "scrap",
    quantity: "", unitPrice: "", totalPrice: "", reference: "", notes: "",
  });

  const { data: materials, isLoading } = trpc.storage.materialList.useQuery({
    search: search || undefined,
    type: typeFilter === "all" ? undefined : typeFilter,
    lowStock: showLowStock || undefined,
  });

  const { data: stats } = trpc.storage.storageStats.useQuery();
  const { data: finishedGoods } = trpc.accounting.finishedGoodsList.useQuery();
  const { data: warehousesData } = trpc.warehouse.warehouseList.useQuery();

  const createMutation = trpc.storage.materialCreate.useMutation({
    onSuccess: () => {
      utils.storage.materialList.invalidate();
      utils.storage.storageStats.invalidate();
      setDialogOpen(false);
      setForm({ name: "", code: "", type: "steel_sheet", unit: "kg", description: "", minStock: "0", currentStock: "0", location: "" });
    },
  });

  const deleteMutation = trpc.storage.materialDelete.useMutation({
    onSuccess: () => {
      utils.storage.materialList.invalidate();
      utils.storage.storageStats.invalidate();
    },
  });

  const txMutation = trpc.storage.transactionCreate.useMutation({
    onSuccess: () => {
      utils.storage.materialList.invalidate();
      utils.storage.storageStats.invalidate();
      setTxDialogOpen(false);
      setTxForm({ type: "receipt", quantity: "", unitPrice: "", totalPrice: "", reference: "", notes: "" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(form as any);
  };

  const handleTxSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMaterial) return;
    txMutation.mutate({
      materialId: selectedMaterial, type: txForm.type, quantity: txForm.quantity,
      unitPrice: txForm.unitPrice || undefined, totalPrice: txForm.totalPrice || undefined,
      reference: txForm.reference || undefined, notes: txForm.notes || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Управување со склад</h2>
          <p className="text-gray-500 mt-1">Материјали и залихи</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-amber-500 hover:bg-amber-600 text-white">
              <Plus className="h-4 w-4 mr-2" />Нов материјал
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Додади нов материјал</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Назив *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
                <div className="space-y-2"><Label>Код *</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Тип</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(materialTypes).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Единица мера</Label>
                  <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(units).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Минимална залиха</Label><Input type="number" step="0.001" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} /></div>
                <div className="space-y-2"><Label>Почетна залиха</Label><Input type="number" step="0.001" value={form.currentStock} onChange={(e) => setForm({ ...form, currentStock: e.target.value })} /></div>
              </div>
              <div className="space-y-2"><Label>Локација во склад</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="на пр. Ред 3, Полица Б" /></div>
              <div className="space-y-2"><Label>Опис</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Зачувување..." : "Зачувај материјал"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Табови: Материјали / Готови производи */}
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { key: "materials" as const, label: "Материјали" },
          { key: "finished" as const, label: "Готови производи (ГЛ-ПРОД)" },
        ].map(t => (
          <button key={t.key} onClick={() => setMainTab(t.key)} className={`flex items-center gap-1 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${mainTab === t.key ? "border-amber-500 text-amber-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            <Package className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {mainTab === "finished" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Производ</TableHead><TableHead>Код</TableHead><TableHead>Количина</TableHead><TableHead>Магацин</TableHead><TableHead>Од налог</TableHead><TableHead>Трошок/ед.</TableHead><TableHead>Ажурирано</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {!finishedGoods?.length ? <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">Нема готови производи — заврши работен налог во Производство за автоматски влез во ГЛ-ПРОД</TableCell></TableRow> :
                  (finishedGoods as any[]).map((fg) => (
                    <TableRow key={fg.id} className={parseFloat(String(fg.quantity || "0")) <= 0 ? "opacity-50" : ""}>
                      <TableCell className="font-medium">{fg.productName ?? `#${fg.productId}`}</TableCell>
                      <TableCell className="font-mono text-xs text-gray-500">{fg.productCode ?? "-"}</TableCell>
                      <TableCell className="font-semibold">{parseFloat(String(fg.quantity || "0")).toFixed(3).replace(/\.?0+$/, "")} {fg.unit ?? "ком"}</TableCell>
                      <TableCell className="text-gray-500">{fg.warehouseName ?? fg.warehouseCode ?? "-"}</TableCell>
                      <TableCell className="font-mono text-xs">{fg.woNumber ?? "-"}</TableCell>
                      <TableCell className="text-gray-500">{fg.unitCost && parseFloat(String(fg.unitCost)) > 0 ? `${fg.unitCost} ден.` : "-"}</TableCell>
                      <TableCell className="text-gray-400 text-xs">{fg.updatedAt ? String(fg.updatedAt).split("T")[0] : "-"}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {mainTab === "materials" && (<>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-blue-50 p-2.5 rounded-lg"><Package className="h-5 w-5 text-blue-600" /></div>
          <div><p className="text-sm text-gray-500">Вкупно материјали</p><p className="text-xl font-bold">{stats?.totalItems ?? 0}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-red-50 p-2.5 rounded-lg"><AlertTriangle className="h-5 w-5 text-red-600" /></div>
          <div><p className="text-sm text-gray-500">Ниски залихи</p><p className="text-xl font-bold text-red-600">{stats?.lowStockItems ?? 0}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-emerald-50 p-2.5 rounded-lg"><Package className="h-5 w-5 text-emerald-600" /></div>
          <div><p className="text-sm text-gray-500">Вкупно количина</p><p className="text-xl font-bold">{stats?.totalValue ?? 0}</p></div>
        </CardContent></Card>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input placeholder="Пребарувај материјали..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Сите типови" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Сите типови</SelectItem>
            {Object.entries(materialTypes).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant={showLowStock ? "default" : "outline"} onClick={() => setShowLowStock(!showLowStock)} className={showLowStock ? "bg-red-500 text-white hover:bg-red-600" : ""}>
          <AlertTriangle className="h-4 w-4 mr-2" />Ниски залихи
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Код</TableHead><TableHead>Назив</TableHead><TableHead>Тип</TableHead>
                <TableHead>Залиха</TableHead><TableHead>Прос.цена</TableHead><TableHead>Мин.</TableHead><TableHead>Локација</TableHead><TableHead>Акции</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-400">Вчитување...</TableCell></TableRow>
              ) : !materials || materials.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-400">Нема материјали</TableCell></TableRow>
              ) : (
                materials.map((m) => {
                  const isLow = parseFloat(m.currentStock) <= parseFloat(m.minStock);
                  return (
                    <TableRow key={m.id} className={isLow ? "bg-red-50" : ""}>
                      <TableCell className="font-mono text-sm">{m.code}</TableCell>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell><Badge variant="outline">{materialTypes[m.type] || m.type}</Badge></TableCell>
                      <TableCell>
                        <span className={isLow ? "text-red-600 font-semibold" : ""}>{m.currentStock} {units[m.unit]}</span>
                        {isLow && <AlertTriangle className="inline h-3.5 w-3.5 ml-1 text-red-500" />}
                      </TableCell>
                      <TableCell className="text-gray-500">{m.avgCost} ден</TableCell>
                      <TableCell className="text-gray-500">{m.minStock} {units[m.unit]}</TableCell>
                          <TableCell className="text-gray-500">{m.location || "-"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => { setSelectedMaterial(m.id); setTxDialogOpen(true); }}>
                            <ArrowDownLeft className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="outline" className="text-red-500 hover:text-red-600" onClick={() => { if (confirm("Дали сте сигурни?")) deleteMutation.mutate({ id: m.id }); }}>
                            ×
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
      </>)}

      <Dialog open={txDialogOpen} onOpenChange={setTxDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Нова трансакција</DialogTitle></DialogHeader>
          <form onSubmit={handleTxSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Тип на трансакција</Label>
              <Select value={txForm.type} onValueChange={(v: any) => setTxForm({ ...txForm, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="receipt">Прием (+)</SelectItem>
                  <SelectItem value="issue">Издавање (-)</SelectItem>
                  <SelectItem value="adjustment">Корекција</SelectItem>
                  <SelectItem value="return">Враќање (+)</SelectItem>
                  <SelectItem value="scrap">Отпад (-)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Количина *</Label><Input type="number" step="0.001" required value={txForm.quantity} onChange={(e) => setTxForm({ ...txForm, quantity: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Цена по единица</Label><Input type="number" step="0.01" value={txForm.unitPrice} onChange={(e) => setTxForm({ ...txForm, unitPrice: e.target.value })} /></div>
              <div className="space-y-2"><Label>Вкупна цена</Label><Input type="number" step="0.01" value={txForm.totalPrice} onChange={(e) => setTxForm({ ...txForm, totalPrice: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Референца</Label><Input value={txForm.reference} onChange={(e) => setTxForm({ ...txForm, reference: e.target.value })} placeholder="на пр. Нарачка #123" /></div>
            <div className="space-y-2"><Label>Белешки</Label><Textarea value={txForm.notes} onChange={(e) => setTxForm({ ...txForm, notes: e.target.value })} /></div>
            <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600" disabled={txMutation.isPending}>
              {txMutation.isPending ? "Зачувување..." : "Зачувај трансакција"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
