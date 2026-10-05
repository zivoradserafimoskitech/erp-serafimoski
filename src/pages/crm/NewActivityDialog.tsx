import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SearchPick from "@/components/SearchPick";
import { toast } from "sonner";
import { ACT_META, PeopleDatalist, todayYmd } from "@/components/crm/shared";

/** Нова активност или задача со избор на фирма → контакт → зделка. */
export function NewActivityDialog({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const [f, setF] = useState({ kind: "task", subject: "", notes: "", dueDate: todayYmd(), assignee: "", customerId: null as number | null, contactId: null as number | null, opportunityId: null as number | null });
  const { data: firms } = trpc.crm.firmList.useQuery();
  const { data: contacts } = trpc.crm.contactList.useQuery({ customerId: f.customerId! }, { enabled: !!f.customerId });
  const { data: deals } = trpc.crm.oppList.useQuery({ customerId: f.customerId! }, { enabled: !!f.customerId });
  const items = useMemo(() => (firms ?? []).map((c) => ({ id: c.id, label: c.name, sub: c.city ?? null })), [firms]);
  const save = trpc.crm.activityUpsert.useMutation({ onSuccess: () => { toast.success("Зачувано"); utils.crm.invalidate(); onClose(); }, onError: (e) => toast.error(e.message) });
  const isTask = f.kind === "task";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Нова активност / задача</DialogTitle>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="space-y-1"><Label className="text-xs">Вид</Label>
            <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v })}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(ACT_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select></div>
          {isTask && <div className="space-y-1"><Label className="text-xs">Рок</Label><DateInput value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></div>}
          <div className="col-span-2 space-y-1"><Label className="text-xs">Наслов *</Label><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder={isTask ? "пр. Јави се за мерките" : "пр. Разговор за цена"} /></div>
          <div className="col-span-2 space-y-1"><Label className="text-xs">Фирма *</Label><SearchPick items={items} value={f.customerId} onChange={(v) => setF({ ...f, customerId: v, contactId: null, opportunityId: null })} placeholder="Избери фирма…" /></div>
          <div className="space-y-1"><Label className="text-xs">Контакт</Label>
            <Select value={f.contactId ? String(f.contactId) : "none"} onValueChange={(v) => setF({ ...f, contactId: v === "none" ? null : Number(v) })} disabled={!f.customerId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">—</SelectItem>{(contacts ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Зделка</Label>
            <Select value={f.opportunityId ? String(f.opportunityId) : "none"} onValueChange={(v) => setF({ ...f, opportunityId: v === "none" ? null : Number(v) })} disabled={!f.customerId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">—</SelectItem>{(deals ?? []).map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.title}</SelectItem>)}</SelectContent></Select></div>
          {isTask && <div className="col-span-2 space-y-1"><Label className="text-xs">Извршител</Label><Input list="crm-people-new" value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })} placeholder="празно = јас" /><PeopleDatalist id="crm-people-new" /></div>}
          <div className="col-span-2 space-y-1"><Label className="text-xs">Белешка</Label><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Откажи</Button>
          <Button disabled={!f.customerId || f.subject.trim().length < 2 || save.isPending} onClick={() => save.mutate({
            customerId: f.customerId, contactId: f.contactId, opportunityId: f.opportunityId, kind: f.kind as any, subject: f.subject.trim(), notes: f.notes || null,
            dueDate: isTask ? f.dueDate || null : null, assignee: isTask ? f.assignee || null : null,
          })}>Зачувај</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
