// Маркетинг → Веб каталог: кои производи одат на веб / во Meta и Google каталогот (feed).
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Globe, Copy, Search, CheckCircle2, AlertTriangle, Pencil } from "lucide-react";

type Row = {
  id: number; code: string; name: string; description: string | null; category: string | null; showOnWeb: boolean;
  imageUrl: string | null; webUrl: string | null; publicPrice: number | null; defaultPrice: number; issues: string[];
};

function CopyUrl({ label, url }: { label: string; url: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex gap-2">
        <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">{url}</code>
        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(url); toast.success("Копирано"); }}><Copy className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}

export default function WebFeed() {
  const [search, setSearch] = useState("");
  const [onlyWeb, setOnlyWeb] = useState(false);
  const [edit, setEdit] = useState<Row | null>(null);
  const utils = trpc.useUtils();
  const { data: rows } = trpc.marketing.feedProductList.useQuery({ onlyWeb });
  const { data: info } = trpc.marketing.feedInfo.useQuery();
  const save = trpc.marketing.feedProductSave.useMutation({
    onSuccess: (r) => { utils.marketing.feedProductList.invalidate(); utils.marketing.feedInfo.invalidate(); toast.success(r.issues.length && r.showOnWeb ? `Зачувано — уште недостасува: ${r.issues.join(", ")}` : "Зачувано"); setEdit(null); },
    onError: (e) => toast.error(e.message),
  });
  const s = search.trim().toLowerCase();
  const list = (rows ?? []).filter((r) => !s || r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s) || (r.category ?? "").toLowerCase().includes(s));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Globe className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Веб каталог</h1>
          <p className="text-sm text-muted-foreground">Производи за веб-страницата и за каталозите на Meta (Facebook/Instagram) и Google Merchant.</p>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-4 p-4 md:grid-cols-[12rem_1fr_1fr]">
          <div>
            <div className="text-3xl font-bold">{info?.ready ?? 0}<span className="text-base font-normal text-muted-foreground"> / {info?.onWeb ?? 0}</span></div>
            <div className="text-xs text-muted-foreground">спремни за feed / означени за веб</div>
          </div>
          {info && <CopyUrl label="Meta каталог (CSV) — Commerce Manager → Data sources → Data feed" url={info.metaUrl} />}
          {info && <CopyUrl label="Google Merchant (XML) — Products → Feeds → Scheduled fetch" url={info.googleUrl} />}
          {info && !info.protectedByToken && <p className="text-xs text-muted-foreground md:col-span-3">Feed-от е јавен (содржи само производите означени за веб). За заштита постави <code>FEED_TOKEN</code>.</p>}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Пребарај производ…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm"><Switch checked={onlyWeb} onCheckedChange={setOnlyWeb} />Само означени за веб</label>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">На веб</TableHead>
                <TableHead>Производ</TableHead>
                <TableHead className="text-right">Јавна цена</TableHead>
                <TableHead>Состојба за feed</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {!list.length && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Нема производи</TableCell></TableRow>}
              {list.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Switch checked={r.showOnWeb} onCheckedChange={(v) => save.mutate({ id: r.id, showOnWeb: v, imageUrl: r.imageUrl, webUrl: r.webUrl, publicPrice: r.publicPrice })} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {r.imageUrl ? <img src={r.imageUrl} alt="" className="h-10 w-10 rounded object-cover" loading="lazy" /> : <div className="h-10 w-10 rounded bg-muted" />}
                      <div>
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-muted-foreground">{r.code} · {r.category}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {r.publicPrice != null ? `${r.publicPrice.toLocaleString("mk-MK")} ден.` : <span className="text-muted-foreground">({r.defaultPrice.toLocaleString("mk-MK")})</span>}
                  </TableCell>
                  <TableCell className="text-sm">
                    {!r.showOnWeb ? <span className="text-muted-foreground">—</span>
                      : r.issues.length ? <span className="inline-flex items-start gap-1 text-amber-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{r.issues.join(", ")}</span>
                      : <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Спремно</span>}
                  </TableCell>
                  <TableCell><Button size="icon" variant="ghost" onClick={() => setEdit(r)} aria-label="Уреди"><Pencil className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {edit && <EditDialog row={edit} onClose={() => setEdit(null)} onSave={(v) => save.mutate(v)} saving={save.isPending} />}
    </div>
  );
}

function EditDialog({ row, onClose, onSave, saving }: { row: Row; onClose: () => void; saving: boolean; onSave: (v: { id: number; showOnWeb: boolean; imageUrl: string | null; webUrl: string | null; publicPrice: number | null; description: string | null }) => void }) {
  const [showOnWeb, setShowOnWeb] = useState(row.showOnWeb);
  const [imageUrl, setImageUrl] = useState(row.imageUrl ?? "");
  const [webUrl, setWebUrl] = useState(row.webUrl ?? "");
  const [price, setPrice] = useState(row.publicPrice != null ? String(row.publicPrice) : "");
  const [description, setDescription] = useState(row.description ?? "");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{row.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm"><Switch checked={showOnWeb} onCheckedChange={setShowOnWeb} />Прикажи на веб и во каталозите</label>
          <div className="space-y-1.5"><Label>Линк до страницата на производот</Label><Input placeholder="https://serafimoski.tech/#/…" value={webUrl} onChange={(e) => setWebUrl(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Линк до слика</Label><Input placeholder="https://…/slika.jpg" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Јавна цена (ден., со ДДВ)</Label><Input type="number" min="0" step="0.01" placeholder={`основна: ${row.defaultPrice}`} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Опис</Label><Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <p className="text-xs text-muted-foreground">Meta и Google бараат: https линк до страница, https слика, цена и опис.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Откажи</Button>
            <Button disabled={saving} onClick={() => onSave({ id: row.id, showOnWeb, imageUrl: imageUrl.trim() || null, webUrl: webUrl.trim() || null, publicPrice: price === "" ? null : Number(price), description: description.trim() || null })}>Зачувај</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
