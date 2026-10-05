import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import PageHeader from "@/components/layout/PageHeader";
import { Building2, Pencil, Plus, Star, Mail, Phone, Handshake, FileText, AlertTriangle, ArrowLeft, Tags, Trash2 } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { ActivityQuickAdd, ActivityTimeline, StageBadge, QUOTE_STATUS, fmtD, fmtMoney } from "@/components/crm/shared";
import { FirmDialog, type FirmForm } from "./FirmDialog";
import { ContactDialog, emptyContact, type ContactForm } from "./ContactDialog";

const TABS = [
  ["overview", "Преглед"], ["contacts", "Контакти"], ["deals", "Зделки"], ["activities", "Активности"], ["docs", "Понуди / нарачки / фактури"], ["emails", "Е-пошта"],
] as const;
type Tab = (typeof TABS)[number][0];

/** Фирма — 360° преглед. */
export default function FirmDetail() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "overview";
  const setTab = (t: Tab) => { const n = new URLSearchParams(params); n.set("tab", t); setParams(n, { replace: true }); };
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data: firm, isLoading, error } = trpc.crm.firmById.useQuery({ id }, { enabled: Number.isFinite(id) });
  const { data: contacts } = trpc.crm.contactList.useQuery({ customerId: id }, { enabled: Number.isFinite(id) });
  const { data: deals } = trpc.crm.oppList.useQuery({ customerId: id, includeClosed: true }, { enabled: Number.isFinite(id) });
  const { data: acts } = trpc.crm.activityFeedList.useQuery({ customerId: id }, { enabled: tab === "activities" || tab === "overview" });
  const { data: docs } = trpc.crm.firmDocsList.useQuery({ id }, { enabled: tab === "docs" || tab === "overview" });
  const { data: emails } = trpc.crm.firmEmailsList.useQuery({ id }, { enabled: tab === "emails" });
  const [editFirm, setEditFirm] = useState(false);
  const [contact, setContact] = useState<ContactForm | null>(null);
  const delContact = trpc.crm.contactDelete.useMutation({ onSuccess: () => utils.crm.invalidate() });

  if (isLoading) return <p className="text-sm text-muted-foreground">Се вчитува…</p>;
  if (error || !firm) return <div className="space-y-2"><p className="text-sm text-red-600">{error?.message ?? "Фирмата не постои"}</p><Link to="/crm/firmi" className="text-primary text-sm">← Назад кон фирми</Link></div>;

  const openDeals = (deals ?? []).filter((d) => d.stage !== "won" && d.stage !== "lost");
  const ov = firm.overview;
  const form: FirmForm = {
    id: firm.id, name: firm.legalName ?? "", company: firm.company ?? "", edb: firm.edb ?? "", taxNumber: firm.taxNumber ?? "", email: firm.email ?? "", phone: firm.phone ?? "",
    address: firm.address ?? "", city: firm.city ?? "", country: firm.country ?? "", website: firm.website ?? "", paymentDays: firm.paymentDays == null ? "" : String(firm.paymentDays),
    creditLimit: firm.creditLimit == null ? "" : String(firm.creditLimit), tags: firm.tags.join(", "), owner: firm.owner ?? "", notes: firm.notes ?? "",
  };

  return (
    <div className="space-y-5">
      <Link to="/crm/firmi" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"><ArrowLeft className="h-3 w-3" />Фирми</Link>
      <PageHeader title={firm.name} icon={<Building2 className="h-6 w-6 text-primary" />}
        description={[firm.legalName !== firm.name ? firm.legalName : null, firm.edb ? `ЕДБ ${firm.edb}` : null, firm.city, firm.owner ? `продавач: ${firm.owner}` : null].filter(Boolean).join(" · ")}
        actions={<>
          <Button variant="outline" onClick={() => setEditFirm(true)}><Pencil className="h-4 w-4 mr-1" />Измени</Button>
          <Button variant="outline" onClick={() => setContact(emptyContact(firm.id))}><Plus className="h-4 w-4 mr-1" />Контакт</Button>
          <Button onClick={() => navigate(`/crm?new=1&customerId=${firm.id}`)}><Handshake className="h-4 w-4 mr-1" />Нова зделка</Button>
        </>} />
      {!!firm.tags.length && <div className="flex flex-wrap gap-1">{firm.tags.map((t) => <span key={t} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs">{t}</span>)}</div>}

      <div className="flex flex-wrap gap-1 rounded-lg border bg-card p-0.5 w-fit">
        {TABS.map(([k, l]) => (
          <Button key={k} size="sm" variant={tab === k ? "default" : "ghost"} className="h-8" onClick={() => setTab(k)}>
            {l}{k === "contacts" && contacts ? ` (${contacts.length})` : k === "deals" && deals ? ` (${openDeals.length})` : ""}
          </Button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Отворени зделки" value={String(ov.openDeals)} sub={fmtMoney(ov.openDealsValue)} onClick={() => setTab("deals")} />
            <Stat label="Отворени понуди" value={String(ov.openQuotes)} sub={fmtMoney(ov.openQuotesValue)} onClick={() => setTab("docs")} />
            <Stat label="Неплатено" value={fmtMoney(ov.unpaid)} tone={ov.overCredit ? "text-red-600" : undefined}
              sub={firm.creditLimit != null ? `лимит ${fmtMoney(firm.creditLimit)}` : "без кредитен лимит"} onClick={() => setTab("docs")} />
            <Stat label="Последна активност" value={ov.lastActivity ? formatDateTime(ov.lastActivity.createdAt) : "—"} sub={ov.lastActivity?.subject ?? `${ov.openTasks} отворени задачи`} onClick={() => setTab("activities")} small />
          </div>
          {ov.overCredit && <p className="text-sm text-red-700 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />Фирмата е над кредитниот лимит.</p>}
          <div className="grid lg:grid-cols-3 gap-4">
            <Card><CardContent className="p-4 space-y-1.5 text-sm">
              <p className="font-semibold">Податоци</p>
              <Row k="Адреса" v={[firm.address, firm.city, firm.country].filter(Boolean).join(", ")} />
              <Row k="ЕДБ / даночен" v={[firm.edb, firm.taxNumber].filter(Boolean).join(" / ")} />
              <Row k="Е-пошта" v={firm.email} />
              <Row k="Телефон" v={firm.phone} />
              <Row k="Веб" v={firm.website} />
              <Row k="Рок на плаќање" v={firm.paymentDays != null ? `${firm.paymentDays} дена` : null} />
              <Row k="Попуст" v={firm.discountPct ? `${firm.discountPct}%` : null} />
              <p className="text-xs pt-1"><Link to="/cenovnici" className="text-primary hover:underline inline-flex items-center gap-1"><Tags className="h-3 w-3" />Ценовник: {firm.specialPrices} посебни цени</Link></p>
              {firm.notes && <p className="text-xs text-muted-foreground whitespace-pre-line pt-1">{firm.notes}</p>}
            </CardContent></Card>
            <Card><CardContent className="p-4 space-y-2 text-sm">
              <p className="font-semibold flex justify-between">Контакт лица <button className="text-xs text-primary" onClick={() => setTab("contacts")}>сите</button></p>
              {!contacts?.length ? <p className="text-xs text-muted-foreground">Нема контакти. <button className="text-primary" onClick={() => setContact(emptyContact(firm.id))}>Додај</button></p> :
                contacts.slice(0, 5).map((c) => (
                  <Link key={c.id} to={`/crm/kontakti/${c.id}`} className="block hover:bg-muted/40 rounded px-1 -mx-1">
                    <p className="font-medium">{c.isPrimary && <Star className="inline h-3 w-3 text-amber-500 mr-1" />}{c.name}<span className="text-xs text-muted-foreground"> {c.position ?? ""}</span></p>
                    <p className="text-xs text-muted-foreground">{[c.email, c.phone].filter(Boolean).join(" · ")}</p>
                  </Link>
                ))}
            </CardContent></Card>
            <Card><CardContent className="p-4 space-y-2 text-sm">
              <p className="font-semibold flex justify-between">Отворени зделки <button className="text-xs text-primary" onClick={() => setTab("deals")}>сите</button></p>
              {!openDeals.length ? <p className="text-xs text-muted-foreground">Нема отворени зделки.</p> : openDeals.slice(0, 5).map((d) => (
                <Link key={d.id} to={`/crm?deal=${d.id}`} className="flex justify-between gap-2 hover:bg-muted/40 rounded px-1 -mx-1">
                  <span className="truncate">{d.title}</span><span className="shrink-0 text-xs"><StageBadge stage={d.stage} /> {fmtMoney(d.value)}</span>
                </Link>
              ))}
            </CardContent></Card>
          </div>
          <Card><CardContent className="p-4 space-y-2">
            <p className="font-semibold text-sm">Последни активности</p>
            <ActivityQuickAdd customerId={firm.id} contacts={(contacts ?? []).map((c) => ({ id: c.id, name: c.name }))} />
            <ActivityTimeline rows={acts?.slice(0, 8)} />
          </CardContent></Card>
        </div>
      )}

      {tab === "contacts" && (
        <Card><CardContent className="p-0 overflow-x-auto">
          <div className="p-3 flex justify-end"><Button size="sm" onClick={() => setContact(emptyContact(firm.id))}><Plus className="h-4 w-4 mr-1" />Нов контакт</Button></div>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-muted-foreground border-y"><th className="text-left font-medium p-2">Име</th><th className="text-left font-medium">Позиција</th><th className="text-left font-medium">Е-пошта</th><th className="text-left font-medium">Телефон</th><th className="text-left font-medium">Последна активност</th><th /></tr></thead>
            <tbody>
              {(contacts ?? []).map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="p-2"><Link to={`/crm/kontakti/${c.id}`} className="font-medium hover:text-primary">{c.isPrimary && <Star className="inline h-3 w-3 text-amber-500 mr-1" />}{c.name}</Link></td>
                  <td>{c.position ?? ""}</td>
                  <td>{c.email ? <a className="text-primary hover:underline" href={`mailto:${c.email}`}><Mail className="inline h-3 w-3 mr-1" />{c.email}</a> : ""}</td>
                  <td>{c.phone ? <a className="hover:underline" href={`tel:${c.phone}`}><Phone className="inline h-3 w-3 mr-1" />{c.phone}</a> : ""}</td>
                  <td className="text-xs text-muted-foreground">{c.lastActivity ? formatDateTime(c.lastActivity) : "—"}</td>
                  <td className="text-right pr-2 whitespace-nowrap">
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => setContact({ id: c.id, customerId: c.customerId, name: c.name, position: c.position ?? "", email: c.email ?? "", phone: c.phone ?? "", isPrimary: c.isPrimary, notes: c.notes ?? "" })}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 text-red-600" onClick={() => { if (confirm(`Да се избрише ${c.name}?`)) delContact.mutate({ id: c.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </td>
                </tr>
              ))}
              {!contacts?.length && <tr><td colSpan={6} className="text-center text-muted-foreground py-8">Нема контакт лица</td></tr>}
            </tbody>
          </table>
        </CardContent></Card>
      )}

      {tab === "deals" && (
        <Card><CardContent className="p-0 overflow-x-auto">
          <div className="p-3 flex justify-end"><Button size="sm" onClick={() => navigate(`/crm?new=1&customerId=${firm.id}`)}><Plus className="h-4 w-4 mr-1" />Нова зделка</Button></div>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-muted-foreground border-y"><th className="text-left font-medium p-2">Зделка</th><th className="text-left font-medium">Контакт</th><th className="text-left font-medium">Фаза</th><th className="text-right font-medium">Вредност</th><th className="text-left font-medium pl-3">Затворање</th><th className="text-left font-medium">Продавач</th><th className="text-left font-medium">Понуда</th></tr></thead>
            <tbody>
              {(deals ?? []).map((d) => (
                <tr key={d.id} className="border-b last:border-0 hover:bg-muted/40 cursor-pointer" onClick={() => navigate(`/crm?deal=${d.id}`)}>
                  <td className="p-2 font-medium">{d.title}</td><td>{d.contact ?? ""}</td><td><StageBadge stage={d.stage} /></td>
                  <td className="text-right tabular-nums">{fmtMoney(d.value, d.currency)}</td><td className="pl-3">{fmtD(d.expectedClose)}</td><td>{d.owner ?? ""}</td><td>{d.quoteNumber ?? ""}</td>
                </tr>
              ))}
              {!deals?.length && <tr><td colSpan={7} className="text-center text-muted-foreground py-8">Нема зделки за оваа фирма</td></tr>}
            </tbody>
          </table>
        </CardContent></Card>
      )}

      {tab === "activities" && (
        <Card><CardContent className="p-4 space-y-3">
          <ActivityQuickAdd customerId={firm.id} contacts={(contacts ?? []).map((c) => ({ id: c.id, name: c.name }))} />
          <ActivityTimeline rows={acts} />
        </CardContent></Card>
      )}

      {tab === "docs" && (
        <div className="grid lg:grid-cols-3 gap-4">
          <DocList title="Понуди" rows={(docs?.quotes ?? []).map((r) => ({ id: r.id, number: r.number, status: QUOTE_STATUS[r.status] ?? r.status, total: fmtMoney(r.total, r.currency), date: fmtD(r.date), href: `/ponudi?open=${r.id}` }))}
            action={<Button size="sm" variant="outline" className="h-7" onClick={() => navigate(`/ponudi?new=1&customerId=${firm.id}`)}><FileText className="h-3.5 w-3.5 mr-1" />Нова</Button>} />
          <DocList title="Нарачки" rows={(docs?.orders ?? []).map((r) => ({ id: r.id, number: r.number, status: r.status, total: fmtMoney(r.total), date: fmtD(r.date), href: `/klienti?order=${r.id}` }))} />
          <DocList title="Фактури" rows={(docs?.invoices ?? []).map((r) => ({ id: r.id, number: r.number, status: `${r.status}${r.type && r.type !== "standard" ? ` · ${r.type}` : ""}`, total: fmtMoney(r.total, r.currency), date: fmtD(r.date), href: `/smetkovodstvo?open=${r.id}` }))} />
        </div>
      )}

      {tab === "emails" && (
        <Card><CardContent className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">Пораки пратени од апликацијата (пр. „Прати по мејл“ на понуда). Влезните пораки (IMAP синхронизација) ќе се прикажуваат тука во следна верзија.</p>
          {!emails?.length ? <p className="text-sm text-muted-foreground text-center py-6">Нема пратени пораки</p> : emails.map((e) => (
            <div key={e.id} className="border rounded-lg p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-medium"><Mail className="inline h-3.5 w-3.5 mr-1 text-primary" />{e.subject}</p>
                <span className="text-xs text-muted-foreground">{formatDateTime(e.sentAt)}{e.sentBy ? ` · ${e.sentBy}` : ""}</span>
              </div>
              <p className="text-xs text-muted-foreground">До: {e.to}{e.cc ? ` · CC: ${e.cc}` : ""}{e.attachment ? ` · 📎 ${e.attachment}` : ""}
                {e.quotationId && <> · <Link to={`/ponudi?open=${e.quotationId}`} className="text-primary hover:underline">понуда {e.quoteNumber}</Link></>}</p>
              {e.body && <p className="text-xs whitespace-pre-line mt-1 line-clamp-5">{e.body}</p>}
            </div>
          ))}
        </CardContent></Card>
      )}

      {editFirm && <FirmDialog initial={form} onClose={() => setEditFirm(false)} />}
      {contact && <ContactDialog initial={contact} lockFirm onClose={() => setContact(null)} />}
    </div>
  );
}

function Stat({ label, value, sub, tone, onClick, small }: { label: string; value: string; sub?: string | null; tone?: string; onClick?: () => void; small?: boolean }) {
  return (
    <Card className={onClick ? "cursor-pointer hover:border-primary/40" : ""} onClick={onClick}><CardContent className="p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className={`${small ? "text-base" : "text-2xl"} font-bold ${tone ?? "text-foreground"}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
    </CardContent></Card>
  );
}
function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return <p className="flex gap-2"><span className="w-28 shrink-0 text-xs text-muted-foreground">{k}</span><span className="flex-1">{v || "—"}</span></p>;
}
function DocList({ title, rows, action }: { title: string; rows: { id: number; number: string; status: string; total: string; date: string; href: string }[]; action?: React.ReactNode }) {
  return (
    <Card><CardContent className="p-4 space-y-2 text-sm">
      <p className="font-semibold flex items-center justify-between">{title} <span className="flex items-center gap-2 text-xs text-muted-foreground font-normal">{rows.length}{action}</span></p>
      {!rows.length ? <p className="text-xs text-muted-foreground">Нема</p> : rows.slice(0, 50).map((r) => (
        <Link key={r.id} to={r.href} className="flex justify-between gap-2 border-t pt-1.5 hover:text-primary">
          <span><b>{r.number}</b><span className="text-xs text-muted-foreground"> · {r.date} · {r.status}</span></span><span className="tabular-nums text-xs">{r.total}</span>
        </Link>
      ))}
    </CardContent></Card>
  );
}
