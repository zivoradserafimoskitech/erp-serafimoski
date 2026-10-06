// Извештаи → Маркетинг: барања по извор/кампања, тек барање → понуда → нарачка → фактура, приход и ROI по кампања.
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { downloadTableXlsx } from "@/lib/xlsx";
import { CHANNEL_LABEL, type Channel } from "@contracts/marketing";
import { Download, Wallet } from "lucide-react";

const fmt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("mk-MK"));
const pctOf = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const ch = (c: string) => CHANNEL_LABEL[c as Channel] ?? c;
const roiCls = (r: number | null) => (r == null ? "" : r >= 0 ? "text-emerald-700" : "text-red-600");

export default function MarketingReport({ from, to }: { from: string; to: string }) {
  const { data, isLoading } = trpc.campaigns.marketingReport.useQuery({ from, to });
  const f = data?.funnel;
  const steps = f ? [
    { label: "Барања", n: f.leads }, { label: "Понуда", n: f.quoted }, { label: "Нарачка", n: f.ordered }, { label: "Фактура", n: f.invoiced },
  ] : [];
  const xlsx = () => data && downloadTableXlsx(`marketing-${from}-${to}.xlsx`, "По кампања",
    [["Кампања", "Канал", "Барања", "Понуди", "Нарачки", "Приход", "Трошок", "ROI %", "Цена по барање"],
      ...data.byCampaign.map((r) => [r.campaign, ch(r.channel), r.leads, r.quotes, r.orders, r.revenue, r.spend, r.roi ?? "", r.costPerLead ?? ""])]);
  if (isLoading) return <div className="py-10 text-center text-gray-400">Вчитување...</div>;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4">
        <div className="flex flex-wrap items-end gap-6">
          {steps.map((s, i) => (
            <div key={s.label} className="min-w-[6rem]">
              <p className="text-[11px] font-semibold uppercase text-gray-400">{s.label}</p>
              <p className="text-2xl font-bold tabular-nums">{s.n}</p>
              {i > 0 && <p className="text-xs text-gray-500">{pctOf(s.n, steps[0].n)} од барањата</p>}
            </div>
          ))}
          <div className="min-w-[8rem]"><p className="text-[11px] font-semibold uppercase text-gray-400">Приход од маркетинг</p><p className="text-2xl font-bold tabular-nums">{fmt(data.totals.revenue)}</p><p className="text-xs text-gray-500">фактури во периодот, без ДДВ</p></div>
          <div className="min-w-[8rem]"><p className="text-[11px] font-semibold uppercase text-gray-400">Трошок / ROI</p><p className="text-2xl font-bold tabular-nums">{fmt(data.totals.spend)}</p><p className={`text-xs font-medium ${roiCls(data.totals.roi)}`}>{data.totals.roi == null ? "внеси трошок за ROI" : `ROI ${data.totals.roi}%`}</p></div>
          <div className="flex-1" />
          <Button size="sm" variant="outline" asChild><Link to="/marketing/budzet"><Wallet className="mr-1.5 h-3.5 w-3.5" />Буџет за реклами</Link></Button>
          <Button size="sm" variant="outline" onClick={xlsx} disabled={!data.byCampaign.length}><Download className="mr-1.5 h-3.5 w-3.5" />Excel</Button>
        </div>
        {steps[0]?.n > 0 && (
          <div className="mt-4 space-y-1">{steps.map((s) => (
            <div key={s.label} className="flex items-center gap-2 text-xs"><span className="w-16 text-gray-500">{s.label}</span>
              <div className="h-3 flex-1 rounded bg-gray-100"><div className="h-3 rounded bg-orange-500" style={{ width: `${steps[0].n ? (s.n / steps[0].n) * 100 : 0}%` }} /></div><span className="w-10 text-right tabular-nums">{s.n}</span></div>
          ))}</div>
        )}
      </CardContent></Card>

      <Card><CardContent className="p-4 space-y-2">
        <p className="text-sm font-semibold">По извор</p>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-xs text-gray-500"><th className="py-2 text-left font-medium">Канал</th><th className="text-right font-medium">Барања</th><th className="text-right font-medium">Понуди</th><th className="text-right font-medium">Нарачки</th><th className="text-right font-medium">Фактури</th><th className="text-right font-medium">Приход</th><th className="text-right font-medium">Трошок</th><th className="text-right font-medium">Цена/барање</th><th className="text-right font-medium">ROI</th></tr></thead>
          <tbody>
            {!data.bySource.length && <tr><td colSpan={9} className="py-6 text-center text-gray-400">Нема барања во периодот</td></tr>}
            {data.bySource.map((r) => (
              <tr key={r.channel} className="border-b border-gray-100"><td className="py-1.5">{ch(r.channel)}</td><td className="text-right tabular-nums">{r.leads}</td><td className="text-right tabular-nums">{r.quotes}</td><td className="text-right tabular-nums">{r.orders}</td><td className="text-right tabular-nums">{r.invoices}</td>
                <td className="text-right tabular-nums">{fmt(r.revenue)}</td><td className="text-right tabular-nums">{r.spend ? fmt(r.spend) : "—"}</td><td className="text-right tabular-nums">{fmt(r.costPerLead)}</td><td className={`text-right tabular-nums font-medium ${roiCls(r.roi)}`}>{r.roi == null ? "—" : `${r.roi}%`}</td></tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>

      <Card><CardContent className="p-4 space-y-2">
        <p className="text-sm font-semibold">По кампања</p>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-xs text-gray-500"><th className="py-2 text-left font-medium">Кампања</th><th className="text-left font-medium">Канал</th><th className="text-right font-medium">Барања</th><th className="text-right font-medium">Понуди</th><th className="text-right font-medium">Нарачки</th><th className="text-right font-medium">Приход</th><th className="text-right font-medium">Трошок</th><th className="text-right font-medium">Цена/барање</th><th className="text-right font-medium">ROI</th></tr></thead>
          <tbody>
            {!data.byCampaign.length && <tr><td colSpan={9} className="py-6 text-center text-gray-400">Нема барања со utm_campaign</td></tr>}
            {data.byCampaign.map((r) => (
              <tr key={`${r.campaign}|${r.channel}`} className="border-b border-gray-100"><td className="py-1.5 font-medium">{r.campaign}</td><td>{ch(r.channel)}</td><td className="text-right tabular-nums">{r.leads}</td><td className="text-right tabular-nums">{r.quotes}</td><td className="text-right tabular-nums">{r.orders}</td>
                <td className="text-right tabular-nums">{fmt(r.revenue)}</td><td className="text-right tabular-nums">{r.spend ? fmt(r.spend) : "—"}</td><td className="text-right tabular-nums">{fmt(r.costPerLead)}</td><td className={`text-right tabular-nums font-medium ${roiCls(r.roi)}`}>{r.roi == null ? "—" : `${r.roi}%`}</td></tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>

      {data.emails.length > 0 && (
        <Card><CardContent className="p-4 space-y-2">
          <p className="text-sm font-semibold">Е-пошта кампањи</p>
          <table className="w-full text-sm">
            <thead><tr className="border-b text-xs text-gray-500"><th className="py-2 text-left font-medium">Кампања</th><th className="text-right font-medium">Пратени</th><th className="text-right font-medium">Отворени</th><th className="text-right font-medium">Кликови</th><th className="text-right font-medium">Одјави</th><th className="text-right font-medium">Приход</th></tr></thead>
            <tbody>{data.emails.map((e) => (
              <tr key={e.id} className="border-b border-gray-100"><td className="py-1.5"><Link className="hover:underline" to="/marketing/kampanji">{e.name}</Link></td><td className="text-right tabular-nums">{e.sent}</td><td className="text-right tabular-nums">{pctOf(e.opened, e.sent)}</td><td className="text-right tabular-nums">{pctOf(e.clicked, e.sent)}</td><td className="text-right tabular-nums">{e.unsubscribed}</td><td className="text-right tabular-nums">{fmt(e.revenue)}</td></tr>
            ))}</tbody>
          </table>
        </CardContent></Card>
      )}
      <p className="text-xs text-gray-500">Барања, понуди и нарачки = кохорта на барањата примени во периодот. Приход = фактури (без ДДВ, минус книжни одобренија) издадени во периодот со извор од маркетинг — изворот се пренесува барање → понуда → нарачка → фактура. ROI = (приход − трошок) / трошок.</p>
    </div>
  );
}
