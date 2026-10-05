import { useEffect, useMemo, useState } from "react";
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
import { Plus, RotateCcw, Trash2 } from "lucide-react";

type Line = {
  key: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  productId?: number;
  orderItemId?: number;
  returnable?: number;
  vatRate?: string;
  restock: boolean;
};

const emptyLine = (): Line => ({
  key: Math.random().toString(36).slice(2),
  description: "",
  quantity: "1",
  unit: "ком",
  unitPrice: "0",
  restock: true,
});

/** Поврат → книжно одобрување + враќање на FG залиха (повеќе ставки). */
export default function SalesReturnsTab() {
  const utils = trpc.useUtils();
  const { data: rows } = trpc.accounting.salesReturnList.useQuery();
  const { data: customers } = trpc.customers.customerList.useQuery({});
  const { data: invoices } = trpc.accounting.invoiceList.useQuery({});
  const { data: orders } = trpc.customers.orderList.useQuery();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    customerId: "", invoiceId: "", orderId: "",
    issueDate: new Date().toISOString().slice(0, 10),
    reason: "defect", notes: "", createCreditNote: true,
  });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);

  const orderIdNum = form.orderId ? parseInt(form.orderId) : undefined;
  const invoiceIdNum = form.invoiceId ? parseInt(form.invoiceId) : undefined;
  const { data: returnable } = trpc.accounting.salesReturnableLines.useQuery(
    { orderId: orderIdNum, invoiceId: invoiceIdNum },
    { enabled: open && (!!orderIdNum || !!invoiceIdNum) },
  );

  useEffect(() => {
    if (!open || !returnable?.lines?.length) return;
    setLines(returnable.lines.map((l: any) => ({
      key: `r-${l.orderItemId ?? l.documentItemId ?? l.productId ?? Math.random()}`,
      description: l.description,
      quantity: String(l.returnable),
      unit: l.unit || "ком",
      unitPrice: String(l.unitPrice ?? "0"),
      productId: l.productId ?? undefined,
      orderItemId: l.orderItemId ?? undefined,
      returnable: l.returnable,
      vatRate: l.vatRate ?? "18",
      restock: !!l.productId,
    })));
  }, [returnable, open]);

  const create = trpc.accounting.salesReturnCreate.useMutation({
    onSuccess: (r) => {
      utils.accounting.salesReturnList.invalidate();
      utils.accounting.invoiceList.invalidate();
      utils.accounting.finishedGoodsList.invalidate();
      utils.accounting.salesReturnableLines.invalidate();
      setOpen(false);
      setLines([emptyLine()]);
      toast.success(`Поврат ${r.number}${r.creditNoteId ? " + книжно" : ""}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const totals = useMemo(() => {
    const sub = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0), 0);
    return { sub, count: lines.length };
  }, [lines]);

  const updateLine = (key: string, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l) => {
      if (l.key !== key) return l;
      const next = { ...l, ...patch };
      if (patch.quantity != null && l.returnable != null) {
        const q = parseFloat(patch.quantity) || 0;
        if (q - l.returnable > 0.0005) {
          toast.error(`Макс. за враќање: ${l.returnable}`);
          next.quantity = String(l.returnable);
        }
      }
      return next;
    }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const items = lines
      .filter((l) => l.description.trim() && (parseFloat(l.quantity) || 0) > 0)
      .map((l) => {
        const qty = parseFloat(l.quantity) || 0;
        const price = parseFloat(l.unitPrice) || 0;
        if (l.returnable != null && qty - l.returnable > 0.0005) {
          throw new Error(`„${l.description}“: макс. ${l.returnable}`);
        }
        return {
          description: l.description,
          quantity: String(qty),
          unit: l.unit || "ком",
          unitPrice: price.toFixed(2),
          totalPrice: (qty * price).toFixed(2),
          productId: l.productId,
          orderItemId: l.orderItemId,
          restock: l.restock,
          vatRate: l.vatRate ?? "18",
        };
      });
    if (!items.length) {
      toast.error("Додај барем една ставка");
      return;
    }
    create.mutate({
      customerId: parseInt(form.customerId),
      orderId: form.orderId ? parseInt(form.orderId) : undefined,
      invoiceId: form.invoiceId ? parseInt(form.invoiceId) : undefined,
      issueDate: form.issueDate,
      reason: form.reason,
      notes: form.notes || undefined,
      createCreditNote: form.createCreditNote && !!form.invoiceId,
      items,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          Поврат на стока: повеќе ставки, валидација според испорачано − веќе вратено, книжно + FG restock.
        </p>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setLines([emptyLine()]); }}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />Нов поврат</Button></DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Поврат / рекламација</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { try { submit(e); } catch (err: any) { e.preventDefault(); toast.error(err.message); } }} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Клиент *</Label>
                  <Select value={form.customerId} onValueChange={(v) => setForm({ ...form, customerId: v })}>
                    <SelectTrigger><SelectValue placeholder="Избери" /></SelectTrigger>
                    <SelectContent>{(customers ?? []).map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Датум *</Label>
                  <DateInput value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Нарачка (остаток за враќање)</Label>
                  <Select value={form.orderId || "__none"} onValueChange={(v) => setForm({ ...form, orderId: v === "__none" ? "" : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">— без —</SelectItem>
                      {(orders ?? []).filter((o: any) => !form.customerId || String(o.customerId) === form.customerId).slice(0, 100).map((o: any) => (
                        <SelectItem key={o.id} value={String(o.id)}>{o.orderNumber}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Фактура (за книжно)</Label>
                  <Select value={form.invoiceId || "__none"} onValueChange={(v) => setForm({ ...form, invoiceId: v === "__none" ? "" : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">— без —</SelectItem>
                      {(invoices ?? []).filter((i: any) => i.invoiceType === "standard" && i.status !== "cancelled"
                        && (!form.customerId || String(i.customerId) === form.customerId)).slice(0, 80).map((i: any) => (
                        <SelectItem key={i.id} value={String(i.id)}>{i.invoiceNumber}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Причина</Label>
                <Select value={form.reason} onValueChange={(v) => setForm({ ...form, reason: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="defect">Дефект</SelectItem>
                    <SelectItem value="wrong">Погрешна испорака</SelectItem>
                    <SelectItem value="other">Друго</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Ставки ({totals.count})</p>
                  <Button type="button" size="sm" variant="outline" onClick={() => setLines((p) => [...p, emptyLine()])}>
                    <Plus className="h-3.5 w-3.5 mr-1" />Додај
                  </Button>
                </div>
                {lines.map((l) => (
                  <div key={l.key} className="grid grid-cols-[1fr_5rem_5.5rem_2rem] gap-2 items-start bg-card border rounded p-2">
                    <div className="space-y-1 min-w-0">
                      <Input className="h-8 text-xs" placeholder="Опис" value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} />
                      {l.returnable != null && (
                        <p className="text-[10px] text-muted-foreground">макс. {l.returnable}{l.productId ? ` · продукт #${l.productId}` : ""}</p>
                      )}
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <input type="checkbox" checked={l.restock} disabled={!l.productId} onChange={(e) => updateLine(l.key, { restock: e.target.checked })} />
                        Врати на FG залиха
                      </label>
                    </div>
                    <Input className="h-8 text-xs" type="number" step="0.001" title="Кол." value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} />
                    <Input className="h-8 text-xs" type="number" step="0.01" title="Цена" value={l.unitPrice} onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })} />
                    <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-500" disabled={lines.length <= 1}
                      onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                ))}
                <p className="text-xs text-right font-medium">Збир (без ДДВ): {totals.sub.toLocaleString("mk-MK", { maximumFractionDigits: 2 })}</p>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.createCreditNote} onChange={(e) => setForm({ ...form, createCreditNote: e.target.checked })} />
                Креирај книжно одобрување (потребна фактура)
              </label>
              <div className="space-y-2">
                <Label>Белешки</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <Button type="submit" className="w-full" disabled={create.isPending || !form.customerId}>
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
