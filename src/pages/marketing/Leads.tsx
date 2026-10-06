// Маркетинг → Барања: барања за понуда од веб-формата (извор/кампања, прилози, статус, претворање во понуда).
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, cn } from "@/lib/utils";
import { openBase64 } from "@/lib/stored-file";
import { LEAD_STATUSES, LEAD_STATUS_LABEL, CHANNELS, CHANNEL_LABEL, type LeadStatus, type Channel } from "@contracts/marketing";
import { Inbox, Search, Settings2, Paperclip, Mail, Phone, ArrowRight, FileText, Send, Trash2, ShieldAlert, ExternalLink } from "lucide-react";

const STATUS_CLS: Record<LeadStatus, string> = {
  new: "bg-blue-100 text-blue-800 border-blue-200",
  contacted: "bg-amber-100 text-amber-800 border-amber-200",
  quoted: "bg-violet-100 text-violet-800 border-violet-200",
  won: "bg-emerald-100 text-emerald-800 border-emerald-200",
  lost: "bg-slate-100 text-slate-700 border-slate-200",
  spam: "bg-red-100 text-red-800 border-red-200",
};
const chLabel = (c: string | null | undefined) => CHANNEL_LABEL[(c ?? "other") as Channel] ?? c ?? "—";
const ALL = "__all";
const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);

export function StatusBadge({ status }: { status: LeadStatus }) {
  return <Badge variant="outline" className={cn("font-medium", STATUS_CLS[status])}>{LEAD_STATUS_LABEL[status] ?? status}</Badge>;
}

export default function Leads() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<string>(ALL);
  const [channel, setChannel] = useState<string>(ALL);
  const [campaign, setCampaign] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const id = Number(params.get("id"));
    if (id) { setOpenId(id); params.delete("id"); setParams(params, { replace: true }); }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const filter = {
    status: status !== ALL ? (status as LeadStatus) : undefined,
    channel: channel !== ALL ? (channel as Channel) : undefined,
    campaign: campaign !== ALL ? campaign : undefined,
    search: search.trim() || undefined,
  };
  const { data: leads, isLoading } = trpc.marketing.leadList.useQuery(filter);
  const { data: counts } = trpc.marketing.leadCounts.useQuery();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Inbox className="h-6 w-6 text-primary" />
        <div className="flex-1 min-w-[12rem]">
          <h1 className="text-2xl font-bold">Барања</h1>
          <p className="text-sm text-muted-foreground">Барања за понуда од веб-страницата — со извор, кампања и прилози.</p>
        </div>
        <Button variant="outline" onClick={() => setSettingsOpen(true)}><Settings2 className="mr-2 h-4 w-4" />Поставки и вградување</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setStatus(ALL)} className={cn("rounded-full border px-3 py-1 text-sm", status === ALL ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
          Отворени <span className="ml-1 opacity-70">{counts?.open ?? 0}</span>
        </button>
        {LEAD_STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={cn("rounded-full border px-3 py-1 text-sm", status === s ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
            {LEAD_STATUS_LABEL[s]} <span className="ml-1 opacity-70">{counts?.byStatus?.[s] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Име, фирма, е-пошта, телефон, производ…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={channel} onValueChange={setChannel}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Извор" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Сите извори</SelectItem>
            {CHANNELS.map((c) => <SelectItem key={c} value={c}>{CHANNEL_LABEL[c]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={campaign} onValueChange={setCampaign}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Кампања" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Сите кампањи</SelectItem>
            {(counts?.campaigns ?? []).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Примено</TableHead>
                <TableHead>Контакт</TableHead>
                <TableHead>Производ / количина</TableHead>
                <TableHead>Извор / кампања</TableHead>
                <TableHead className="text-center">Прилози</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Понуда</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Се вчитува…</TableCell></TableRow>}
              {!isLoading && !leads?.length && (
                <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  Нема барања. Кога формата на веб-страницата ќе биде поврзана, барањата ќе се појавуваат тука (види „Поставки и вградување“).
                </TableCell></TableRow>
              )}
              {leads?.map((l) => (
                <TableRow key={l.id} className="cursor-pointer" onClick={() => setOpenId(l.id)}>
                  <TableCell className="whitespace-nowrap text-sm">{formatDateTime(l.createdAt)}</TableCell>
                  <TableCell>
                    <div className="font-medium">{l.company || l.name}</div>
                    <div className="text-xs text-muted-foreground">{l.company ? `${l.name} · ` : ""}{l.email}</div>
                  </TableCell>
                  <TableCell className="text-sm">{l.productType || "—"}{l.quantity ? <span className="text-muted-foreground"> · {l.quantity}</span> : null}</TableCell>
                  <TableCell className="text-sm">
                    <div>{chLabel(l.channel)}</div>
                    {l.utmCampaign && <div className="text-xs text-muted-foreground">{l.utmCampaign}</div>}
                  </TableCell>
                  <TableCell className="text-center">{l.fileCount ? <span className="inline-flex items-center gap-1 text-sm"><Paperclip className="h-3.5 w-3.5" />{l.fileCount}</span> : ""}</TableCell>
                  <TableCell><StatusBadge status={l.status} /></TableCell>
                  <TableCell className="text-sm">{l.quoteNumber ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {openId != null && <LeadDetail id={openId} onClose={() => setOpenId(null)} />}
      <MarketingSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children == null || children === "" || children === false) return null;
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function LeadDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data: me } = trpc.appUsers.appUsersMe.useQuery();
  const { data: lead } = trpc.marketing.leadById.useQuery({ id });
  const [notes, setNotes] = useState("");
  const [assigned, setAssigned] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { if (lead) { setNotes(lead.notes ?? ""); setAssigned(lead.assignedTo ?? ""); } }, [lead?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => { utils.marketing.leadById.invalidate({ id }); utils.marketing.leadList.invalidate(); utils.marketing.leadCounts.invalidate(); };
  const update = trpc.marketing.leadUpdate.useMutation({ onSuccess: () => { refresh(); toast.success("Зачувано"); }, onError: (e) => toast.error(e.message) });
  const addNote = trpc.marketing.leadNoteAdd.useMutation({ onSuccess: () => { setNote(""); refresh(); }, onError: (e) => toast.error(e.message) });
  const convert = trpc.marketing.leadConvert.useMutation({
    onSuccess: (r) => {
      refresh();
      toast.success(r.quoteNumber ? `${r.createdCustomer ? "Создаден купувач и н" : "Н"}ацрт-понуда ${r.quoteNumber}` : "Поврзано со купувач");
      if (r.quotationId) navigate(`/ponudi?open=${r.quotationId}`);
    },
    onError: (e) => toast.error(e.message),
  });
  const autoReply = trpc.marketing.leadAutoReplySend.useMutation({ onSuccess: () => { refresh(); toast.success("Одговорот е пратен"); }, onError: (e) => toast.error(e.message) });
  const del = trpc.marketing.leadDelete.useMutation({ onSuccess: () => { utils.marketing.leadList.invalidate(); utils.marketing.leadCounts.invalidate(); onClose(); toast.success("Барањето е избришано"); }, onError: (e) => toast.error(e.message) });
  const openFile = async (fid: number) => {
    try { const f = await utils.marketing.leadFileGet.fetch({ id: fid }); openBase64(f.data, f.mime); }
    catch (e: any) { toast.error(e?.message ?? "Не може да се отвори"); }
  };
  const isAdmin = (me?.role ?? "admin") === "admin";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Барање #{id}{lead && <> — {lead.company || lead.name} <StatusBadge status={lead.status} /></>}
          </DialogTitle>
        </DialogHeader>
        {!lead ? <div className="py-8 text-center text-muted-foreground">Се вчитува…</div> : (
          <div className="grid gap-5 md:grid-cols-[1fr_17rem]">
            <div className="space-y-4">
              <section>
                <Row label="Име">{lead.name}</Row>
                <Row label="Фирма">{lead.company}</Row>
                <Row label="Е-пошта"><a className="inline-flex items-center gap-1 text-primary hover:underline" href={`mailto:${lead.email}`}><Mail className="h-3.5 w-3.5" />{lead.email}</a></Row>
                <Row label="Телефон">{lead.phone && <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`tel:${lead.phone}`}><Phone className="h-3.5 w-3.5" />{lead.phone}</a>}</Row>
                <Row label="Производ">{lead.productType}</Row>
                <Row label="Количина">{lead.quantity}</Row>
                <Row label="Согласност">{lead.consent ? "Да — прифаќа маркетинг пораки" : "Не"}</Row>
                <Row label="Примено">{formatDateTime(lead.createdAt)}</Row>
                <Row label="Купувач">{lead.customer}</Row>
              </section>
              {lead.message && <section className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">{lead.message}</section>}
              {lead.spamReason && <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"><ShieldAlert className="h-4 w-4" />Можен спам: {lead.spamReason}</div>}

              {lead.files.length > 0 && (
                <section>
                  <h3 className="mb-1 text-sm font-semibold">Прилози</h3>
                  <div className="space-y-1">
                    {lead.files.map((f) => (
                      <button key={f.id} onClick={() => openFile(f.id)} className="flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left text-sm hover:bg-muted">
                        <Paperclip className="h-4 w-4 shrink-0" /><span className="flex-1 truncate">{f.name}</span><span className="text-xs text-muted-foreground">{fmtSize(f.size)}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section className="rounded-md border p-3">
                <h3 className="mb-1 text-sm font-semibold">Извор</h3>
                <Row label="Канал">{chLabel(lead.channel)}</Row>
                <Row label="Кампања">{lead.utmCampaign}</Row>
                <Row label="utm_source">{lead.utmSource}</Row>
                <Row label="utm_medium">{lead.utmMedium}</Row>
                <Row label="utm_content">{lead.utmContent}</Row>
                <Row label="utm_term">{lead.utmTerm}</Row>
                <Row label="Клик ID">{[lead.gclid && "Google (gclid)", lead.fbclid && "Meta (fbclid)"].filter(Boolean).join(", ")}</Row>
                <Row label="Страница">{lead.landingPage && <a href={lead.landingPage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">{lead.landingPage}<ExternalLink className="h-3 w-3" /></a>}</Row>
                <Row label="Дојде од">{lead.referrer}</Row>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold">Историја</h3>
                <div className="mb-2 flex gap-2">
                  <Input placeholder="Белешка (пр. „Се јавив, сака понуда до петок“)" value={note} onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) addNote.mutate({ id, note }); }} />
                  <Button variant="outline" disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate({ id, note })}>Додај</Button>
                </div>
                <ol className="space-y-1.5 border-l pl-3">
                  {lead.events.map((e) => (
                    <li key={e.id} className="text-sm">
                      <span className="text-xs text-muted-foreground">{formatDateTime(e.at)}{e.by ? ` · ${e.by}` : ""}</span>
                      <div className="whitespace-pre-wrap">{e.note ?? e.kind}</div>
                    </li>
                  ))}
                </ol>
              </section>
            </div>

            <aside className="space-y-4">
              <div className="space-y-2">
                {lead.quotationId ? (
                  <Button className="w-full" onClick={() => navigate(`/ponudi?open=${lead.quotationId}`)}><FileText className="mr-2 h-4 w-4" />Отвори понуда {lead.quoteNumber}</Button>
                ) : (
                  <Button className="w-full" disabled={convert.isPending || lead.status === "spam"} onClick={() => convert.mutate({ id })}>
                    <ArrowRight className="mr-2 h-4 w-4" />{lead.customerId ? "Направи понуда" : "Во купувач + понуда"}
                  </Button>
                )}
                <Button variant="outline" className="w-full" disabled={autoReply.isPending || lead.status === "spam"} onClick={() => autoReply.mutate({ id })}>
                  <Send className="mr-2 h-4 w-4" />{lead.autoReplyAt ? "Прати одговор повторно" : "Прати автоматски одговор"}
                </Button>
                {lead.autoReplyAt && <p className="text-xs text-muted-foreground">Автоматски одговор: {formatDateTime(lead.autoReplyAt)}</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Статус</Label>
                <Select value={lead.status} onValueChange={(v) => update.mutate({ id, status: v as LeadStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{LEAD_STATUSES.map((s) => <SelectItem key={s} value={s}>{LEAD_STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Задолжен</Label>
                <Input value={assigned} onChange={(e) => setAssigned(e.target.value)} onBlur={() => assigned !== (lead.assignedTo ?? "") && update.mutate({ id, assignedTo: assigned || null })} placeholder="Име" />
              </div>
              <div className="space-y-1.5">
                <Label>Интерни белешки</Label>
                <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (lead.notes ?? "") && update.mutate({ id, notes: notes || null })} />
              </div>
              {lead.otherLeads.length > 0 && (
                <div className="text-sm">
                  <Label>Други барања од оваа адреса</Label>
                  <ul className="mt-1 space-y-0.5">
                    {lead.otherLeads.map((o) => <li key={o.id}><button className="text-primary hover:underline" onClick={() => navigate(`/marketing/baranja?id=${o.id}`)}>#{o.id}</button> · {formatDateTime(o.createdAt)} · {o.productType || "—"}</li>)}
                  </ul>
                </div>
              )}
              {isAdmin && (
                <Button variant="ghost" size="sm" className="w-full text-red-600 hover:text-red-700" disabled={del.isPending}
                  onClick={() => { if (confirm("Трајно да се избрише барањето и прилозите (GDPR барање за бришење)?")) del.mutate({ id }); }}>
                  <Trash2 className="mr-2 h-4 w-4" />Избриши трајно
                </Button>
              )}
            </aside>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MarketingSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const utils = trpc.useUtils();
  const { data } = trpc.marketing.marketingSettingsGet.useQuery(undefined, { enabled: open });
  const [enabled, setEnabled] = useState(true);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [emails, setEmails] = useState("");
  const [doi, setDoi] = useState(true);
  useEffect(() => {
    if (!data) return;
    setEnabled(data.autoReply.enabled); setSubject(data.autoReply.subject); setBody(data.autoReply.body); setEmails(data.notifyEmails.join(", ")); setDoi(data.doubleOptIn);
  }, [data]);
  const save = trpc.marketing.marketingSettingsSave.useMutation({
    onSuccess: () => { utils.marketing.marketingSettingsGet.invalidate(); toast.success("Зачувано"); onOpenChange(false); },
    onError: (e) => toast.error(e.message),
  });
  const endpoint = useMemo(() => `${data?.publicBase || window.location.origin}/api/public/lead`, [data?.publicBase]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Поставки за барања</DialogTitle></DialogHeader>
        <div className="space-y-5">
          <section className="space-y-1 rounded-md border p-3 text-sm">
            <div className="font-semibold">Вградување на веб-страницата</div>
            <p className="text-muted-foreground">Формата праќа POST на:</p>
            <code className="block break-all rounded bg-muted px-2 py-1">{endpoint}</code>
            <p className="text-muted-foreground">Готова форма (HTML и React) и упатство: <code>docs/WEBSITE-FORM.md</code> во репозиториумот. Домените на страницата одат во <code>ALLOWED_ORIGINS</code>.</p>
          </section>
          <section className="space-y-1 text-sm">
            <div className="font-semibold">Е-пошта за праќање</div>
            {data?.mail?.configured
              ? <p className="text-emerald-700">Поставено: {(data.mail.provider ?? "").toUpperCase()} ({data.mail.source === "env" ? "од опкружувањето" : "од Подесувања"}) · испраќач {data.mail.from}</p>
              : <p className="text-amber-700">Не е поставено — автоматскиот одговор нема да се праќа. Постави SMTP во Подесувања или SMTP_* / MAIL_PROVIDER во опкружувањето.</p>}
          </section>
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="ar-en" className="font-semibold">Автоматски одговор до клиентот</Label>
              <Switch id="ar-en" checked={enabled} onCheckedChange={setEnabled} />
            </div>
            <div className="space-y-1.5"><Label>Наслов</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Текст</Label><Textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} /></div>
            <p className="text-xs text-muted-foreground">Променливи: {"{{name}}"}, {"{{company}}"}, {"{{product_type}}"}, {"{{quantity}}"}, {"{{product_line}}"}, {"{{company_name}}"} (вашата фирма).</p>
          </section>
          <section className="space-y-1.5">
            <Label className="font-semibold">Интерно известување по е-пошта</Label>
            <Input placeholder="andrej@serafimoski.tech, prodazba@…" value={emails} onChange={(e) => setEmails(e.target.value)} />
            <p className="text-xs text-muted-foreground">За секое ново барање (покрај ѕвончето во апликацијата). Празно = само ѕвонче.</p>
          </section>
          <section className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="doi" className="font-semibold">Потврда на согласност (double opt-in)</Label>
              <Switch id="doi" checked={doi} onCheckedChange={setDoi} />
            </div>
            <p className="text-xs text-muted-foreground">Кога клиентот ќе штиклира „сакам понуди по е-пошта“, добива линк за потврда; дури по потврдата влегува во кампањите. Препорачано (доказ за согласност според ЗЗЛП/GDPR).</p>
          </section>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Откажи</Button>
            <Button disabled={save.isPending || !subject.trim() || !body.trim()} onClick={() => save.mutate({
              autoReply: { enabled, subject: subject.trim(), body },
              notifyEmails: emails.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean),
              doubleOptIn: doi,
            })}>Зачувај</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
