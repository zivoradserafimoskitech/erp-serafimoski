// Маркетинг → Публика: контакти (клиенти + барања + CSV), согласност, одјавени (suppression), сегменти.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime, cn } from "@/lib/utils";
import { CONSENT_LABEL, CONSENT_STATUSES, CONTACT_SOURCE_LABEL, CONTACT_SOURCES, type ConsentStatus, type SegmentRules } from "@contracts/marketing-campaigns";
import { Users, RefreshCw, Upload, Search, Plus, ShieldOff, Send, Trash2, History, Filter } from "lucide-react";

const CONSENT_CLS: Record<ConsentStatus, string> = {
  none: "bg-slate-100 text-slate-700", pending: "bg-amber-100 text-amber-800", granted: "bg-emerald-100 text-emerald-800", withdrawn: "bg-red-100 text-red-800",
};
const ALL = "__all";

export default function Audience() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") ?? "contacts");
  const { data: stats } = trpc.campaigns.contactStats.useQuery();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Users className="h-6 w-6 text-primary" />
        <div className="flex-1 min-w-[12rem]">
          <h1 className="text-2xl font-bold">Публика</h1>
          <p className="text-sm text-muted-foreground">
            {stats ? <>{stats.total} контакти · {stats.byConsent.granted ?? 0} со согласност · {stats.byConsent.pending ?? 0} чекаат потврда · {stats.suppressed} одјавени</> : "Контакти за е-пошта кампањи"}
          </p>
        </div>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="contacts">Контакти</TabsTrigger>
          <TabsTrigger value="segments">Сегменти</TabsTrigger>
          <TabsTrigger value="suppressed">Одјавени</TabsTrigger>
        </TabsList>
        <TabsContent value="contacts"><Contacts initialSearch={params.get("q") ?? ""} /></TabsContent>
        <TabsContent value="segments"><Segments /></TabsContent>
        <TabsContent value="suppressed"><Suppressed /></TabsContent>
      </Tabs>
    </div>
  );
}

function Contacts({ initialSearch }: { initialSearch: string }) {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState(initialSearch);
  const [consent, setConsent] = useState(ALL);
  const [source, setSource] = useState(ALL);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [logFor, setLogFor] = useState<{ id: number; email: string } | null>(null);
  const [grantFor, setGrantFor] = useState<{ id: number; email: string } | null>(null);
  const { data: rows } = trpc.campaigns.contactList.useQuery({ search: search.trim() || undefined, consent: consent !== ALL ? (consent as ConsentStatus) : undefined, source: source !== ALL ? (source as any) : undefined });
  const inv = () => { utils.campaigns.contactList.invalidate(); utils.campaigns.contactStats.invalidate(); utils.campaigns.segmentList.invalidate(); };
  const sync = trpc.campaigns.audienceSync.useMutation({ onSuccess: (r) => { inv(); toast.success(`Нови: ${r.customers} од клиенти, ${r.leads} од барања`); }, onError: (e) => toast.error(e.message) });
  const setC = trpc.campaigns.contactConsentSet.useMutation({ onSuccess: () => { inv(); toast.success("Зачувано"); }, onError: (e) => toast.error(e.message) });
  const doi = trpc.campaigns.contactDoiSend.useMutation({ onSuccess: (r: any) => { inv(); toast.success(r.sent ? "Пратена е-пошта за потврда" : `Не е пратено: ${r.reason}`); }, onError: (e) => toast.error(e.message) });
  const del = trpc.campaigns.contactDelete.useMutation({ onSuccess: () => { inv(); toast.success("Избришано"); }, onError: (e) => toast.error(e.message) });

  return (
    <div className="space-y-3 pt-2">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Е-пошта, име, фирма, град…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={consent} onValueChange={setConsent}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>Секоја согласност</SelectItem>{CONSENT_STATUSES.map((c) => <SelectItem key={c} value={c}>{CONSENT_LABEL[c]}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={ALL}>Сите извори</SelectItem>{CONTACT_SOURCES.map((c) => <SelectItem key={c} value={c}>{CONTACT_SOURCE_LABEL[c]}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}><RefreshCw className={cn("mr-2 h-4 w-4", sync.isPending && "animate-spin")} />Од клиенти и барања</Button>
        <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="mr-2 h-4 w-4" />CSV увоз</Button>
        <Button variant="outline" onClick={() => setAddOpen(true)}><Plus className="mr-2 h-4 w-4" />Контакт</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Контакт</TableHead><TableHead>Град</TableHead><TableHead>Извор</TableHead><TableHead>Согласност</TableHead><TableHead className="w-56 text-right">Акции</TableHead></TableRow></TableHeader>
            <TableBody>
              {!rows?.length && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">Нема контакти. Кликни „Од клиенти и барања“ или увези CSV.</TableCell></TableRow>}
              {rows?.map((c) => (
                <TableRow key={c.id}>
                  <TableCell><div className="font-medium">{c.email}</div><div className="text-xs text-muted-foreground">{[c.name, c.company].filter(Boolean).join(" · ")}</div></TableCell>
                  <TableCell className="text-sm">{[c.city, c.country].filter(Boolean).join(", ")}</TableCell>
                  <TableCell className="text-sm">{CONTACT_SOURCE_LABEL[c.source as keyof typeof CONTACT_SOURCE_LABEL] ?? c.source}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("border-0", CONSENT_CLS[c.consentStatus])}>{c.suppressed && c.consentStatus !== "withdrawn" ? "Во листа за одјава" : CONSENT_LABEL[c.consentStatus]}</Badge>
                    {c.consentAt && c.consentStatus === "granted" && <div className="text-[11px] text-muted-foreground">{formatDate(c.consentAt)} · {c.consentSource}</div>}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="icon" variant="ghost" title="Историја на согласност" onClick={() => setLogFor({ id: c.id, email: c.email })}><History className="h-4 w-4" /></Button>
                    {c.consentStatus !== "granted" && !c.suppressed && <Button size="icon" variant="ghost" title="Прати барање за потврда (double opt-in)" onClick={() => doi.mutate({ id: c.id })}><Send className="h-4 w-4" /></Button>}
                    {c.consentStatus !== "granted" && <Button size="sm" variant="ghost" onClick={() => setGrantFor({ id: c.id, email: c.email })}>Согласност</Button>}
                    {c.consentStatus !== "withdrawn" && <Button size="icon" variant="ghost" title="Одјави" onClick={() => { if (confirm(`Да се одјави ${c.email}?`)) setC.mutate({ id: c.id, status: "withdrawn", note: "рачно" }); }}><ShieldOff className="h-4 w-4" /></Button>}
                    <Button size="icon" variant="ghost" className="text-red-600" title="Избриши (GDPR)" onClick={() => { if (confirm(`Трајно да се избрише ${c.email}? Адресата останува во листата за одјава.`)) del.mutate({ id: c.id }); }}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onDone={inv} />
      <AddContactDialog open={addOpen} onOpenChange={setAddOpen} onDone={inv} />
      {logFor && <ConsentLogDialog contact={logFor} onClose={() => setLogFor(null)} />}
      {grantFor && <GrantDialog contact={grantFor} onClose={() => setGrantFor(null)} onSave={(note) => { setC.mutate({ id: grantFor.id, status: "granted", note }); setGrantFor(null); }} />}
    </div>
  );
}

function GrantDialog({ contact, onClose, onSave }: { contact: { email: string }; onClose: () => void; onSave: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Согласност за {contact.email}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Внеси само ако имате изречна согласност (потпишана форма, писмена порака…). Се чува со датум и вашето име. Подобро: прати барање за потврда по е-пошта.</p>
        <Input autoFocus placeholder="Како е добиена (пр. „форма на саем 12.10.2026“)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Откажи</Button><Button disabled={note.trim().length < 3} onClick={() => onSave(note.trim())}>Зачувај</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function ConsentLogDialog({ contact, onClose }: { contact: { id: number; email: string }; onClose: () => void }) {
  const { data } = trpc.campaigns.contactConsentLogList.useQuery({ contactId: contact.id });
  const A: Record<string, string> = { granted: "Согласност", pending: "Чека потврда", confirmed: "Потврдено", withdrawn: "Одјава", imported: "Додаден" };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Историја на согласност — {contact.email}</DialogTitle></DialogHeader>
        <ol className="space-y-2 text-sm">
          {!data?.length && <li className="text-muted-foreground">Нема записи</li>}
          {data?.map((e) => (
            <li key={e.id} className="rounded border px-3 py-2">
              <div className="flex justify-between"><b>{A[e.action] ?? e.action}</b><span className="text-xs text-muted-foreground">{formatDateTime(e.at)}</span></div>
              <div className="text-xs text-muted-foreground">{[e.source, e.note, e.by, e.ip].filter(Boolean).join(" · ")}</div>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [csv, setCsv] = useState("");
  const [consent, setConsent] = useState(false);
  const [note, setNote] = useState("");
  const imp = trpc.campaigns.contactImportCsv.useMutation({
    onSuccess: (r) => { onDone(); toast.success(`Додадени ${r.added}, ажурирани ${r.updated}, со согласност ${r.consented}, прескокнати (одјавени) ${r.skipped}${r.errors.length ? ` · ${r.errors.length} грешки` : ""}`); if (!r.errors.length) { onOpenChange(false); setCsv(""); } },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Увоз на контакти од CSV</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Колони (прв ред): <code>email, име, фирма, град, држава, телефон, согласност</code> — запирка или точка-запирка. Адресите од листата за одјава се прескокнуваат.</p>
          <Input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
          <Textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"email,име,фирма,град\nmarko@firma.mk,Марко Петровски,Фирма ДОО,Скопје"} className="font-mono text-xs" />
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>Сите во листата дале <b>изречна согласност</b> за маркетинг е-пошта (иначе остануваат „без согласност“ и може да им пратите барање за потврда).</span></label>
          {consent && <Input placeholder="Извор на согласноста (пр. „пријави од саем Техномама 2026“)" value={note} onChange={(e) => setNote(e.target.value)} />}
          {imp.data?.errors?.length ? <div className="max-h-32 overflow-auto rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">{imp.data.errors.map((e) => <div key={e}>{e}</div>)}</div> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Затвори</Button>
            <Button disabled={!csv.trim() || imp.isPending || (consent && note.trim().length < 3)} onClick={() => imp.mutate({ csv, consent, note: note.trim() || undefined })}>Увези</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddContactDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [f, setF] = useState({ email: "", name: "", company: "", city: "", country: "" });
  const save = trpc.campaigns.contactSave.useMutation({ onSuccess: () => { onDone(); onOpenChange(false); setF({ email: "", name: "", company: "", city: "", country: "" }); toast.success("Додадено — без согласност додека не потврди"); }, onError: (e) => toast.error(e.message) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Нов контакт</DialogTitle></DialogHeader>
        <div className="grid gap-2">
          {(["email", "name", "company", "city", "country"] as const).map((k) => (
            <div key={k} className="space-y-1"><Label>{{ email: "Е-пошта", name: "Име", company: "Фирма", city: "Град", country: "Држава" }[k]}</Label><Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
          ))}
          <div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Откажи</Button><Button disabled={!f.email.trim() || save.isPending} onClick={() => save.mutate({ email: f.email, name: f.name || null, company: f.company || null, city: f.city || null, country: f.country || null })}>Додај</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Suppressed() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [add, setAdd] = useState("");
  const { data } = trpc.campaigns.suppressionList.useQuery({ search: search.trim() || undefined });
  const { data: me } = trpc.appUsers.appUsersMe.useQuery();
  const inv = () => { utils.campaigns.suppressionList.invalidate(); utils.campaigns.contactStats.invalidate(); utils.campaigns.contactList.invalidate(); };
  const addM = trpc.campaigns.suppressionAdd.useMutation({ onSuccess: (r) => { inv(); setAdd(""); toast.success(`Додадени ${r.added}`); }, onError: (e) => toast.error(e.message) });
  const delM = trpc.campaigns.suppressionDelete.useMutation({ onSuccess: inv, onError: (e) => toast.error(e.message) });
  const R: Record<string, string> = { unsubscribe: "Одјава", bounce: "Неважечка адреса", complaint: "Пријава за спам", manual: "Рачно" };
  return (
    <div className="space-y-3 pt-2">
      <p className="text-sm text-muted-foreground">На овие адреси никогаш не се праќаат кампањи — ниту по повторен увоз. Одјавата од пораката (вклучително „Unsubscribe“ во Gmail/Outlook) ги додава автоматски.</p>
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Пребарај…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex-1" />
        <Input className="max-w-sm" placeholder="Додај адреси (одделени со запирка)" value={add} onChange={(e) => setAdd(e.target.value)} />
        <Button variant="outline" disabled={!add.trim()} onClick={() => addM.mutate({ emails: add, reason: "manual" })}>Додај</Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Е-пошта</TableHead><TableHead>Причина</TableHead><TableHead>Кампања</TableHead><TableHead>Датум</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
          <TableBody>
            {!data?.length && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Празно</TableCell></TableRow>}
            {data?.map((s) => (
              <TableRow key={s.email}>
                <TableCell>{s.email}</TableCell><TableCell>{R[s.reason] ?? s.reason}{s.note ? <span className="text-xs text-muted-foreground"> · {s.note}</span> : null}</TableCell>
                <TableCell className="text-sm">{s.campaign ?? ""}</TableCell><TableCell className="text-sm">{formatDateTime(s.createdAt)}</TableCell>
                <TableCell>{(me?.role ?? "admin") === "admin" && <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Да се отстрани ${s.email} од листата? Само ако лицето побарало повторно да добива пораки.`)) delM.mutate({ email: s.email }); }}>Отстрани</Button>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

const EMPTY_RULES: SegmentRules = { consent: "granted" };

function Segments() {
  const utils = trpc.useUtils();
  const { data } = trpc.campaigns.segmentList.useQuery();
  const [edit, setEdit] = useState<{ id?: number; name: string; rules: SegmentRules } | null>(null);
  const del = trpc.campaigns.segmentDelete.useMutation({ onSuccess: () => utils.campaigns.segmentList.invalidate() });
  return (
    <div className="space-y-3 pt-2">
      <div className="flex justify-end"><Button onClick={() => setEdit({ name: "", rules: EMPTY_RULES })}><Plus className="mr-2 h-4 w-4" />Нов сегмент</Button></div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Сегмент</TableHead><TableHead>Правила</TableHead><TableHead className="text-right">Контакти</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
          <TableBody>
            {!data?.length && <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">Нема сегменти. Пр. „Скопје, купиле огради, без нарачка 6 месеци“.</TableCell></TableRow>}
            {data?.map((s) => (
              <TableRow key={s.id} className="cursor-pointer" onClick={() => setEdit({ id: s.id, name: s.name, rules: s.rules })}>
                <TableCell className="font-medium">{s.name}</TableCell><TableCell className="text-sm text-muted-foreground">{describeRules(s.rules)}</TableCell>
                <TableCell className="text-right tabular-nums">{s.count}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}><Button size="icon" variant="ghost" className="text-red-600" onClick={() => { if (confirm("Да се избрише сегментот?")) del.mutate({ id: s.id }); }}><Trash2 className="h-4 w-4" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent></Card>
      {edit && <SegmentDialog seg={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

export function describeRules(r: SegmentRules) {
  const p: string[] = [r.consent === "granted" ? "со согласност" : "согласност + клиенти"];
  if (r.cities?.length) p.push(`град: ${r.cities.join(", ")}`);
  if (r.countries?.length) p.push(`држава: ${r.countries.join(", ")}`);
  if (r.categories?.length) p.push(`купиле: ${r.categories.join(", ")}`);
  if (r.lastOrderFrom || r.lastOrderTo) p.push(`последна нарачка ${r.lastOrderFrom ?? "…"} – ${r.lastOrderTo ?? "…"}`);
  if (r.noOrderDays) p.push(`без нарачка ${r.noOrderDays} дена`);
  if (r.minRevenue != null || r.maxRevenue != null) p.push(`промет ${r.minRevenue ?? 0} – ${r.maxRevenue ?? "∞"} ден.`);
  if (r.sources?.length) p.push(`извор: ${r.sources.map((s) => CONTACT_SOURCE_LABEL[s]).join(", ")}`);
  return p.join(" · ");
}

function Chips({ options, value, onChange, placeholder }: { options: string[]; value: string[] | undefined; onChange: (v: string[] | undefined) => void; placeholder: string }) {
  const [txt, setTxt] = useState("");
  const v = value ?? [];
  const addVal = (x: string) => { const t = x.trim(); if (t && !v.includes(t)) onChange([...v, t]); setTxt(""); };
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">{v.map((x) => <Badge key={x} variant="secondary" className="cursor-pointer" onClick={() => onChange(v.filter((y) => y !== x).length ? v.filter((y) => y !== x) : undefined)}>{x} ×</Badge>)}</div>
      <Input list={`dl-${placeholder}`} value={txt} placeholder={placeholder} onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addVal(txt); } }} onBlur={() => txt && addVal(txt)} />
      <datalist id={`dl-${placeholder}`}>{options.map((o) => <option key={o} value={o} />)}</datalist>
    </div>
  );
}

function SegmentDialog({ seg, onClose }: { seg: { id?: number; name: string; rules: SegmentRules }; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(seg.name);
  const [r, setR] = useState<SegmentRules>(seg.rules);
  const [debounced, setDebounced] = useState(r);
  useEffect(() => { const t = setTimeout(() => setDebounced(r), 400); return () => clearTimeout(t); }, [r]);
  const { data: opts } = trpc.campaigns.segmentOptionsGet.useQuery();
  const { data: prev, isFetching } = trpc.campaigns.segmentPreview.useQuery({ rules: debounced });
  const save = trpc.campaigns.segmentSave.useMutation({ onSuccess: () => { utils.campaigns.segmentList.invalidate(); onClose(); toast.success("Зачувано"); }, onError: (e) => toast.error(e.message) });
  const numOrU = (s: string) => (s === "" ? undefined : Number(s));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Filter className="h-5 w-5" />{seg.id ? "Сегмент" : "Нов сегмент"}</DialogTitle></DialogHeader>
        <div className="grid gap-5 md:grid-cols-[1fr_16rem]">
          <div className="space-y-3">
            <div className="space-y-1"><Label>Име</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="пр. Скопје — огради — неактивни 6 мес." /></div>
            <div className="space-y-1">
              <Label>Согласност</Label>
              <Select value={r.consent} onValueChange={(v) => setR({ ...r, consent: v as SegmentRules["consent"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="granted">Само со изречна согласност</SelectItem><SelectItem value="granted_or_customer">Со согласност + постоечки клиенти (soft opt-in)</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label>Град</Label><Chips options={opts?.cities ?? []} value={r.cities} onChange={(v) => setR({ ...r, cities: v })} placeholder="Скопје" /></div>
              <div className="space-y-1"><Label>Држава</Label><Chips options={opts?.countries ?? []} value={r.countries} onChange={(v) => setR({ ...r, countries: v })} placeholder="Македонија" /></div>
            </div>
            <div className="space-y-1"><Label>Купиле производи од категорија</Label><Chips options={opts?.categories ?? []} value={r.categories} onChange={(v) => setR({ ...r, categories: v })} placeholder="категорија" /></div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1"><Label>Последна нарачка од</Label><Input type="date" value={r.lastOrderFrom ?? ""} onChange={(e) => setR({ ...r, lastOrderFrom: e.target.value || undefined })} /></div>
              <div className="space-y-1"><Label>до</Label><Input type="date" value={r.lastOrderTo ?? ""} onChange={(e) => setR({ ...r, lastOrderTo: e.target.value || undefined })} /></div>
              <div className="space-y-1"><Label>Без нарачка (дена)</Label><Input type="number" min={1} value={r.noOrderDays ?? ""} onChange={(e) => setR({ ...r, noOrderDays: numOrU(e.target.value) })} placeholder="пр. 180" /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label>Фактурирано мин. (ден., без ДДВ)</Label><Input type="number" min={0} value={r.minRevenue ?? ""} onChange={(e) => setR({ ...r, minRevenue: numOrU(e.target.value) })} /></div>
              <div className="space-y-1"><Label>макс.</Label><Input type="number" min={0} value={r.maxRevenue ?? ""} onChange={(e) => setR({ ...r, maxRevenue: numOrU(e.target.value) })} /></div>
            </div>
            <div className="space-y-1">
              <Label>Извор на контактот</Label>
              <div className="flex flex-wrap gap-3 text-sm">{CONTACT_SOURCES.map((s) => (
                <label key={s} className="flex items-center gap-1"><input type="checkbox" checked={!!r.sources?.includes(s)} onChange={(e) => { const cur = r.sources ?? []; const nx = e.target.checked ? [...cur, s] : cur.filter((x) => x !== s); setR({ ...r, sources: nx.length ? nx : undefined }); }} />{CONTACT_SOURCE_LABEL[s]}</label>
              ))}</div>
            </div>
          </div>
          <aside className="space-y-2">
            <div className="rounded-md border p-3 text-center"><div className="text-3xl font-bold tabular-nums">{isFetching ? "…" : prev?.count ?? 0}</div><div className="text-xs text-muted-foreground">контакти одговараат</div></div>
            <ul className="space-y-1 text-xs">{prev?.sample.map((s) => <li key={s.email} className="truncate">{s.email}{s.city ? ` · ${s.city}` : ""}</li>)}</ul>
            <p className="text-[11px] text-muted-foreground">Одјавените и адресите од листата за одјава секогаш се исклучени.</p>
          </aside>
        </div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Откажи</Button><Button disabled={name.trim().length < 2 || save.isPending} onClick={() => save.mutate({ id: seg.id, name: name.trim(), rules: r })}>Зачувај</Button></div>
      </DialogContent>
    </Dialog>
  );
}
