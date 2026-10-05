import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import PageHeader from "@/components/layout/PageHeader";
import { ArrowLeft, Contact as ContactIcon, Pencil, Mail, Phone, Star, Handshake } from "lucide-react";
import { ActivityQuickAdd, ActivityTimeline, StageBadge, fmtMoney } from "@/components/crm/shared";
import { ContactDialog } from "./ContactDialog";

export default function ContactDetail() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { data: c, isLoading, error } = trpc.crm.contactById.useQuery({ id }, { enabled: Number.isFinite(id) });
  const [edit, setEdit] = useState(false);
  if (isLoading) return <p className="text-sm text-muted-foreground">Се вчитува…</p>;
  if (error || !c) return <p className="text-sm text-red-600">{error?.message ?? "Контактот не постои"}</p>;
  return (
    <div className="space-y-5">
      <Link to="/crm/kontakti" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"><ArrowLeft className="h-3 w-3" />Контакт лица</Link>
      <PageHeader title={c.name} icon={<ContactIcon className="h-6 w-6 text-primary" />}
        description={[c.position, c.customer].filter(Boolean).join(" · ")}
        actions={<>
          <Button variant="outline" onClick={() => setEdit(true)}><Pencil className="h-4 w-4 mr-1" />Измени</Button>
          <Button onClick={() => navigate(`/crm?new=1&customerId=${c.customerId}&contactId=${c.id}`)}><Handshake className="h-4 w-4 mr-1" />Нова зделка</Button>
        </>} />
      <div className="grid lg:grid-cols-3 gap-4">
        <Card><CardContent className="p-4 space-y-2 text-sm">
          <p className="font-semibold">{c.isPrimary && <Star className="inline h-3.5 w-3.5 text-amber-500 mr-1" />}{c.isPrimary ? "Главен контакт" : "Контакт"}</p>
          <p>Фирма: <Link to={`/crm/firmi/${c.customerId}`} className="text-primary hover:underline">{c.customer}</Link></p>
          {c.email && <p><a href={`mailto:${c.email}`} className="hover:underline"><Mail className="inline h-3.5 w-3.5 mr-1" />{c.email}</a></p>}
          {c.phone && <p><a href={`tel:${c.phone}`} className="hover:underline"><Phone className="inline h-3.5 w-3.5 mr-1" />{c.phone}</a></p>}
          {c.notes && <p className="text-xs text-muted-foreground whitespace-pre-line">{c.notes}</p>}
          <div className="border-t pt-2 space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">Зделки</p>
            {!c.deals.length ? <p className="text-xs text-muted-foreground">Нема</p> : c.deals.map((d) => (
              <Link key={d.id} to={`/crm?deal=${d.id}`} className="flex justify-between gap-2 text-xs hover:text-primary"><span className="truncate">{d.title}</span><span className="shrink-0"><StageBadge stage={d.stage} /> {fmtMoney(d.value)}</span></Link>
            ))}
          </div>
        </CardContent></Card>
        <Card className="lg:col-span-2"><CardContent className="p-4 space-y-3">
          <p className="font-semibold text-sm">Активности</p>
          <ActivityQuickAdd customerId={c.customerId} contactId={c.id} />
          <ActivityTimeline rows={c.activities} />
        </CardContent></Card>
      </div>
      {edit && <ContactDialog lockFirm initial={{ id: c.id, customerId: c.customerId, name: c.name, position: c.position ?? "", email: c.email ?? "", phone: c.phone ?? "", isPrimary: c.isPrimary, notes: c.notes ?? "" }} onClose={() => setEdit(false)} />}
    </div>
  );
}
