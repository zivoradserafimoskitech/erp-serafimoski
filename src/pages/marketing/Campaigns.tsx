// Маркетинг → Кампањи: е-пошта кампањи со блокови (текст, копче, слика, производ од ERP, понуда), тест, закажување, следење.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, cn } from "@/lib/utils";
import { BLOCK_LABEL, CAMPAIGN_STATUS_LABEL, type Block, type CampaignStatus, type SegmentRules } from "@contracts/marketing-campaigns";
import { Mail, Plus, ArrowUp, ArrowDown, Trash2, Send, Clock, Pause, Play, Copy, X, RefreshCw, Eye, MousePointerClick, UserMinus, AlertTriangle } from "lucide-react";

const STATUS_CLS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700", scheduled: "bg-blue-100 text-blue-800", sending: "bg-amber-100 text-amber-800",
  paused: "bg-orange-100 text-orange-800", sent: "bg-emerald-100 text-emerald-800", cancelled: "bg-red-100 text-red-800",
};
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const money = (n: number) => `${Math.round(n).toLocaleString("mk-MK")} ден.`;

export default function Campaigns() {
  const { data: list } = trpc.campaigns.campaignList.useQuery(undefined, { refetchInterval: 30_000 });
  const [params] = useSearchParams();
  const [edit, setEdit] = useState<number | "new" | null>(() => (Number(params.get("id")) > 0 ? Number(params.get("id")) : null));
  const utils = trpc.useUtils();
  const dup = trpc.campaigns.campaignDuplicate.useMutation({ onSuccess: (r) => { utils.campaigns.campaignList.invalidate(); setEdit(r.id); }, onError: (e) => toast.error(e.message) });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Mail className="h-6 w-6 text-primary" />
        <div className="flex-1 min-w-[12rem]">
          <h1 className="text-2xl font-bold">Кампањи</h1>
          <p className="text-sm text-muted-foreground">Е-пошта до клиенти и пријавени контакти — само со согласност, со одјава во секоја порака.</p>
        </div>
        <Button onClick={() => setEdit("new")}><Plus className="mr-2 h-4 w-4" />Нова кампања</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Кампања</TableHead><TableHead>Статус</TableHead><TableHead className="text-right">Примачи</TableHead>
                <TableHead className="text-right">Пратени</TableHead><TableHead className="text-right">Отворени</TableHead><TableHead className="text-right">Кликови</TableHead>
                <TableHead className="text-right">Одјави</TableHead><TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {!list?.length && <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">Нема кампањи. Прво во „Публика“ синхронизирај ги клиентите и барањата.</TableCell></TableRow>}
              {list?.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => setEdit(c.id)}>
                  <TableCell>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.subject} · {c.segmentName ?? "без сегмент"} · {formatDateTime(c.startedAt ?? c.createdAt)}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className={cn("border-0", STATUS_CLS[c.status])}>{CAMPAIGN_STATUS_LABEL[c.status as CampaignStatus] ?? c.status}</Badge>
                    {c.lastError && c.status === "sending" && <AlertTriangle className="ml-1 inline h-4 w-4 text-amber-600" aria-label={c.lastError} />}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.recipients || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.stats?.sent ?? 0}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(c.stats?.opened ?? 0, c.stats?.sent ?? 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(c.stats?.clicked ?? 0, c.stats?.sent ?? 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.stats?.unsubscribed ?? 0}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}><Button size="icon" variant="ghost" title="Копија" onClick={() => dup.mutate({ id: c.id })}><Copy className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Отворањата се приближни (Apple Mail и други ги вчитуваат сликите автоматски); кликовите и барањата/приходот по кампања се посигурни.</p>
      {edit != null && <CampaignDialog id={edit === "new" ? null : edit} onClose={() => setEdit(null)} onCreated={(id) => setEdit(id)} />}
    </div>
  );
}

function CampaignDialog({ id, onClose, onCreated }: { id: number | null; onClose: () => void; onCreated: (id: number) => void }) {
  const { data } = trpc.campaigns.campaignById.useQuery({ id: id ?? 0 }, { enabled: id != null, refetchInterval: (q) => (q.state.data?.status === "sending" ? 10_000 : false) });
  const editable = id == null || (data && ["draft", "paused", "scheduled"].includes(data.status));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader><DialogTitle>{id == null ? "Нова кампања" : data?.name ?? "Кампања"}</DialogTitle></DialogHeader>
        {id != null && !data ? <div className="py-10 text-center text-muted-foreground">Се вчитува…</div>
          : editable ? <CampaignEditor initial={data ?? null} onCreated={onCreated} onClose={onClose} />
          : <CampaignReport c={data!} />}
      </DialogContent>
    </Dialog>
  );
}

type Draft = { name: string; subject: string; preheader: string; replyTo: string; blocks: Block[]; segmentId: number | null; consent: SegmentRules["consent"]; ratePerMinute: number; utmCampaign: string };

const NEW_BLOCKS: Record<Block["type"], () => Block> = {
  heading: () => ({ type: "heading", text: "Наслов" }),
  text: () => ({ type: "text", text: "Почитувани {{first_name}},\n\n" }),
  button: () => ({ type: "button", label: "Побарај понуда", url: "https://serafimoski.tech/#/kontakt" }),
  image: () => ({ type: "image", url: "", alt: "" }),
  product: () => ({ type: "product", productId: 0, showPrice: true }),
  offer: () => ({ type: "offer", title: "Акција", text: "", price: "", url: "https://serafimoski.tech/#/kontakt" }),
  divider: () => ({ type: "divider" }),
};

function CampaignEditor({ initial, onCreated, onClose }: { initial: any | null; onCreated: (id: number) => void; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data: segments } = trpc.campaigns.segmentList.useQuery();
  const { data: products } = trpc.campaigns.productPickList.useQuery();
  const [d, setD] = useState<Draft>(() => ({
    name: initial?.name ?? "", subject: initial?.subject ?? "", preheader: initial?.preheader ?? "", replyTo: initial?.replyTo ?? "",
    blocks: initial?.blocks ?? [NEW_BLOCKS.heading(), NEW_BLOCKS.text(), NEW_BLOCKS.button()],
    segmentId: initial?.segmentId ?? null, consent: initial?.rules?.consent ?? "granted", ratePerMinute: initial?.ratePerMinute ?? 30, utmCampaign: initial?.utmCampaign ?? "",
  }));
  const [testTo, setTestTo] = useState("");
  const [when, setWhen] = useState("");
  const payload = { id: initial?.id, name: d.name.trim() || "Нова кампања", subject: d.subject.trim() || "(без наслов)", preheader: d.preheader || null, replyTo: d.replyTo || null,
    blocks: d.blocks, segmentId: d.segmentId, rules: d.segmentId ? null : { consent: d.consent }, ratePerMinute: d.ratePerMinute, utmCampaign: d.utmCampaign || undefined };

  const preview = trpc.campaigns.campaignDraftPreview.useMutation();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = JSON.stringify(payload);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => preview.mutate(payload), 700);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = trpc.campaigns.campaignSave.useMutation({ onError: (e) => toast.error(e.message) });
  const doSave = async () => {
    if (d.name.trim().length < 2 || d.subject.trim().length < 2) { toast.error("Внеси име и наслов на пораката"); return null; }
    const r = await save.mutateAsync({ ...payload, name: d.name.trim(), subject: d.subject.trim() });
    utils.campaigns.campaignList.invalidate();
    setD((x) => ({ ...x, utmCampaign: r.utmCampaign }));
    if (!initial?.id) onCreated(r.id); else utils.campaigns.campaignById.invalidate({ id: r.id });
    return r.id;
  };
  const test = trpc.campaigns.campaignTestSend.useMutation({ onSuccess: (r) => toast.success(`Тест пратен (${r.sent})`), onError: (e) => toast.error(e.message) });
  const schedule = trpc.campaigns.campaignSchedule.useMutation({
    onSuccess: (r) => { toast.success(r.status === "scheduled" ? `Закажана за ${r.total} примачи` : `Се праќа на ${r.total} примачи`); utils.campaigns.campaignList.invalidate(); if (initial?.id) utils.campaigns.campaignById.invalidate({ id: initial.id }); },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.campaigns.campaignDelete.useMutation({ onSuccess: () => { utils.campaigns.campaignList.invalidate(); onClose(); }, onError: (e) => toast.error(e.message) });

  const setBlock = (i: number, b: Block) => setD((x) => ({ ...x, blocks: x.blocks.map((y, j) => (j === i ? b : y)) }));
  const move = (i: number, dir: -1 | 1) => setD((x) => { const a = [...x.blocks]; const j = i + dir; if (j < 0 || j >= a.length) return x; [a[i], a[j]] = [a[j], a[i]]; return { ...x, blocks: a }; });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        {initial?.status === "scheduled" && <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">Закажана за {formatDateTime(initial.scheduledAt)}. Измените се зачувуваат, но новите примачи се додаваат само при повторно закажување.</div>}
        {initial?.status === "paused" && <PauseBar id={initial.id} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Име (интерно)</Label><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="пр. Есенска акција огради" /></div>
          <div className="space-y-1.5"><Label>UTM кампања</Label><Input value={d.utmCampaign} onChange={(e) => setD({ ...d, utmCampaign: e.target.value })} placeholder={preview.data?.utmCampaign ?? "автоматски од името"} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Наслов на пораката</Label><Input value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} placeholder="пр. {{first_name}}, -15% на ласерско сечење до крајот на месецот" /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Преглед во инбокс (preheader)</Label><Input value={d.preheader} onChange={(e) => setD({ ...d, preheader: e.target.value })} placeholder="Краток текст што се гледа до насловот" /></div>
          <div className="space-y-1.5">
            <Label>Примачи</Label>
            <Select value={d.segmentId ? String(d.segmentId) : `all:${d.consent}`} onValueChange={(v) => v.startsWith("all:") ? setD({ ...d, segmentId: null, consent: v.slice(4) as SegmentRules["consent"] }) : setD({ ...d, segmentId: Number(v) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all:granted">Сите со согласност</SelectItem>
                <SelectItem value="all:granted_or_customer">Со согласност + постоечки клиенти</SelectItem>
                {segments?.map((s) => <SelectItem key={s.id} value={String(s.id)}>Сегмент: {s.name} ({s.count})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Брзина (пораки/мин)</Label><Input type="number" min={1} max={1000} value={d.ratePerMinute} onChange={(e) => setD({ ...d, ratePerMinute: Math.max(1, Number(e.target.value) || 1) })} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Одговор на (Reply-To)</Label><Input value={d.replyTo} onChange={(e) => setD({ ...d, replyTo: e.target.value })} placeholder="andrej@serafimoski.tech" /></div>
        </div>
        {d.consent === "granted_or_customer" && !d.segmentId && <p className="text-xs text-amber-700">„Постоечки клиенти“ = клиенти без изречна согласност кои не се одјавиле (soft opt-in за слични производи). Користете само за релевантни понуди.</p>}

        <div className="space-y-2">
          <div className="flex items-center justify-between"><Label className="text-base">Содржина</Label><span className="text-xs text-muted-foreground">Променливи: {"{{first_name}} {{name}} {{company}}"}</span></div>
          {d.blocks.map((b, i) => (
            <div key={i} className="rounded-md border p-3">
              <div className="mb-2 flex items-center gap-1">
                <span className="flex-1 text-xs font-semibold uppercase text-muted-foreground">{BLOCK_LABEL[b.type]}</span>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(i, 1)} disabled={i === d.blocks.length - 1}><ArrowDown className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600" onClick={() => setD({ ...d, blocks: d.blocks.filter((_, j) => j !== i) })}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
              <BlockFields b={b} onChange={(nb) => setBlock(i, nb)} products={products ?? []} />
            </div>
          ))}
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(NEW_BLOCKS) as Block["type"][]).map((t) => (
              <Button key={t} size="sm" variant="outline" onClick={() => setD({ ...d, blocks: [...d.blocks, NEW_BLOCKS[t]()] })}><Plus className="mr-1 h-3.5 w-3.5" />{BLOCK_LABEL[t]}</Button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3 lg:sticky lg:top-0 lg:self-start">
        <div className="flex items-center justify-between text-sm">
          <span>Примачи сега: <b>{preview.data?.audience ?? "…"}</b></span>
          <Button size="sm" variant="ghost" onClick={() => preview.mutate(payload)}><RefreshCw className={cn("mr-1 h-3.5 w-3.5", preview.isPending && "animate-spin")} />Преглед</Button>
        </div>
        {preview.data && !preview.data.appUrlSet && <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">APP_URL не е поставен — праќањето е оневозможено (потребен за одјава и следење).</div>}
        <div className="rounded-md border bg-white">
          <div className="border-b px-3 py-2 text-sm"><b>{preview.data?.subject || d.subject || "(без наслов)"}</b></div>
          <iframe title="Преглед" sandbox="" className="h-[520px] w-full" srcDoc={preview.data?.html ?? "<p style='font-family:sans-serif;padding:20px;color:#888'>Се подготвува преглед…</p>"} />
        </div>
        <div className="flex gap-2">
          <Input placeholder="тест@адреса.мк (до 5, со запирка)" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <Button variant="outline" disabled={test.isPending || !testTo.trim()} onClick={async () => { const id = await doSave(); if (id) test.mutate({ id, to: testTo.split(/[,;\s]+/).filter(Boolean) }); }}><Send className="mr-1 h-4 w-4" />Тест</Button>
        </div>
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <Button variant="outline" disabled={save.isPending} onClick={async () => { const id = await doSave(); if (id) toast.success("Зачувано"); }}>Зачувај нацрт</Button>
          <div className="flex-1" />
          <div className="space-y-1">
            <Label className="text-xs">Закажи за (празно = веднаш)</Label>
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="w-52" />
          </div>
          <Button disabled={schedule.isPending || save.isPending} onClick={async () => {
            const id = await doSave(); if (!id) return;
            const n = preview.data?.audience ?? 0;
            if (!confirm(when ? `Да се закаже кампањата за ${n} примачи?` : `Да се прати кампањата на ${n} примачи сега?`)) return;
            schedule.mutate({ id, at: when ? new Date(when).toISOString() : undefined });
          }}>{when ? <><Clock className="mr-1 h-4 w-4" />Закажи</> : <><Send className="mr-1 h-4 w-4" />Прати</>}</Button>
        </div>
        {initial?.id && initial.status === "draft" && <Button variant="ghost" size="sm" className="text-red-600" onClick={() => { if (confirm("Да се избрише нацртот?")) del.mutate({ id: initial.id }); }}><Trash2 className="mr-1 h-4 w-4" />Избриши нацрт</Button>}
      </div>
    </div>
  );
}

function BlockFields({ b, onChange, products }: { b: Block; onChange: (b: Block) => void; products: { id: number; name: string; code: string; hasImage: boolean; hasUrl: boolean; price: number }[] }) {
  switch (b.type) {
    case "heading": return <Input value={b.text} onChange={(e) => onChange({ ...b, text: e.target.value })} />;
    case "text": return <Textarea rows={5} value={b.text} onChange={(e) => onChange({ ...b, text: e.target.value })} placeholder="Празен ред = нов пасус. **задебелено**. Линковите стануваат кликливи." />;
    case "button": return <div className="grid gap-2 sm:grid-cols-2"><Input value={b.label} onChange={(e) => onChange({ ...b, label: e.target.value })} placeholder="Текст" /><Input value={b.url} onChange={(e) => onChange({ ...b, url: e.target.value })} placeholder="https://…" /></div>;
    case "image": return <div className="grid gap-2 sm:grid-cols-3"><Input className="sm:col-span-2" value={b.url} onChange={(e) => onChange({ ...b, url: e.target.value })} placeholder="https://…/slika.jpg" /><Input value={b.alt} onChange={(e) => onChange({ ...b, alt: e.target.value })} placeholder="Опис" /><Input className="sm:col-span-3" value={b.link ?? ""} onChange={(e) => onChange({ ...b, link: e.target.value || undefined })} placeholder="Линк при клик (опционално)" /></div>;
    case "product": return (
      <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
        <Select value={b.productId ? String(b.productId) : ""} onValueChange={(v) => onChange({ ...b, productId: Number(v) })}>
          <SelectTrigger><SelectValue placeholder="Избери производ" /></SelectTrigger>
          <SelectContent>{products.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name} · {p.code}{!p.hasUrl ? " (без линк)" : ""}</SelectItem>)}</SelectContent>
        </Select>
        <Input value={b.cta ?? ""} onChange={(e) => onChange({ ...b, cta: e.target.value || undefined })} placeholder="Повеќе →" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={b.showPrice} onChange={(e) => onChange({ ...b, showPrice: e.target.checked })} />Прикажи цена (цената на клиентот од ценовникот, ако има)</label>
      </div>
    );
    case "offer": return (
      <div className="grid gap-2 sm:grid-cols-2">
        <Input className="sm:col-span-2" value={b.title} onChange={(e) => onChange({ ...b, title: e.target.value })} placeholder="Наслов на понудата" />
        <Textarea className="sm:col-span-2" rows={3} value={b.text} onChange={(e) => onChange({ ...b, text: e.target.value })} placeholder="Опис" />
        <Input value={b.price ?? ""} onChange={(e) => onChange({ ...b, price: e.target.value || undefined })} placeholder="Цена (пр. 1.990 ден.)" />
        <Input value={b.oldPrice ?? ""} onChange={(e) => onChange({ ...b, oldPrice: e.target.value || undefined })} placeholder="Стара цена" />
        <Input value={b.url ?? ""} onChange={(e) => onChange({ ...b, url: e.target.value || undefined })} placeholder="https://…" />
        <Input value={b.cta ?? ""} onChange={(e) => onChange({ ...b, cta: e.target.value || undefined })} placeholder="Побарај понуда" />
      </div>
    );
    case "divider": return null;
  }
}

function PauseBar({ id }: { id: number }) {
  const utils = trpc.useUtils();
  const inv = () => { utils.campaigns.campaignById.invalidate({ id }); utils.campaigns.campaignList.invalidate(); };
  const resume = trpc.campaigns.campaignResume.useMutation({ onSuccess: inv });
  const cancel = trpc.campaigns.campaignCancel.useMutation({ onSuccess: inv });
  return (
    <div className="flex items-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">
      <span className="flex-1">Кампањата е паузирана.</span>
      <Button size="sm" onClick={() => resume.mutate({ id })}><Play className="mr-1 h-3.5 w-3.5" />Продолжи</Button>
      <Button size="sm" variant="outline" onClick={() => { if (confirm("Да се откаже праќањето до останатите?")) cancel.mutate({ id }); }}><X className="mr-1 h-3.5 w-3.5" />Откажи</Button>
    </div>
  );
}

function Stat({ label, value, sub, icon: Icon }: { label: string; value: string | number; sub?: string; icon?: typeof Eye }) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase text-muted-foreground">{Icon && <Icon className="h-3.5 w-3.5" />}{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function CampaignReport({ c }: { c: any }) {
  const utils = trpc.useUtils();
  const inv = () => { utils.campaigns.campaignById.invalidate({ id: c.id }); utils.campaigns.campaignList.invalidate(); };
  const pause = trpc.campaigns.campaignPause.useMutation({ onSuccess: inv });
  const cancel = trpc.campaigns.campaignCancel.useMutation({ onSuccess: inv });
  const run = trpc.campaigns.campaignQueueRun.useMutation({ onSuccess: (r) => { inv(); toast.success(`Пратени ${r.sent}`); }, onError: (e) => toast.error(e.message) });
  const { data: prev } = trpc.campaigns.campaignPreview.useQuery({ id: c.id });
  const s = c.stats;
  const progress = s.total ? Math.round(((s.total - s.queued) / s.total) * 100) : 0;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn("border-0", STATUS_CLS[c.status])}>{CAMPAIGN_STATUS_LABEL[c.status as CampaignStatus] ?? c.status}</Badge>
          <span className="text-sm text-muted-foreground">utm_campaign = <code>{c.utmCampaign}</code></span>
          <div className="flex-1" />
          {c.status === "sending" && <>
            <Button size="sm" variant="outline" onClick={() => run.mutate()} disabled={run.isPending}><RefreshCw className="mr-1 h-3.5 w-3.5" />Прати следна серија</Button>
            <Button size="sm" variant="outline" onClick={() => pause.mutate({ id: c.id })}><Pause className="mr-1 h-3.5 w-3.5" />Пауза</Button>
            <Button size="sm" variant="outline" onClick={() => { if (confirm("Да се откаже праќањето до останатите?")) cancel.mutate({ id: c.id }); }}><X className="mr-1 h-3.5 w-3.5" />Откажи</Button>
          </>}
        </div>
        {c.status === "sending" && <div><div className="h-2 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{ width: `${progress}%` }} /></div><p className="mt-1 text-xs text-muted-foreground">{s.total - s.queued} / {s.total} · {c.ratePerMinute} пораки/мин</p></div>}
        {c.lastError && <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Последна грешка: {c.lastError}</div>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Пратени" value={s.sent} sub={`од ${s.total}${s.failed ? ` · ${s.failed} неуспешни` : ""}${s.skipped ? ` · ${s.skipped} прескокнати` : ""}`} icon={Send} />
          <Stat label="Отворени" value={pct(s.opened, s.sent)} sub={`${s.opened} примачи`} icon={Eye} />
          <Stat label="Кликови" value={pct(s.clicked, s.sent)} sub={`${s.clicked} примачи`} icon={MousePointerClick} />
          <Stat label="Одјави" value={s.unsubscribed} sub={pct(s.unsubscribed, s.sent)} icon={UserMinus} />
          <Stat label="Барања" value={c.leads} sub="од веб-формата со оваа кампања" />
          <Stat label="Приход" value={money(c.revenue)} sub="фактурирано, без ДДВ" />
        </div>
        {c.links.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-semibold">Најкликани линкови</h3>
            <table className="w-full text-sm"><tbody>{c.links.map((l: any) => (
              <tr key={l.url} className="border-b"><td className="max-w-0 truncate py-1.5 pr-2" title={l.url}>{l.url.replace(/[?&]utm_[^&#]+/g, "").replace(/\?(#|$)/, "$1")}</td><td className="text-right tabular-nums">{l.people} луѓе</td><td className="w-20 text-right tabular-nums">{l.clicks} кл.</td></tr>
            ))}</tbody></table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Започната {formatDateTime(c.startedAt)}{c.finishedAt ? ` · завршена ${formatDateTime(c.finishedAt)}` : ""}.</p>
      </div>
      <div className="rounded-md border bg-white">
        <div className="border-b px-3 py-2 text-sm"><b>{prev?.subject ?? c.subject}</b></div>
        <iframe title="Преглед" sandbox="" className="h-[560px] w-full" srcDoc={prev?.html ?? ""} />
      </div>
    </div>
  );
}

