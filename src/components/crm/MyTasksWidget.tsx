import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Circle, ListTodo } from "lucide-react";
import { fmtD } from "./shared";

/** „Мои задачи / Денес“ — виџет за контролна табла и продажба. */
export default function MyTasksWidget({ limit = 6 }: { limit?: number }) {
  const utils = trpc.useUtils();
  const { data } = trpc.crm.myTasksList.useQuery(undefined, { refetchInterval: 60_000 });
  const done = trpc.crm.activityDone.useMutation({ onSuccess: () => utils.crm.invalidate() });
  const rows = [...(data?.overdue ?? []).map((t) => ({ ...t, b: "overdue" as const })), ...(data?.today ?? []).map((t) => ({ ...t, b: "today" as const })), ...(data?.upcoming ?? []).map((t) => ({ ...t, b: "upcoming" as const }))];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><ListTodo className="h-4 w-4 text-primary" />Мои задачи
          <span className="ml-auto flex gap-1.5 text-[11px] font-normal">
            {!!data?.counts.overdue && <span className="rounded-full bg-red-500/10 text-red-700 dark:text-red-300 px-2 py-0.5">{data.counts.overdue} доцнат</span>}
            <span className="rounded-full bg-primary/10 px-2 py-0.5">{data?.counts.today ?? 0} денес</span>
            <span className="rounded-full bg-muted px-2 py-0.5">{data?.counts.upcoming ?? 0} наскоро</span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {!rows.length ? <p className="text-sm text-muted-foreground py-2">Нема задачи за денес 🎉</p> : rows.slice(0, limit).map((t) => (
          <div key={t.id} className="flex items-start gap-2 text-sm">
            <button type="button" className="mt-0.5 text-muted-foreground hover:text-primary" onClick={() => done.mutate({ id: t.id, done: true })} aria-label="Заврши">
              {t.doneAt ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4" />}
            </button>
            <div className="flex-1 min-w-0">
              <p className="truncate">{t.subject}</p>
              <p className="text-[11px] text-muted-foreground truncate">
                {t.customerId ? <Link to={`/crm/firmi/${t.customerId}`} className="hover:text-primary">{t.customer}</Link> : null}
                {t.opportunityId ? <> · <Link to={`/crm?deal=${t.opportunityId}`} className="hover:text-primary">{t.opportunity}</Link></> : null}
              </p>
            </div>
            <span className={`text-xs shrink-0 ${t.b === "overdue" ? "text-red-600 font-semibold" : t.b === "today" ? "text-foreground" : "text-muted-foreground"}`}>{t.b === "today" ? "денес" : fmtD(t.dueDate)}</span>
          </div>
        ))}
        <Link to="/crm/aktivnosti" className="block text-xs text-primary hover:underline pt-1">Сите активности и задачи →</Link>
      </CardContent>
    </Card>
  );
}
