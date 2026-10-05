import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import SearchPick from "@/components/SearchPick";
import { toast } from "sonner";

export type ContactForm = { id?: number; customerId: number | null; name: string; position: string; email: string; phone: string; isPrimary: boolean; notes: string };
export const emptyContact = (customerId: number | null = null): ContactForm => ({ customerId, name: "", position: "", email: "", phone: "", isPrimary: false, notes: "" });

export function ContactDialog({ initial, lockFirm, onClose, onSaved }: { initial: ContactForm; lockFirm?: boolean; onClose: () => void; onSaved?: (id: number) => void }) {
  const utils = trpc.useUtils();
  const [f, setF] = useState<ContactForm>(initial);
  const { data: firms } = trpc.crm.firmList.useQuery(undefined, { enabled: !lockFirm });
  const items = useMemo(() => (firms ?? []).map((c) => ({ id: c.id, label: c.name, sub: c.city ?? null })), [firms]);
  const save = trpc.crm.contactSave.useMutation({
    onSuccess: (r) => { toast.success("Контактот е зачуван"); utils.crm.invalidate(); onClose(); onSaved?.(r.id); },
    onError: (e) => toast.error(e.message),
  });
  const emailOk = !f.email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>{f.id ? "Измени контакт" : "Нов контакт"}</DialogTitle>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {!lockFirm && (
            <div className="col-span-2 space-y-1"><Label className="text-xs">Фирма *</Label>
              <SearchPick items={items} value={f.customerId} onChange={(v) => setF({ ...f, customerId: v })} placeholder="Избери фирма…" /></div>
          )}
          <div className="col-span-2 space-y-1"><Label className="text-xs">Име и презиме *</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="col-span-2 space-y-1"><Label className="text-xs">Позиција</Label><Input value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} placeholder="пр. Набавка, Управител, Сметководство" /></div>
          <div className="space-y-1"><Label className="text-xs">Е-пошта</Label><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={emailOk ? "" : "border-red-500"} /></div>
          <div className="space-y-1"><Label className="text-xs">Телефон</Label><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isPrimary} onChange={(e) => setF({ ...f, isPrimary: e.target.checked })} />Главен контакт на фирмата (оди прв на понуди и е-пошта)</label>
          <div className="col-span-2 space-y-1"><Label className="text-xs">Белешка</Label><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Откажи</Button>
          <Button disabled={!f.customerId || f.name.trim().length < 2 || !emailOk || save.isPending}
            onClick={() => save.mutate({ id: f.id, customerId: f.customerId!, name: f.name.trim(), position: f.position || null, email: f.email.trim() || null, phone: f.phone || null, isPrimary: f.isPrimary, notes: f.notes || null })}>Зачувај</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
