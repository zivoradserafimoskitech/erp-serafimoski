import { useState } from "react";
import { formatDate } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ClipboardCheck, Plus, CheckCircle2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

const statusCfg: Record<string, { label: string; cls: string }> = {
  pending: { label: "Во тек", cls: "bg-amber-100 text-amber-700" },
  completed: { label: "Завршен", cls: "bg-emerald-100 text-emerald-700" },
};

export default function InventoryCountTab() {
  const utils = trpc.useUtils();
  const [selected, setSelected] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ countNumber: "", warehouseId: "", countDate: new Date().toISOString().slice(0, 10), notes: "" });
  const [qtyDraft, setQtyDraft] = useState<Record<number, string>>({});

  const { data: counts, isLoading } = trpc.warehouse.countList.useQuery();
  const { data: warehouses } = trpc.warehouse.warehouseList.useQuery();
  const { data: detail } = trpc.warehouse.countById.useQuery({ id: selected! }, { enabled: !!selected });
  const { data: nextNum } = trpc.settings.nextDocNumber.useQuery({ kind: "count" }, { enabled: createOpen });

  const create = trpc.warehouse.countCreate.useMutation({
    onSuccess: (d) => {
      utils.warehouse.countList.invalidate();
      toast.success("Пописот е креиран, пополнет со тековна залиха");
      setCreateOpen(false);
      setForm({ countNumber: "", warehouseId: "", countDate: new Date().toISOString().slice(0, 10), notes: "" });
      setSelected(d.id);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateItem = trpc.warehouse.countUpdateItem.useMutation({
    onSuccess: () => utils.warehouse.countById.invalidate({ id: selected! }),
  });

  const complete = trpc.warehouse.countComplete.useMutation({
    onSuccess: () => {
      utils.warehouse.countList.invalidate();
      utils.warehouse.countById.invalidate({ id: selected! });
      utils.storage.materialList.invalidate();
      toast.success("Пописот е завршен -- залихата е усогласена");
    },
    onError: (e) => toast.error(e.message),
  });

  const whName = (id: number) => warehouses?.find((w: any) => w.id === id)?.name ?? "-";

  const saveQty = (itemId: number, systemQty: string) => {
    const val = qtyDraft[itemId];
    if (val === undefined) return;
    updateItem.mutate({ id: itemId, countedQty: val || systemQty });
  };

  // ---------- Детален приказ ----------
  if (selected) {
    const items = detail?.items ?? [];
    const totalDiff = items.reduce((s: number, i: any) => s + (parseFloat(i.totalDifference ?? "0") || 0), 0);
    const isDone = detail?.status === "completed";
    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft className="h-4 w-4" /> Назад на сите пописи
        </button>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">{detail?.countNumber}</h3>
              {detail && <Badge className={statusCfg[detail.status]?.cls}>{statusCfg[detail.status]?.label}</Badge>}
            </div>
            <p className="text-sm text-gray-500">
              {detail && whName(detail.warehouseId)} · {detail && formatDate(detail.countDate)}
              {detail?.notes ? ` · ${detail.notes}` : ""}
            </p>
          </div>
          {!isDone && (
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={complete.isPending}
              onClick={() => { if (confirm("Пописот ќе ја усогласи залихата според внесените количини. Продолжи?")) complete.mutate({ id: selected }); }}>
              <CheckCircle2 className="h-4 w-4 mr-2" />{complete.isPending ? "Се книжи..." : "Заврши попис"}
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Материјал</TableHead>
                  <TableHead className="text-right">Системски</TableHead>
                  <TableHead className="text-right w-36">Пребројано</TableHead>
                  <TableHead className="text-right">Разлика</TableHead>
                  <TableHead className="text-right">Вредност разлика</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-400">Нема материјали во овој магацин</TableCell></TableRow>
                ) : items.map((it: any) => {
                  const diff = parseFloat(it.difference ?? "0");
                  return (
                    <TableRow key={it.id}>
                      <TableCell>
                        <div className="text-sm font-medium">{it.materialName}</div>
                        <div className="text-[11px] text-gray-400 font-mono">{it.materialCode}</div>
                      </TableCell>
                      <TableCell className="text-right text-sm text-gray-500">{Number(it.systemQty).toLocaleString("mk-MK")}</TableCell>
                      <TableCell className="text-right">
                        {isDone ? (
                          <span className="text-sm">{Number(it.countedQty).toLocaleString("mk-MK")}</span>
                        ) : (
                          <Input className="h-8 text-right" type="number" step="0.001"
                            value={qtyDraft[it.id] ?? it.countedQty ?? it.systemQty}
                            onChange={(e) => setQtyDraft({ ...qtyDraft, [it.id]: e.target.value })}
                            onBlur={() => saveQty(it.id, it.systemQty)} />
                        )}
                      </TableCell>
                      <TableCell className={`text-right text-sm font-medium ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-red-600" : "text-gray-400"}`}>
                        {diff > 0 ? "+" : ""}{diff.toLocaleString("mk-MK")}
                      </TableCell>
                      <TableCell className={`text-right text-sm ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-red-600" : "text-gray-400"}`}>
                        {Number(it.totalDifference ?? 0).toLocaleString("mk-MK")} ден.
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {items.length > 0 && (
          <div className="text-right text-sm text-gray-600">
            Вкупна вредност на разликата: <b className={totalDiff > 0 ? "text-emerald-600" : totalDiff < 0 ? "text-red-600" : ""}>{totalDiff.toLocaleString("mk-MK")} ден.</b>
          </div>
        )}
      </div>
    );
  }

  // ---------- Листа на пописи ----------
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Периодично пребројување на магацин -- системот ја покажува разликата и, по потврда, ја усогласува залихата.</p>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild><Button className="bg-amber-500 hover:bg-amber-600 text-white"><Plus className="h-4 w-4 mr-2" />Нов попис</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Нов попис</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Број *</Label>
                <Input value={form.countNumber || nextNum || ""} onChange={(e) => setForm({ ...form, countNumber: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Магацин *</Label>
                <Select value={form.warehouseId} onValueChange={(v) => setForm({ ...form, warehouseId: v })}>
                  <SelectTrigger><SelectValue placeholder="Избери магацин" /></SelectTrigger>
                  <SelectContent>{warehouses?.map((w: any) => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Датум</Label>
                <Input type="date" value={form.countDate} onChange={(e) => setForm({ ...form, countDate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Белешки</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <p className="text-xs text-gray-500">Пописот автоматски се пополнува со сите материјали и тековната системска количина од избраниот магацин -- потоа само ги внесуваш реално пребројаните количини.</p>
              <Button className="w-full bg-amber-500 hover:bg-amber-600 text-white" disabled={!form.warehouseId || create.isPending}
                onClick={() => create.mutate({ countNumber: form.countNumber || nextNum || `ПП-${Date.now()}`, warehouseId: parseInt(form.warehouseId), countDate: form.countDate, notes: form.notes || undefined })}>
                {create.isPending ? "Се креира..." : "Креирај попис"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Број</TableHead>
                <TableHead>Магацин</TableHead>
                <TableHead>Датум</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-400">Вчитувам...</TableCell></TableRow>
              ) : !counts || counts.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-12 text-gray-400">
                  <ClipboardCheck className="h-8 w-8 mx-auto mb-2 text-gray-300" />Нема пописи. Кликни „Нов попис" да започнеш.
                </TableCell></TableRow>
              ) : counts.map((c: any) => (
                <TableRow key={c.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setSelected(c.id)}>
                  <TableCell className="font-mono text-sm">{c.countNumber}</TableCell>
                  <TableCell className="text-sm">{whName(c.warehouseId)}</TableCell>
                  <TableCell className="text-sm">{formatDate(c.countDate)}</TableCell>
                  <TableCell><Badge className={statusCfg[c.status]?.cls}>{statusCfg[c.status]?.label}</Badge></TableCell>
                  <TableCell className="text-right text-sm text-gray-400">Отвори →</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
