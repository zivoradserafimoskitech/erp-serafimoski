import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { toast } from "sonner";
import { downloadTableXlsx } from "@/lib/xlsx";
import { BarChart3, Users, Package, Cog, CalendarRange, Target, Download } from "lucide-react";

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : Math.round(n).toLocaleString("mk-MK"));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`);
const MONTHS = ["Јан", "Феб", "Мар", "Апр", "Мај", "Јун", "Јул", "Авг", "Сеп", "Окт", "Ное", "Дек"];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const change = (cur: number, prev: number) => (prev ? (cur - prev) / Math.abs(prev) : null);

/** Извештаи за раководство: добивка по купувач/производ/машина, година спрема година, буџет. */
export default function Reports() {
  const [view, setView] = useState<"customer" | "product" | "machine" | "yoy" | "budget">("customer");
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(ymd(new Date()));
  const TABS = [
    { k: "customer", l: "По купувач", i: Users }, { k: "product", l: "По производ", i: Package }, { k: "machine", l: "По машина", i: Cog },
    { k: "yoy", l: "Година спрема година", i: CalendarRange }, { k: "budget", l: "Буџет", i: Target },
  ] as const;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><BarChart3 className="h-6 w-6 text-amber-600" />Извештаи</h2>
        <p className="text-gray-500 mt-1">Каде се заработува, што се движи низ годината и колку отстапуваме од планот</p>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-lg border bg-white p-0.5">
          {TABS.map((t) => { const I = t.i; return <Button key={t.k} size="sm" variant={view === t.k ? "default" : "ghost"} className="h-8" onClick={() => setView(t.k)}><I className="h-4 w-4 mr-1.5" />{t.l}</Button>; })}
        </div>
        {["customer", "product", "machine"].includes(view) && (
          <div className="flex gap-2">
            <div className="space-y-1"><Label className="text-xs">Од</Label><DateInput className="h-9 w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">До</Label><DateInput className="h-9 w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
        )}
      </div>
      {(view === "customer" || view === "product") && <ProfitBy view={view} from={from} to={to} />}
      {view === "machine" && <ByMachine from={from} to={to} />}
      {view === "yoy" && <Yoy />}
      {view === "budget" && <Budget />}
    </div>
  );
}

function ProfitBy({ view, from, to }: { view: "customer" | "product"; from: string; to: string }) {
  const { data, isLoading } = trpc.reports.profitBy.useQuery({ from, to });
  const rows: any[] = (view === "customer" ? data?.byCustomer : data?.byProduct) ?? [];
  const maxP = Math.max(1, ...rows.map((r) => Math.abs(r.profit)));
  const xlsx = () => downloadTableXlsx(`dobivka-po-${view === "customer" ? "kupuvac" : "proizvod"}-${from}-${to}.xlsx`, view === "customer" ? "По купувач" : "По производ",
    [[view === "customer" ? "Купувач" : "Производ", "Нарачки", view === "product" ? "Количина" : "", "Приход", "Трошок", "Добивка", "Маржа %"], ...rows.map((r) => [r.customer ?? r.product, r.orders, r.qty ?? "", r.revenue, r.cost, r.profit, r.marginPct])]);
  return (
    <Card><CardContent className="p-4 space-y-2">
      <div className="flex justify-between items-center"><p className="text-xs text-gray-500">Од „Добивка по нарачка“: само нарачки со познат приход и трошок. {view === "product" ? "Добивката на нарачката се дели по удел на ставката во вредноста." : ""}</p>
        <Button size="sm" variant="outline" onClick={xlsx} disabled={!rows.length}><Download className="h-3.5 w-3.5 mr-1.5" />Excel</Button></div>
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-gray-500 border-b"><th className="text-left font-medium py-2">{view === "customer" ? "Купувач" : "Производ"}</th><th className="text-right font-medium">Нарачки</th>
          <th className="text-right font-medium">Приход</th><th className="text-right font-medium">Трошок</th><th className="text-right font-medium">Добивка</th><th className="text-right font-medium">Маржа</th><th className="w-40" /></tr></thead>
        <tbody>
          {isLoading ? <tr><td colSpan={7} className="py-8 text-center text-gray-400">Вчитување...</td></tr> : !rows.length ? <tr><td colSpan={7} className="py-8 text-center text-gray-400">Нема податоци за периодот</td></tr> : rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="py-1.5 font-medium">{r.customer ?? r.product}{r.qty ? <span className="text-xs text-gray-400"> · {r.qty.toLocaleString("mk-MK")} ед.</span> : null}</td>
              <td className="text-right">{r.orders}</td><td className="text-right tabular-nums">{fmt(r.revenue)}</td><td className="text-right tabular-nums text-gray-500">{fmt(r.cost)}</td>
              <td className={`text-right tabular-nums font-semibold ${r.profit < 0 ? "text-red-600" : ""}`}>{fmt(r.profit)}</td>
              <td className={`text-right ${r.marginPct !== null && r.marginPct < 10 ? "text-red-600" : ""}`}>{r.marginPct === null ? "—" : `${r.marginPct}%`}</td>
              <td className="pl-3"><div className="h-2 rounded bg-gray-100"><div className={`h-2 rounded ${r.profit < 0 ? "bg-red-400" : "bg-emerald-500"}`} style={{ width: `${(Math.abs(r.profit) / maxP) * 100}%` }} /></div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </CardContent></Card>
  );
}

function ByMachine({ from, to }: { from: string; to: string }) {
  const { data } = trpc.reports.profitByMachine.useQuery({ from, to });
  return (
    <Card><CardContent className="p-4 space-y-2">
      <p className="text-xs text-gray-500">Часови и трошок на завршените операции; приходот на налогот е распределен по машините според уделот во трошокот. Придонес = приход − трошок на машината.</p>
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-gray-500 border-b"><th className="text-left font-medium py-2">Машина</th><th className="text-right font-medium">Часови</th><th className="text-right font-medium">Искористеност</th>
          <th className="text-right font-medium">Трошок</th><th className="text-right font-medium">Приход (распределен)</th><th className="text-right font-medium">Придонес</th><th className="text-right font-medium">Приход/час</th><th className="text-right font-medium">Цена/час</th></tr></thead>
        <tbody>{(data ?? []).map((m) => (
          <tr key={m.machineId} className="border-b border-gray-100">
            <td className="py-1.5 font-medium">{m.machine}</td><td className="text-right tabular-nums">{m.hours}<span className="text-xs text-gray-400"> / {m.available}</span></td>
            <td className="text-right">{pct(m.utilization)}</td><td className="text-right tabular-nums">{fmt(m.cost)}</td><td className="text-right tabular-nums">{fmt(m.revenue)}</td>
            <td className={`text-right tabular-nums font-semibold ${m.contribution < 0 ? "text-red-600" : ""}`}>{fmt(m.contribution)}</td>
            <td className="text-right tabular-nums">{fmt(m.revenuePerHour)}</td><td className="text-right tabular-nums text-gray-500">{fmt(m.ratePerHour)}</td>
          </tr>
        ))}</tbody>
      </table>
    </CardContent></Card>
  );
}

function Yoy() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data } = trpc.reports.yearOverYear.useQuery({ year });
  const max = Math.max(1, ...(data?.months ?? []).flatMap((m) => [m.current.revenue, m.previous.revenue]));
  return (
    <Card><CardContent className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><Label className="text-xs">Година</Label><Input type="number" className="h-8 w-24" value={year} onChange={(e) => setYear(parseInt(e.target.value) || new Date().getFullYear())} /></div>
        {data && <p className="text-sm">До {MONTHS[data.upToMonth - 1]}: приходи <b>{fmt(data.ytd.current.revenue)}</b> наспроти {fmt(data.ytd.previous.revenue)} ({pct(change(data.ytd.current.revenue, data.ytd.previous.revenue))}) · резултат <b className={data.ytd.current.result < 0 ? "text-red-600" : ""}>{fmt(data.ytd.current.result)}</b> наспроти {fmt(data.ytd.previous.result)}</p>}
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-gray-500 border-b"><th className="text-left font-medium py-2 w-12">Месец</th><th className="text-left font-medium">Приходи ({year} / {year - 1})</th>
          <th className="text-right font-medium">{year}</th><th className="text-right font-medium">{year - 1}</th><th className="text-right font-medium">Промена</th>
          <th className="text-right font-medium">Расходи {year}</th><th className="text-right font-medium">Резултат {year}</th><th className="text-right font-medium">Резултат {year - 1}</th></tr></thead>
        <tbody>{(data?.months ?? []).map((m) => (
          <tr key={m.month} className={`border-b border-gray-100 ${m.month > (data?.upToMonth ?? 12) ? "opacity-40" : ""}`}>
            <td className="py-1.5">{MONTHS[m.month - 1]}</td>
            <td className="pr-3"><div className="space-y-0.5"><div className="h-2 rounded bg-amber-500" style={{ width: `${(m.current.revenue / max) * 100}%` }} /><div className="h-2 rounded bg-gray-300" style={{ width: `${(m.previous.revenue / max) * 100}%` }} /></div></td>
            <td className="text-right tabular-nums">{fmt(m.current.revenue)}</td><td className="text-right tabular-nums text-gray-500">{fmt(m.previous.revenue)}</td>
            <td className="text-right">{pct(change(m.current.revenue, m.previous.revenue))}</td>
            <td className="text-right tabular-nums text-gray-600">{fmt(m.current.expense)}</td>
            <td className={`text-right tabular-nums font-medium ${m.current.result < 0 ? "text-red-600" : ""}`}>{fmt(m.current.result)}</td>
            <td className="text-right tabular-nums text-gray-500">{fmt(m.previous.result)}</td>
          </tr>
        ))}</tbody>
      </table>
      <p className="text-[11px] text-gray-500">Од главната книга (класа 7 приходи, класа 4 расходи), без налогот за затворање на годината. Портокалово = {year}, сиво = {year - 1}.</p>
    </CardContent></Card>
  );
}

function Budget() {
  const utils = trpc.useUtils();
  const [year, setYear] = useState(new Date().getFullYear());
  const [upTo, setUpTo] = useState(new Date().getFullYear() === year ? new Date().getMonth() + 1 : 12);
  const { data: b } = trpc.reports.budgetGet.useQuery({ year });
  const { data: bva } = trpc.reports.budgetVsActual.useQuery({ year, upToMonth: upTo });
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => { if (b) setVals(Object.fromEntries(b.values.filter((v) => v.month === 0).map((v) => [v.line, String(v.amount)]))); }, [b]);
  const save = trpc.reports.budgetSave.useMutation({ onSuccess: () => { toast.success("Буџетот е зачуван"); utils.reports.invalidate(); }, onError: (e) => toast.error(e.message) });
  return (
    <Card><CardContent className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2"><Label className="text-xs">Година</Label><Input type="number" className="h-8 w-24" value={year} onChange={(e) => setYear(parseInt(e.target.value) || new Date().getFullYear())} /></div>
        <div className="flex items-center gap-2"><Label className="text-xs">Остварено до месец</Label><Input type="number" min={1} max={12} className="h-8 w-20" value={upTo} onChange={(e) => setUpTo(Math.max(1, Math.min(12, parseInt(e.target.value) || 12)))} /></div>
        <span className="flex-1" />
        <Button size="sm" className="bg-amber-500 hover:bg-amber-600" disabled={save.isPending}
          onClick={() => save.mutate({ year, values: Object.entries(vals).map(([line, v]) => ({ line, month: 0, amount: parseFloat(v.replace(",", ".")) || 0 })) })}>Зачувај буџет</Button>
      </div>
      <p className="text-xs text-gray-500">Внеси годишен буџет по позиција (се дели рамномерно по месеци). Остварувањето е од главната книга; зелено = подобро од планот (повеќе приход / помал трошок).</p>
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-gray-500 border-b"><th className="text-left font-medium py-2">Позиција</th><th className="text-right font-medium w-36">Годишен буџет</th><th className="text-right font-medium">Буџет до {MONTHS[upTo - 1]}</th>
          <th className="text-right font-medium">Остварено</th><th className="text-right font-medium">Разлика</th><th className="text-right font-medium">%</th></tr></thead>
        <tbody>{(bva?.rows ?? []).map((r) => (
          <tr key={r.key} className={`border-b border-gray-100 ${r.kind === "revenue" ? "" : ""}`}>
            <td className="py-1.5">{r.kind === "revenue" ? <b>{r.label}</b> : r.label}</td>
            <td className="pl-2"><Input className="h-7 text-right text-xs" value={vals[r.key] ?? ""} onChange={(e) => setVals({ ...vals, [r.key]: e.target.value })} /></td>
            <td className="text-right tabular-nums text-gray-500">{fmt(r.budget)}</td><td className="text-right tabular-nums">{fmt(r.actual)}</td>
            <td className={`text-right tabular-nums font-medium ${!r.budget ? "" : r.good ? "text-emerald-700" : "text-red-600"}`}>{r.budget ? fmt(r.diff) : "—"}</td>
            <td className="text-right">{pct(r.pct)}</td>
          </tr>
        ))}</tbody>
      </table>
      {bva && <p className="text-sm">Приходи: {fmt(bva.totals.revenue.actual)} од планирани {fmt(bva.totals.revenue.budget)} · Расходи: {fmt(bva.totals.expense.actual)} од планирани {fmt(bva.totals.expense.budget)}</p>}
    </CardContent></Card>
  );
}
