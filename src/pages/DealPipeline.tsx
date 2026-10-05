import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import DealFlow, { DealFlowMini } from "@/components/DealFlow";
import { Search, Workflow } from "lucide-react";

const STAGES = [
  { key: "quote", label: "Понуда" }, { key: "proforma", label: "Про-фактура" }, { key: "advance", label: "Аванс" }, { key: "order", label: "Нарачка" },
  { key: "wo", label: "Производство" }, { key: "delivery", label: "Испратница" }, { key: "invoice", label: "Фактура" }, { key: "payment", label: "Наплата" },
];
const money = (n: number, c: string) => `${n.toLocaleString("mk-MK", { maximumFractionDigits: 0 })} ${c === "MKD" ? "ден" : c}`;

export default function DealPipeline() {
  const navigate = useNavigate();
  const [showClosed, setShowClosed] = useState(false);
  const [search, setSearch] = useState("");
  const [stageF, setStageF] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: number; number: string } | null>(null);
  const { data, isLoading } = trpc.ops.dealList.useQuery({ includeClosed: showClosed });
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of data ?? []) if (d.currentStage) m[d.currentStage] = (m[d.currentStage] ?? 0) + 1;
    return m;
  }, [data]);
  const rows = (data ?? []).filter(d =>
    (!stageF || d.currentStage === stageF) &&
    (!search || `${d.quoteNumber} ${d.customer ?? ""}`.toLowerCase().includes(search.toLowerCase())));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><Workflow className="h-6 w-6 text-primary" />Тек на нарачки</h2>
        <p className="text-gray-500 mt-1">Секоја понуда од прифаќање до наплата — на кој чекор е и што е следно</p>
      </div>

      <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
        {STAGES.map(s => (
          <button key={s.key} onClick={() => setStageF(stageF === s.key ? null : s.key)}
            className={`rounded-lg border px-3 py-2 text-left transition ${stageF === s.key ? "border-primary/50 bg-primary/10" : "bg-white hover:bg-gray-50"}`}>
            <div className="text-[11px] text-gray-500 truncate">{s.label}</div>
            <div className={`text-xl font-bold ${counts[s.key] ? "text-gray-800" : "text-gray-300"}`}>{counts[s.key] ?? 0}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input className="pl-9" placeholder="Пребарај понуда или клиент..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />Прикажи и завршени</label>
      </div>

      <Card><CardContent className="p-0">
        {isLoading ? <p className="py-10 text-center text-sm text-gray-400">Вчитување...</p>
          : !rows.length ? <p className="py-10 text-center text-sm text-gray-400">Нема нарачки во тек{stageF ? " на овој чекор" : ""}</p>
          : rows.map(d => {
            const cur = d.stages.find(s => s.status === "current");
            return (
              <button key={d.quotationId} onClick={() => setOpen({ id: d.quotationId, number: d.quoteNumber })}
                className="w-full flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b last:border-b-0 hover:bg-gray-50 text-left">
                <div className="w-44 min-w-0">
                  <div className="font-mono text-xs font-semibold text-gray-800">{d.quoteNumber}</div>
                  <div className="text-sm text-gray-600 truncate">{d.customer}</div>
                </div>
                <div className="text-sm tabular-nums text-gray-700 w-28 text-right">{money(d.total, d.currency)}</div>
                <DealFlowMini stages={d.stages} />
                <div className="flex-1 min-w-[160px] text-sm">
                  {d.closed ? <span className="text-emerald-700">Завршена</span> : <><span className="text-gray-400">Следно: </span><b className="text-gray-800">{cur?.label}</b><span className="text-gray-400"> · {cur?.detail}</span></>}
                </div>
              </button>
            );
          })}
      </CardContent></Card>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader><DialogTitle>Тек на нарачка · {open?.number}</DialogTitle></DialogHeader>
          {open && <DealFlow quotationId={open.id} />}
          {open && <button className="text-sm text-primary hover:underline text-left" onClick={() => navigate(`/ponudi?open=${open.id}`)}>Отвори ја понудата →</button>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
