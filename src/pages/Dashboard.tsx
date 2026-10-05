import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Package,
  Factory,
  Users,
  ShoppingCart,
  AlertTriangle,
  TrendingUp,
  ClipboardList,
  CheckCircle,
  FileText,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

export default function Dashboard() {
  // Таблата се освежува сама на 30 секунди (и веднаш по секое зачувување во апликацијата)
  const { data: stats, dataUpdatedAt, isFetching, refetch } = trpc.dashboard.stats.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: parsedDocs, refetch: refetchParsed } = trpc.ocr.parsedDocumentList.useQuery({ documentType: "receipt" }, { refetchInterval: 30_000 });
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 5000); return () => clearInterval(t); }, []);
  const ago = dataUpdatedAt ? Math.max(0, Math.round((Date.now() - dataUpdatedAt) / 1000)) : null;
  const money = (v: any) => Number(v ?? 0).toLocaleString("mk-MK", { maximumFractionDigits: 0 });
  const navigate = useNavigate();
  const pendingParsed = parsedDocs?.filter((d: any) => d.status === "parsed").length ?? 0;
  const now = new Date();
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const monthName = ["јануари", "февруари", "март", "април", "мај", "јуни", "јули", "август", "септември", "октомври", "ноември", "декември"][now.getMonth()];
  const { data: profit } = trpc.ops.profitabilityReport.useQuery({ from: `${now.getFullYear()}-01-01`, to: ymd(now) }, { refetchInterval: 60_000 });
  const { data: vat } = trpc.finance.vatBooks.useQuery({ from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) }, { refetchInterval: 60_000 });

  const k = stats?.kpi;
  const den = (v: any) => `${money(v)} ден.`;
  // Секоја картичка: бројка + од каде доаѓа (hint) + каде води
  const cards = [
    { title: "Нарачки во тек", value: k?.ordersOpen ?? 0, icon: ClipboardList, color: "text-blue-600", bg: "bg-blue-50", href: "/tek",
      hint: `неиспорачани и неоткажани · вкупно ${k?.ordersTotal ?? 0} нарачки` },
    { title: "Налози во производство", value: k?.woActive ?? 0, icon: Factory, color: "text-primary", bg: "bg-primary/10", href: "/proizvodstvo",
      hint: `${k?.woInProgress ?? 0} во тек · ${k?.woPending ?? 0} чекаат` },
    { title: `Фактурирано ${k?.year ?? ""}`, value: den(k?.invoicedYear), icon: TrendingUp, color: "text-violet-600", bg: "bg-violet-50", href: "/smetkovodstvo",
      hint: `без ДДВ, од ${k?.invoicedYearCount ?? 0} издадени фактури (минус книжни одобренија)${k?.invoicedNoRate ? ` · ${k.invoicedNoRate} без курс не се бројат` : ""}` },
    { title: "Ненаплатено од купувачи", value: den(k?.receivables), icon: FileText, color: "text-emerald-600", bg: "bg-emerald-50", href: "/smetkovodstvo",
      hint: `${k?.receivablesCount ?? 0} отворени излезни фактури, по уплатите (банка + благајна)${(k as any)?.manualReceivables ? ` · вклучени ${den((k as any).manualReceivables)} од рачни налози` : ""}` },
    { title: "Неплатено кон добавувачи", value: den(k?.payables), icon: ShoppingCart, color: "text-red-600", bg: "bg-red-50", href: "/smetkovodstvo",
      hint: `${k?.payablesCount ?? 0} отворени влезни фактури, по плаќањата${(k as any)?.manualPayables ? ` · вклучени ${den((k as any).manualPayables)} од рачни налози` : ""}` },
    { title: "Ниски залихи", value: stats?.storage.lowStock ?? 0, icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50", href: "/sklad",
      hint: (stats?.storage.noMinStock ?? 0) > 0 ? `материјали под поставениот минимум · ${stats?.storage.noMinStock} немаат поставен минимум` : "материјали под поставениот минимум" },
    { title: "Отворени неусогласености", value: k?.qualityOpen ?? 0, icon: CheckCircle, color: "text-orange-600", bg: "bg-orange-50", href: "/kvalitet",
      hint: "грешки, рекламации и проблеми со добавувачи што не се затворени" },
    { title: "Активни клиенти", value: stats?.customers.active ?? 0, icon: Users, color: "text-teal-600", bg: "bg-teal-50", href: "/klienti",
      hint: `од вкупно ${stats?.customers.total ?? 0} внесени клиенти` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Контролна табла</h2>
          <p className="text-gray-500 mt-1">Преглед на клучни показатели за вашиот бизнис — кликни на картичка за детали</p>
        </div>
        <button onClick={() => { refetch(); refetchParsed(); }} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 rounded-md border bg-white px-2.5 py-1.5" title="Освежи сега">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin text-primary" : ""}`} />
          {isFetching ? "Се освежува..." : ago === null ? "Освежи" : ago < 5 ? "Освежено сега" : `Освежено пред ${ago < 60 ? ago + " сек" : Math.round(ago / 60) + " мин"}`}
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title} onClick={() => (card as any).href && navigate((card as any).href)}
              className={`border-l-4 border-l-transparent hover:shadow-md transition-shadow ${(card as any).href ? "cursor-pointer hover:border-l-primary" : ""}`}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <p className="text-sm text-gray-500">{card.title}</p>
                    <p className="text-2xl font-bold text-gray-800">{card.value}</p>
                    {(card as any).hint && (
                      <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{(card as any).hint}</p>
                    )}
                  </div>
                  <div className={`${card.bg} p-2.5 rounded-lg`}>
                    <Icon className={`h-5 w-5 ${card.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Состојба по оддели: секој ред води до листата */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <StatusCard title="Нарачки по статус" icon={Package} rows={[
          { label: "На чекање", value: stats?.orders.pending ?? 0, color: "bg-gray-400", href: "/tek" },
          { label: "Потврдени", value: stats?.orders.confirmed ?? 0, color: "bg-blue-400", href: "/tek" },
          { label: "Во производство", value: stats?.orders.inProduction ?? 0, color: "bg-warning", href: "/tek" },
          { label: "Готови за испорака", value: stats?.orders.ready ?? 0, color: "bg-emerald-400", href: "/tek" },
          { label: "Испорачани", value: stats?.orders.delivered ?? 0, color: "bg-teal-500", href: "/tek" },
        ]} note={(stats?.orders.inProductionNoWo ?? 0) > 0 ? `${stats?.orders.inProductionNoWo} нарачки се „во производство“, а немаат отворен работен налог` : undefined}
          footer={`статус на секоја нарачка · ${stats?.orders.cancelled ?? 0} откажани не се прикажани`} />
        <StatusCard title="Работни налози" icon={Factory} rows={[
          { label: "Чекаат почеток", value: stats?.production.pending ?? 0, color: "bg-gray-400", href: "/proizvodstvo" },
          { label: "Во тек", value: stats?.production.inProgress ?? 0, color: "bg-blue-400", href: "/proizvodstvo" },
          { label: "Паузирани", value: stats?.production.onHold ?? 0, color: "bg-warning", href: "/proizvodstvo" },
          { label: "Завршени (вкупно)", value: stats?.production.completed ?? 0, color: "bg-emerald-400", href: "/proizvodstvo" },
        ]} footer="статус на секој работен налог" />
        <StatusCard title="Набавка" icon={ShoppingCart} rows={[
          { label: "Нарачки неиспратени до добавувач", value: stats?.procurement.draft ?? 0, color: "bg-gray-400", href: "/nabavka" },
          { label: "Испратени, чекаме стока", value: stats?.procurement.sent ?? 0, color: "bg-blue-400", href: "/nabavka" },
          { label: "Делумно примени", value: stats?.procurement.partial ?? 0, color: "bg-warning", href: "/nabavka" },
          { label: "Приемници во нацрт (непотврдени)", value: stats?.procurement.receiptsDraft ?? 0, color: "bg-violet-400", href: "/priemnici" },
          ...(pendingParsed > 0 ? [{ label: "Скенирани приемници за преглед", value: pendingParsed, color: "bg-indigo-400", href: "/priemnici" }] : []),
        ]} footer="нарачки кон добавувачи и приемници" />
      </div>

      {/* Пари: секоја бројка со извор */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" />Финансиски преглед</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            { label: `Добивка по нарачки ${k?.year ?? ""}`, value: profit?.totals.counted ? den(profit.totals.profit) : "—",
              cls: (profit?.totals.profit ?? 0) >= 0 ? "text-emerald-700" : "text-red-600", href: "/finansii?tab=profit",
              hint: profit?.totals.counted
                ? `приход ${den(profit.totals.revenue)} − трошок ${den(profit.totals.actualCost)}${profit.totals.revenue ? ` · маржа ${Math.round(profit.totals.profit / profit.totals.revenue * 100)}%` : ""} · ${profit.totals.counted} нарачки`
                : "нема нарачка со познат приход и трошок" },
            { label: `ДДВ за ${monthName}`, value: vat ? den(Math.abs(vat.summary.payable)) : "—",
              cls: (vat?.summary.payable ?? 0) > 0 ? "text-red-600" : "text-emerald-700", href: "/finansii?tab=vat",
              hint: vat ? `${vat.summary.payable > 0 ? "за плаќање" : vat.summary.payable < 0 ? "за поврат" : "нула"} · излезен ${den(vat.summary.outVat)} − влезен ${den(vat.summary.inVat)}` : "" },
            { label: "Вредност на залихата", value: den(stats?.storage.inventoryValue), cls: "text-gray-800", href: "/sklad",
              hint: `количина × просечна набавна цена · ${stats?.storage.totalMaterials ?? 0} материјали` },
            { label: "Понуди што чекаат одговор", value: String(stats?.quotes.pending ?? 0), cls: "text-gray-800", href: "/ponudi",
              hint: `во нацрт или испратени · вкупно ${stats?.quotes.total ?? 0} понуди` },
          ].map(f => (
            <button key={f.label} onClick={() => navigate(f.href)} className="text-left rounded-lg border p-3 hover:border-primary/40 hover:bg-accent/40 transition">
              <p className="text-xs text-gray-500">{f.label}</p>
              <p className={`text-xl font-bold tabular-nums ${f.cls}`}>{f.value}</p>
              <p className="text-[11px] text-gray-500 leading-snug mt-0.5">{f.hint}</p>
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusCard({ title, icon: Icon, rows, note, footer }: {
  title: string; icon: any; rows: { label: string; value: number; color: string; href: string }[]; note?: string; footer?: string;
}) {
  const navigate = useNavigate();
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><Icon className="h-4 w-4" />{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {rows.map(r => (
          <button key={r.label} onClick={() => navigate(r.href)} className="w-full flex items-center gap-3 rounded-md px-2 py-1.5 -mx-2 hover:bg-gray-50 text-left">
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${r.color}`} />
            <span className="flex-1 text-sm text-gray-600">{r.label}</span>
            <span className={`text-sm font-semibold ${r.value ? "text-gray-900" : "text-gray-300"}`}>{r.value}</span>
          </button>
        ))}
        {note && <p className="flex items-start gap-1.5 rounded-md bg-primary/10 px-2 py-1.5 text-xs text-foreground/80"><AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />{note}</p>}
        {footer && <p className="text-[11px] text-gray-400 pt-1">{footer}</p>}
      </CardContent>
    </Card>
  );
}
