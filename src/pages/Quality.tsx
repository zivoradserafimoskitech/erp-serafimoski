import { useState } from "react";
import { DateInput } from "@/components/ui/date-input";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ShieldAlert, Wrench, Plus, CheckCircle2, Trash2, History } from "lucide-react";

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d?: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "—");
const fmt = (n: number) => n.toLocaleString("mk-MK", { maximumFractionDigits: 2 });

const KIND: Record<string, { label: string; cls: string }> = {
  internal: { label: "Интерна", cls: "bg-gray-100 text-gray-700" },
  complaint: { label: "Рекламација од клиент", cls: "bg-red-100 text-red-700" },
  supplier: { label: "Кон добавувач", cls: "bg-purple-100 text-purple-700" },
};
const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: "Отворена", cls: "bg-amber-100 text-amber-800" },
  in_progress: { label: "Во решавање", cls: "bg-blue-100 text-blue-700" },
  closed: { label: "Затворена", cls: "bg-emerald-100 text-emerald-700" },
};
const LOGKIND: Record<string, string> = { planned: "Редовен сервис", breakdown: "Дефект", repair: "Поправка" };

function QualityTab() {
  const utils = trpc.useUtils();
  const [statusF, setStatusF] = useState("open_all");
  const { data: rows } = trpc.ops.qualityList.useQuery(statusF === "open_all" ? undefined : { status: statusF });
  const { data: stats } = trpc.ops.qualityStats.useQuery();
  const { data: wos } = trpc.production.workOrderList.useQuery({});
  const { data: customers } = trpc.customers.customerList.useQuery({});
  const { data: suppliers } = trpc.procurement.supplierList.useQuery();
  const [newOpen, setNewOpen] = useState(false);
  const [sel, setSel] = useState<any>(null);
  const empty = { date: today(), kind: "internal", title: "", description: "", workOrderId: "", customerId: "", supplierId: "", cost: "", responsible: "" };
  const [f, setF] = useState(empty);
  const inv = () => { utils.ops.qualityList.invalidate(); utils.ops.qualityStats.invalidate(); };
  const create = trpc.ops.qualityCreate.useMutation({ onSuccess: (r) => { toast.success(`Внесена ${r.number}`); setNewOpen(false); setF(empty); inv(); }, onError: (e) => toast.error(e.message) });
  const update = trpc.ops.qualityUpdate.useMutation({ onSuccess: () => { toast.success("Зачувано"); inv(); }, onError: (e) => toast.error(e.message) });
  const del = trpc.ops.qualityDelete.useMutation({ onSuccess: () => { setSel(null); inv(); } });
  const list = statusF === "open_all" ? rows?.filter(r => r.status !== "closed") : rows;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Отворени</p><p className="text-2xl font-bold text-amber-700">{stats?.open ?? 0}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Рекламации оваа година</p><p className="text-2xl font-bold text-red-600">{stats?.complaintsYear ?? 0}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Трошок на грешки (год.)</p><p className="text-2xl font-bold">{fmt(stats?.costYear ?? 0)} <span className="text-sm">ден</span></p></CardContent></Card>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={statusF} onValueChange={setStatusF}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open_all">Отворени и во решавање</SelectItem>
            {Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button className="bg-amber-500 hover:bg-amber-600" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4 mr-1.5" />Нова неусогласеност</Button>
      </div>

      <Card><CardContent className="p-0">
        {!list?.length ? (
          <div className="py-10 text-center"><ShieldAlert className="h-8 w-8 text-gray-300 mx-auto mb-2" /><p className="text-sm text-gray-500">Нема записи</p>
            <p className="text-xs text-gray-400 mt-1">Бележи тука грешки во производство, рекламации од клиенти и проблеми со материјал од добавувач.</p></div>
        ) : list.map(r => (
          <button key={r.id} className="w-full text-left border-b last:border-b-0 px-4 py-3 hover:bg-gray-50 flex flex-wrap items-center gap-3" onClick={() => setSel(r)}>
            <span className="font-mono text-xs font-semibold w-24">{r.number}</span>
            <span className="text-xs text-gray-400 w-20">{fmtDate(r.date)}</span>
            <Badge className={KIND[r.kind]?.cls}>{KIND[r.kind]?.label}</Badge>
            <span className="flex-1 min-w-[200px] text-sm font-medium text-gray-800">{r.title}
              <span className="text-xs text-gray-400 font-normal">{[r.woNumber, r.customer, r.supplier].filter(Boolean).map(x => ` · ${x}`).join("")}</span></span>
            {r.cost > 0 && <span className="text-sm tabular-nums text-red-600">{fmt(r.cost)} ден</span>}
            <Badge className={STATUS[r.status]?.cls}>{STATUS[r.status]?.label}</Badge>
          </button>
        ))}
      </CardContent></Card>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Нова неусогласеност</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Датум</Label><DateInput value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Вид</Label>
                <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(KIND).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">Наслов</Label><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="на пр. Погрешна мера на отвори, 12 парчиња" /></div>
            <div className="space-y-1"><Label className="text-xs">Опис</Label><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Работен налог</Label>
                <Select value={f.workOrderId || "none"} onValueChange={(v) => setF({ ...f, workOrderId: v === "none" ? "" : v })}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">—</SelectItem>{wos?.map((w: any) => <SelectItem key={w.id} value={String(w.id)}>{w.woNumber}</SelectItem>)}</SelectContent></Select></div>
              {f.kind === "supplier" ? (
                <div className="space-y-1"><Label className="text-xs">Добавувач</Label>
                  <Select value={f.supplierId || "none"} onValueChange={(v) => setF({ ...f, supplierId: v === "none" ? "" : v })}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="none">—</SelectItem>{suppliers?.map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent></Select></div>
              ) : (
                <div className="space-y-1"><Label className="text-xs">Клиент</Label>
                  <Select value={f.customerId || "none"} onValueChange={(v) => setF({ ...f, customerId: v === "none" ? "" : v })}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="none">—</SelectItem>{customers?.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.company || c.name}</SelectItem>)}</SelectContent></Select></div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Трошок (ден)</Label><Input type="number" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} placeholder="доработка, отпад..." /></div>
              <div className="space-y-1"><Label className="text-xs">Одговорен</Label><Input value={f.responsible} onChange={(e) => setF({ ...f, responsible: e.target.value })} /></div>
            </div>
            <Button className="w-full bg-amber-500 hover:bg-amber-600" disabled={f.title.length < 3 || create.isPending}
              onClick={() => create.mutate({ date: f.date, kind: f.kind as any, title: f.title, description: f.description || undefined,
                workOrderId: f.workOrderId ? Number(f.workOrderId) : undefined, customerId: f.customerId ? Number(f.customerId) : undefined,
                supplierId: f.supplierId ? Number(f.supplierId) : undefined, cost: parseFloat(f.cost) || 0, responsible: f.responsible || undefined })}>Внеси</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="sm:max-w-lg">
          {sel && (<>
            <DialogHeader><DialogTitle><span className="font-mono text-amber-600">{sel.number}</span> · {sel.title}</DialogTitle></DialogHeader>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge className={KIND[sel.kind]?.cls}>{KIND[sel.kind]?.label}</Badge>
              <span className="text-gray-500">{fmtDate(sel.date)}{[sel.woNumber, sel.customer, sel.supplier].filter(Boolean).map((x: string) => ` · ${x}`).join("")}</span>
            </div>
            {sel.description && <p className="text-sm text-gray-600 whitespace-pre-wrap">{sel.description}</p>}
            <div className="space-y-3">
              <div className="space-y-1"><Label className="text-xs">Причина (зошто се случи)</Label><Textarea rows={2} defaultValue={sel.rootCause ?? ""} onBlur={(e) => e.target.value !== (sel.rootCause ?? "") && update.mutate({ id: sel.id, rootCause: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Мерка (што направивме да не се повтори)</Label><Textarea rows={2} defaultValue={sel.action ?? ""} onBlur={(e) => e.target.value !== (sel.action ?? "") && update.mutate({ id: sel.id, action: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Трошок (ден)</Label><Input type="number" defaultValue={sel.cost} onBlur={(e) => parseFloat(e.target.value) !== sel.cost && update.mutate({ id: sel.id, cost: parseFloat(e.target.value) || 0 })} /></div>
                <div className="space-y-1"><Label className="text-xs">Статус</Label>
                  <Select value={sel.status} onValueChange={(v) => { update.mutate({ id: sel.id, status: v as any }); setSel({ ...sel, status: v }); }}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <div className="flex justify-between pt-1">
                <Button variant="ghost" size="sm" className="text-red-500" onClick={() => { if (confirm("Да се избрише записот?")) del.mutate({ id: sel.id }); }}><Trash2 className="h-3.5 w-3.5 mr-1" />Избриши</Button>
                {sel.status !== "closed" && <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { update.mutate({ id: sel.id, status: "closed" }); setSel(null); }}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Затвори</Button>}
              </div>
            </div>
          </>)}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MaintenanceTab() {
  const utils = trpc.useUtils();
  const { data: plans } = trpc.ops.maintenancePlans.useQuery();
  const { data: logs } = trpc.ops.maintenanceLogs.useQuery();
  const { data: machines } = trpc.ops.machinesForSchedule.useQuery();
  const [planOpen, setPlanOpen] = useState(false);
  const [logFor, setLogFor] = useState<null | { machineId: string; planId?: number; title?: string }>(null);
  const [p, setP] = useState({ machineId: "", title: "", intervalDays: "90", lastDone: "" });
  const [l, setL] = useState({ date: today(), kind: "planned", description: "", cost: "", downtime: "", by: "" });
  const inv = () => { utils.ops.maintenancePlans.invalidate(); utils.ops.maintenanceLogs.invalidate(); utils.ops.maintenanceDue.invalidate(); };
  const createPlan = trpc.ops.maintenancePlanCreate.useMutation({ onSuccess: () => { toast.success("Планот е внесен"); setPlanOpen(false); inv(); }, onError: (e) => toast.error(e.message) });
  const delPlan = trpc.ops.maintenancePlanDelete.useMutation({ onSuccess: inv });
  const createLog = trpc.ops.maintenanceLogCreate.useMutation({ onSuccess: () => { toast.success("Сервисот е забележан"); setLogFor(null); inv(); }, onError: (e) => toast.error(e.message) });
  const ST: Record<string, string> = { overdue: "border-red-300 bg-red-50", soon: "border-amber-300 bg-amber-50", ok: "" };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => { setL({ date: today(), kind: "breakdown", description: "", cost: "", downtime: "", by: "" }); setLogFor({ machineId: "" }); }}>Пријави дефект / поправка</Button>
        <Button className="bg-amber-500 hover:bg-amber-600" onClick={() => { setP({ machineId: "", title: "", intervalDays: "90", lastDone: "" }); setPlanOpen(true); }}><Plus className="h-4 w-4 mr-1.5" />План за сервис</Button>
      </div>
      {!machines?.length && <p className="text-sm text-amber-700">Нема машини — внеси ги во Каталог → Машини.</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {plans?.map(pl => (
          <Card key={pl.id} className={ST[pl.state]}><CardContent className="p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div><p className="font-semibold text-gray-800">{pl.title}</p><p className="text-xs text-gray-500">{pl.machine} · на секои {pl.intervalDays} дена</p></div>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-gray-400" onClick={() => { if (confirm("Да се отстрани планот?")) delPlan.mutate({ id: pl.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
            <div className="text-sm">
              <span className="text-gray-500">Последно: </span>{fmtDate(pl.lastDone)} · <span className="text-gray-500">Следно: </span>
              <b className={pl.state === "overdue" ? "text-red-600" : pl.state === "soon" ? "text-amber-700" : ""}>{fmtDate(pl.nextDue)}</b>
              <span className="text-xs text-gray-500"> ({pl.daysLeft < 0 ? `доцни ${-pl.daysLeft} дена` : pl.daysLeft === 0 ? "денес" : `за ${pl.daysLeft} дена`})</span>
            </div>
            <Button size="sm" variant="outline" className="w-full" onClick={() => { setL({ date: today(), kind: "planned", description: "", cost: "", downtime: "", by: "" }); setLogFor({ machineId: String(pl.machineId), planId: pl.id, title: pl.title }); }}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Сервисот е направен
            </Button>
          </CardContent></Card>
        ))}
        {!plans?.length && machines?.length ? <p className="text-sm text-gray-400 col-span-full py-6 text-center">Нема планови. Додади на пр. „Замена на масло“ на секои 90 дена или „Чистење на оптика“ на секои 7 дена.</p> : null}
      </div>

      <Card><CardContent className="p-4">
        <p className="font-semibold text-sm mb-2 flex items-center gap-1.5"><History className="h-4 w-4" />Историја на сервиси и дефекти</p>
        {!logs?.length ? <p className="text-sm text-gray-400">Нема записи.</p> : (
          <div className="divide-y">
            {logs.map(g => (
              <div key={g.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="text-xs text-gray-400 w-20">{fmtDate(g.date)}</span>
                <span className="font-medium w-40 truncate">{g.machine}</span>
                <Badge className={g.kind === "planned" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}>{LOGKIND[g.kind] ?? g.kind}</Badge>
                <span className="flex-1 text-gray-600">{g.plan ?? g.description}{g.plan && g.description ? ` · ${g.description}` : ""}</span>
                {g.downtimeHours > 0 && <span className="text-xs text-gray-500">застој {g.downtimeHours} ч</span>}
                {g.cost > 0 && <span className="text-xs tabular-nums">{fmt(g.cost)} ден</span>}
              </div>
            ))}
          </div>
        )}
      </CardContent></Card>

      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>План за редовен сервис</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={p.machineId} onValueChange={(v) => setP({ ...p, machineId: v })}><SelectTrigger><SelectValue placeholder="Машина" /></SelectTrigger>
              <SelectContent>{machines?.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}</SelectContent></Select>
            <Input placeholder="Што се прави (на пр. Замена на масло)" value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">На секои (дена)</Label><Input type="number" value={p.intervalDays} onChange={(e) => setP({ ...p, intervalDays: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Последно направено</Label><DateInput value={p.lastDone} onChange={(e) => setP({ ...p, lastDone: e.target.value })} /></div>
            </div>
            <Button className="w-full bg-amber-500 hover:bg-amber-600" disabled={!p.machineId || p.title.length < 3 || !(parseInt(p.intervalDays) > 0)}
              onClick={() => createPlan.mutate({ machineId: Number(p.machineId), title: p.title, intervalDays: parseInt(p.intervalDays), lastDone: p.lastDone || undefined })}>Зачувај</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!logFor} onOpenChange={(o) => !o && setLogFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{logFor?.title ? `Направено: ${logFor.title}` : "Дефект / поправка"}</DialogTitle></DialogHeader>
          {logFor && (
            <div className="space-y-3">
              {!logFor.planId && (
                <div className="grid grid-cols-2 gap-3">
                  <Select value={logFor.machineId} onValueChange={(v) => setLogFor({ ...logFor, machineId: v })}><SelectTrigger><SelectValue placeholder="Машина" /></SelectTrigger>
                    <SelectContent>{machines?.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}</SelectContent></Select>
                  <Select value={l.kind} onValueChange={(v) => setL({ ...l, kind: v })}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(LOGKIND).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1"><Label className="text-xs">Датум</Label><DateInput value={l.date} onChange={(e) => setL({ ...l, date: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Трошок (ден)</Label><Input type="number" value={l.cost} onChange={(e) => setL({ ...l, cost: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Застој (ч)</Label><Input type="number" value={l.downtime} onChange={(e) => setL({ ...l, downtime: e.target.value })} /></div>
              </div>
              <Input placeholder="Опис" value={l.description} onChange={(e) => setL({ ...l, description: e.target.value })} />
              <Input placeholder="Направил (сервисер / вработен)" value={l.by} onChange={(e) => setL({ ...l, by: e.target.value })} />
              <Button className="w-full bg-amber-500 hover:bg-amber-600" disabled={!logFor.machineId}
                onClick={() => createLog.mutate({ machineId: Number(logFor.machineId), planId: logFor.planId, date: l.date, kind: (logFor.planId ? "planned" : l.kind) as any,
                  description: l.description || undefined, cost: parseFloat(l.cost) || 0, downtimeHours: parseFloat(l.downtime) || 0, performedBy: l.by || undefined })}>Зачувај</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Quality() {
  const { data: due } = trpc.ops.maintenanceDue.useQuery();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Квалитет и одржување</h2>
        <p className="text-gray-500 mt-1">Неусогласености и рекламации, редовен сервис и дефекти на машините</p>
      </div>
      <Tabs defaultValue="quality">
        <TabsList className="bg-amber-50">
          <TabsTrigger value="quality"><ShieldAlert className="h-4 w-4 mr-1.5" />Квалитет</TabsTrigger>
          <TabsTrigger value="maintenance"><Wrench className="h-4 w-4 mr-1.5" />Одржување{due?.dueSoon ? <Badge className="ml-1.5 bg-red-500 text-white text-[10px] px-1.5">{due.dueSoon}</Badge> : null}</TabsTrigger>
        </TabsList>
        <TabsContent value="quality" className="mt-4"><QualityTab /></TabsContent>
        <TabsContent value="maintenance" className="mt-4"><MaintenanceTab /></TabsContent>
      </Tabs>
    </div>
  );
}
