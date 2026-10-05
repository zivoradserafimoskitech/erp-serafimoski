import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
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
import {
  Handshake, Plus, Paperclip, X, ArrowRight, FileText, Truck, Calculator, Info, Users, LayoutGrid, List, Trophy, XCircle, Search,
  Phone, Mail, MapPin, StickyNote, ListTodo,
} from "lucide-react";
import { DEAL_STAGES, DEAL_STAGE_LABEL, OPEN_STAGES, STAGE_PROBABILITY, type DealStage } from "@contracts/crm";
import { ActivityQuickAdd, ActivityTimeline, PeopleDatalist, StageBadge, STAGE_TONE, QUOTE_STATUS, fmtD, fmtMoney } from "@/components/crm/shared";

const HELP_KEY = "crm-deals-help-dismissed";

export const LOST: Record<string, string> = {
  price: "Цена", delivery: "Рок на испорака", competitor: "Отиде кај конкурент", spec: "Не можеме технички",
  no_response: "Нема одговор", cancelled: "Клиентот се откажа", other: "Друго",
};
/** Задржано за компатибилност (CustomerCrmDialog). */
export const ACT: Record<string, { label: string; icon: any }> = {
  call: { label: "Повик", icon: Phone }, meeting: { label: "Средба", icon: Users }, email: { label: "Е-пошта", icon: Mail },
  visit: { label: "Посета", icon: MapPin }, note: { label: "Белешка", icon: StickyNote }, task: { label: "Задача", icon: ListTodo },
};
const SOURCES: Record<string, string> = {
  phone: "Телефон", email: "Е-пошта", web: "Веб", portal: "Портал", fair: "Саем", referral: "Препорака", existing: "Постоечки клиент", other: "Друго",
};

type Deal = {
  id?: number; customerId: number | null; contactId: number | null; title: string; value: string; probability: string; stage: DealStage;
  expectedClose: string; source: string; lostReason: string; lostNote: string; notes: string; products: string; owner: string; quotationId: number | null;
};
const EMPTY: Deal = {
  customerId: null, contactId: null, title: "", value: "", probability: String(STAGE_PROBABILITY.new), stage: "new", expectedClose: "", source: "existing",
  lostReason: "", lostNote: "", notes: "", products: "", owner: "", quotationId: null,
};
const toDeal = (o: any): Deal => ({
  id: o.id, customerId: o.customerId, contactId: o.contactId ?? null, title: o.title, value: String(o.value || ""), probability: String(o.probability),
  stage: o.stage, expectedClose: o.expectedClose ?? "", source: o.source ?? "", lostReason: o.lostReason ?? "", lostNote: o.lostNote ?? "",
  notes: o.notes ?? "", products: o.products ?? "", owner: o.owner ?? "", quotationId: o.quotationId,
});

const FLOW = [
  { t: "Зделка", i: Handshake }, { t: "Понуда", i: FileText }, { t: "Нарачка", i: Users }, { t: "Испратница", i: Truck }, { t: "Фактура", i: Calculator },
];

/** Зделки: pipeline (kanban со drag & drop) + листа; секоја зделка е поврзана со фирма и контакт. */
export default function Crm() {
  const utils = trpc.useUtils();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<"board" | "list">(() => (localStorage.getItem("crm-deals-view") === "list" ? "list" : "board"));
  const [showClosed, setShowClosed] = useState(false);
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("");
  const { data: opps, isLoading } = trpc.crm.oppList.useQuery({ includeClosed: view === "list" ? showClosed : true });
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const { data: rep } = trpc.crm.crmReport.useQuery({ from: yearStart, to: new Date().toISOString().slice(0, 10) });
  const [edit, setEdit] = useState<Deal | null>(null);
  const [lostFor, setLostFor] = useState<{ id: number; title: string } | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(() => { try { return localStorage.getItem(HELP_KEY) !== "1"; } catch { return true; } });
  const move = trpc.crm.dealMove.useMutation({
    onSuccess: () => utils.crm.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => { localStorage.setItem("crm-deals-view", view); }, [view]);
  // ?deal=ID отвора зделка; ?new=1&customerId=… нова за фирма
  const dealParam = params.get("deal");
  const { data: linked } = trpc.crm.oppList.useQuery({ id: Number(dealParam) }, { enabled: !!dealParam && !edit });
  useEffect(() => {
    if (dealParam && linked?.[0] && !edit) setEdit(toDeal(linked[0]));
  }, [dealParam, linked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (params.get("new") === "1") {
      setEdit({ ...EMPTY, customerId: params.get("customerId") ? Number(params.get("customerId")) : null, contactId: params.get("contactId") ? Number(params.get("contactId")) : null });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const closeDialog = () => {
    setEdit(null);
    if (params.has("deal") || params.has("new")) { const n = new URLSearchParams(params); n.delete("deal"); n.delete("new"); n.delete("customerId"); n.delete("contactId"); setParams(n, { replace: true }); }
  };

  const owners = useMemo(() => Array.from(new Set((opps ?? []).map((o) => o.owner).filter(Boolean))) as string[], [opps]);
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (opps ?? []).filter((o) => (!owner || o.owner === owner) && (!s || `${o.title} ${o.customer ?? ""} ${o.contact ?? ""} ${o.products ?? ""}`.toLowerCase().includes(s)));
  }, [opps, search, owner]);
  const open = filtered.filter((o) => OPEN_STAGES.includes(o.stage as DealStage));
  const weighted = (rep?.pipeline ?? []).reduce((s, p) => s + p.weighted, 0);

  const dismissHelp = () => { setHelpOpen(false); try { localStorage.setItem(HELP_KEY, "1"); } catch { /* */ } };
  const onDrop = (stage: DealStage) => {
    const id = dragId; setDragId(null); setOverStage(null);
    if (!id) return;
    const d = (opps ?? []).find((o) => o.id === id);
    if (!d || d.stage === stage) return;
    if (stage === "lost") { setLostFor({ id, title: d.title }); return; }
    move.mutate({ id, stage }, { onSuccess: () => toast.success(stage === "won" ? `🎉 Добиена: ${d.title}` : `${d.title} → ${DEAL_STAGE_LABEL[stage]}`) });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Зделки"
        description="Pipeline на продажбата: секоја зделка е за фирма и контакт лице, со вредност, фаза и следен чекор кон понуда → нарачка → фактура."
        icon={<Handshake className="h-6 w-6 text-primary" />}
        actions={
          <div className="flex flex-wrap gap-2">
            {!helpOpen && <Button variant="outline" size="sm" onClick={() => setHelpOpen(true)}><Info className="h-4 w-4 mr-1" />Како работи</Button>}
            <Button onClick={() => setEdit({ ...EMPTY })}><Plus className="h-4 w-4 mr-1.5" />Нова зделка</Button>
          </div>
        }
      />

      {helpOpen && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 space-y-3 relative">
            <button type="button" className="absolute right-3 top-3 text-muted-foreground hover:text-foreground" onClick={dismissHelp} aria-label="Затвори"><X className="h-4 w-4" /></button>
            <p className="text-sm text-foreground/90 pr-6">
              <b>Зделка</b> = „оваа фирма сака нешто од нас“. Влечете ја картичката низ фазите (drag &amp; drop); кога сте спремни — <b>Направи понуда</b> од картичката.
              Кога понудата ќе стане нарачка, зделката автоматски е <b>Добиена</b>.
            </p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {FLOW.map((s, i) => { const I = s.i; return (
                <span key={s.t} className="inline-flex items-center gap-1.5">
                  {i > 0 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 font-medium"><I className="h-3.5 w-3.5 text-primary" />{s.t}</span>
                </span>
              ); })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Отворени зделки" value={String(open.length)} sub={fmtMoney(open.reduce((s, o) => s + o.value, 0))} />
        <Kpi label="Пондерирано" value={fmtMoney(weighted)} />
        <Kpi label="Win-rate (год.)" value={rep?.deals.winRate == null ? "—" : `${Math.round(rep.deals.winRate * 100)}%`} sub={`${rep?.deals.won ?? 0} добиени / ${rep?.deals.lost ?? 0} изгубени`} />
        <Kpi label="Просечно до затворање" value={rep?.deals.avgDaysToClose == null ? "—" : `${rep.deals.avgDaysToClose} дена`} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border bg-card p-0.5">
          <Button size="sm" variant={view === "board" ? "default" : "ghost"} className="h-8" onClick={() => setView("board")}><LayoutGrid className="h-4 w-4 mr-1" />Pipeline</Button>
          <Button size="sm" variant={view === "list" ? "default" : "ghost"} className="h-8" onClick={() => setView("list")}><List className="h-4 w-4 mr-1" />Листа</Button>
        </div>
        <div className="relative flex-1 min-w-[12rem] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9 h-9" placeholder="Пребарај зделка, фирма, контакт…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={owner || "all"} onValueChange={(v) => setOwner(v === "all" ? "" : v)}>
          <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Продавач" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Сите продавачи</SelectItem>{owners.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
        {view === "list" && (
          <label className="text-sm flex items-center gap-1.5"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />и затворени</label>
        )}
      </div>

      {!isLoading && !(opps ?? []).length ? (
        <Card><CardContent className="p-0">
          <EmptyState title="Нема зделки"
            description="Започнете со „Нова зделка“: изберете фирма и контакт лице, опишете што бара и очекувана вредност. Потоа од картичката направете понуда."
            action={<Button onClick={() => setEdit({ ...EMPTY })}><Plus className="h-4 w-4 mr-1.5" />Додај прва зделка</Button>} />
        </CardContent></Card>
      ) : view === "board" ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {OPEN_STAGES.map((st) => {
              const list = filtered.filter((o) => o.stage === st);
              return (
                <div key={st}
                  onDragOver={(e) => { e.preventDefault(); setOverStage(st); }}
                  onDragLeave={() => setOverStage((s) => (s === st ? null : s))}
                  onDrop={() => onDrop(st)}
                  className={`rounded-xl border p-2 space-y-2 min-h-[10rem] transition-colors ${STAGE_TONE[st]} ${overStage === st ? "ring-2 ring-primary" : ""}`}>
                  <p className="text-xs font-semibold px-1 flex justify-between">
                    <span>{DEAL_STAGE_LABEL[st]}</span>
                    <span className="text-muted-foreground">{list.length} · {fmtMoney(list.reduce((s, o) => s + o.value, 0))}</span>
                  </p>
                  {list.map((o) => (
                    <div key={o.id} draggable
                      onDragStart={(e) => { setDragId(o.id); e.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => { setDragId(null); setOverStage(null); }}
                      onClick={() => setEdit(toDeal(o))}
                      className={`cursor-grab active:cursor-grabbing rounded-lg bg-card border px-2.5 py-2 hover:border-primary/40 shadow-sm ${dragId === o.id ? "opacity-50" : ""}`}>
                      <p className="text-sm font-medium leading-tight text-foreground">{o.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        <span className="font-medium text-foreground/80">{o.customer ?? "—"}</span>{o.contact ? ` · ${o.contact}` : ""}
                        {o.files ? <span className="ml-1"><Paperclip className="inline h-3 w-3" />{o.files}</span> : null}
                      </p>
                      <p className="text-xs mt-1 flex justify-between">
                        <span className="font-semibold text-foreground">{fmtMoney(o.value, o.currency)}</span>
                        <span className={`${o.expectedClose && o.expectedClose < new Date().toISOString().slice(0, 10) ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>{o.probability}%{o.expectedClose ? ` · ${fmtD(o.expectedClose)}` : ""}</span>
                      </p>
                      <div className="flex justify-between text-[11px] text-muted-foreground mt-0.5">
                        <span>{o.quoteNumber ? `понуда ${o.quoteNumber}` : ""}</span><span>{o.owner ?? ""}</span>
                      </div>
                    </div>
                  ))}
                  {!list.length && <p className="text-[11px] text-muted-foreground text-center py-6">Довлечи зделка тука</p>}
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(["won", "lost"] as const).map((st) => (
              <div key={st}
                onDragOver={(e) => { e.preventDefault(); setOverStage(st); }}
                onDragLeave={() => setOverStage((s) => (s === st ? null : s))}
                onDrop={() => onDrop(st)}
                className={`rounded-xl border-2 border-dashed p-3 text-sm flex items-center justify-center gap-2 ${STAGE_TONE[st]} ${overStage === st ? "ring-2 ring-primary" : ""}`}>
                {st === "won" ? <Trophy className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                {st === "won" ? "Довлечи тука → Добиена" : "Довлечи тука → Изгубена"}
                <span className="text-xs text-muted-foreground">({filtered.filter((o) => o.stage === st).length})</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <Card><CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-muted-foreground border-b">
              <th className="text-left font-medium p-2">Зделка</th><th className="text-left font-medium">Фирма</th><th className="text-left font-medium">Контакт</th>
              <th className="text-left font-medium">Фаза</th><th className="text-right font-medium">Вредност</th><th className="text-right font-medium">%</th>
              <th className="text-left font-medium pl-3">Затворање</th><th className="text-left font-medium">Продавач</th><th className="text-left font-medium">Понуда</th>
            </tr></thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id} className="border-b last:border-0 hover:bg-muted/40 cursor-pointer" onClick={() => setEdit(toDeal(o))}>
                  <td className="p-2 font-medium">{o.title}</td>
                  <td>{o.customerId ? <Link className="text-primary hover:underline" to={`/crm/firmi/${o.customerId}`} onClick={(e) => e.stopPropagation()}>{o.customer}</Link> : "—"}</td>
                  <td>{o.contact ?? "—"}</td>
                  <td><StageBadge stage={o.stage} /></td>
                  <td className="text-right tabular-nums">{fmtMoney(o.value, o.currency)}</td>
                  <td className="text-right tabular-nums">{o.probability}</td>
                  <td className="pl-3">{fmtD(o.expectedClose)}</td>
                  <td>{o.owner ?? ""}</td>
                  <td>{o.quoteNumber ?? ""}</td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan={9} className="text-center text-muted-foreground py-8">Нема зделки за филтерот</td></tr>}
            </tbody>
          </table>
        </CardContent></Card>
      )}

      {edit && <DealDialog deal={edit} onClose={closeDialog} />}
      {lostFor && <LostDialog deal={lostFor} onClose={() => setLostFor(null)} />}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card><CardContent className="p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </CardContent></Card>
  );
}

function LostDialog({ deal, onClose }: { deal: { id: number; title: string }; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const move = trpc.crm.dealMove.useMutation({
    onSuccess: () => { toast.success("Зделката е означена како изгубена"); utils.crm.invalidate(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>Изгубена: {deal.title}</DialogTitle>
        <div className="space-y-2 text-sm">
          <Label className="text-xs">Зошто е изгубена *</Label>
          <Select value={reason || "none"} onValueChange={(v) => setReason(v === "none" ? "" : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="none">— избери —</SelectItem>{Object.entries(LOST).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select>
          <Textarea rows={2} placeholder="Белешка (пр. конкурентот 10% поевтин)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose}>Откажи</Button>
            <Button disabled={!reason || move.isPending} onClick={() => move.mutate({ id: deal.id, stage: "lost", lostReason: reason, lostNote: note || null })}>Означи изгубена</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DealDialog({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const [f, setF] = useState<Deal>(deal);
  const [newFirm, setNewFirm] = useState<null | { name: string; edb: string; phone: string; email: string }>(null);
  const [newContact, setNewContact] = useState<null | { name: string; position: string; email: string; phone: string }>(null);
  const [lostOpen, setLostOpen] = useState(false);
  const { data: firms } = trpc.crm.firmList.useQuery();
  const { data: contacts } = trpc.crm.contactList.useQuery({ customerId: f.customerId! }, { enabled: !!f.customerId });
  const { data: acts } = trpc.crm.activityFeedList.useQuery({ opportunityId: deal.id ?? -1 }, { enabled: !!deal.id });
  const { data: files } = trpc.crm.oppFiles.useQuery({ id: deal.id ?? -1 }, { enabled: !!deal.id });
  const { data: timeline } = trpc.crm.oppTimeline.useQuery({ id: deal.id! }, { enabled: !!deal.id });
  const firmItems = useMemo(() => (firms ?? []).map((c) => ({ id: c.id, label: c.name, sub: [c.city, c.edb].filter(Boolean).join(" · ") || null })), [firms]);
  const firm = (firms ?? []).find((c) => c.id === f.customerId);

  // при избор на фирма: главен контакт и одговорен продавач
  useEffect(() => {
    if (!contacts || f.contactId) return;
    const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
    if (primary && !deal.id) setF((p) => ({ ...p, contactId: primary.id }));
  }, [contacts]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (firm?.owner && !f.owner && !deal.id) setF((p) => ({ ...p, owner: firm.owner! })); }, [firm?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = trpc.crm.oppSave.useMutation({
    onSuccess: () => { toast.success("Зделката е зачувана"); utils.crm.invalidate(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  const toQuote = trpc.crm.oppToQuotation.useMutation({
    onSuccess: (r) => { toast.success(r.existing ? "Понудата веќе постои — ја отвораме" : `Креирана понуда ${r.quoteNumber}`); utils.crm.invalidate(); onClose(); navigate(`/ponudi?open=${r.id}`); },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.crm.oppDelete.useMutation({ onSuccess: () => { toast.success("Избришано"); utils.crm.invalidate(); onClose(); }, onError: (e) => toast.error(e.message) });
  const move = trpc.crm.dealMove.useMutation({ onSuccess: () => { utils.crm.invalidate(); toast.success("🎉 Зделката е добиена"); onClose(); }, onError: (e) => toast.error(e.message) });
  const createFirm = trpc.crm.firmSave.useMutation({
    onSuccess: (r) => { utils.crm.firmList.invalidate(); utils.customers.customerList.invalidate(); setF((p) => ({ ...p, customerId: r.id, contactId: null })); setNewFirm(null); toast.success("Фирмата е додадена"); },
    onError: (e) => toast.error(e.message),
  });
  const createContact = trpc.crm.contactSave.useMutation({
    onSuccess: (r) => { utils.crm.contactList.invalidate(); setF((p) => ({ ...p, contactId: r.id })); setNewContact(null); toast.success("Контактот е додаден"); },
    onError: (e) => toast.error(e.message),
  });

  const payload = () => ({
    id: f.id, customerId: f.customerId!, contactId: f.contactId, title: f.title.trim(), value: parseFloat(f.value.replace(",", ".")) || 0,
    probability: Math.max(0, Math.min(100, parseInt(f.probability) || 0)), stage: f.stage, expectedClose: f.expectedClose || null,
    source: f.source || undefined, lostReason: f.lostReason || null, lostNote: f.lostNote || null, quotationId: f.quotationId,
    owner: f.owner || undefined, notes: f.notes || undefined, products: f.products || undefined,
  });
  const next = timeline?.next;
  const closed = f.stage === "won" || f.stage === "lost";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogTitle className="flex items-center gap-2 flex-wrap">
          <Handshake className="h-5 w-5 text-primary" />{f.id ? f.title || "Зделка" : "Нова зделка"}{f.id && <StageBadge stage={f.stage} />}
        </DialogTitle>

        {f.id && next && next.action !== "lost" && next.action !== "done" && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
            <p className="text-sm">Следен чекор: <b>{next.label}</b></p>
            {next.action === "create_quote"
              ? <Button size="sm" disabled={toQuote.isPending} onClick={() => toQuote.mutate({ opportunityId: f.id! })}><FileText className="h-4 w-4 mr-1" />{next.label}</Button>
              : next.href && <Button size="sm" onClick={() => { onClose(); navigate(next.href!); }}>{next.label}<ArrowRight className="h-4 w-4 ml-1" /></Button>}
          </div>
        )}

        <div className="grid md:grid-cols-[1fr_20rem] gap-4">
          <div className="grid grid-cols-2 gap-2 text-sm content-start">
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Фирма *</Label>
              <div className="flex gap-2">
                <div className="flex-1 min-w-0"><SearchPick items={firmItems} value={f.customerId} onChange={(v) => setF({ ...f, customerId: v, contactId: null })} placeholder="Избери фирма…" /></div>
                <Button type="button" variant="outline" className="shrink-0" onClick={() => setNewFirm({ name: "", edb: "", phone: "", email: "" })}>Нова фирма</Button>
              </div>
              {firm && <p className="text-xs text-muted-foreground"><Link className="text-primary hover:underline" to={`/crm/firmi/${firm.id}`} onClick={onClose}>Отвори 360° преглед на {firm.name}</Link>{firm.phone ? ` · ${firm.phone}` : ""}</p>}
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Контакт лице</Label>
              <div className="flex gap-2">
                <Select value={f.contactId ? String(f.contactId) : "none"} onValueChange={(v) => setF({ ...f, contactId: v === "none" ? null : Number(v) })} disabled={!f.customerId}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder={f.customerId ? "Избери контакт" : "Прво избери фирма"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— без контакт —</SelectItem>
                    {(contacts ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}{c.position ? ` · ${c.position}` : ""}{c.isPrimary ? " ★" : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" className="shrink-0" disabled={!f.customerId} onClick={() => setNewContact({ name: "", position: "", email: "", phone: "" })}>Нов контакт</Button>
              </div>
            </div>
            <div className="col-span-2 space-y-1"><Label className="text-xs">Наслов (што бара фирмата) *</Label><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="на пр. Ограда 40 m, ласерски рез 2 mm" /></div>
            <div className="col-span-2 space-y-1"><Label className="text-xs">Производ(и) / опис</Label><Input value={f.products} onChange={(e) => setF({ ...f, products: e.target.value })} placeholder="на пр. панел-ограда + порта" /></div>
            <div className="space-y-1"><Label className="text-xs">Вредност (ден)</Label><Input inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder="пр. 250000" /></div>
            <div className="space-y-1"><Label className="text-xs">Веројатност %</Label><Input inputMode="numeric" value={f.probability} onChange={(e) => setF({ ...f, probability: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Очекувано затворање</Label><DateInput value={f.expectedClose} onChange={(e) => setF({ ...f, expectedClose: e.target.value })} /></div>
            <div className="space-y-1">
              <Label className="text-xs">Продавач</Label>
              <Input list="crm-people-deal" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} placeholder="Одговорен комерцијалист" />
              <PeopleDatalist id="crm-people-deal" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Фаза</Label>
              <Select value={f.stage} onValueChange={(v) => setF({ ...f, stage: v as DealStage, probability: String(STAGE_PROBABILITY[v as DealStage]) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DEAL_STAGES.map((k) => <SelectItem key={k} value={k}>{DEAL_STAGE_LABEL[k]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Извор</Label>
              <Select value={f.source || "none"} onValueChange={(v) => setF({ ...f, source: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">—</SelectItem>{Object.entries(SOURCES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {f.stage === "lost" && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Зошто е изгубена *</Label>
                  <Select value={f.lostReason || "none"} onValueChange={(v) => setF({ ...f, lostReason: v === "none" ? "" : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="none">— избери —</SelectItem>{Object.entries(LOST).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Белешка за губењето</Label><Input value={f.lostNote} onChange={(e) => setF({ ...f, lostNote: e.target.value })} /></div>
              </>
            )}
            <div className="col-span-2 space-y-1"><Label className="text-xs">Белешка</Label><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Детали од разговорот…" /></div>
          </div>

          <div className="space-y-3">
            {f.id && (
              <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                <p className="text-xs font-semibold text-muted-foreground">Поврзани документи</p>
                {!timeline?.steps.length ? <p className="text-xs text-muted-foreground">Уште нема понуда.</p> : (
                  <ol className="space-y-1.5">
                    {timeline.steps.map((s: any) => (
                      <li key={`${s.kind}-${s.id}`} className="flex items-center justify-between gap-2 text-xs">
                        <span><b>{s.kind === "quote" ? "Понуда" : s.kind === "order" ? "Нарачка" : s.kind === "delivery" ? "Испратница" : "Фактура"}</b> {s.number}
                          <span className="text-muted-foreground"> · {s.kind === "quote" ? QUOTE_STATUS[s.status] ?? s.status : s.status}</span></span>
                        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => { onClose(); navigate(s.href); }}>Отвори</Button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
            {!!files?.length && (
              <div className="text-sm space-y-1"><p className="text-xs font-semibold text-muted-foreground">Прикачени датотеки</p>
                {files.map((x) => (
                  <button key={x.id} type="button" className="block text-primary hover:underline text-xs" onClick={() => {
                    const m = /^data:([^;]+);base64,(.*)$/s.exec(x.data);
                    openBase64(m ? m[2] : x.data, m ? m[1] : x.mime ?? "application/octet-stream");
                  }}><Paperclip className="inline h-3 w-3 mr-1" />{x.fileName}</button>
                ))}
              </div>
            )}
            {f.id && !closed && (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300" disabled={move.isPending} onClick={() => move.mutate({ id: f.id!, stage: "won" })}><Trophy className="h-4 w-4 mr-1" />Добиена</Button>
                <Button variant="outline" className="text-red-600" onClick={() => setLostOpen(true)}><XCircle className="h-4 w-4 mr-1" />Изгубена</Button>
              </div>
            )}
          </div>
        </div>

        {f.id && (
          <div className="border-t pt-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">Активности и задачи</p>
            <ActivityQuickAdd customerId={f.customerId} opportunityId={f.id} contacts={(contacts ?? []).map((c) => ({ id: c.id, name: c.name }))} />
            <ActivityTimeline rows={acts} showLinks={false} />
          </div>
        )}

        <div className="flex flex-wrap justify-between gap-2 pt-2">
          {f.id ? <Button variant="ghost" className="text-red-600" onClick={() => { if (confirm("Да се избрише зделката?")) del.mutate({ id: f.id! }); }}>Избриши</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Затвори</Button>
            <Button disabled={f.title.trim().length < 2 || !f.customerId || save.isPending || (f.stage === "lost" && !f.lostReason)} onClick={() => save.mutate(payload())}>Зачувај</Button>
          </div>
        </div>

        {newFirm && (
          <Dialog open onOpenChange={(o) => !o && setNewFirm(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogTitle>Брза нова фирма</DialogTitle>
              <div className="space-y-2 text-sm">
                <div className="space-y-1"><Label className="text-xs">Назив *</Label><Input value={newFirm.name} onChange={(e) => setNewFirm({ ...newFirm, name: e.target.value })} placeholder="пр. Метал Про ДООЕЛ" /></div>
                <div className="space-y-1"><Label className="text-xs">ЕДБ</Label><Input value={newFirm.edb} onChange={(e) => setNewFirm({ ...newFirm, edb: e.target.value })} placeholder="13 цифри" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1"><Label className="text-xs">Телефон</Label><Input value={newFirm.phone} onChange={(e) => setNewFirm({ ...newFirm, phone: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Е-пошта</Label><Input value={newFirm.email} onChange={(e) => setNewFirm({ ...newFirm, email: e.target.value })} /></div>
                </div>
                <Button className="w-full" disabled={newFirm.name.trim().length < 2 || createFirm.isPending}
                  onClick={() => createFirm.mutate({ name: newFirm.name.trim(), company: newFirm.name.trim(), edb: newFirm.edb || null, phone: newFirm.phone || null, email: newFirm.email || null })}>Додај и избери</Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
        {newContact && f.customerId && (
          <Dialog open onOpenChange={(o) => !o && setNewContact(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogTitle>Нов контакт за {firm?.name}</DialogTitle>
              <div className="space-y-2 text-sm">
                <div className="space-y-1"><Label className="text-xs">Име и презиме *</Label><Input value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Позиција</Label><Input value={newContact.position} onChange={(e) => setNewContact({ ...newContact, position: e.target.value })} placeholder="пр. Набавка, Управител" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1"><Label className="text-xs">Е-пошта</Label><Input value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Телефон</Label><Input value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} /></div>
                </div>
                <Button className="w-full" disabled={newContact.name.trim().length < 2 || createContact.isPending}
                  onClick={() => createContact.mutate({ customerId: f.customerId!, name: newContact.name.trim(), position: newContact.position || null, email: newContact.email || null, phone: newContact.phone || null, isPrimary: false })}>Додај и избери</Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
        {lostOpen && f.id && <LostDialog deal={{ id: f.id, title: f.title }} onClose={() => { setLostOpen(false); onClose(); }} />}
      </DialogContent>
    </Dialog>
  );
}
