// Маркетинг → Буџет за реклами: рачно внесен трошок по канал/кампања (за ROI во маркетинг извештајот).
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { CHANNELS, CHANNEL_LABEL, type Channel } from "@contracts/marketing";
import { Wallet, Plus, Trash2, BarChart3 } from "lucide-react";

type Row = { id?: number; periodStart: string; periodEnd: string; channel: Channel; campaign: string; amount: string; note: string };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthRange = () => { const n = new Date(); return { periodStart: ymd(new Date(n.getFullYear(), n.getMonth(), 1)), periodEnd: ymd(new Date(n.getFullYear(), n.getMonth() + 1, 0)) }; };
const iso = (v: any) => (typeof v === "string" ? v.slice(0, 10) : ymd(new Date(v)));

export default function AdSpend() {
  const utils = trpc.useUtils();
  const { data } = trpc.campaigns.adSpendList.useQuery();
  const { data: me } = trpc.appUsers.appUsersMe.useQuery();
  const [edit, setEdit] = useState<Row | null>(null);
  const save = trpc.campaigns.adSpendSave.useMutation({ onSuccess: () => { utils.campaigns.adSpendList.invalidate(); setEdit(null); toast.success("Зачувано"); }, onError: (e) => toast.error(e.message) });
  const del = trpc.campaigns.adSpendDelete.useMutation({ onSuccess: () => utils.campaigns.adSpendList.invalidate(), onError: (e) => toast.error(e.message) });
  const total = (data ?? []).reduce((a, r) => a + r.amount, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Wallet className="h-6 w-6 text-primary" />
        <div className="flex-1 min-w-[12rem]">
          <h1 className="text-2xl font-bold">Буџет за реклами</h1>
          <p className="text-sm text-muted-foreground">Колку е потрошено на Google Ads, Meta и др. — за ROI и цена по барање во <Link to="/izvestai?view=marketing" className="text-primary hover:underline">маркетинг извештајот</Link>.</p>
        </div>
        <Button variant="outline" asChild><Link to="/izvestai?view=marketing"><BarChart3 className="mr-2 h-4 w-4" />Извештај</Link></Button>
        <Button onClick={() => setEdit({ ...monthRange(), channel: "google_ads", campaign: "", amount: "", note: "" })}><Plus className="mr-2 h-4 w-4" />Внеси трошок</Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Период</TableHead><TableHead>Канал</TableHead><TableHead>Кампања (utm_campaign)</TableHead><TableHead className="text-right">Износ</TableHead><TableHead>Белешка</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
          <TableBody>
            {!data?.length && <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Нема внесено трошоци. Внеси го месечниот трошок од Google Ads / Meta Ads Manager.</TableCell></TableRow>}
            {data?.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => setEdit({ id: r.id, periodStart: iso(r.periodStart), periodEnd: iso(r.periodEnd), channel: r.channel as Channel, campaign: r.campaign ?? "", amount: String(r.amount), note: r.note ?? "" })}>
                <TableCell className="whitespace-nowrap text-sm">{formatDate(r.periodStart)} – {formatDate(r.periodEnd)}</TableCell>
                <TableCell>{CHANNEL_LABEL[r.channel as Channel] ?? r.channel}</TableCell>
                <TableCell className="text-sm">{r.campaign ?? <span className="text-muted-foreground">цел канал</span>}</TableCell>
                <TableCell className="text-right tabular-nums">{r.amount.toLocaleString("mk-MK")} ден.</TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.note}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>{(me?.role ?? "admin") === "admin" && <Button size="icon" variant="ghost" className="text-red-600" onClick={() => { if (confirm("Да се избрише записот?")) del.mutate({ id: r.id }); }}><Trash2 className="h-4 w-4" /></Button>}</TableCell>
              </TableRow>
            ))}
            {!!data?.length && <TableRow><TableCell colSpan={3} className="font-semibold">Вкупно</TableCell><TableCell className="text-right font-semibold tabular-nums">{total.toLocaleString("mk-MK")} ден.</TableCell><TableCell colSpan={2} /></TableRow>}
          </TableBody>
        </Table>
      </CardContent></Card>
      <p className="text-xs text-muted-foreground">Внесете го <b>utm_campaign</b> исто како во линковите од рекламата (пр. <code>laser-oktomvri</code>), за трошокот да се спари со барањата и приходот. Без кампања = трошок за целиот канал.</p>
      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>{edit.id ? "Трошок" : "Нов трошок"}</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label>Од</Label><Input type="date" value={edit.periodStart} onChange={(e) => setEdit({ ...edit, periodStart: e.target.value })} /></div>
                <div className="space-y-1"><Label>До</Label><Input type="date" value={edit.periodEnd} onChange={(e) => setEdit({ ...edit, periodEnd: e.target.value })} /></div>
              </div>
              <div className="space-y-1"><Label>Канал</Label>
                <Select value={edit.channel} onValueChange={(v) => setEdit({ ...edit, channel: v as Channel })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CHANNELS.map((c) => <SelectItem key={c} value={c}>{CHANNEL_LABEL[c]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Кампања (utm_campaign, опционално)</Label><Input value={edit.campaign} onChange={(e) => setEdit({ ...edit, campaign: e.target.value })} /></div>
              <div className="space-y-1"><Label>Износ (ден.)</Label><Input type="number" min={0} step="0.01" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} /></div>
              <div className="space-y-1"><Label>Белешка</Label><Input value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></div>
              <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEdit(null)}>Откажи</Button>
                <Button disabled={!edit.amount || save.isPending} onClick={() => save.mutate({ id: edit.id, periodStart: edit.periodStart, periodEnd: edit.periodEnd, channel: edit.channel, campaign: edit.campaign.trim() || null, amount: Number(edit.amount), note: edit.note || null })}>Зачувај</Button></div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
