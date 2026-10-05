import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { BellRing } from "lucide-react";

/** Поставки за автоматските CRM потсетници (follow-up на понуди, рокови на зделки, задачи што доцнат). */
export function ReminderSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const utils = trpc.useUtils();
  const { data } = trpc.crm.crmRemindersGet.useQuery(undefined, { enabled: open });
  const save = trpc.crm.crmRemindersSet.useMutation();
  const run = trpc.crm.crmRemindersRunNow.useMutation();
  const [enabled, setEnabled] = useState(true);
  const [days, setDays] = useState("");
  const [digest, setDigest] = useState(false);
  const [emails, setEmails] = useState("");
  useEffect(() => {
    if (!data || !open) return;
    setEnabled(data.enabled); setDays(data.quoteFollowupDays ? String(data.quoteFollowupDays) : ""); setDigest(data.digest);
    setEmails(Object.entries(data.emails ?? {}).map(([k, v]) => `${k} = ${v}`).join("\n"));
  }, [data, open]);

  const parseEmails = () => {
    const out: Record<string, string> = {};
    for (const line of emails.split("\n")) {
      const [name, email] = line.split("=").map((s) => s?.trim());
      if (name && email) out[name] = email;
    }
    return out;
  };
  const onSave = async () => {
    try {
      await save.mutateAsync({ enabled, quoteFollowupDays: days ? Math.max(1, Math.min(60, Number(days) || 3)) : undefined, digest, emails: parseEmails() });
      utils.crm.crmRemindersGet.invalidate();
      toast.success("Зачувано");
      onOpenChange(false);
    } catch (e: any) { toast.error(e?.message?.includes("email") ? "Неважечка е-пошта во листата на продавачи" : e?.message ?? "Грешка"); }
  };
  const onRun = async () => {
    const r = await run.mutateAsync();
    utils.crm.invalidate();
    toast.success(`Нови задачи: ${r.tasksCreated} · известувања: ${r.notificationsCreated}${r.digests ? ` · дигести: ${r.digests}` : ""}`);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><BellRing className="h-5 w-5 text-primary" />Автоматски потсетници</DialogTitle></DialogHeader>
        {data?.disabledByEnv && <p className="text-xs rounded-md border border-destructive/30 bg-destructive/10 p-2">Исклучено на серверот (CRM_REMINDERS_DISABLED=true).</p>}
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">На секои 30 мин. серверот создава задачи и известувања: понуда пратена без одговор по N дена, зделка со поминат рок за затворање и задачи што доцнат. Секој потсетник се создава само еднаш.</p>
          <div className="flex items-center justify-between"><Label>Вклучено</Label><Switch checked={enabled} onCheckedChange={setEnabled} /></div>
          <div className="space-y-1">
            <Label className="text-xs">Follow-up на пратена понуда по (дена)</Label>
            <Input type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} placeholder={`${data?.effectiveDays ?? 3}${data?.envDays ? " (од CRM_QUOTE_FOLLOWUP_DAYS)" : " (стандардно)"}`} />
          </div>
          <div className="flex items-center justify-between">
            <div><Label>Дневен дигест по е-пошта до продавачот</Label>{data && !data.smtp && <p className="text-[11px] text-muted-foreground">Потребен е SMTP (Подесувања → Фирма или SMTP_* env).</p>}</div>
            <Switch checked={digest} onCheckedChange={setDigest} disabled={!data?.smtp} />
          </div>
          {digest && (
            <div className="space-y-1">
              <Label className="text-xs">Е-пошта по продавач (по еден во ред: Име = е-пошта)</Label>
              <Textarea rows={4} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder={"Марко = marko@firma.mk\nЕлена = elena@firma.mk"} />
            </div>
          )}
          <div className="flex gap-2 justify-between pt-1">
            <Button variant="outline" onClick={onRun} disabled={run.isPending}>Провери сега</Button>
            <Button onClick={onSave} disabled={save.isPending}>Зачувај</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
