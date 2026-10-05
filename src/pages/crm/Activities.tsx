import { useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/layout/PageHeader";
import { CalendarCheck, CheckCircle2, Circle, ListTodo, Bot, BellRing } from "lucide-react";
import { ACT_META, ActivityTimeline, fmtD, type ActivityRow } from "@/components/crm/shared";
import { NewActivityDialog } from "./NewActivityDialog";
import { ReminderSettingsDialog } from "./ReminderSettingsDialog";

/** Активности и задачи: „Мои задачи / Денес“ (доцнат, денес, наскоро) + целосен дневник. */
export default function Activities() {
  const [tab, setTab] = useState<"mine" | "feed">("mine");
  const [scope, setScope] = useState<"me" | "all">("me");
  const [kind, setKind] = useState("");
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);
  const { data: mine } = trpc.crm.myTasksList.useQuery({ all: scope === "all" });
  const { data: feed } = trpc.crm.activityFeedList.useQuery({ kind: (kind || undefined) as any, limit: 300 }, { enabled: tab === "feed" });
  return (
    <div className="space-y-6">
      <PageHeader title="Активности" description="Повици, средби, е-пошта, белешки и задачи — поврзани со фирма, контакт или зделка."
        icon={<CalendarCheck className="h-6 w-6 text-primary" />}
        actions={<div className="flex gap-2"><Button variant="outline" onClick={() => setSettings(true)}><BellRing className="h-4 w-4 mr-1.5" />Потсетници</Button><Button onClick={() => setCreating(true)}><ListTodo className="h-4 w-4 mr-1.5" />Нова активност / задача</Button></div>} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border bg-card p-0.5">
          <Button size="sm" variant={tab === "mine" ? "default" : "ghost"} className="h-8" onClick={() => setTab("mine")}>Мои задачи / Денес</Button>
          <Button size="sm" variant={tab === "feed" ? "default" : "ghost"} className="h-8" onClick={() => setTab("feed")}>Сите активности</Button>
        </div>
        {tab === "mine" ? (
          <Select value={scope} onValueChange={(v) => setScope(v as any)}>
            <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="me">{mine && !mine.who ? "Сите (без најава)" : `Само мои${mine?.who ? ` (${mine.who})` : ""}`}</SelectItem><SelectItem value="all">На сите</SelectItem></SelectContent>
          </Select>
        ) : (
          <Select value={kind || "all"} onValueChange={(v) => setKind(v === "all" ? "" : v)}>
            <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Сите видови</SelectItem>{Object.entries(ACT_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </div>

      {tab === "mine" ? (
        <div className="grid lg:grid-cols-3 gap-4">
          <Bucket title="Доцнат" tone="text-red-600" rows={mine?.overdue} empty="Ништо не доцни 👍" />
          <Bucket title="Денес" tone="text-foreground" rows={mine?.today} empty="Нема задачи за денес" />
          <Bucket title="Наскоро (7 дена)" tone="text-muted-foreground" rows={mine?.upcoming} empty="Нема" />
          {!!mine?.later.length && <div className="lg:col-span-3"><Bucket title="Подоцна / без рок" tone="text-muted-foreground" rows={mine.later} empty="" /></div>}
        </div>
      ) : (
        <Card><CardContent className="p-4"><ActivityTimeline rows={feed} /></CardContent></Card>
      )}
      {creating && <NewActivityDialog onClose={() => setCreating(false)} />}
      <ReminderSettingsDialog open={settings} onOpenChange={setSettings} />
    </div>
  );
}

function Bucket({ title, tone, rows, empty }: { title: string; tone: string; rows: ActivityRow[] | undefined; empty: string }) {
  const utils = trpc.useUtils();
  const done = trpc.crm.activityDone.useMutation({ onSuccess: () => utils.crm.invalidate() });
  return (
    <Card><CardContent className="p-4 space-y-2">
      <p className={`font-semibold text-sm ${tone}`}>{title} <span className="text-xs text-muted-foreground font-normal">({rows?.length ?? 0})</span></p>
      {!rows?.length ? <p className="text-xs text-muted-foreground">{empty}</p> : rows.map((t) => (
        <div key={t.id} className="flex items-start gap-2 text-sm border-t pt-1.5">
          <button type="button" className="mt-0.5 text-muted-foreground hover:text-primary" onClick={() => done.mutate({ id: t.id, done: !t.doneAt })} aria-label="Заврши">
            {t.doneAt ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4" />}
          </button>
          <div className="flex-1 min-w-0">
            <p>{t.subject}{t.auto && <Bot className="inline h-3 w-3 ml-1 text-muted-foreground" aria-label="автоматски" />}</p>
            <p className="text-[11px] text-muted-foreground">
              {t.customerId && <Link to={`/crm/firmi/${t.customerId}`} className="hover:text-primary">{t.customer}</Link>}
              {t.contactId && <> · <Link to={`/crm/kontakti/${t.contactId}`} className="hover:text-primary">{t.contact}</Link></>}
              {t.opportunityId && <> · <Link to={`/crm?deal=${t.opportunityId}`} className="hover:text-primary">{t.opportunity}</Link></>}
              {t.assignee && <> · → {t.assignee}</>}
            </p>
          </div>
          <span className={`text-xs shrink-0 ${tone}`}>{fmtD(t.dueDate)}</span>
        </div>
      ))}
    </CardContent></Card>
  );
}
