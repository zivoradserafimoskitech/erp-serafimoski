import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SearchPick from "@/components/SearchPick";
import { toast } from "sonner";
import { openBase64 } from "@/lib/stored-file";
import { formatDateTime } from "@/lib/utils";
import { Target, Plus, Phone, Users, Mail, MapPin, StickyNote, ListTodo, Paperclip, TrendingUp, XCircle } from "lucide-react";

const fmt = (n: number) => n.toLocaleString("mk-MK", { maximumFractionDigits: 0 });
const fmtD = (d?: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "");
const today = () => new Date().toISOString().slice(0, 10);
export const STAGE: Record<string, { label: string; cls: string }> = {
  new: { label: "Ново барање", cls: "bg-sky-50 border-sky-200" }, contacted: { label: "Во контакт", cls: "bg-indigo-50 border-indigo-200" },
  quoting: { label: "Се прави понуда", cls: "bg-amber-50 border-amber-200" }, quoted: { label: "Понуда пратена", cls: "bg-violet-50 border-violet-200" },
  won: { label: "Добиена", cls: "bg-emerald-50 border-emerald-200" }, lost: { label: "Изгубена", cls: "bg-gray-50 border-gray-200" },
};
export const LOST: Record<string, string> = { price: "Цена", delivery: "Рок на испорака", competitor: "Отиде кај конкурент", spec: "Не можеме технички", no_response: "Нема одговор", cancelled: "Клиентот се откажа", other: "Друго" };
export const ACT: Record<string, { label: string; icon: any }> = {
  call: { label: "Повик", icon: Phone }, meeting: { label: "Средба", icon: Users }, email: { label: "Е-пошта", icon: Mail },
  visit: { label: "Посета", icon: MapPin }, note: { label: "Белешка", icon: StickyNote }, task: { label: "Задача", icon: ListTodo },
};
const SOURCES: Record<string, string> = { phone: "Телефон", email: "Е-пошта", web: "Веб", portal: "Портал", fair: "Саем", referral: "Препорака", existing: "Постоечки клиент", other: "Друго" };

type Opp = { id?: number; customerId: number | null; company: string; contactName: string; email: string; phone: string; title: string; value: string; probability: string; stage: string; expectedClose: string; source: string; lostReason: string; notes: string; quotationId: number | null };
const EMPTY: Opp = { customerId: null, company: "", contactName: "", email: "", phone: "", title: "", value: "0", probability: "30", stage: "new", expectedClose: "", source: "", lostReason: "", notes: "", quotationId: null };

/** Продажба: можности пред понуда, активности и задачи, причини за изгубени понуди. */
export default function Crm() {
  const utils = trpc.useUtils();
  const { data: opps } = trpc.crm.oppList.useQuery({});
  const { data: tasks } = trpc.crm.activityList.useQuery({ openTasks: true });
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const { data: stats } = trpc.crm.crmStats.useQuery({ from: yearStart, to: today() });
  const [edit, setEdit] = useState<Opp | null>(null);
  const done = trpc.crm.activityDone.useMutation({ onSuccess: () => utils.crm.invalidate() });
  const cols = ["new", "contacted", "quoting", "quoted"];
  const weighted = (stats?.pipeline ?? []).reduce((s, p) => s + p.weighted, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><Target className="h-6 w-6 text-amber-600" />Продажба</h2>
          <p className="text-gray-500 mt-1">Барања и можности пред понудата, разговори и задачи, зошто губиме понуди · <a className="text-amber-700 hover:underline" href="/izvestai">Извештаи</a></p>
        </div>
        <Button className="bg-amber-500 hover:bg-amber-600" onClick={() => setEdit({ ...EMPTY })}><Plus className="h-4 w-4 mr-1.5" />Нова можност</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Во тек (пондерирано)</p><p className="text-2xl font-bold">{fmt(weighted)} <span className="text-sm">ден</span></p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Добиени понуди (год.)</p><p className="text-2xl font-bold text-emerald-700">{stats?.quotes.won ?? 0}<span className="text-sm text-gray-400"> / {stats?.quotes.total ?? 0}</span></p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Стапка на успех</p><p className="text-2xl font-bold">{stats?.quotes.winRate === null || stats?.quotes.winRate === undefined ? "—" : `${Math.round(stats.quotes.winRate * 100)}%`}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Отворени задачи</p><p className={`text-2xl font-bold ${(tasks ?? []).some((t) => t.dueDate && t.dueDate < today()) ? "text-red-600" : ""}`}>{tasks?.length ?? 0}</p></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {cols.map((st) => {
          const list = (opps ?? []).filter((o) => o.stage === st);
          return (
            <div key={st} className={`rounded-xl border p-2 space-y-2 min-h-[8rem] ${STAGE[st].cls}`}>
              <p className="text-xs font-semibold text-gray-600 px-1 flex justify-between"><span>{STAGE[st].label}</span><span>{list.length} · {fmt(list.reduce((s, o) => s + o.value, 0))}</span></p>
              {list.map((o) => (
                <button key={o.id} onClick={() => setEdit({ id: o.id, customerId: o.customerId, company: o.company ?? "", contactName: o.contactName ?? "", email: o.email ?? "", phone: o.phone ?? "", title: o.title, value: String(o.value),
                  probability: String(o.probability), stage: o.stage, expectedClose: o.expectedClose ?? "", source: o.source ?? "", lostReason: o.lostReason ?? "", notes: o.notes ?? "", quotationId: o.quotationId })}
                  className="w-full text-left rounded-lg bg-white border px-2.5 py-2 hover:border-amber-400 shadow-sm">
                  <p className="text-sm font-medium leading-tight">{o.title}</p>
                  <p className="text-xs text-gray-500">{o.customer ?? o.company ?? "—"}{o.files ? <span className="ml-1"><Paperclip className="inline h-3 w-3" />{o.files}</span> : null}</p>
                  <p className="text-xs mt-1 flex justify-between"><span className="font-semibold">{fmt(o.value)} {o.currency === "MKD" ? "ден" : o.currency}</span><span className="text-gray-400">{o.probability}%{o.expectedClose ? ` · ${fmtD(o.expectedClose)}` : ""}</span></p>
                  {o.quoteNumber && <p className="text-[11px] text-violet-700">понуда {o.quoteNumber}</p>}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card><CardContent className="p-4 space-y-2">
          <p className="font-semibold flex items-center gap-2"><ListTodo className="h-4 w-4 text-amber-600" />Задачи</p>
          {!tasks?.length ? <p className="text-sm text-gray-400">Нема отворени задачи</p> : tasks.map((t) => (
            <label key={t.id} className="flex items-start gap-2 text-sm border-t pt-1.5">
              <input type="checkbox" className="mt-1" onChange={() => done.mutate({ id: t.id, done: true })} />
              <span className="flex-1">{t.subject}<span className="block text-xs text-gray-500">{t.customer ?? ""}{t.opportunity ? ` · ${t.opportunity}` : ""}</span></span>
              <span className={`text-xs ${t.dueDate && t.dueDate < today() ? "text-red-600 font-semibold" : "text-gray-500"}`}>{fmtD(t.dueDate)}</span>
            </label>
          ))}
        </CardContent></Card>
        <Card><CardContent className="p-4 space-y-2">
          <p className="font-semibold flex items-center gap-2"><XCircle className="h-4 w-4 text-red-500" />Зошто губиме (оваа година)</p>
          {!stats?.lostReasons.length ? <p className="text-sm text-gray-400">Уште нема изгубени понуди со причина. При одбиена понуда — изберете причина.</p> : stats.lostReasons.map((r) => {
            const max = Math.max(...stats.lostReasons.map((x) => x.count));
            return (
              <div key={r.reason} className="flex items-center gap-2 text-sm">
                <span className="w-40">{r.label}</span>
                <div className="flex-1 h-2 rounded bg-gray-100"><div className="h-2 rounded bg-red-400" style={{ width: `${(r.count / max) * 100}%` }} /></div>
                <span className="w-8 text-right tabular-nums">{r.count}</span>
              </div>
            );
          })}
          <p className="text-[11px] text-gray-500 flex items-center gap-1"><TrendingUp className="h-3 w-3" />Ако „Цена“ е најчеста причина — проверете ја маржата и калкулацијата; ако „Рок“ — капацитетот во распоредот.</p>
        </CardContent></Card>
      </div>

      {edit && <OppDialog opp={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function OppDialog({ opp, onClose }: { opp: Opp; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [f, setF] = useState<Opp>(opp);
  const { data: customers } = trpc.customers.customerList.useQuery();
  const { data: acts } = trpc.crm.activityList.useQuery({ opportunityId: opp.id ?? -1 }, { enabled: !!opp.id });
  const { data: files } = trpc.crm.oppFiles.useQuery({ id: opp.id ?? -1 }, { enabled: !!opp.id });
  const { data: quotes } = trpc.quotation.quotationList.useQuery({}, { enabled: !!f.customerId });
  const custItems = useMemo(() => (customers ?? []).map((c: any) => ({ id: c.id as number, label: c.company || c.name, sub: c.city ?? null })), [customers]);
  const save = trpc.crm.oppSave.useMutation({ onSuccess: () => { toast.success("Зачувано"); utils.crm.invalidate(); onClose(); }, onError: (e) => toast.error(e.message) });
  const del = trpc.crm.oppDelete.useMutation({ onSuccess: () => { utils.crm.invalidate(); onClose(); } });
  const [act, setAct] = useState({ kind: "call", subject: "", dueDate: "" });
  const addAct = trpc.crm.activitySave.useMutation({ onSuccess: () => { setAct({ ...act, subject: "", dueDate: "" }); utils.crm.invalidate(); }, onError: (e) => toast.error(e.message) });
  const custQuotes = (quotes as any[] | undefined)?.filter((q: any) => q.customerId === f.customerId) ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogTitle>{f.id ? "Можност" : "Нова можност"}</DialogTitle>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="col-span-2 space-y-1"><Label className="text-xs">Што бара клиентот *</Label><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="на пр. Ограда 40 m, ласер 2 mm" /></div>
          <div className="space-y-1"><Label className="text-xs">Клиент (ако е постоечки)</Label><SearchPick items={custItems} value={f.customerId} onChange={(v) => setF({ ...f, customerId: v })} placeholder="Избери клиент" /></div>
          <div className="space-y-1"><Label className="text-xs">Фирма (нов клиент)</Label><Input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Контакт</Label><Input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2"><div className="space-y-1"><Label className="text-xs">Телефон</Label><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Е-пошта</Label><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div></div>
          <div className="grid grid-cols-2 gap-2"><div className="space-y-1"><Label className="text-xs">Проценета вредност (ден)</Label><Input value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Веројатност %</Label><Input value={f.probability} onChange={(e) => setF({ ...f, probability: e.target.value })} /></div></div>
          <div className="grid grid-cols-2 gap-2"><div className="space-y-1"><Label className="text-xs">Очекувано затворање</Label><DateInput value={f.expectedClose} onChange={(e) => setF({ ...f, expectedClose: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Извор</Label><Select value={f.source || "none"} onValueChange={(v) => setF({ ...f, source: v === "none" ? "" : v })}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">—</SelectItem>{Object.entries(SOURCES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div></div>
          <div className="space-y-1"><Label className="text-xs">Фаза</Label><Select value={f.stage} onValueChange={(v) => setF({ ...f, stage: v })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(STAGE).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select></div>
          {f.stage === "lost" ? (
            <div className="space-y-1"><Label className="text-xs">Зошто е изгубена *</Label><Select value={f.lostReason || "none"} onValueChange={(v) => setF({ ...f, lostReason: v === "none" ? "" : v })}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">— избери —</SelectItem>{Object.entries(LOST).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
          ) : f.customerId ? (
            <div className="space-y-1"><Label className="text-xs">Поврзана понуда</Label><Select value={f.quotationId ? String(f.quotationId) : "none"} onValueChange={(v) => setF({ ...f, quotationId: v === "none" ? null : Number(v), stage: v !== "none" && ["new", "contacted", "quoting"].includes(f.stage) ? "quoted" : f.stage })}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">—</SelectItem>{custQuotes.map((q: any) => <SelectItem key={q.id} value={String(q.id)}>{q.quoteNumber}</SelectItem>)}</SelectContent></Select></div>
          ) : <div />}
          <div className="col-span-2 space-y-1"><Label className="text-xs">Белешки</Label><Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        </div>
        {!!files?.length && (
          <div className="text-sm space-y-1"><p className="text-xs font-semibold text-gray-500">Прикачени датотеки</p>
            {files.map((x) => <button key={x.id} className="block text-amber-700 hover:underline text-xs" onClick={() => { const m = /^data:([^;]+);base64,(.*)$/s.exec(x.data); openBase64(m ? m[2] : x.data, m ? m[1] : x.mime ?? "application/octet-stream"); }}><Paperclip className="inline h-3 w-3 mr-1" />{x.fileName}</button>)}
          </div>
        )}
        {f.id && (
          <div className="border-t pt-2 space-y-2 text-sm">
            <p className="text-xs font-semibold text-gray-500">Активности</p>
            <div className="flex flex-wrap gap-1.5">
              <Select value={act.kind} onValueChange={(v) => setAct({ ...act, kind: v })}><SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(ACT).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select>
              <Input className="h-8 flex-1 min-w-[12rem]" placeholder="Што е договорено / што треба да се направи" value={act.subject} onChange={(e) => setAct({ ...act, subject: e.target.value })} />
              {act.kind === "task" && <DateInput className="h-8 w-40" value={act.dueDate} onChange={(e) => setAct({ ...act, dueDate: e.target.value })} />}
              <Button size="sm" className="h-8" disabled={act.subject.length < 2} onClick={() => addAct.mutate({ customerId: f.customerId, opportunityId: f.id!, kind: act.kind as any, subject: act.subject, dueDate: act.dueDate || null })}>Додај</Button>
            </div>
            {(acts ?? []).map((a) => { const I = ACT[a.kind]?.icon ?? StickyNote; return (
              <p key={a.id} className="text-xs flex items-start gap-1.5"><I className="h-3.5 w-3.5 text-gray-400 mt-0.5" /><span className="flex-1">{a.subject}{a.notes ? <span className="text-gray-500"> — {a.notes}</span> : null}</span>
                <span className="text-gray-400">{a.kind === "task" ? (a.doneAt ? "✓" : `до ${fmtD(a.dueDate)}`) : formatDateTime(a.createdAt)}{a.createdBy ? ` · ${a.createdBy}` : ""}</span></p>
            ); })}
          </div>
        )}
        <div className="flex justify-between pt-2">
          {f.id ? <Button variant="ghost" className="text-red-600" onClick={() => { if (confirm("Да се избрише можноста?")) del.mutate({ id: f.id! }); }}>Избриши</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Откажи</Button>
            <Button className="bg-amber-500 hover:bg-amber-600" disabled={f.title.length < 2 || save.isPending} onClick={() => save.mutate({
              id: f.id, customerId: f.customerId, company: f.company || undefined, contactName: f.contactName || undefined, email: f.email || undefined, phone: f.phone || undefined,
              title: f.title, value: parseFloat(f.value) || 0, probability: parseInt(f.probability) || 0, stage: f.stage as any, expectedClose: f.expectedClose || null,
              source: f.source || undefined, lostReason: f.lostReason || null, quotationId: f.quotationId, notes: f.notes || undefined })}>Зачувај</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
