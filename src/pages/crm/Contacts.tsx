import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/layout/EmptyState";
import { Contact as ContactIcon, Plus, Search, Star, Mail, Phone } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { ContactDialog, emptyContact } from "./ContactDialog";

/** Контакт лица — луѓе поврзани со фирма. */
export default function Contacts() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = trpc.crm.contactList.useQuery({ search: search.trim() || undefined });
  const rows = data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader title="Контакт лица" description="Луѓе во фирмите со кои работиме — со позиција, е-пошта, телефон и нивните активности."
        icon={<ContactIcon className="h-6 w-6 text-primary" />}
        actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-1.5" />Нов контакт</Button>} />
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9 h-9" placeholder="Име, е-пошта, телефон, фирма…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <Card><CardContent className="p-0 overflow-x-auto">
        {!isLoading && !rows.length ? (
          <EmptyState title="Нема контакт лица" description="Контактите се додаваат на фирма. Отворете фирма или додајте нов контакт." action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-1.5" />Нов контакт</Button>} />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-muted-foreground border-b"><th className="text-left font-medium p-2">Име</th><th className="text-left font-medium">Фирма</th><th className="text-left font-medium">Позиција</th><th className="text-left font-medium">Е-пошта</th><th className="text-left font-medium">Телефон</th><th className="text-left font-medium">Последна активност</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40 cursor-pointer" onClick={() => navigate(`/crm/kontakti/${c.id}`)}>
                  <td className="p-2 font-medium">{c.isPrimary && <Star className="inline h-3 w-3 text-amber-500 mr-1" />}{c.name}</td>
                  <td><Link to={`/crm/firmi/${c.customerId}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{c.customer}</Link></td>
                  <td>{c.position ?? ""}</td>
                  <td>{c.email ? <a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()} className="hover:underline"><Mail className="inline h-3 w-3 mr-1" />{c.email}</a> : ""}</td>
                  <td>{c.phone ? <a href={`tel:${c.phone}`} onClick={(e) => e.stopPropagation()} className="hover:underline"><Phone className="inline h-3 w-3 mr-1" />{c.phone}</a> : ""}</td>
                  <td className="text-xs text-muted-foreground">{c.lastActivity ? formatDateTime(c.lastActivity) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent></Card>
      {creating && <ContactDialog initial={emptyContact()} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/crm/kontakti/${id}`)} />}
    </div>
  );
}
