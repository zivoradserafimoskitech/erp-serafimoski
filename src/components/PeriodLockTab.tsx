import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { toast } from "sonner";
import { Lock, LockOpen, History, ChevronDown, ChevronRight } from "lucide-react";

const fmtD = (iso?: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "—");
const fmtAt = (v: any) => formatDateTime(v);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ACTION: Record<string, { label: string; cls: string }> = {
  create: { label: "нов налог", cls: "bg-emerald-50 text-emerald-700" },
  update: { label: "изменет", cls: "bg-primary/10 text-foreground/80" },
  delete: { label: "избришан", cls: "bg-red-50 text-red-700" },
  storno: { label: "сторно", cls: "bg-violet-50 text-violet-700" },
  lock: { label: "заклучено", cls: "bg-slate-100 text-slate-700" },
  unlock: { label: "отклучено", cls: "bg-orange-50 text-orange-700" },
};
const den = (n: number) => n.toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Заклучување на период (по поднесена ДДВ пријава) и дневник на сите измени во главната книга. */
export default function PeriodLockTab() {
  const utils = trpc.useUtils();
  const { data: me } = trpc.appUsers.appUsersMe.useQuery();
  const { data: lock } = trpc.finance.periodLockGet.useQuery();
  const prevMonthEnd = (() => { const n = new Date(); return ymd(new Date(n.getFullYear(), n.getMonth(), 0)); })();
  const [date, setDate] = useState(prevMonthEnd);
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const { data: log } = trpc.finance.glAuditList.useQuery({ search: search || undefined, limit: 50, offset: page * 50 });
  const set = trpc.finance.periodLockSet.useMutation({
    onSuccess: (r) => { toast.success(r.lockedUntil ? `Заклучено до ${fmtD(r.lockedUntil)}` : "Заклучувањето е тргнато"); utils.finance.invalidate(); setReason(""); },
    onError: (e) => toast.error(e.message),
  });
  const isAdmin = !me || me.role === "admin";
  const cur = lock?.lockedUntil ?? null;
  const backwards = !!cur && date < cur;

  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${cur ? "bg-slate-800 text-white" : "bg-gray-100 text-gray-500"}`}>{cur ? <Lock className="h-5 w-5" /> : <LockOpen className="h-5 w-5" />}</div>
          <div className="flex-1">
            <p className="font-semibold">{cur ? `Заклучено до ${fmtD(cur)}` : "Ниеден период не е заклучен"}</p>
            <p className="text-sm text-gray-600">Откако ќе ја поднесеш ДДВ пријавата за месецот, заклучи го. До тој датум ништо не може да се внесе, смени или избрише — ни фактури, ни плаќања, ни налози. Исправка се прави во тековниот период: книжно одобрување за фактура, сторно за налог.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label className="text-xs">Заклучи до (вклучително)</Label><DateInput className="h-9 w-44" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <Button size="sm" variant="ghost" className="h-9" onClick={() => setDate(prevMonthEnd)}>Крај на претходниот месец</Button>
          <div className="space-y-1 flex-1 min-w-[12rem]"><Label className="text-xs">Причина (не е задолжително)</Label><Input className="h-9" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="на пр. ДДВ пријава за септември поднесена" /></div>
          <Button className="h-9 bg-slate-800 hover:bg-slate-900" disabled={set.isPending || !date || (backwards && !isAdmin) || date === cur}
            onClick={() => { if (confirm(backwards ? `Да се ОТКЛУЧИ периодот од ${fmtD(date)} до ${fmtD(cur!)}? Ова се бележи во дневникот.` : `Да се заклучи сè до ${fmtD(date)}?`)) set.mutate({ date, reason: reason || undefined }); }}>
            {backwards ? <><LockOpen className="h-4 w-4 mr-1.5" />Отклучи назад до {fmtD(date)}</> : <><Lock className="h-4 w-4 mr-1.5" />Заклучи</>}
          </Button>
          {cur && isAdmin && <Button variant="ghost" className="h-9 text-red-600" onClick={() => { if (confirm("Да се тргне целото заклучување? Ова се бележи во дневникот.")) set.mutate({ date: null, reason: reason || undefined }); }}>Тргни заклучување</Button>}
        </div>
        {backwards && !isAdmin && <p className="text-xs text-primary">Отклучување смее само администратор.</p>}
        {!!lock?.history.length && (
          <div className="text-xs text-gray-500 space-y-0.5 border-t pt-2">
            {lock.history.map((h, i) => <p key={i}>{fmtAt(h.at)} · {h.actor} · {h.description}</p>)}
          </div>
        )}
      </CardContent></Card>

      <Card><CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <p className="font-semibold flex items-center gap-2"><History className="h-4 w-4 text-gray-500" />Дневник на измени во главната книга</p>
          <Input className="h-8 w-56" placeholder="Налог, опис, корисник..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        </div>
        {!log?.rows.length ? <p className="py-8 text-center text-sm text-gray-400">Нема записи</p> : log.rows.map(r => {
          const a = ACTION[r.action] ?? { label: r.action, cls: "bg-gray-100" };
          const d: any = r.detail;
          const lines = (x: any[] | undefined) => (x ?? []).map((l: any, i: number) => <span key={i} className="mr-3 font-mono">{l.a} {l.d ? `Д ${den(l.d)}` : `П ${den(l.c)}`}</span>);
          return (
            <div key={r.id} className="border-b last:border-b-0 px-4 py-2 text-sm">
              <button className="w-full flex flex-wrap items-center gap-2 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
                {d ? (open === r.id ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />) : <span className="w-3.5" />}
                <span className="text-xs text-gray-500 w-28">{fmtAt(r.at)}</span>
                <span className={`text-[11px] rounded px-1.5 py-0.5 ${a.cls}`}>{a.label}</span>
                {r.entryNumber && <span className="font-mono text-xs">{r.entryNumber}</span>}
                {r.entryDate && <span className="text-xs text-gray-400">{fmtD(r.entryDate)}</span>}
                <span className="flex-1 truncate text-gray-700">{r.description}</span>
                <span className="text-xs text-gray-500">{r.actor}</span>
              </button>
              {open === r.id && d && (
                <div className="mt-1 ml-6 rounded bg-gray-50 px-3 py-2 text-xs text-gray-600 space-y-1">
                  {d.before && <p><b>Пред:</b> {fmtD(d.before.date)} · {lines(d.before.lines)}</p>}
                  {d.after && <p><b>После:</b> {fmtD(d.after.date)} · {lines(d.after.lines)}</p>}
                  {d.lines && <p>{lines(d.lines)}</p>}
                  {d.template && <p>терк: {d.template}</p>}
                </div>
              )}
            </div>
          );
        })}
        {log && log.total > 50 && (
          <div className="flex items-center justify-end gap-2 px-4 py-2 text-sm text-gray-500">
            <span>{page * 50 + 1}–{Math.min((page + 1) * 50, log.total)} од {log.total}</span>
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Претходни</Button>
            <Button size="sm" variant="outline" disabled={(page + 1) * 50 >= log.total} onClick={() => setPage(page + 1)}>Следни</Button>
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}
