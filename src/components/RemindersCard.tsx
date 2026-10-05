import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { BellRing, Send, Save } from "lucide-react";

const DAYS = ["недела", "понеделник", "вторник", "среда", "четврток", "петок", "сабота"];
const money = (n: number, c = "MKD") => `${n.toLocaleString("mk-MK", { maximumFractionDigits: 0 })} ${c === "MKD" ? "ден" : c}`;

/** Подесување на автоматските потсетници по е-пошта. */
export default function RemindersCard() {
  const utils = trpc.useUtils();
  const { data } = trpc.reminders.remindersGet.useQuery();
  const { data: preview } = trpc.reminders.remindersPreview.useQuery();
  const [s, setS] = useState<any>(null);
  useEffect(() => { if (data) setS(data); }, [data]);
  const save = trpc.reminders.remindersSet.useMutation({ onSuccess: () => { toast.success("Потсетниците се зачувани"); utils.reminders.invalidate(); }, onError: (e) => toast.error(e.message) });
  const send = trpc.reminders.remindersSendNow.useMutation({
    onSuccess: (r: any) => { toast.success(`Пратено${r?.sent !== undefined ? `: ${r.sent}` : ""}${r?.skipped ? ` (без е-пошта: ${r.skipped})` : ""}`); utils.reminders.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  if (!s) return null;
  const set = (k: string, v: any) => setS({ ...s, [k]: v });
  const overdueDue = preview?.overdue.filter((o: any) => o.due) ?? [];
  const noEmail = preview?.overdue.filter((o: any) => !o.email).length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BellRing className="h-5 w-5 text-primary" />Автоматски потсетници по е-пошта</CardTitle>
        <p className="text-xs text-gray-500">Се праќаат сами секој ден по {s.sendHour}:00 (по македонско време) преку SMTP погоре. Бара серверот да е буден.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between rounded-lg border px-4 py-3">
          <div><p className="font-medium">Вклучи потсетници</p><p className="text-xs text-gray-500">Главен прекинувач за сите три</p></div>
          <Switch checked={s.enabled} onCheckedChange={(v) => set("enabled", v)} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Е-пошта на шефот (извештаи)</Label><Input value={s.bossEmail} onChange={(e) => set("bossEmail", e.target.value)} placeholder="sef@firma.mk" /></div>
          <div className="space-y-1"><Label>Час на праќање</Label><Input type="number" min={0} max={23} value={s.sendHour} onChange={(e) => set("sendHour", parseInt(e.target.value) || 0)} /></div>
        </div>

        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-medium">1. Доцнење на плаќање → до клиентот</p>
            <Switch checked={s.overdueToCustomer} onCheckedChange={(v) => set("overdueToCustomer", v)} />
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">Повтори најмногу на секои <Input type="number" className="w-16 h-8" value={s.overdueEveryDays} onChange={(e) => set("overdueEveryDays", parseInt(e.target.value) || 7)} /> дена. Копија до шефот.</div>
          <p className="text-xs text-gray-500">Сега: {preview?.overdue.length ?? 0} фактури по рок, {overdueDue.length} за потсетник{noEmail ? `, ${noEmail} клиенти без е-пошта` : ""}.</p>
          {overdueDue.slice(0, 4).map((o: any) => <p key={o.id} className="text-xs text-gray-600">• {o.number} {o.customer} — {money(o.open, o.currency)}, доцни {o.daysLate} дена {o.email ? "" : "(нема е-пошта)"}</p>)}
          <Button size="sm" variant="outline" disabled={!overdueDue.length || send.isPending} onClick={() => { if (confirm(`Да се пратат ${overdueDue.length} потсетници до клиентите сега?`)) send.mutate({ kind: "overdue" }); }}><Send className="h-3.5 w-3.5 mr-1.5" />Прати сега</Button>
        </div>

        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-medium">2. Понуди без одговор → до шефот</p>
            <Switch checked={s.quoteFollowup} onCheckedChange={(v) => set("quoteFollowup", v)} />
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">По <Input type="number" className="w-16 h-8" value={s.quoteFollowupDays} onChange={(e) => set("quoteFollowupDays", parseInt(e.target.value) || 7)} /> дена без прифаќање. Секоја понуда се јавува само еднаш.</div>
          <p className="text-xs text-gray-500">Сега: {preview?.quotes.length ?? 0} понуди.</p>
          <Button size="sm" variant="outline" disabled={!preview?.quotes.length || send.isPending} onClick={() => send.mutate({ kind: "quotes" })}><Send className="h-3.5 w-3.5 mr-1.5" />Прати сега</Button>
        </div>

        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-medium">3. Неделен извештај → до шефот</p>
            <Switch checked={s.weekly} onCheckedChange={(v) => set("weekly", v)} />
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">Секој
            <select className="h-8 rounded border px-2 bg-white" value={s.weeklyWeekday} onChange={(e) => set("weeklyWeekday", parseInt(e.target.value))}>
              {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </div>
          {preview?.weekly && <p className="text-xs text-gray-500">Фактурирано {money(preview.weekly.invoicedMkd)} · наплатено {money(preview.weekly.paymentsReceived)} · {preview.weekly.woDone} завршени налози · {preview.weekly.overdueCount} по рок</p>}
          <Button size="sm" variant="outline" disabled={send.isPending} onClick={() => send.mutate({ kind: "weekly" })}><Send className="h-3.5 w-3.5 mr-1.5" />Прати пробен извештај</Button>
        </div>

        <Button className="bg-emerald-700 hover:bg-emerald-800" disabled={save.isPending} onClick={() => save.mutate(s)}><Save className="h-4 w-4 mr-1" /> Зачувај потсетници</Button>
      </CardContent>
    </Card>
  );
}
