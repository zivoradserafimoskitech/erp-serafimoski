import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
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
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/layout/EmptyState";
import { toast } from "sonner";
import { openBase64 } from "@/lib/stored-file";
import { formatDateTime } from "@/lib/utils";
import {
  Target, Plus, Phone, Users, Mail, MapPin, StickyNote, ListTodo, Paperclip,
  TrendingUp, XCircle, X, ArrowRight, FileText, Truck, Calculator, Info,
} from "lucide-react";

const HELP_KEY = "crm-potential-help-dismissed";
const fmt = (n: number) => n.toLocaleString("mk-MK", { maximumFractionDigits: 0 });
const fmtD = (d?: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "");
const today = () => new Date().toISOString().slice(0, 10);

export const STAGE: Record<string, { label: string; cls: string }> = {
  new: { label: "Ново барање", cls: "bg-sky-50 border-sky-200" },
  contacted: { label: "Во контакт", cls: "bg-indigo-50 border-indigo-200" },
  quoting: { label: "Се прави понуда", cls: "bg-primary/10 border-primary/20" },
  quoted: { label: "Понуда пратена", cls: "bg-violet-50 border-violet-200" },
  won: { label: "Добиена", cls: "bg-emerald-50 border-emerald-200" },
  lost: { label: "Изгубена", cls: "bg-gray-50 border-gray-200" },
};
export const LOST: Record<string, string> = {
  price: "Цена", delivery: "Рок на испорака", competitor: "Отиде кај конкурент", spec: "Не можеме технички",
  no_response: "Нема одговор", cancelled: "Клиентот се откажа", other: "Друго",
};
export const ACT: Record<string, { label: string; icon: any }> = {
  call: { label: "Повик", icon: Phone }, meeting: { label: "Средба", icon: Users }, email: { label: "Е-пошта", icon: Mail },
  visit: { label: "Посета", icon: MapPin }, note: { label: "Белешка", icon: StickyNote }, task: { label: "Задача", icon: ListTodo },
};
const SOURCES: Record<string, string> = {
  phone: "Телефон", email: "Е-пошта", web: "Веб", portal: "Портал", fair: "Саем", referral: "Препорака", existing: "Постоечки клиент", other: "Друго",
};

type Opp = {
  id?: number; customerId: number | null; company: string; contactName: string; email: string; phone: string;
  title: string; value: string; probability: string; stage: string; expectedClose: string; source: string;
  lostReason: string; notes: string; products: string; owner: string; quotationId: number | null;
};
const EMPTY: Opp = {
  customerId: null, company: "", contactName: "", email: "", phone: "", title: "", value: "", probability: "40",
  stage: "new", expectedClose: "", source: "existing", lostReason: "", notes: "", products: "", owner: "", quotationId: null,
};

const FLOW = [
  { t: "Потенцијална продажба", i: Target },
  { t: "Понуда", i: FileText },
  { t: "Нарачка", i: Users },
  { t: "Испратница", i: Truck },
  { t: "Фактура", i: Calculator },
];

/** Потенцијални продажби: барања пред понуда, поврзани документи и следен чекор. */
export default function Crm() {
  const utils = trpc.useUtils();
  const { data: opps, isLoading } = trpc.crm.oppList.useQuery({});
  const { data: tasks } = trpc.crm.activityList.useQuery({ openTasks: true });
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const { data: stats } = trpc.crm.crmStats.useQuery({ from: yearStart, to: today() });
  const [edit, setEdit] = useState<Opp | null>(null);
  const [helpOpen, setHelpOpen] = useState(() => {
    try { return localStorage.getItem(HELP_KEY) !== "1"; } catch { return true; }
  });
  const done = trpc.crm.activityDone.useMutation({ onSuccess: () => utils.crm.invalidate() });
  const cols = ["new", "contacted", "quoting", "quoted"];
  const weighted = (stats?.pipeline ?? []).reduce((s, p) => s + p.weighted, 0);
  const openCount = (opps ?? []).filter((o) => !["won", "lost"].includes(o.stage)).length;

  const dismissHelp = () => {
    setHelpOpen(false);
    try { localStorage.setItem(HELP_KEY, "1"); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Потенцијални продажби"
        description="Тука се евидентираат барања од клиенти пред да станат понуда. Секоја картичка води кон понуда → нарачка → испратница → фактура."
        icon={<Target className="h-6 w-6 text-primary" />}
        actions={
          <div className="flex flex-wrap gap-2">
            {!helpOpen && (
              <Button variant="outline" size="sm" onClick={() => setHelpOpen(true)}><Info className="h-4 w-4 mr-1" />Како работи</Button>
            )}
            <Button onClick={() => setEdit({ ...EMPTY })}><Plus className="h-4 w-4 mr-1.5" />Нова потенцијална продажба</Button>
          </div>
        }
      />

      {helpOpen && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 space-y-3 relative">
            <button type="button" className="absolute right-3 top-3 text-muted-foreground hover:text-foreground" onClick={dismissHelp} aria-label="Затвори">
              <X className="h-4 w-4" />
            </button>
            <p className="text-sm text-foreground/90 pr-6">
              <b>Потенцијална продажба</b> е запис: „овој клиент сака нешто, уште немаме понуда“.
              Кога сте спремни, креирате понуда од картичката — потоа истиот тек продолжува како кај секоја нарачка.
            </p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {FLOW.map((s, i) => {
                const I = s.i;
                return (
                  <span key={s.t} className="inline-flex items-center gap-1.5">
                    {i > 0 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
                    <span className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 font-medium">
                      <I className="h-3.5 w-3.5 text-primary" />{s.t}
                    </span>
                  </span>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Во тек (пондерирано)</p><p className="text-2xl font-bold">{fmt(weighted)} <span className="text-sm">ден</span></p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Добиени понуди (год.)</p><p className="text-2xl font-bold text-emerald-700">{stats?.quotes.won ?? 0}<span className="text-sm text-gray-400"> / {stats?.quotes.total ?? 0}</span></p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Стапка на успех</p><p className="text-2xl font-bold">{stats?.quotes.winRate == null ? "—" : `${Math.round(stats.quotes.winRate * 100)}%`}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Отворени задачи</p><p className={`text-2xl font-bold ${(tasks ?? []).some((t) => t.dueDate && t.dueDate < today()) ? "text-red-600" : ""}`}>{tasks?.length ?? 0}</p></CardContent></Card>
      </div>

      {!isLoading && openCount === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              title="Нема потенцијални продажби"
              description="Започнете со „Нова потенцијална продажба“: изберете клиент, опишете што бара и очекувана вредност. Потоа од картичката направете понуда."
              action={<Button onClick={() => setEdit({ ...EMPTY })}><Plus className="h-4 w-4 mr-1.5" />Додај прва</Button>}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {cols.map((st) => {
            const list = (opps ?? []).filter((o) => o.stage === st);
            return (
              <div key={st} className={`rounded-xl border p-2 space-y-2 min-h-[8rem] ${STAGE[st].cls}`}>
                <p className="text-xs font-semibold text-gray-600 px-1 flex justify-between">
                  <span>{STAGE[st].label}</span>
                  <span>{list.length} · {fmt(list.reduce((s, o) => s + o.value, 0))}</span>
                </p>
                {list.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setEdit({
                      id: o.id, customerId: o.customerId, company: o.company ?? "", contactName: o.contactName ?? "",
                      email: o.email ?? "", phone: o.phone ?? "", title: o.title, value: String(o.value || ""),
                      probability: String(o.probability), stage: o.stage, expectedClose: o.expectedClose ?? "",
                      source: o.source ?? "", lostReason: o.lostReason ?? "", notes: o.notes ?? "",
                      products: (o as any).products ?? "", owner: o.owner ?? "", quotationId: o.quotationId,
                    })}
                    className="w-full text-left rounded-lg bg-white border px-2.5 py-2 hover:border-primary/40 shadow-sm"
                  >
                    <p className="text-sm font-medium leading-tight">{o.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Клиент: <span className="font-medium text-gray-700">{o.customer ?? o.company ?? "—"}</span>
                      {o.files ? <span className="ml-1"><Paperclip className="inline h-3 w-3" />{o.files}</span> : null}
                    </p>
                    {(o as any).products && <p className="text-[11px] text-gray-500 line-clamp-1 mt-0.5">{(o as any).products}</p>}
                    <p className="text-xs mt-1 flex justify-between">
                      <span className="font-semibold">{fmt(o.value)} {o.currency === "MKD" ? "ден" : o.currency}</span>
                      <span className="text-gray-400">{o.probability}%{o.expectedClose ? ` · ${fmtD(o.expectedClose)}` : ""}</span>
                    </p>
                    {o.quoteNumber && <p className="text-[11px] text-violet-700">понуда {o.quoteNumber}</p>}
                    {o.owner && <p className="text-[11px] text-gray-400">продавач: {o.owner}</p>}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card><CardContent className="p-4 space-y-2">
          <p className="font-semibold flex items-center gap-2"><ListTodo className="h-4 w-4 text-primary" />Задачи</p>
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
          {!stats?.lostReasons.length ? (
            <p className="text-sm text-gray-400">Уште нема изгубени понуди со причина. При одбиена понуда — изберете причина.</p>
          ) : stats.lostReasons.map((r) => {
            const max = Math.max(...stats.lostReasons.map((x) => x.count));
            return (
              <div key={r.reason} className="flex items-center gap-2 text-sm">
                <span className="w-40">{r.label}</span>
                <div className="flex-1 h-2 rounded bg-gray-100"><div className="h-2 rounded bg-red-400" style={{ width: `${(r.count / max) * 100}%` }} /></div>
                <span className="w-8 text-right tabular-nums">{r.count}</span>
              </div>
            );
          })}
          <p className="text-[11px] text-gray-500 flex items-center gap-1"><TrendingUp className="h-3 w-3" />Ако „Цена“ е најчеста — проверете маржа; ако „Рок“ — капацитет во распоредот.</p>
        </CardContent></Card>
      </div>

      {edit && <OppDialog opp={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function OppDialog({ opp, onClose }: { opp: Opp; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [f, setF] = useState<Opp>(opp);
  const [newCustOpen, setNewCustOpen] = useState(false);
  const [nc, setNc] = useState({ name: "", company: "", phone: "", email: "" });
  const { data: customers } = trpc.customers.customerList.useQuery();
  const { data: acts } = trpc.crm.activityList.useQuery({ opportunityId: opp.id ?? -1 }, { enabled: !!opp.id });
  const { data: files } = trpc.crm.oppFiles.useQuery({ id: opp.id ?? -1 }, { enabled: !!opp.id });
  const { data: timeline } = trpc.crm.oppTimeline.useQuery({ id: opp.id! }, { enabled: !!opp.id });
  const custItems = useMemo(() => (customers ?? []).map((c: any) => ({ id: c.id as number, label: c.company || c.name, sub: c.city ?? null })), [customers]);
  const navigate = useNavigate();
  const save = trpc.crm.oppSave.useMutation({
    onSuccess: () => { toast.success("Потенцијалната продажба е зачувана"); utils.crm.invalidate(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  const toQuote = trpc.crm.oppToQuotation.useMutation({
    onSuccess: (r) => {
      toast.success(r.existing ? "Понудата веќе постои — ја отвораме" : `Креирана понуда ${r.quoteNumber}`);
      utils.crm.invalidate();
      onClose();
      navigate(`/ponudi?open=${r.id}`);
    },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.crm.oppDelete.useMutation({
    onSuccess: () => { toast.success("Избришано"); utils.crm.invalidate(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  const createCust = trpc.customers.customerCreate.useMutation({
    onSuccess: async (r: any) => {
      const id = Number(r?.id ?? r?.[0]?.insertId);
      await utils.customers.customerList.invalidate();
      if (id) setF((prev) => ({ ...prev, customerId: id, company: nc.company || nc.name }));
      else {
        const list = await utils.customers.customerList.fetch();
        const found = (list as any[])?.find((c) => c.name === nc.name || c.company === (nc.company || nc.name));
        if (found) setF((prev) => ({ ...prev, customerId: found.id, company: nc.company || nc.name }));
      }
      setNewCustOpen(false);
      toast.success("Клиентот е додаден");
    },
    onError: (e) => toast.error(e.message),
  });
  const [act, setAct] = useState({ kind: "call", subject: "", dueDate: "" });
  const addAct = trpc.crm.activitySave.useMutation({
    onSuccess: () => { setAct({ ...act, subject: "", dueDate: "" }); utils.crm.invalidate(); toast.success("Активноста е додадена"); },
    onError: (e) => toast.error(e.message),
  });

  const selectedCust = (customers as any[] | undefined)?.find((c) => c.id === f.customerId);

  const primaryNext = () => {
    const n = timeline?.next;
    if (!n || n.action === "lost") return null;
    if (n.action === "create_quote") {
      return <Button disabled={toQuote.isPending} onClick={() => toQuote.mutate({ opportunityId: f.id! })}>{n.label}</Button>;
    }
    if (n.href) {
      return <Button onClick={() => { onClose(); navigate(n.href!); }}>{n.label}</Button>;
    }
    return null;
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogTitle>{f.id ? "Потенцијална продажба" : "Нова потенцијална продажба"}</DialogTitle>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Клиент *</Label>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <SearchPick items={custItems} value={f.customerId} onChange={(v) => setF({ ...f, customerId: v })} placeholder="Избери постоечки клиент…" />
              </div>
              <Button type="button" variant="outline" className="shrink-0" onClick={() => setNewCustOpen(true)}>Нов клиент</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Мора да е поврзано со клиент од списокот (или брзо додајте нов).</p>
            {selectedCust && (
              <p className="text-xs text-gray-600">
                Избран: <Link className="text-primary hover:underline" to={`/klienti`} onClick={onClose}>{selectedCust.company || selectedCust.name}</Link>
                {selectedCust.phone ? ` · ${selectedCust.phone}` : ""}
              </p>
            )}
          </div>

          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Што бара клиентот *</Label>
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="на пр. Ограда 40 m, ласерски рез 2 mm" />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Производ(и) / опис</Label>
            <Input value={f.products} onChange={(e) => setF({ ...f, products: e.target.value })} placeholder="на пр. панел-ограда + порта, или шифра од каталог" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Очекуван износ (ден)</Label>
            <Input value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder="пр. 250000" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Очекувано затворање</Label>
            <DateInput value={f.expectedClose} onChange={(e) => setF({ ...f, expectedClose: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Продавач</Label>
            <Input value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} placeholder="Име на комерцијалист" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Фаза</Label>
            <Select value={f.stage} onValueChange={(v) => setF({ ...f, stage: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(STAGE).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Веројатност %</Label>
            <Input value={f.probability} onChange={(e) => setF({ ...f, probability: e.target.value })} placeholder="40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Извор</Label>
            <Select value={f.source || "none"} onValueChange={(v) => setF({ ...f, source: v === "none" ? "" : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">—</SelectItem>{Object.entries(SOURCES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {f.stage === "lost" && (
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Зошто е изгубена *</Label>
              <Select value={f.lostReason || "none"} onValueChange={(v) => setF({ ...f, lostReason: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">— избери —</SelectItem>{Object.entries(LOST).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Белешка</Label>
            <Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Дополнителни детали од разговорот…" />
          </div>
          <div className="space-y-1"><Label className="text-xs">Контакт лице</Label><Input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} placeholder="опционално" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label className="text-xs">Телефон</Label><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Е-пошта</Label><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          </div>
        </div>

        {f.id && timeline && (
          <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
            <p className="text-xs font-semibold text-gray-600">Поврзани документи</p>
            {!timeline.steps.length ? (
              <p className="text-xs text-muted-foreground">Уште нема понуда. Следен чекор: направете понуда.</p>
            ) : (
              <ol className="space-y-1.5">
                {timeline.steps.map((s: any) => (
                  <li key={`${s.kind}-${s.id}`} className="flex items-center justify-between text-xs gap-2">
                    <span className="font-medium">
                      {s.kind === "quote" ? "Понуда" : s.kind === "order" ? "Нарачка" : s.kind === "delivery" ? "Испратница" : "Фактура"}{" "}
                      {s.number}
                      <span className="text-muted-foreground font-normal"> · {s.status}</span>
                    </span>
                    <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => { onClose(); navigate(s.href); }}>Отвори</Button>
                  </li>
                ))}
              </ol>
            )}
            {timeline.next && timeline.next.action !== "lost" && (
              <p className="text-[11px] text-muted-foreground">Следно: <b>{timeline.next.label}</b></p>
            )}
          </div>
        )}

        {!!files?.length && (
          <div className="text-sm space-y-1"><p className="text-xs font-semibold text-gray-500">Прикачени датотеки</p>
            {files.map((x) => (
              <button key={x.id} type="button" className="block text-primary hover:underline text-xs" onClick={() => {
                const m = /^data:([^;]+);base64,(.*)$/s.exec(x.data);
                openBase64(m ? m[2] : x.data, m ? m[1] : x.mime ?? "application/octet-stream");
              }}><Paperclip className="inline h-3 w-3 mr-1" />{x.fileName}</button>
            ))}
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
            {(acts ?? []).map((a) => {
              const I = ACT[a.kind]?.icon ?? StickyNote;
              return (
                <p key={a.id} className="text-xs flex items-start gap-1.5"><I className="h-3.5 w-3.5 text-gray-400 mt-0.5" /><span className="flex-1">{a.subject}{a.notes ? <span className="text-gray-500"> — {a.notes}</span> : null}</span>
                  <span className="text-gray-400">{a.kind === "task" ? (a.doneAt ? "✓" : `до ${fmtD(a.dueDate)}`) : formatDateTime(a.createdAt)}{a.createdBy ? ` · ${a.createdBy}` : ""}</span></p>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap justify-between gap-2 pt-2">
          {f.id ? <Button variant="ghost" className="text-red-600" onClick={() => { if (confirm("Да се избрише потенцијалната продажба?")) del.mutate({ id: f.id! }); }}>Избриши</Button> : <span />}
          <div className="flex flex-wrap gap-2">
            {f.id && primaryNext()}
            <Button variant="outline" onClick={onClose}>Откажи</Button>
            <Button
              disabled={f.title.length < 2 || !f.customerId || save.isPending}
              onClick={() => save.mutate({
                id: f.id, customerId: f.customerId!, company: f.company || undefined, contactName: f.contactName || undefined,
                email: f.email || undefined, phone: f.phone || undefined, title: f.title, value: parseFloat(f.value) || 0,
                probability: parseInt(f.probability) || 0, stage: f.stage as any, expectedClose: f.expectedClose || null,
                source: f.source || undefined, lostReason: f.lostReason || null, quotationId: f.quotationId,
                owner: f.owner || undefined, notes: f.notes || undefined, products: f.products || undefined,
              })}
            >Зачувај</Button>
          </div>
        </div>

        <Dialog open={newCustOpen} onOpenChange={setNewCustOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogTitle>Брз нов клиент</DialogTitle>
            <div className="space-y-2 text-sm">
              <div className="space-y-1"><Label className="text-xs">Име *</Label><Input value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} placeholder="Име / краток назив" /></div>
              <div className="space-y-1"><Label className="text-xs">Фирма</Label><Input value={nc.company} onChange={(e) => setNc({ ...nc, company: e.target.value })} placeholder="опционално" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label className="text-xs">Телефон</Label><Input value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Е-пошта</Label><Input value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} /></div>
              </div>
              <Button className="w-full" disabled={nc.name.length < 2 || createCust.isPending}
                onClick={() => createCust.mutate({ name: nc.name, company: nc.company || undefined, phone: nc.phone || undefined, email: nc.email || undefined })}>
                {createCust.isPending ? "…" : "Додај и избери"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
