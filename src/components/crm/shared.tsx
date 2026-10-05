import { useMemo, useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/utils";
import { Phone, Users, Mail, MapPin, StickyNote, ListTodo, CheckCircle2, Circle, Bot } from "lucide-react";
import { DEAL_STAGE_LABEL, type DealStage } from "@contracts/crm";

export const fmtMoney = (n: number | null | undefined, cur = "MKD") =>
  n === null || n === undefined ? "—" : `${n.toLocaleString("mk-MK", { maximumFractionDigits: 0 })} ${cur === "MKD" ? "ден" : cur}`;
export const fmtD = (d?: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "");
export const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const ACT_META: Record<string, { label: string; icon: typeof Phone }> = {
  call: { label: "Повик", icon: Phone },
  meeting: { label: "Средба", icon: Users },
  email: { label: "Е-пошта", icon: Mail },
  visit: { label: "Посета", icon: MapPin },
  note: { label: "Белешка", icon: StickyNote },
  task: { label: "Задача", icon: ListTodo },
};

export const STAGE_TONE: Record<DealStage, string> = {
  new: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20",
  contacted: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20",
  quoting: "bg-primary/10 text-foreground border-primary/20",
  quoted: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20",
  won: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
  lost: "bg-muted text-muted-foreground border-border",
};

export function StageBadge({ stage }: { stage: string }) {
  const s = (stage in DEAL_STAGE_LABEL ? stage : "new") as DealStage;
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${STAGE_TONE[s]}`}>{DEAL_STAGE_LABEL[s]}</span>;
}

export const QUOTE_STATUS: Record<string, string> = {
  draft: "Нацрт", sent: "Пратена", accepted: "Прифатена", rejected: "Одбиена", expired: "Истечена", converted: "Во нарачка", pending: "Во изработка",
};

/** Предлози за продавач / извршител (корисници + досега внесени). */
export function PeopleDatalist({ id }: { id: string }) {
  const { data } = trpc.crm.crmPeopleList.useQuery();
  return <datalist id={id}>{(data ?? []).map((n) => <option key={n} value={n} />)}</datalist>;
}

export type ActivityRow = {
  id: number; kind: string; subject: string; notes: string | null; dueDate: string | null; doneAt: any; assignee: string | null;
  createdBy: string | null; createdAt: any; customer?: string | null; customerId?: number | null; contact?: string | null; contactId?: number | null;
  opportunity?: string | null; opportunityId?: number | null; auto?: boolean;
};

/** Временска линија на активности (со штиклирање задачи). */
export function ActivityTimeline({ rows, showLinks = true, empty = "Нема активности" }: { rows: ActivityRow[] | undefined; showLinks?: boolean; empty?: string }) {
  const utils = trpc.useUtils();
  const done = trpc.crm.activityDone.useMutation({ onSuccess: () => utils.crm.invalidate() });
  if (!rows?.length) return <p className="text-sm text-muted-foreground py-4 text-center">{empty}</p>;
  const today = todayYmd();
  return (
    <ol className="relative border-l border-border ml-2 space-y-3">
      {rows.map((a) => {
        const I = ACT_META[a.kind]?.icon ?? StickyNote;
        const isTask = a.kind === "task";
        const late = isTask && !a.doneAt && a.dueDate && a.dueDate < today;
        return (
          <li key={a.id} className="ml-4">
            <span className="absolute -left-[9px] flex h-[18px] w-[18px] items-center justify-center rounded-full border bg-card">
              <I className="h-2.5 w-2.5 text-primary" />
            </span>
            <div className="flex items-start gap-2">
              {isTask && (
                <button type="button" className="mt-0.5 text-muted-foreground hover:text-primary" onClick={() => done.mutate({ id: a.id, done: !a.doneAt })} aria-label="Заврши">
                  {a.doneAt ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4" />}
                </button>
              )}
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${isTask && a.doneAt ? "line-through text-muted-foreground" : ""}`}>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground mr-1.5">{ACT_META[a.kind]?.label ?? a.kind}</span>
                  {a.subject}
                  {a.auto && <Bot className="inline h-3 w-3 ml-1 text-muted-foreground" aria-label="автоматски" />}
                </p>
                {a.notes && <p className="text-xs text-muted-foreground whitespace-pre-line line-clamp-4">{a.notes}</p>}
                <p className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-2">
                  {isTask && a.dueDate && <span className={late ? "text-red-600 font-semibold" : ""}>рок {fmtD(a.dueDate)}</span>}
                  {isTask && a.assignee && <span>→ {a.assignee}</span>}
                  <span>{formatDateTime(a.createdAt)}{a.createdBy ? ` · ${a.createdBy}` : ""}</span>
                  {showLinks && a.customerId && <Link className="text-primary hover:underline" to={`/crm/firmi/${a.customerId}`}>{a.customer}</Link>}
                  {showLinks && a.contactId && <Link className="text-primary hover:underline" to={`/crm/kontakti/${a.contactId}`}>{a.contact}</Link>}
                  {showLinks && a.opportunityId && <Link className="text-primary hover:underline" to={`/crm?deal=${a.opportunityId}`}>{a.opportunity}</Link>}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Брзо додавање активност/задача поврзана со фирма/контакт/зделка. */
export function ActivityQuickAdd({ customerId, contactId, opportunityId, contacts }: {
  customerId?: number | null; contactId?: number | null; opportunityId?: number | null; contacts?: { id: number; name: string }[];
}) {
  const utils = trpc.useUtils();
  const [a, setA] = useState({ kind: "call", subject: "", notes: "", dueDate: "", assignee: "", contactId: contactId ?? null as number | null });
  const add = trpc.crm.activityUpsert.useMutation({
    onSuccess: () => { setA({ ...a, subject: "", notes: "", dueDate: "" }); utils.crm.invalidate(); toast.success(a.kind === "task" ? "Задачата е додадена" : "Активноста е запишана"); },
    onError: (e) => toast.error(e.message),
  });
  const contactItems = useMemo(() => contacts ?? [], [contacts]);
  return (
    <div className="rounded-lg border bg-muted/30 p-2.5 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <Select value={a.kind} onValueChange={(v) => setA({ ...a, kind: v })}>
          <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(ACT_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
        </Select>
        <Input className="h-9 flex-1 min-w-[14rem]" placeholder={a.kind === "task" ? "Што треба да се направи" : "Што е договорено / разговарано"} value={a.subject} onChange={(e) => setA({ ...a, subject: e.target.value })} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {!!contactItems.length && !contactId && (
          <Select value={a.contactId ? String(a.contactId) : "none"} onValueChange={(v) => setA({ ...a, contactId: v === "none" ? null : Number(v) })}>
            <SelectTrigger className="h-9 w-44"><SelectValue placeholder="Контакт" /></SelectTrigger>
            <SelectContent><SelectItem value="none">— без контакт —</SelectItem>{contactItems.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {a.kind === "task" && (
          <>
            <DateInput className="h-9 w-40" value={a.dueDate} onChange={(e) => setA({ ...a, dueDate: e.target.value })} />
            <Input className="h-9 w-40" list="crm-people-quick" placeholder="Извршител" value={a.assignee} onChange={(e) => setA({ ...a, assignee: e.target.value })} />
            <PeopleDatalist id="crm-people-quick" />
          </>
        )}
        <Input className="h-9 flex-1 min-w-[10rem]" placeholder="Белешка (опционално)" value={a.notes} onChange={(e) => setA({ ...a, notes: e.target.value })} />
        <Button className="h-9" disabled={a.subject.trim().length < 2 || add.isPending}
          onClick={() => add.mutate({
            customerId: customerId ?? null, contactId: contactId ?? a.contactId ?? null, opportunityId: opportunityId ?? null, kind: a.kind as any,
            subject: a.subject.trim(), notes: a.notes || null, dueDate: a.kind === "task" ? a.dueDate || todayYmd() : null, assignee: a.kind === "task" ? a.assignee || null : null,
          })}>Запиши</Button>
      </div>
    </div>
  );
}
