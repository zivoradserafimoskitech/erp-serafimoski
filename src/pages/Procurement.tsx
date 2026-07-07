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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  Plus,
  ShoppingCart,
  Truck,
  Trash2,
  Eye,
} from "lucide-react";

const poStatusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: "Нацрт", className: "bg-gray-100 text-gray-700" },
  sent: { label: "Испратена", className: "bg-blue-100 text-blue-700" },
  confirmed: { label: "Потврдена", className: "bg-emerald-100 text-emerald-700" },
  received: { label: "Примена", className: "bg-teal-100 text-teal-700" },
  cancelled: { label: "Откажана", className: "bg-red-100 text-red-700" },
};

export default function Procurement() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [supplierDialog, setSupplierDialog] = useState(false);
  const [poDialog, setPoDialog] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<number | null>(null);

  const [supForm, setSupForm] = useState({
    name: "", contactPerson: "", email: "", phone: "",
    address: "", city: "", country: "Македонија", materials: "",
  });

  const [poForm, setPoForm] = useState({
    poNumber: "", supplierId: "", expectedDate: "", notes: "",
  });

  const [items, setItems] = useState<Array<{
    materialId: string; description: string; quantity: string;
    unitPrice: string; totalPrice: string; notes: string;
  }>>([]);

  const { data: suppliers } = trpc.procurement.supplierList.useQuery({
    search: search || undefined,
  });

  const { data: purchaseOrders } = trpc.procurement.poList.useQuery({
    search: search || undefined,
  });

  const { data: allMaterials } = trpc.storage.materialList.useQuery({});

  const { data: poDetail } = trpc.procurement.poById.useQuery(
    { id: selectedPO! },
    { enabled: !!selectedPO }
  );

  const supCreate = trpc.procurement.supplierCreate.useMutation({
    onSuccess: () => {
      utils.procurement.supplierList.invalidate();
      setSupplierDialog(false);
      setSupForm({ name: "", contactPerson: "", email: "", phone: "", address: "", city: "", country: "Македонија", materials: "" });
    },
  });

  const supDelete = trpc.procurement.supplierDelete.useMutation({
    onSuccess: () => utils.procurement.supplierList.invalidate(),
  });

  const poCreate = trpc.procurement.poCreate.useMutation({
    onSuccess: () => {
      utils.procurement.poList.invalidate();
      utils.dashboard.stats.invalidate();
      setPoDialog(false);
      setPoForm({ poNumber: "", supplierId: "", expectedDate: "", notes: "" });
      setItems([]);
    },
  });

  const poUpdate = trpc.procurement.poUpdate.useMutation({
    onSuccess: () => {
      utils.procurement.poList.invalidate();
      utils.procurement.poById.invalidate();
      utils.dashboard.stats.invalidate();
    },
  });

  const poDelete = trpc.procurement.poDelete.useMutation({
    onSuccess: () => {
      utils.procurement.poList.invalidate();
      utils.dashboard.stats.invalidate();
    },
  });

  const handleSupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    supCreate.mutate(supForm);
  };

  const handlePoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!poForm.supplierId || items.length === 0) return;
    poCreate.mutate({
      ...poForm,
      supplierId: parseInt(poForm.supplierId),
      items: items.map((i) => ({ ...i, materialId: parseInt(i.materialId) })),
    });
  };

  const addItem = () => {
    setItems([...items, { materialId: "", description: "", quantity: "", unitPrice: "", totalPrice: "", notes: "" }]);
  };

  const updateItem = (idx: number, field: string, value: string) => {
    const newItems = [...items];
    (newItems[idx] as any)[field] = value;
    if (field === "quantity" || field === "unitPrice") {
      const q = parseFloat(newItems[idx].quantity) || 0;
      const p = parseFloat(newItems[idx].unitPrice) || 0;
      newItems[idx].totalPrice = (q * p).toFixed(2);
    }
    setItems(newItems);
  };

  const removeItem = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Набавка</h2>
          <p className="text-gray-500 mt-1">Добавувачи и набавни нарачки</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={supplierDialog} onOpenChange={setSupplierDialog}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                Нов добавувач
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Нов добавувач</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSupSubmit} className="space-y-3">
                <div className="space-y-2">
                  <Label>Назив *</Label>
                  <Input value={supForm.name} onChange={(e) => setSupForm({ ...supForm, name: e.target.value })} required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Контакт лице</Label>
                    <Input value={supForm.contactPerson} onChange={(e) => setSupForm({ ...supForm, contactPerson: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Телефон</Label>
                    <Input value={supForm.phone} onChange={(e) => setSupForm({ ...supForm, phone: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" value={supForm.email} onChange={(e) => setSupForm({ ...supForm, email: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Адреса</Label>
                  <Input value={supForm.address} onChange={(e) => setSupForm({ ...supForm, address: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Град</Label>
                    <Input value={supForm.city} onChange={(e) => setSupForm({ ...supForm, city: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Држава</Label>
                    <Input value={supForm.country} onChange={(e) => setSupForm({ ...supForm, country: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Материјали што ги нуди</Label>
                  <Textarea value={supForm.materials} onChange={(e) => setSupForm({ ...supForm, materials: e.target.value })} placeholder="на пр. Челични лимови, профили..." />
                </div>
                <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600" disabled={supCreate.isPending}>
                  {supCreate.isPending ? "Зачувување..." : "Зачувај добавувач"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={poDialog} onOpenChange={setPoDialog}>
            <DialogTrigger asChild>
              <Button className="bg-amber-500 hover:bg-amber-600 text-white">
                <Plus className="h-4 w-4 mr-2" />
                Нова набавна нарачка
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Нова набавна нарачка</DialogTitle>
              </DialogHeader>
              <form onSubmit={handlePoSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Број на нарачка *</Label>
                    <Input value={poForm.poNumber} onChange={(e) => setPoForm({ ...poForm, poNumber: e.target.value })} required placeholder="на пр. PO-2026-001" />
                  </div>
                  <div className="space-y-2">
                    <Label>Добавувач *</Label>
                    <Select value={poForm.supplierId} onValueChange={(v) => setPoForm({ ...poForm, supplierId: v })}>
                      <SelectTrigger><SelectValue placeholder="Избери добавувач" /></SelectTrigger>
                      <SelectContent>
                        {suppliers?.map((s) => (
                          <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Очекуван датум на прием</Label>
                  <Input type="date" value={poForm.expectedDate} onChange={(e) => setPoForm({ ...poForm, expectedDate: e.target.value })} />
                </div>

                {/* Items */}
                <div className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Ставки</Label>
                    <Button type="button" size="sm" variant="outline" onClick={addItem}>
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Додади ставка
                    </Button>
                  </div>
                  {items.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-gray-50 p-2 rounded">
                      <div className="col-span-3">
                        <Select value={item.materialId} onValueChange={(v) => updateItem(idx, "materialId", v)}>
                          <SelectTrigger className="text-xs"><SelectValue placeholder="Материјал" /></SelectTrigger>
                          <SelectContent>
                            {allMaterials?.map((m) => (
                              <SelectItem key={m.id} value={m.id.toString()}>{m.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-3">
                        <Input size={1} placeholder="Опис" value={item.description} onChange={(e) => updateItem(idx, "description", e.target.value)} />
                      </div>
                      <div className="col-span-2">
                        <Input size={1} type="number" step="0.001" placeholder="Кол." value={item.quantity} onChange={(e) => updateItem(idx, "quantity", e.target.value)} />
                      </div>
                      <div className="col-span-2">
                        <Input size={1} type="number" step="0.01" placeholder="Цена" value={item.unitPrice} onChange={(e) => updateItem(idx, "unitPrice", e.target.value)} />
                      </div>
                      <div className="col-span-1">
                        <Button type="button" size="sm" variant="ghost" className="text-red-500" onClick={() => removeItem(idx)}>×</Button>
                      </div>
                    </div>
                  ))}
                  {items.length > 0 && (
                    <div className="text-right text-sm font-semibold">
                      Вкупно: {items.reduce((s, i) => s + parseFloat(i.totalPrice || "0"), 0).toFixed(2)} ден.
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Белешки</Label>
                  <Textarea value={poForm.notes} onChange={(e) => setPoForm({ ...poForm, notes: e.target.value })} />
                </div>
                <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600" disabled={poCreate.isPending || !poForm.supplierId || items.length === 0}>
                  {poCreate.isPending ? "Зачувување..." : "Креирај набавна нарачка"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input placeholder="Пребарувај добавувачи и нарачки..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Tabs defaultValue="suppliers" className="space-y-4">
        <TabsList>
          <TabsTrigger value="suppliers">
            <Truck className="h-4 w-4 mr-1" />
            Добавувачи
          </TabsTrigger>
          <TabsTrigger value="orders">
            <ShoppingCart className="h-4 w-4 mr-1" />
            Набавни нарачки
          </TabsTrigger>
        </TabsList>

        <TabsContent value="suppliers">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Назив</TableHead>
                    <TableHead>Контакт</TableHead>
                    <TableHead>Телефон</TableHead>
                    <TableHead>Град</TableHead>
                    <TableHead>Материјали</TableHead>
                    <TableHead>Акции</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers?.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-400">Нема добавувачи</TableCell></TableRow>
                  ) : (
                    suppliers?.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell>{s.contactPerson || "-"}</TableCell>
                        <TableCell>{s.phone || "-"}</TableCell>
                        <TableCell>{s.city || "-"}</TableCell>
                        <TableCell className="max-w-xs truncate">{s.materials || "-"}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" className="text-red-500" onClick={() => { if (confirm("Дали сте сигурни?")) supDelete.mutate({ id: s.id }); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orders">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Број</TableHead>
                    <TableHead>Добавувач</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Износ</TableHead>
                    <TableHead>Очекуван датум</TableHead>
                    <TableHead>Акции</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchaseOrders?.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-400">Нема набавни нарачки</TableCell></TableRow>
                  ) : (
                    purchaseOrders?.map((po) => {
                      const st = poStatusConfig[po.status] || poStatusConfig.draft;
                      return (
                        <TableRow key={po.id}>
                          <TableCell className="font-mono text-sm font-medium">{po.poNumber}</TableCell>
                          <TableCell>{po.supplierName}</TableCell>
                          <TableCell>
                            <Select value={po.status} onValueChange={(v) => poUpdate.mutate({ id: po.id, status: v as any })}>
                              <SelectTrigger className="h-7 w-32">
                                <Badge className={st.className + " text-xs"}>{st.label}</Badge>
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(poStatusConfig).map(([k, v]) => (
                                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="font-medium">{po.totalAmount} ден.</TableCell>
                          <TableCell className="text-gray-500">{po.expectedDate ? String(po.expectedDate).split("T")[0] : "-"}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" onClick={() => { setSelectedPO(po.id); setDetailOpen(true); }}>
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" className="text-red-500" onClick={() => { if (confirm("Дали сте сигурни?")) poDelete.mutate({ id: po.id }); }}>
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
        </TabsContent>
      </Tabs>

      {/* PO Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Набавна нарачка {poDetail?.poNumber}</DialogTitle>
          </DialogHeader>
          {poDetail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">Добавувач:</span> {poDetail.supplier?.name}</div>
                <div><span className="text-gray-500">Статус:</span> <Badge className={poStatusConfig[poDetail.status]?.className}>{poStatusConfig[poDetail.status]?.label}</Badge></div>
                <div><span className="text-gray-500">Вкупно:</span> <span className="font-semibold">{poDetail.totalAmount} ден.</span></div>
                <div><span className="text-gray-500">Очекувано:</span> {poDetail.expectedDate ? String(poDetail.expectedDate).split("T")[0] : "-"}</div>
              </div>

              {poDetail.items && poDetail.items.length > 0 && (
                <div className="border-t pt-3">
                  <h4 className="font-semibold mb-2">Ставки</h4>
                  <div className="space-y-2">
                    {poDetail.items.map((item) => (
                      <div key={item.id} className="bg-gray-50 p-2 rounded text-sm">
                        <div className="font-medium">{item.description}</div>
                        <div className="text-gray-500 flex flex-wrap gap-2 mt-1">
                          <span>Мат: {item.materialName}</span>
                          <span>Кол: {item.quantity} {item.materialUnit}</span>
                          <span>Цена: {item.unitPrice} ден.</span>
                          <span>Вкупно: {item.totalPrice} ден.</span>
                          <span>Примено: {item.receivedQuantity}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {poDetail.notes && (
                <div className="border-t pt-3">
                  <span className="text-gray-500 text-sm">Белешки: {poDetail.notes}</span>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
