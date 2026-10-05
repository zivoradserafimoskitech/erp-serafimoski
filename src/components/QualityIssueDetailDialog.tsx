import { useState } from "react";
import EightDPanel from "@/components/mfg/EightDPanel";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import SearchPick from "@/components/SearchPick";
import SendEmailDialog from "@/components/SendEmailDialog";
import { printQualityIssue, qualityIssueHtml } from "@/lib/print-documents";
import { toast } from "sonner";
import { Factory, UserX, Truck, Package, Hammer, Mail, Printer, CheckCircle2, Trash2, Pencil, ExternalLink, Wallet } from "lucide-react";

const KIND: Record<string, { label: string; cls: string }> = {
  internal: { label: "Грешка во производство", cls: "bg-gray-100 text-gray-700" },
  complaint: { label: "Рекламација од клиент", cls: "bg-red-100 text-red-700" },
  supplier: { label: "Проблем со добавувач", cls: "bg-purple-100 text-purple-700" },
};
const STATUS: Record<string, string> = { open: "Отворена", in_progress: "Во решавање", closed: "Затворена" };
const fmtDate = (d?: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "—");
const money = (n: number) => n.toLocaleString("mk-MK", { maximumFractionDigits: 2 });

/** Преглед на неусогласеност: врски до налог/клиент/добавувач/материјал и корекции (доработка, рекламација, мерка). */
export default function QualityIssueDetailDialog({ issue, onClose }: { issue: any | null; onClose: () => void }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [editLinks, setEditLinks] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const { data: settings } = trpc.settings.settingsGet.useQuery(undefined, { enabled: !!issue });
  const { data: opt } = trpc.ops.qualityLinkOptions.useQuery(undefined, { enabled: !!issue && editLinks });
  const inv = () => { utils.ops.qualityList.invalidate(); utils.ops.qualityStats.invalidate(); };
  const update = trpc.ops.qualityUpdate.useMutation({ onSuccess: () => { toast.success("Зачувано"); inv(); }, onError: (e) => toast.error(e.message) });
  const del = trpc.ops.qualityDelete.useMutation({ onSuccess: () => { inv(); onClose(); } });
  const rework = trpc.ops.qualityRework.useMutation({
    onSuccess: (r) => { toast.success(`Отворен налог за доработка ${r.woNumber}`, { action: { label: "Отвори", onClick: () => navigate(`/proizvodstvo?open=${r.woId}`) } }); inv(); utils.production.workOrderList.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  if (!issue) return null;
  const q = issue;
  const go = (href: string) => { onClose(); navigate(href); };
  const links = [
    q.woNumber && { icon: Factory, label: `Налог ${q.woNumber}`, href: `/proizvodstvo?open=${q.workOrderId}` },
    q.customer && { icon: UserX, label: q.customer, href: `/klienti?q=${encodeURIComponent(q.customer)}` },
    q.supplier && { icon: Truck, label: q.supplier, href: `/nabavka?q=${encodeURIComponent(q.supplier)}` },
    q.material && { icon: Package, label: q.material, href: `/sklad?q=${encodeURIComponent(q.material)}` },
  ].filter(Boolean) as { icon: any; label: string; href: string }[];
  const mailTo = q.kind === "supplier" ? q.supplierEmail : q.customerEmail;
  const canMail = q.kind === "supplier" ? !!q.supplierId : !!q.customerId;

  return (
    <>
      <Dialog open={!!issue} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogTitle className="flex flex-wrap items-center gap-2"><span className="font-mono text-primary">{q.number}</span> {q.title}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <Badge className={KIND[q.kind]?.cls}>{KIND[q.kind]?.label}</Badge><span>{fmtDate(q.date)}</span>{q.responsible && <span>· одговорен {q.responsible}</span>}
          </DialogDescription>
          {q.description && <p className="text-sm text-gray-700 whitespace-pre-wrap">{q.description}</p>}

          {/* Врски */}
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-gray-400">Поврзано со</span>
              <button className="text-xs text-primary hover:underline flex items-center gap-1" onClick={() => setEditLinks(!editLinks)}><Pencil className="h-3 w-3" />{editLinks ? "Готово" : "Смени"}</button>
            </div>
            {!editLinks ? (
              <div className="flex flex-wrap gap-2">
                {links.length ? links.map(l => { const I = l.icon; return (
                  <button key={l.href} onClick={() => go(l.href)} className="inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-1 text-sm hover:border-primary/50 hover:bg-accent">
                    <I className="h-3.5 w-3.5 text-gray-500" />{l.label}<ExternalLink className="h-3 w-3 text-gray-400" /></button>); })
                  : <span className="text-sm text-gray-400">Не е поврзано — кликни „Смени“</span>}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1"><Label className="text-xs">Работен налог</Label>
                  <SearchPick items={(opt?.wos ?? []).map(w => ({ id: w.id, label: w.number, sub: w.customer }))} value={q.workOrderId ?? null} onChange={(id) => update.mutate({ id: q.id, workOrderId: id })} /></div>
                <div className="space-y-1"><Label className="text-xs">Клиент</Label>
                  <SearchPick items={(opt?.customers ?? []).map(c => ({ id: c.id, label: c.name }))} value={q.customerId ?? null} onChange={(id) => update.mutate({ id: q.id, customerId: id })} /></div>
                <div className="space-y-1"><Label className="text-xs">Добавувач</Label>
                  <SearchPick items={(opt?.suppliers ?? []).map(s => ({ id: s.id, label: s.name }))} value={q.supplierId ?? null} onChange={(id) => update.mutate({ id: q.id, supplierId: id })} /></div>
                <div className="space-y-1"><Label className="text-xs">Материјал</Label>
                  <SearchPick items={(opt?.materials ?? []).map(m => ({ id: m.id, label: m.name, sub: m.code }))} value={q.materialId ?? null} onChange={(id) => update.mutate({ id: q.id, materialId: id })} /></div>
              </div>
            )}
          </div>

          {/* Корекција */}
          <div className="rounded-lg border border-primary/20 bg-primary/10 p-3 space-y-3">
            <span className="text-xs uppercase tracking-wider text-foreground/80">Корекција</span>
            <div className="flex flex-wrap gap-2">
              {q.reworkWoId ? (
                <button onClick={() => go(`/proizvodstvo?open=${q.reworkWoId}`)} className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-800 hover:bg-emerald-100">
                  <Hammer className="h-4 w-4" />Доработка {q.reworkWoNumber} · {q.reworkStatus === "completed" ? "завршена" : "во тек"}{q.reworkCost > 0 ? ` · ${money(q.reworkCost)} ден` : ""}<ExternalLink className="h-3 w-3" />
                </button>
              ) : (
                <Button size="sm" disabled={rework.isPending} onClick={() => rework.mutate({ id: q.id })}><Hammer className="h-4 w-4 mr-1.5" />Налог за доработка</Button>
              )}
              {q.reworkWoId && q.reworkCost > 0 && Math.abs(q.reworkCost - q.cost) > 0.01 && (
                <Button size="sm" variant="outline" onClick={() => update.mutate({ id: q.id, cost: q.reworkCost })}><Wallet className="h-4 w-4 mr-1.5" />Трошок од доработката ({money(q.reworkCost)} ден)</Button>
              )}
              {canMail && (
                <Button size="sm" variant="outline" onClick={() => setMailOpen(true)}><Mail className="h-4 w-4 mr-1.5" />{q.kind === "supplier" ? "Прати рекламација до добавувачот" : "Одговор до клиентот"}</Button>
              )}
              <Button size="sm" variant="outline" onClick={() => printQualityIssue(q, settings)}><Printer className="h-4 w-4 mr-1.5" />Печати</Button>
            </div>
            <div className="space-y-1"><Label className="text-xs">Причина — зошто се случи</Label>
              <Textarea rows={2} defaultValue={q.rootCause ?? ""} onBlur={(e) => e.target.value !== (q.rootCause ?? "") && update.mutate({ id: q.id, rootCause: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Мерка — што направивме да не се повтори</Label>
              <Textarea rows={2} defaultValue={q.action ?? ""} onBlur={(e) => e.target.value !== (q.action ?? "") && update.mutate({ id: q.id, action: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Трошок (ден)</Label>
                <Input type="number" key={q.cost} defaultValue={q.cost} onBlur={(e) => parseFloat(e.target.value) !== q.cost && update.mutate({ id: q.id, cost: parseFloat(e.target.value) || 0 })} /></div>
              <div className="space-y-1"><Label className="text-xs">Статус</Label>
                <Select value={q.status} onValueChange={(v) => update.mutate({ id: q.id, status: v as any })}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
            </div>
          </div>

          {q.kind !== "internal" && <EightDPanel key={q.id} issueId={q.id} />}

          <div className="flex justify-between pt-1">
            <Button variant="ghost" size="sm" className="text-red-500" onClick={() => { if (confirm("Да се избрише записот?")) del.mutate({ id: q.id }); }}><Trash2 className="h-3.5 w-3.5 mr-1" />Избриши</Button>
            {q.status !== "closed" && <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={!q.action}
              title={!q.action ? "Внеси ја мерката пред да затвориш" : undefined}
              onClick={() => { update.mutate({ id: q.id, status: "closed" }); onClose(); }}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Затвори</Button>}
          </div>
        </DialogContent>
      </Dialog>
      <SendEmailDialog open={mailOpen} onOpenChange={setMailOpen} docType="quality" docId={q.id} docNumber={q.number}
        defaultTo={mailTo} companyName={settings?.name} buildHtml={() => qualityIssueHtml(q, settings)} />
    </>
  );
}
