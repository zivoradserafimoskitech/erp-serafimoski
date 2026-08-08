import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, Pencil, FileCheck2, FileWarning, ExternalLink, ShieldCheck } from "lucide-react";

const UNIT_MK: Record<string, string> = { kg: "кг", m: "м", m2: "м²", pcs: "ком", l: "л", sheet: "табла" };

export default function CertificatesTab() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "with_cert" | "missing_cert">("all");
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<any>(null);

  const { data: stats } = trpc.certificates.lotCertStats.useQuery();
  const { data: lots, isLoading } = trpc.certificates.lotCertList.useQuery({
    search: search || undefined,
    filter,
  });
  const { data: suppliers } = trpc.procurement.supplierList.useQuery({});

  const updateMut = trpc.certificates.lotCertUpdate.useMutation({
    onSuccess: () => {
      utils.certificates.lotCertList.invalidate();
      utils.certificates.lotCertStats.invalidate();
      setEditOpen(false);
      setEditForm(null);
    },
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-blue-50 p-2.5 rounded-lg"><ShieldCheck className="h-5 w-5 text-blue-600" /></div>
          <div><p className="text-sm text-gray-500">Партии вкупно</p><p className="text-xl font-bold">{stats?.total ?? 0}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-emerald-50 p-2.5 rounded-lg"><FileCheck2 className="h-5 w-5 text-emerald-600" /></div>
          <div><p className="text-sm text-gray-500">Со шаржа / атест</p><p className="text-xl font-bold text-emerald-700">{stats?.withCert ?? 0}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-amber-50 p-2.5 rounded-lg"><FileWarning className="h-5 w-5 text-amber-600" /></div>
          <div><p className="text-sm text-gray-500">Без податок</p><p className="text-xl font-bold text-amber-700">{stats?.missing ?? 0}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-red-50 p-2.5 rounded-lg"><FileWarning className="h-5 w-5 text-red-600" /></div>
          <div><p className="text-sm text-gray-500">Без податок, на залиха</p><p className="text-xl font-bold text-red-600">{stats?.inStockMissing ?? 0}</p></div>
        </CardContent></Card>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input placeholder="Шаржа, атест, стандард, материјал, приемница..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Сите партии</SelectItem>
            <SelectItem value="with_cert">Само со шаржа/атест</SelectItem>
            <SelectItem value="missing_cert">Само без податок</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Материјал</TableHead>
                <TableHead className="w-28">Шаржа</TableHead>
                <TableHead className="w-36">Атест</TableHead>
                <TableHead className="w-36">Квалитет</TableHead>
                <TableHead className="text-right w-28">Примено</TableHead>
                <TableHead className="w-36">Добавувач</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">Вчитување...</TableCell></TableRow>
              ) : !lots || lots.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-12 text-gray-400">
                  Нема партии. Партиите се создаваат кога ќе потврдиш приемница.
                </TableCell></TableRow>
              ) : lots.map((l: any) => (
                <TableRow key={l.id} className={!l.hasCert ? "bg-amber-50/40" : ""}>
                  <TableCell>
                    <div className="text-sm font-medium leading-tight">{l.materialName ?? "—"}</div>
                    <div className="text-[11px] text-gray-400 font-mono">
                      {l.materialCode}{l.receiptNumber ? ` · ${l.receiptNumber}` : ""}
                    </div>
                  </TableCell>
                  <TableCell>
                    {l.heatNumber ? (
                      <span className="font-mono text-xs font-semibold text-blue-800">{l.heatNumber}</span>
                    ) : <span className="text-gray-300">—</span>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {l.certNumber ? (
                      <span className="flex items-center gap-1">
                        {l.certNumber}
                        {l.certUrl && (
                          <a href={l.certUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {l.certStandard ? (
                      <Badge variant="outline" className="text-[10px] border-blue-200 text-blue-700">{l.certStandard}</Badge>
                    ) : <span className="text-gray-300">—</span>}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {Number(l.quantity).toLocaleString("mk-MK")}
                    <span className="text-[11px] text-gray-400 ml-1">{UNIT_MK[l.materialUnit] ?? l.materialUnit}</span>
                    <div className="text-[11px] text-gray-400">
                      остаток {Number(l.remainingQty).toLocaleString("mk-MK")}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-gray-600">{l.supplierName ?? "—"}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" title="Внеси / измени"
                      onClick={() => { setEditForm({ ...l }); setEditOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Шаржа и атест</DialogTitle></DialogHeader>
          {editForm && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg px-4 py-2.5 text-sm">
                <div className="font-medium">{editForm.materialName}</div>
                <div className="text-gray-500 text-xs">
                  {Number(editForm.quantity).toLocaleString("mk-MK")} {UNIT_MK[editForm.materialUnit] ?? editForm.materialUnit}
                  {editForm.receiptNumber ? ` · ${editForm.receiptNumber}` : ""}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Шаржа (heat number)</Label>
                <Input value={editForm.heatNumber ?? ""} placeholder="512884" autoFocus
                  onChange={(e) => setEditForm({ ...editForm, heatNumber: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Број на атест</Label>
                  <Input value={editForm.certNumber ?? ""} placeholder="3.1/2026-441"
                    onChange={(e) => setEditForm({ ...editForm, certNumber: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Квалитет</Label>
                  <Input value={editForm.certStandard ?? ""} placeholder="S235JR EN 10025"
                    onChange={(e) => setEditForm({ ...editForm, certStandard: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Линк до PDF на атестот</Label>
                <Input value={editForm.certUrl ?? ""} placeholder="https://…"
                  onChange={(e) => setEditForm({ ...editForm, certUrl: e.target.value })} />
                <p className="text-[11px] text-gray-400">
                  Систем не чува файлови — стави линк од Drive, Dropbox или мејл архива.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Добавувач</Label>
                <Select value={editForm.supplierId ? String(editForm.supplierId) : "none"}
                  onValueChange={(v) => setEditForm({ ...editForm, supplierId: v === "none" ? null : Number(v) })}>
                  <SelectTrigger><SelectValue placeholder="Од приемницата" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Од приемницата</SelectItem>
                    {suppliers?.map((sp: any) => (
                      <SelectItem key={sp.id} value={String(sp.id)}>{sp.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditOpen(false)}>Откажи</Button>
                <Button className="bg-amber-500 hover:bg-amber-600 text-white" disabled={updateMut.isPending}
                  onClick={() => updateMut.mutate({
                    id: editForm.id,
                    heatNumber: editForm.heatNumber ?? "",
                    certNumber: editForm.certNumber ?? "",
                    certStandard: editForm.certStandard ?? "",
                    certUrl: editForm.certUrl ?? "",
                    supplierId: editForm.supplierId ?? null,
                  })}>
                  {updateMut.isPending ? "Зачувување..." : "Зачувај"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
