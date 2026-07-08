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
  TestTube,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router";
import { useState } from "react";

export default function Dashboard() {
  const { data: stats } = trpc.dashboard.stats.useQuery();
  const { data: parsedDocs } = trpc.ocr.parsedDocumentList.useQuery({ documentType: "receipt" });
  const navigate = useNavigate();
  const pendingParsed = parsedDocs?.filter(d => d.status === "parsed").length ?? 0;
  const [testLog, setTestLog] = useState<string[]>([]);
  const [testRunning, setTestRunning] = useState(false);

  const testMutation = trpc.test.fullFlow.useMutation({
    onMutate: () => { setTestRunning(true); setTestLog([]); },
    onSuccess: (data) => { setTestLog(data.log); setTestRunning(false); },
    onError: (e) => { setTestLog([`❌ Грешка: ${e.message}`]); setTestRunning(false); },
  });

  const cards = [
    {
      title: "Вкупно нарачки",
      value: stats?.orders.total ?? 0,
      icon: ClipboardList,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      title: "Во производство",
      value: stats?.production.inProgress ?? 0,
      icon: Factory,
      color: "text-amber-600",
      bg: "bg-amber-50",
    },
    {
      title: "Ниски залихи",
      value: stats?.storage.lowStock ?? 0,
      icon: AlertTriangle,
      color: "text-red-600",
      bg: "bg-red-50",
    },
    {
      title: "Активни клиенти",
      value: stats?.customers.active ?? 0,
      icon: Users,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      title: "Вкупен промет",
      value: `${stats?.financial.totalRevenue ?? "0"} ден.`,
      icon: TrendingUp,
      color: "text-violet-600",
      bg: "bg-violet-50",
    },
    {
      title: "Завршени работни налози",
      value: stats?.production.completed ?? 0,
      icon: CheckCircle,
      color: "text-teal-600",
      bg: "bg-teal-50",
    },
    {
      title: "Парсирани приемници",
      value: pendingParsed,
      icon: ScanLine,
      color: "text-indigo-600",
      bg: "bg-indigo-50",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Контролна табла</h2>
        <p className="text-gray-500 mt-1">Преглед на клучни показатели за вашиот бизнис</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title} className="border-l-4 border-l-transparent hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <p className="text-sm text-gray-500">{card.title}</p>
                    <p className="text-2xl font-bold text-gray-800">{card.value}</p>
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
              { label: "На удар", value: stats?.production.onHold ?? 0, color: "bg-red-400" },
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
              <span className="text-sm text-gray-600">Обврски</span>
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

        {/* E2E Test */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TestTube className="h-4 w-4 text-emerald-600" />
              Тест: Приемница {'->'} Производство {'->'} Фактура
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              onClick={() => testMutation.mutate({})}
              disabled={testRunning}
              className="w-full bg-emerald-600 hover:bg-emerald-700"
            >
              {testRunning ? "Се тестира..." : <><TestTube className="h-4 w-4 mr-2" />Пушти E2E тест</>}
            </Button>
            {testLog.length > 0 && (
              <div className="bg-slate-50 rounded p-3 space-y-1 text-xs font-mono max-h-64 overflow-y-auto">
                {testLog.map((line, i) => (
                  <div key={i} className={line.startsWith("❌") ? "text-red-600" : line.startsWith("✅") ? "text-emerald-700 font-bold" : "text-gray-700"}>
                    {line}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
