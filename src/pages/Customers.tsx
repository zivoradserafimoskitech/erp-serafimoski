import { useState, useEffect } from "react";
import { toast } from "sonner";
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
  Users,
  ClipboardList,
  Trash2,
  Eye,
} from "lucide-react";

const orderStatusConfig: Record<string, { label: string; className: string }> = {
  pending: { label: "На чекање", className: "bg-gray-100 text-gray-700" },
  confirmed: { label: "Потврдена", className: "bg-blue-100 text-blue-700" },
  in_production: { label: "Во производство", className: "bg-amber-100 text-amber-700" },
  ready: { label: "Готова", className: "bg-emerald-100 text-emerald-700" },
  delivered: { label: "Испорачана", className: "bg-teal-100 text-teal-700" },
  cancelled: { label: "Откажана", className: "bg-red-100 text-red-700" },
};

const priorityConfig: Record<string, { label: string; className: string }> = {
  low: { label: "Низок", className: "bg-gray-100" },
  normal: { label: "Нормален", className: "bg-blue-100 text-blue-700" },
  high: { label: "Висок", className: "bg-orange-100 text-orange-700" },
  urgent: { label: "Итен", className: "bg-red-100 text-red-700" },
};

export default function Customers() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [customerDialog, setCustomerDialog] = useState(false);
  const [orderDialog, setOrderDialog] = useState(false);
  const { data: nextOrderNum } = trpc.settings.nextDocNumber.useQuery({ kind: "order" }, { enabled: orderDialog });
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<number | null>(null);

  const [custForm, setCustForm] = useState({
    name: "", company: "", contactPerson: "", email: "", phone: "",
    address: "", city: "", taxNumber: "", notes: "",
  });

  const [orderForm, setOrderForm] = useState({
    orderNumber: "", customerId: "", priority: "normal",
    deliveryDate: "", notes: "",
  });

  const [items, setItems] = useState<Array<{
    description: string; drawingNumber: string; quantity: number;
    unitPrice: string; totalPrice: string; material: string; dimensions: string;
  }>>([]);

  const { data: customers } = trpc.customers.customerList.useQuery({
    search: search || undefined,
  });

  const { data: orders } = trpc.customers.orderList.useQuery({
    search: search || undefined,
  });

  const { data: orderDetail } = trpc.customers.orderById.useQuery(
    { id: selectedOrder! },
    { enabled: !!selectedOrder }
  );

  const custCreate = trpc.customers.customerCreate.useMutation({
    onSuccess: () => {
      utils.customers.customerList.invalidate();
      setCustomerDialog(false);
      setCustForm({ name: "", company: "", contactPerson: "", email: "", phone: "", address: "", city: "", taxNumber: "", notes: "" });
    },
  });

  const custDelete = trpc.customers.customerDelete.useMutation({
    onSuccess: () => utils.customers.customerList.invalidate(),
  });

  const orderCreate = trpc.customers.orderCreate.useMutation({
    onSuccess: () => {
      utils.customers.orderList.invalidate();
      utils.dashboard.stats.invalidate();
      setOrderDialog(false);
      setOrderForm({ orderNumber: "", customerId: "", priority: "normal", deliveryDate: "", notes: "" });
      setItems([]);
    },
  });

  const chainWO = trpc.production.orderFromChain.useMutation({ onSuccess: (d) => { toast.success(`Креиран работен налог ${d.woNumber}`); } });
  const orderUpdate = trpc.customers.orderUpdate.useMutation({
    onSuccess: () => {
      utils.customers.orderList.invalidate();
      utils.customers.orderById.invalidate();
      utils.dashboard.stats.invalidate();
    },
  });

  const orderDelete = trpc.customers.orderDelete.useMutation({
    onSuccess: () => {
      utils.customers.orderList.invalidate();
      utils.dashboard.stats.invalidate();
    },
  });

  const handleCustSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    custCreate.mutate(custForm);
  };

  const handleOrderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderForm.customerId || items.length === 0) return;
    orderCreate.mutate({
      orderNumber: orderForm.orderNumber,
      customerId: parseInt(orderForm.customerId),
      priority: orderForm.priority as "low" | "normal" | "high" | "urgent",
      deliveryDate: orderForm.deliveryDate || undefined,
      notes: orderForm.notes || undefined,
      items: items.map((i) => ({ ...i, totalPrice: i.totalPrice })),
    });
  };

  const addItem = () => {
    setItems([...items, { description: "", drawingNumber: "", quantity: 1, unitPrice: "0", totalPrice: "0", material: "", dimensions: "" }]);
  };

  const updateItem = (idx: number, field: string, value: string) => {
    const newItems = [...items];
    (newItems[idx] as any)[field] = value;
    if (field === "quantity" || field === "unitPrice") {
      const q = parseFloat(newItems[idx].quantity.toString()) || 0;
      const p = parseFloat(newItems[idx].unitPrice) || 0;
      newItems[idx].totalPrice = (q * p).toFixed(2);
    }
    setItems(newItems);
  };

  const removeItem = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx));
  };

  useEffect(() => {
    if (orderDialog && nextOrderNum && !orderForm.orderNumber) {
      setOrderForm(prev => ({ ...prev, orderNumber: nextOrderNum }));
    }
  }, [orderDialog, nextOrderNum]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Клиенти и нарачки</h2>
          <p className="text-gray-500 mt-1">Управување со клиенти и нивни нарачки</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={customerDialog} onOpenChange={setCustomerDialog}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                Нов клиент
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Нов клиент</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCustSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Назив *</Label>
                    <Input value={custForm.name} onChange={(e) => setCustForm({ ...custForm, name: e.target.value })} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Компанија</Label>
                    <Input value={custForm.company} onChange={(e) => setCustForm({ ...custForm, company: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Контакт лице</Label>
                    <Input value={custForm.contactPerson} onChange={(e) => setCustForm({ ...custForm, contactPerson: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Телефон</Label>
                    <Input value={custForm.phone} onChange={(e) => setCustForm({ ...custForm, phone: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" value={custForm.email} onChange={(e) => setCustForm({ ...custForm, email: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Адреса</Label>
                  <Input value={custForm.address} onChange={(e) => setCustForm({ ...custForm, address: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Град</Label>
                    <Input value={custForm.city} onChange={(e) => setCustForm({ ...custForm, city: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Даночен број</Label>
                    <Input value={custForm.taxNumber} onChange={(e) => setCustForm({ ...custForm, taxNumber: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Белешки</Label>
                  <Textarea value={custForm.notes} onChange={(e) => setCustForm({ ...custForm, notes: e.target.value })} />
                </div>
                <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600" disabled={custCreate.isPending}>
                  {custCreate.isPending ? "Зачувување..." : "Зачувај клиент"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={orderDialog} onOpenChange={setOrderDialog}>
            <DialogTrigger asChild>
              <Button className="bg-amber-500 hover:bg-amber-600 text-white">
                <Plus className="h-4 w-4 mr-2" />
                Нова нарачка
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Нова нарачка</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleOrderSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Број на нарачка *</Label>
                    <Input value={orderForm.orderNumber} onChange={(e) => setOrderForm({ ...orderForm, orderNumber: e.target.value })} required placeholder="на пр. ORD-2026-001" />
                  </div>
                  <div className="space-y-2">
                    <Label>Клиент *</Label>
                    <Select value={orderForm.customerId} onValueChange={(v) => setOrderForm({ ...orderForm, customerId: v })}>
                      <SelectTrigger><SelectValue placeholder="Избери клиент" /></SelectTrigger>
                      <SelectContent>
                        {customers?.map((c) => (
                          <SelectItem key={c.id} value={c.id.toString()}>{c.name} {c.company ? `(${c.company})` : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Приоритет</Label>
                    <Select value={orderForm.priority} onValueChange={(v) => setOrderForm({ ...orderForm, priority: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(priorityConfig).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Датум на испорака</Label>
                    <Input type="date" value={orderForm.deliveryDate} onChange={(e) => setOrderForm({ ...orderForm, deliveryDate: e.target.value })} />
                  </div>
                </div>

                {/* Items */}
                <div className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Ставки во нарачка</Label>
                    <Button type="button" size="sm" variant="outline" onClick={addItem}>
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Додади ставка
                    </Button>
                  </div>
                  {items.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-gray-50 p-2 rounded">
                      <div className="col-span-4">
                        <Input size={1} placeholder="Опис" value={item.description} onChange={(e) => updateItem(idx, "description", e.target.value)} />
                      </div>
                      <div className="col-span-2">
                        <Input size={1} placeholder="Цртеж №" value={item.drawingNumber} onChange={(e) => updateItem(idx, "drawingNumber", e.target.value)} />
                      </div>
                      <div className="col-span-1">
                        <Input size={1} type="number" placeholder="Кол." value={item.quantity} onChange={(e) => updateItem(idx, "quantity", e.target.value)} />
                      </div>
                      <div className="col-span-2">
                        <Input size={1} type="number" step="0.01" placeholder="Цена" value={item.unitPrice} onChange={(e) => updateItem(idx, "unitPrice", e.target.value)} />
                      </div>
                      <div className="col-span-2">
                        <Input size={1} placeholder="Материјал" value={item.material} onChange={(e) => updateItem(idx, "material", e.target.value)} />
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
                  <Textarea value={orderForm.notes} onChange={(e) => setOrderForm({ ...orderForm, notes: e.target.value })} />
                </div>
                <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600" disabled={orderCreate.isPending || !orderForm.customerId || items.length === 0}>
                  {orderCreate.isPending ? "Зачувување..." : "Креирај нарачка"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input placeholder="Пребарувај клиенти и нарачки..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Tabs defaultValue="customers" className="space-y-4">
        <TabsList>
          <TabsTrigger value="customers">
            <Users className="h-4 w-4 mr-1" />
            Клиенти
          </TabsTrigger>
          <TabsTrigger value="orders">
            <ClipboardList className="h-4 w-4 mr-1" />
            Нарачки
          </TabsTrigger>
        </TabsList>

        <TabsContent value="customers">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Назив</TableHead>
                    <TableHead>Компанија</TableHead>
                    <TableHead>Контакт</TableHead>
                    <TableHead>Телефон</TableHead>
                    <TableHead>Град</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Акции</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers?.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">Нема клиенти</TableCell></TableRow>
                  ) : (
                    customers?.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell>{c.company || "-"}</TableCell>
                        <TableCell>{c.contactPerson || "-"}</TableCell>
                        <TableCell>{c.phone || "-"}</TableCell>
                        <TableCell>{c.city || "-"}</TableCell>
                        <TableCell>
                          <Badge className={c.isActive === "active" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}>
                            {c.isActive === "active" ? "Активен" : "Неактивен"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" className="text-red-500" onClick={() => { if (confirm("Дали сте сигурни?")) custDelete.mutate({ id: c.id }); }}>
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
                    <TableHead>Клиент</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Приоритет</TableHead>
                    <TableHead>Износ</TableHead>
                    <TableHead>Испорака</TableHead>
                    <TableHead>Акции</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders?.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">Нема нарачки</TableCell></TableRow>
                  ) : (
                    orders?.map((o) => {
                      const st = orderStatusConfig[o.status] || orderStatusConfig.pending;
                      const pr = priorityConfig[o.priority] || priorityConfig.normal;
                      return (
                        <TableRow key={o.id}>
                          <TableCell className="font-mono text-sm font-medium">{o.orderNumber}</TableCell>
                          <TableCell>{o.customerName} {o.customerCompany ? `(${o.customerCompany})` : ""}</TableCell>
                          <TableCell>
                            <Select value={o.status} onValueChange={(v) => orderUpdate.mutate({ id: o.id, status: v as any })}>
                              <SelectTrigger className="h-7 w-32">
                                <Badge className={st.className + " text-xs"}>{st.label}</Badge>
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(orderStatusConfig).map(([k, v]) => (
                                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell><Badge className={pr.className}>{pr.label}</Badge></TableCell>
                          <TableCell className="font-medium">{o.totalAmount} ден.</TableCell>
                          <TableCell className="text-gray-500">{o.deliveryDate ? String(o.deliveryDate).split("T")[0] : "-"}</TableCell>
                          <TableCell><Button size="sm" variant="outline" onClick={() => chainWO.mutate({ orderId: o.id })} disabled={chainWO.isPending}>→ Налог</Button></TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" onClick={() => { setSelectedOrder(o.id); setDetailOpen(true); }}>
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" className="text-red-500" onClick={() => { if (confirm("Дали сте сигурни?")) orderDelete.mutate({ id: o.id }); }}>
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

      {/* Order Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Нарачка {orderDetail?.orderNumber}</DialogTitle>
          </DialogHeader>
          {orderDetail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">Клиент:</span> {orderDetail.customer?.name}</div>
                <div><span className="text-gray-500">Компанија:</span> {orderDetail.customer?.company || "-"}</div>
                <div><span className="text-gray-500">Статус:</span> <Badge className={orderStatusConfig[orderDetail.status]?.className}>{orderStatusConfig[orderDetail.status]?.label}</Badge></div>
                <div><span className="text-gray-500">Приоритет:</span> <Badge className={priorityConfig[orderDetail.priority]?.className}>{priorityConfig[orderDetail.priority]?.label}</Badge></div>
                <div><span className="text-gray-500">Вкупно:</span> <span className="font-semibold">{orderDetail.totalAmount} ден.</span></div>
                <div><span className="text-gray-500">Испорака:</span> {orderDetail.deliveryDate ? String(orderDetail.deliveryDate).split("T")[0] : "-"}</div>
              </div>

              {orderDetail.items && orderDetail.items.length > 0 && (
                <div className="border-t pt-3">
                  <h4 className="font-semibold mb-2">Ставки</h4>
                  <div className="space-y-2">
                    {orderDetail.items.map((item) => (
                      <div key={item.id} className="bg-gray-50 p-2 rounded text-sm">
                        <div className="font-medium">{item.description}</div>
                        <div className="text-gray-500 flex gap-3 mt-1">
                          <span>Кол: {item.quantity}</span>
                          <span>Цена: {item.unitPrice} ден.</span>
                          <span>Вкупно: {item.totalPrice} ден.</span>
                          {item.material && <span>Мат: {item.material}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {orderDetail.notes && (
                <div className="border-t pt-3">
                  <span className="text-gray-500 text-sm">Белешки: {orderDetail.notes}</span>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
