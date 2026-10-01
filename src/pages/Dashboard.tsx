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
  ScanLine,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
  const pendingParsed = parsedDocs?.filter(d => d.status === "parsed").length ?? 0;

  const k = stats?.kpi;
  const den = (v: any) => `${money(v)} ден.`;
  // Секоја картичка: бројка + од каде доаѓа (hint) + каде води
  const cards = [
    { title: "Нарачки во тек", value: k?.ordersOpen ?? 0, icon: ClipboardList, color: "text-blue-600", bg: "bg-blue-50", href: "/tek",
      hint: `неиспорачани и неоткажани · вкупно ${k?.ordersTotal ?? 0} нарачки` },
    { title: "Налози во производство", value: k?.woActive ?? 0, icon: Factory, color: "text-amber-600", bg: "bg-amber-50", href: "/proizvodstvo",
      hint: `${k?.woInProgress ?? 0} во тек · ${k?.woPending ?? 0} чекаат` },
    { title: `Фактурирано ${k?.year ?? ""}`, value: den(k?.invoicedYear), icon: TrendingUp, color: "text-violet-600", bg: "bg-violet-50", href: "/smetkovodstvo",
      hint: `без ДДВ, од ${k?.invoicedYearCount ?? 0} издадени фактури (минус книжни одобренија)${k?.invoicedNoRate ? ` · ${k.invoicedNoRate} без курс не се бројат` : ""}` },
    { title: "Ненаплатено од купувачи", value: den(k?.receivables), icon: FileText, color: "text-emerald-600", bg: "bg-emerald-50", href: "/smetkovodstvo",
      hint: `${k?.receivablesCount ?? 0} отворени излезни фактури, по уплатите (банка + благајна)` },
    { title: "Неплатено кон добавувачи", value: den(k?.payables), icon: ShoppingCart, color: "text-red-600", bg: "bg-red-50", href: "/smetkovodstvo",
      hint: `${k?.payablesCount ?? 0} отворени влезни фактури, по плаќањата` },
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
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin text-amber-600" : ""}`} />
          {isFetching ? "Се освежува..." : ago === null ? "Освежи" : ago < 5 ? "Освежено сега" : `Освежено пред ${ago < 60 ? ago + " сек" : Math.round(ago / 60) + " мин"}`}
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title} onClick={() => (card as any).href && navigate((card as any).href)}
              className={`border-l-4 border-l-transparent hover:shadow-md transition-shadow ${(card as any).href ? "cursor-pointer hover:border-l-amber-400" : ""}`}>
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

      {/* Status breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Order status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4" />
              Статус на нарачки
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "На чекање", value: stats?.orders.pending ?? 0, color: "bg-gray-400" },
              { label: "Потврдени", value: stats?.orders.confirmed ?? 0, color: "bg-blue-400" },
              { label: "Во производство", value: stats?.orders.inProduction ?? 0, color: "bg-amber-400" },
              { label: "Готови за испорака", value: stats?.orders.ready ?? 0, color: "bg-emerald-400" },
              { label: "Испорачани", value: stats?.orders.delivered ?? 0, color: "bg-teal-500" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                <span className="flex-1 text-sm text-gray-600">{item.label}</span>
                <span className="text-sm font-semibold text-gray-800">{item.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Production status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Factory className="h-4 w-4" />
              Статус на производство
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "На чекање", value: stats?.production.pending ?? 0, color: "bg-gray-400" },
              { label: "Во тек", value: stats?.production.inProgress ?? 0, color: "bg-blue-400" },
              { label: "Завршени", value: stats?.production.completed ?? 0, color: "bg-emerald-400" },
              { label: "Паузирани", value: stats?.production.onHold ?? 0, color: "bg-amber-400" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                <span className="flex-1 text-sm text-gray-600">{item.label}</span>
                <span className="text-sm font-semibold text-gray-800">{item.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Procurement status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" />
              Статус на набавка
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Нацрт", value: stats?.procurement.draft ?? 0, color: "bg-gray-400" },
              { label: "Испратени", value: stats?.procurement.sent ?? 0, color: "bg-blue-400" },
              { label: "Делумно", value: stats?.procurement.partial ?? 0, color: "bg-amber-400" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                <span className="flex-1 text-sm text-gray-600">{item.label}</span>
                <span className="text-sm font-semibold text-gray-800">{item.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Parsed Documents */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ScanLine className="h-4 w-4" />
              OCR - Парсирани документи
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingParsed > 0 ? (
              <>
                <p className="text-sm text-gray-600">
                  Имате <span className="font-semibold text-indigo-600">{pendingParsed}</span> парсирани приемници за ревизија
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-indigo-700 border-indigo-300 hover:bg-indigo-50"
                  onClick={() => navigate("/priemnici")}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Прегледај приемници
                  <ArrowRight className="h-4 w-4 ml-auto" />
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500">Нема парсирани документи за ревизија</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => navigate("/priemnici")}
                >
                  <ScanLine className="h-4 w-4 mr-2" />
                  Учитај приемница (OCR)
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Quick info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Финансиски преглед
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Вкупен промет</span>
              <span className="text-lg font-bold text-emerald-600">
                {stats?.financial.totalRevenue ?? "0"} ден.
              </span>
            </div>
            <div className="h-px bg-gray-100" />
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Вкупна маржа</span>
              <span className="text-lg font-bold text-amber-600">
                {stats?.financial.totalMargin ?? "0"} ден.
              </span>
            </div>
            <div className="h-px bg-gray-100" />
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Ненаплатени побарувања</span>
              <span className="text-lg font-bold text-emerald-700">
                {stats?.financial.totalReceivables ?? "0"} ден.
              </span>
            </div>
            <div className="h-px bg-gray-100" />
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Неплатени обврски</span>
              <span className="text-lg font-bold text-red-600">
                {stats?.financial.totalPayables ?? "0"} ден.
              </span>
            </div>
            <div className="h-px bg-gray-100" />
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">ДДВ салдо</span>
              <span className="text-lg font-bold text-blue-600">
                {stats?.financial.vatBalance ?? "0"} ден.
              </span>
            </div>
            <div className="h-px bg-gray-100" />
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Вкупно материјали</span>
              <span className="text-lg font-bold text-blue-600">
                {stats?.storage.totalMaterials ?? 0}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
