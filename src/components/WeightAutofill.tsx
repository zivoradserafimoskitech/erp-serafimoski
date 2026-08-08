import { useState, useEffect, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Wand2, AlertTriangle, Search } from "lucide-react";

const UNIT_MK: Record<string, string> = { kg: "кг", m: "м", m2: "м²", pcs: "ком", l: "л", sheet: "табла" };

export function WeightAutofill({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [includeFilled, setIncludeFilled] = useState(false);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [q, setQ] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const { data, isLoading, refetch } = trpc.storage.weightAutofillPreview.useQuery(
    { includeFilled },
    { enabled: open }
  );

  const applyMutation = trpc.storage.weightAutofillApply.useMutation({
    onSuccess: (res) => {
      setResult(`Запишани тежини за ${res.updated} материјали.`);
      onDone();
      refetch();
    },
  });

  // Стандардно: сè што е препознато со висока сигурност е штиклирано
  useEffect(() => {
    if (!data) return;
    const next: Record<number, boolean> = {};
    for (const r of data.recognized) next[r.id] = r.confidence === "high";
    setChecked(next);
  }, [data]);

  const filtered = useMemo(() => {
    const list = data?.recognized ?? [];
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter(
      (r: any) => r.name.toLowerCase().includes(s) || (r.code ?? "").toLowerCase().includes(s)
    );
  }, [data, q]);

  const selectedCount = Object.values(checked).filter(Boolean).length;

  const toggleAll = (val: boolean) => {
    const next: Record<number, boolean> = { ...checked };
    for (const r of filtered) next[r.id] = val;
    setChecked(next);
  };

  const apply = () => {
    const items = (data?.recognized ?? [])
      .filter((r: any) => checked[r.id])
      .map((r: any) => ({ id: r.id, weightPerUnit: r.weightPerUnit }));
    if (items.length === 0) return;
    applyMutation.mutate({ items });
  };

  return (
    <>
      <Button variant="outline" onClick={() => { setResult(null); setOpen(true); }}>
        <Wand2 className="h-4 w-4 mr-2" />Пополни тежини
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Автоматско пополнување на тежини</DialogTitle>
          </DialogHeader>

          {isLoading ? (
            <div className="py-16 text-center text-gray-400">Се читаат материјалите...</div>
          ) : !data ? null : (
            <>
              <div className="grid grid-cols-4 gap-3 text-center">
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 py-2">
                  <div className="text-xl font-bold text-emerald-700">{data.totals.recognized}</div>
                  <div className="text-[11px] text-emerald-700">препознаени</div>
                </div>
                <div className="rounded-lg bg-amber-50 border border-amber-200 py-2">
                  <div className="text-xl font-bold text-amber-700">{data.totals.medium}</div>
                  <div className="text-[11px] text-amber-700">за проверка</div>
                </div>
                <div className="rounded-lg bg-gray-50 border border-gray-200 py-2">
                  <div className="text-xl font-bold text-gray-600">{data.totals.unparsed}</div>
                  <div className="text-[11px] text-gray-500">непрепознаени</div>
                </div>
                <div className="rounded-lg bg-blue-50 border border-blue-200 py-2">
                  <div className="text-xl font-bold text-blue-700">{data.totals.alreadyFilled}</div>
                  <div className="text-[11px] text-blue-700">веќе пополнети</div>
                </div>
              </div>

              {result && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-4 py-2">
                  {result}
                </div>
              )}

              <div className="flex flex-wrap gap-2 items-center">
                <div className="relative flex-1 min-w-[160px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input placeholder="Филтрирај..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-9 h-9" />
                </div>
                <Button size="sm" variant="outline" onClick={() => toggleAll(true)}>Означи сè</Button>
                <Button size="sm" variant="outline" onClick={() => toggleAll(false)}>Отштиклирај сè</Button>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 ml-1">
                  <input type="checkbox" checked={includeFilled}
                    onChange={(e) => setIncludeFilled(e.target.checked)} />
                  Прегази и веќе пополнети
                </label>
              </div>

              <div className="flex-1 overflow-y-auto border rounded-lg">
                <Table>
                  <TableHeader className="sticky top-0 bg-white z-10">
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Материјал</TableHead>
                      <TableHead>Препознато</TableHead>
                      <TableHead className="text-right w-32">Тежина</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center py-10 text-gray-400">
                        Нема што да се пополни
                      </TableCell></TableRow>
                    ) : filtered.map((r: any) => (
                      <TableRow key={r.id} className={r.confidence === "medium" ? "bg-amber-50/50" : ""}>
                        <TableCell>
                          <input type="checkbox" checked={!!checked[r.id]}
                            onChange={(e) => setChecked({ ...checked, [r.id]: e.target.checked })} />
                        </TableCell>
                        <TableCell>
                          <div className="text-sm leading-tight">{r.name}</div>
                          <div className="text-[11px] text-gray-400 font-mono">{r.code}</div>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs font-medium">{r.shape}</div>
                          <div className="text-[11px] text-gray-500">{r.dims}</div>
                          {r.note && (
                            <div className="text-[11px] text-amber-700 flex items-start gap-1 mt-0.5">
                              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{r.note}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-bold">{r.weightPerUnit.toFixed(3)}</span>
                          <span className="text-[11px] text-gray-400 ml-1">кг/{UNIT_MK[r.unit] ?? r.unit}</span>
                          {r.currentWeight > 0 && (
                            <div className="text-[11px] text-blue-600">беше {Number(r.currentWeight).toFixed(3)}</div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <p className="text-[11px] text-gray-400 max-w-md leading-relaxed">
                  Пресметките се теоретски — без радиуси на аглите и толеранции. Отстапувањето
                  од каталошката тежина е обично под 2%.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setOpen(false)}>Затвори</Button>
                  <Button className="bg-amber-500 hover:bg-amber-600 text-white"
                    disabled={selectedCount === 0 || applyMutation.isPending} onClick={apply}>
                    {applyMutation.isPending ? "Се запишува..." : `Запиши ${selectedCount}`}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
