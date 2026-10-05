import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import PageHeader from "@/components/layout/PageHeader";
import {
  Target, FileText, Users, Workflow, Truck, Calculator, Tags, BarChart3,
  ShoppingBag, ExternalLink, Info,
} from "lucide-react";

const fmt = (n: number) => n.toLocaleString("mk-MK", { maximumFractionDigits: 0 });
const today = () => new Date().toISOString().slice(0, 10);

/** Центар за продажба: брзи акции + преглед + линкови кон тек/извештаи. */
export default function SalesHub() {
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const { data: stats } = trpc.crm.crmStats.useQuery({ from: yearStart, to: today() });
  const { data: deals } = trpc.ops.dealList.useQuery({ includeClosed: false });
  const openDeals = deals?.length ?? 0;
  const weighted = (stats?.pipeline ?? []).reduce((s, p) => s + p.weighted, 0);

  const tiles = [
    { to: "/crm", title: "Можности (CRM)", desc: "Барања, задачи, win-rate", icon: Target, color: "text-sky-700 bg-sky-50" },
    { to: "/ponudi", title: "Понуди", desc: "Креирај / испрати / конвертирај", icon: FileText, color: "text-violet-700 bg-violet-50" },
    { to: "/klienti", title: "Клиенти и нарачки", desc: "SO и контакти", icon: Users, color: "text-teal-700 bg-teal-50" },
    { to: "/tek", title: "Тек на нарачки", desc: "Понуда → наплата (DealFlow)", icon: Workflow, color: "text-amber-700 bg-amber-50" },
    { to: "/smetkovodstvo?tab=delivery", title: "Испратници", desc: "Испорака и атести", icon: Truck, color: "text-orange-700 bg-orange-50" },
    { to: "/smetkovodstvo", title: "Фактури", desc: "Про-фактура, фактура, книжно", icon: Calculator, color: "text-emerald-700 bg-emerald-50" },
    { to: "/smetkovodstvo?tab=returns", title: "Поврати", desc: "Враќање + книжно + залиха", icon: Calculator, color: "text-rose-700 bg-rose-50" },
    { to: "/cenovnici", title: "Ценовници", desc: "Попуст и цени по клиент", icon: Tags, color: "text-indigo-700 bg-indigo-50" },
    { to: "/izvestai?view=salesSummary&r=sales-summary", title: "Извештаи", desc: "Продажба по купувач/продавач", icon: BarChart3, color: "text-rose-700 bg-rose-50" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Продажба"
        description="Работно место за комерцијала — од можност до наплата. DealFlow е во „Тек на нарачки“."
        icon={<ShoppingBag className="h-6 w-6 text-amber-600" />}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild className="bg-amber-500 hover:bg-amber-600"><Link to="/crm">Нова можност</Link></Button>
            <Button asChild variant="outline"><Link to="/ponudi">Нова понуда</Link></Button>
            <Button asChild variant="outline"><Link to="/tek">Отвори тек →</Link></Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><p className="text-[11px] uppercase text-gray-400 font-semibold">Pipeline (пондерирано)</p><p className="text-2xl font-bold">{fmt(weighted)} <span className="text-sm">ден</span></p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[11px] uppercase text-gray-400 font-semibold">Добиени понуди</p><p className="text-2xl font-bold text-emerald-700">{stats?.quotes.won ?? 0}<span className="text-sm text-gray-400"> / {stats?.quotes.total ?? 0}</span></p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[11px] uppercase text-gray-400 font-semibold">Win-rate</p><p className="text-2xl font-bold">{stats?.quotes.winRate == null ? "—" : `${Math.round(stats.quotes.winRate * 100)}%`}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[11px] uppercase text-gray-400 font-semibold">Нарачки во тек</p><p className="text-2xl font-bold">{openDeals}</p></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Link key={t.to} to={t.to} className="rounded-xl border bg-white p-4 hover:border-amber-300 hover:shadow-sm transition-all">
              <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${t.color}`}><Icon className="h-5 w-5" /></div>
              <p className="mt-3 font-semibold text-gray-800 text-sm">{t.title}</p>
              <p className="text-xs text-gray-500 mt-0.5">{t.desc}</p>
            </Link>
          );
        })}
      </div>

      <Card className="border-dashed">
        <CardContent className="p-4 flex gap-3 text-sm text-gray-600">
          <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-gray-800">УЈП е-фактура</p>
            <p className="text-xs mt-1">
              Интеграцијата е во Фактури → таб „УЈП е-фактури“ (тест окружување, XML/испраќање).
              Целосен production E2E (сертификати, статус callback, масовно испраќање) уште не е завршен — останува како scaffold.
            </p>
            <Link to="/smetkovodstvo" className="inline-flex items-center gap-1 text-amber-700 hover:underline text-xs mt-2">
              Отвори УЈП таб <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
