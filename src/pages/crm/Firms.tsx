import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/layout/EmptyState";
import { Building2, Plus, Search } from "lucide-react";
import { fmtMoney } from "@/components/crm/shared";
import { formatDateTime } from "@/lib/utils";
import { FirmDialog } from "./FirmDialog";

/** Фирми (купувачи) — листа со филтер по ознака / продавач. */
export default function Firms() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [owner, setOwner] = useState("");
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = trpc.crm.firmList.useQuery({ search: search.trim() || undefined, tag: tag || undefined, owner: owner || undefined });
  const { data: tags } = trpc.crm.firmTagsList.useQuery();
  const { data: people } = trpc.crm.crmPeopleList.useQuery();
  const rows = data ?? [];
  const totals = useMemo(() => ({ deals: rows.reduce((s, r) => s + r.openDeals, 0), value: rows.reduce((s, r) => s + r.openValue, 0) }), [rows]);

  return (
    <div className="space-y-6">
      <PageHeader title="Фирми" description="Купувачи како компании: контакт лица, зделки, активности, понуди, нарачки и фактури на едно место (360° преглед)."
        icon={<Building2 className="h-6 w-6 text-primary" />}
        actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-1.5" />Нова фирма</Button>} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[14rem] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9 h-9" placeholder="Назив, ЕДБ, даночен број, град…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={tag || "all"} onValueChange={(v) => setTag(v === "all" ? "" : v)}>
          <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Ознака" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Сите ознаки</SelectItem>{(tags ?? []).map((t) => <SelectItem key={t.tag} value={t.tag}>{t.tag} ({t.count})</SelectItem>)}</SelectContent>
        </Select>
        <Select value={owner || "all"} onValueChange={(v) => setOwner(v === "all" ? "" : v)}>
          <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Продавач" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Сите продавачи</SelectItem>{(people ?? []).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">{rows.length} фирми · {totals.deals} отворени зделки · {fmtMoney(totals.value)}</span>
      </div>

      <Card><CardContent className="p-0 overflow-x-auto">
        {!isLoading && !rows.length ? (
          <EmptyState title="Нема фирми" description="Додајте ја првата фирма — или сменете го филтерот." action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-1.5" />Нова фирма</Button>} />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-muted-foreground border-b">
              <th className="text-left font-medium p-2">Фирма</th><th className="text-left font-medium">Град</th><th className="text-left font-medium">ЕДБ</th>
              <th className="text-left font-medium">Ознаки</th><th className="text-left font-medium">Продавач</th><th className="text-right font-medium">Контакти</th>
              <th className="text-right font-medium">Отворени зделки</th><th className="text-left font-medium pl-3">Последна активност</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40 cursor-pointer" onClick={() => navigate(`/crm/firmi/${r.id}`)}>
                  <td className="p-2"><Link to={`/crm/firmi/${r.id}`} className="font-medium text-foreground hover:text-primary">{r.name}</Link>
                    {!r.active && <span className="ml-1 text-[10px] text-muted-foreground">(неактивна)</span>}
                    {r.email && <p className="text-[11px] text-muted-foreground">{r.email}</p>}</td>
                  <td>{r.city ?? ""}</td>
                  <td className="tabular-nums text-xs">{r.edb ?? r.taxNumber ?? ""}</td>
                  <td><div className="flex flex-wrap gap-1">{r.tags.map((t) => <span key={t} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px]">{t}</span>)}</div></td>
                  <td>{r.owner ?? ""}</td>
                  <td className="text-right tabular-nums">{r.contacts}</td>
                  <td className="text-right tabular-nums">{r.openDeals ? `${r.openDeals} · ${fmtMoney(r.openValue)}` : "—"}</td>
                  <td className="pl-3 text-xs text-muted-foreground">{r.lastActivity ? formatDateTime(r.lastActivity) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent></Card>

      {creating && <FirmDialog onClose={() => setCreating(false)} onSaved={(id) => navigate(`/crm/firmi/${id}`)} />}
    </div>
  );
}
