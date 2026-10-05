import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { PeopleDatalist } from "@/components/crm/shared";

export type FirmForm = {
  id?: number; name: string; company: string; edb: string; taxNumber: string; email: string; phone: string; address: string; city: string; country: string;
  website: string; paymentDays: string; creditLimit: string; tags: string; owner: string; notes: string;
};
export const EMPTY_FIRM: FirmForm = { name: "", company: "", edb: "", taxNumber: "", email: "", phone: "", address: "", city: "", country: "Македонија", website: "", paymentDays: "", creditLimit: "", tags: "", owner: "", notes: "" };

/** Нова фирма / измена на податоците за фирма (ЕДБ, адреса, услови, ознаки, продавач). */
export function FirmDialog({ initial, onClose, onSaved }: { initial?: FirmForm; onClose: () => void; onSaved?: (id: number) => void }) {
  const utils = trpc.useUtils();
  const [f, setF] = useState<FirmForm>(initial ?? EMPTY_FIRM);
  const save = trpc.crm.firmSave.useMutation({
    onSuccess: (r) => { toast.success("Фирмата е зачувана"); utils.crm.invalidate(); utils.customers.customerList.invalidate(); onClose(); onSaved?.(r.id); },
    onError: (e) => toast.error(e.message),
  });
  const set = (k: keyof FirmForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const emailOk = !f.email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogTitle>{f.id ? "Измени фирма" : "Нова фирма"}</DialogTitle>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="space-y-1"><Label className="text-xs">Правен назив *</Label><Input value={f.name} onChange={set("name")} placeholder="пр. Метал Про ДООЕЛ Битола" /></div>
          <div className="space-y-1"><Label className="text-xs">Краток / комерцијален назив</Label><Input value={f.company} onChange={set("company")} placeholder="пр. Метал Про" /></div>
          <div className="space-y-1"><Label className="text-xs">ЕДБ</Label><Input value={f.edb} onChange={set("edb")} placeholder="13 цифри" /></div>
          <div className="space-y-1"><Label className="text-xs">Даночен број (ЕМБС / ДДВ)</Label><Input value={f.taxNumber} onChange={set("taxNumber")} /></div>
          <div className="col-span-2 space-y-1"><Label className="text-xs">Адреса</Label><Input value={f.address} onChange={set("address")} /></div>
          <div className="space-y-1"><Label className="text-xs">Град</Label><Input value={f.city} onChange={set("city")} /></div>
          <div className="space-y-1"><Label className="text-xs">Држава</Label><Input value={f.country} onChange={set("country")} /></div>
          <div className="space-y-1"><Label className="text-xs">Е-пошта (општа)</Label><Input value={f.email} onChange={set("email")} className={emailOk ? "" : "border-red-500"} /></div>
          <div className="space-y-1"><Label className="text-xs">Телефон</Label><Input value={f.phone} onChange={set("phone")} /></div>
          <div className="space-y-1"><Label className="text-xs">Веб-страна</Label><Input value={f.website} onChange={set("website")} placeholder="https://" /></div>
          <div className="space-y-1">
            <Label className="text-xs">Одговорен продавач</Label>
            <Input list="crm-people-firm" value={f.owner} onChange={set("owner")} />
            <PeopleDatalist id="crm-people-firm" />
          </div>
          <div className="space-y-1"><Label className="text-xs">Рок на плаќање (денови)</Label><Input inputMode="numeric" value={f.paymentDays} onChange={set("paymentDays")} placeholder="пр. 30" /></div>
          <div className="space-y-1"><Label className="text-xs">Кредитен лимит (ден)</Label><Input inputMode="decimal" value={f.creditLimit} onChange={set("creditLimit")} placeholder="без лимит" /></div>
          <div className="col-span-2 space-y-1"><Label className="text-xs">Ознаки (одделени со запирка)</Label><Input value={f.tags} onChange={set("tags")} placeholder="пр. VIP, ограда, Битола" /></div>
          <div className="col-span-2 space-y-1"><Label className="text-xs">Белешка</Label><Textarea rows={2} value={f.notes} onChange={set("notes")} /></div>
          <p className="col-span-2 text-[11px] text-muted-foreground">Попусти и посебни цени (ценовник) се уредуваат во <b>Ценовници</b>.</p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Откажи</Button>
          <Button disabled={f.name.trim().length < 1 || !emailOk || save.isPending} onClick={() => save.mutate({
            id: f.id, name: f.name.trim(), company: f.company.trim() || null, edb: f.edb.trim() || null, taxNumber: f.taxNumber.trim() || null, email: f.email.trim() || null,
            phone: f.phone || null, address: f.address || null, city: f.city || null, country: f.country || null, website: f.website || null,
            paymentDays: f.paymentDays ? parseInt(f.paymentDays) : null, creditLimit: f.creditLimit ? parseFloat(f.creditLimit.replace(",", ".")) : null,
            tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean), owner: f.owner.trim() || null, notes: f.notes || null,
          })}>Зачувај</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
