import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateInput } from "@/components/ui/date-input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, RotateCcw } from "lucide-react";

/** Поврат → книжно одобрување + враќање на FG залиха. */
export default function SalesReturnsTab() {
  const utils = trpc.useUtils();
  const { data: rows } = trpc.accounting.salesReturnList.useQuery();
  const { data: customers } = trpc.customers.customerList.useQuery({});
  const { data: invoices } = trpc.accounting.invoiceList.useQuery({});
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    customerId: "", invoiceId: "", issueDate: new Date().toISOString().slice(0, 10),
    reason: "defect", notes: "", createCreditNote: true,
    description: "", quantity: "1", unitPrice: "0", productId: "",
  });

  const create = trpc.accounting.salesReturnCreate.useMutation({
    onSuccess: (r) => {
      utils.accounting.salesReturnList.invalidate();
      utils.accounting.invoiceList.invalidate();
      utils.accounting.finishedGoodsList.invalidate();
      setOpen(false);
      toast.success(`Поврат ${r.number}${r.creditNoteId ? " + книжно" : ""}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(form.quantity) || 0;
    const price = parseFloat(form.unitPrice) || 0;
    create.mutate({
      customerId: parseInt(form.customerId),
      invoiceId: form.invoiceId ? parseInt(form.invoiceId) : undefined,
      issueDate: form.issueDate,
      reason: form.reason,
      notes: form.notes || undefined,
      createCreditNote: form.createCreditNote && !!form.invoiceId,
      items: [{
        description: form.description,
        quantity: String(qty),
        unitPrice: price.toFixed(2),
        totalPrice: (qty * price).toFixed(2),
        productId: form.productId ? parseInt(form.productId) : undefined,
        restock: true,
      }],
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Поврат на стока: книжно одобрување и враќање на залиха на готови производи.</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />Нов поврат</Button></DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Поврат / рекламација</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-3">
              <div className="space-y-2">
                <Label>Клиент *</Label>
                <Select value={form.customerId} onValueChange={(v) => setForm({ ...form, customerId: v })}>
                  <SelectTrigger><SelectValue placeholder="Избери" /></SelectTrigger>
                  <SelectContent>{(customers ?? []).map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Фактура (за книжно)</Label>
                <Select value={form.invoiceId || "__none"} onValueChange={(v) => setForm({ ...form, invoiceId: v === "__none" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— без —</SelectItem>
                    {(invoices ?? []).filter((i: any) => i.invoiceType === "standard" && i.status !== "cancelled").slice(0, 80).map((i: any) => (
                      <SelectItem key={i.id} value={String(i.id)}>{i.invoiceNumber}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label>Датум *</Label><DateInput value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} required /></div>
                <div className="space-y-2"><Label>Причина</Label>
                  <Select value={form.reason} onValueChange={(v) => setForm({ ...form, reason: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="defect">Дефект</SelectItem>
                      <SelectItem value="wrong">Погрешна испорака</SelectItem>
                      <SelectItem value="other">Друго</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2"><Label>Опис *</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required /></div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-2"><Label>Кол.</Label><Input type="number" step="0.001" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
                <div className="space-y-2"><Label>Цена</Label><Input type="number" step="0.01" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} /></div>
                <div className="space-y-2"><Label>Производ ID</Label><Input value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} placeholder="за restock" /></div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.createCreditNote} onChange={(e) => setForm({ ...form, createCreditNote: e.target.checked })} />
                Креирај книжно одобрување (потребна фактура)
              </label>
              <Button type="submit" className="w-full" disabled={create.isPending || !form.customerId || !form.description}>
                {create.isPending ? "..." : "Зачувај поврат"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Број</TableHead><TableHead>Клиент</TableHead><TableHead>Статус</TableHead>
                <TableHead>Фактура</TableHead><TableHead>Книжно</TableHead><TableHead>Датум</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8"><RotateCcw className="h-5 w-5 mx-auto mb-2 opacity-40" />Нема поврати</TableCell></TableRow>
              ) : (rows ?? []).map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.number}</TableCell>
                  <TableCell>{r.customer}</TableCell>
                  <TableCell>{r.status}</TableCell>
                  <TableCell>{r.invoiceId ?? "—"}</TableCell>
                  <TableCell>{r.creditNoteId ?? "—"}</TableCell>
                  <TableCell>{r.issueDate ? String(r.issueDate).slice(0, 10) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
