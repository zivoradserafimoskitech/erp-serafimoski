import { useState, useEffect } from "react";
import { useSearchParams } from "react-router";
import { formatDate } from "@/lib/utils";
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
import PurchaseOrderCreateDialog from "@/components/PurchaseOrderCreateDialog";
import PurchaseOrderDetailDialog from "@/components/PurchaseOrderDetailDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ProcurementNeeds from "@/components/ProcurementNeeds";
import {
  Search,
  Plus,
  ShoppingCart,
  Truck,
  Trash2,
  Eye,
  AlertTriangle,
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
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const qq = params.get("q");
    if (qq) { setSearch(qq); params.delete("q"); setParams(params, { replace: true }); }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const [supplierDialog, setSupplierDialog] = useState(false);
  const [poDialog, setPoDialog] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<number | null>(null);

  const [supForm, setSupForm] = useState({
    name: "", contactPerson: "", email: "", phone: "",
    address: "", city: "", country: "Македонија", materials: "",
  });


  const { data: suppliers } = trpc.procurement.supplierList.useQuery({
    search: search || undefined,
  });

  const { data: purchaseOrders } = trpc.procurement.poList.useQuery({
    search: search || undefined,
  });



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

          <Button className="bg-amber-500 hover:bg-amber-600 text-white" onClick={() => setPoDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Нова набавна нарачка
          </Button>
          <PurchaseOrderCreateDialog open={poDialog} onOpenChange={setPoDialog} onCreated={(id) => { setSelectedPO(id); setDetailOpen(true); }} />
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
          <TabsTrigger value="needs">
            <AlertTriangle className="h-4 w-4 mr-1" />
            Потреби
          </TabsTrigger>
        </TabsList>

        <TabsContent value="needs">
          <ProcurementNeeds />
        </TabsContent>

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
                        <TableRow key={po.id} className="cursor-pointer hover:bg-amber-50/40" onClick={() => { setSelectedPO(po.id); setDetailOpen(true); }}>
                          <TableCell className="font-mono text-sm font-medium">{po.poNumber}</TableCell>
                          <TableCell>{po.supplierName}</TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
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
                          <TableCell className="font-medium tabular-nums">{Number(po.totalAmount).toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ден.</TableCell>
                          <TableCell className="text-gray-500">{formatDate(po.expectedDate)}</TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" title="Отвори · печати · прати" onClick={() => { setSelectedPO(po.id); setDetailOpen(true); }}>
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
      <PurchaseOrderDetailDialog poId={selectedPO} open={detailOpen} onOpenChange={setDetailOpen} />
    </div>
  );
}
