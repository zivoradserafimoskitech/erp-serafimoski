import { useState, useEffect, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertTriangle, ShoppingCart, Package, Coins, Info } from "lucide-react";

const UNIT_MK: Record<string, string> = { kg: "кг", m: "м", m2: "м²", pcs: "ком", l: "л", sheet: "табла" };

export default function ProcurementNeeds() {
  const utils = trpc.useUtils();
  const [includeMinStock, setIncludeMinStock] = useState(true);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [qtyOverride, setQtyOverride] = useState<Record<number, string>>({});
  const [supOverride, setSupOverride] = useState<Record<number, string>>({});
  const [expectedDate, setExpectedDate] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const { data, isLoading } = trpc.procurement.procurementNeeds.useQuery({ includeMinStock });
  const { data: suppliers } = trpc.procurement.supplierList.useQuery({});

  const createPOs = trpc.procurement.poCreateFromNeeds.useMutation({
    onSuccess: (res) => {
      utils.procurement.poList.invalidate();
      utils.procurement.procurementNeeds.invalidate();
      const nums = res.created.map((c) => c.poNumber).join(", ");
      setResult(
        res.created.length === 1
          ? `Креирана набавна нарачка ${nums}`
          : `Креирани ${res.created.length} набавни нарачки: ${nums}`
      );
      setChecked({});
    },
  });

  useEffect(() => {
    setChecked({});
    setQtyOverride({});
    setSupOverride({});
  }, [data]);

  const rows = data?.rows ?? [];

  const supplierOf = (r: any) => supOverride[r.id] ?? (r.defaultSupplierId ? String(r.defaultSupplierId) : "");
  const qtyOf = (r: any) => qtyOverride[r.id] ?? String(r.shortage);

  const selected = useMemo(
    () => rows.filter((r: any) => checked[r.id]),
    [rows, checked]
  );
  const readyCount = selected.filter((r: any) => supplierOf(r)).length;
  const missingSupplier = selected.length - readyCount;
  const selectedCost = selected.reduce(
    (a: number, r: any) => a + (Number(qtyOf(r)) || 0) * r.lastPrice, 0
  );

  const submit = () => {
    const items = selected
      .filter((r: any) => supplierOf(r))
      .map((r: any) => ({
        materialId: r.id,
        supplierId: Number(supplierOf(r)),
        description: r.name,
        quantity: String(Number(qtyOf(r)) || 0),
        unitPrice: String(r.lastPrice),
      }))
      .filter((i) => Number(i.quantity) > 0);
    if (items.length === 0) return;
    createPOs.mutate({ items, expectedDate: expectedDate || undefined });
  };

  if (isLoading) {
    return <div className="py-16 text-center text-gray-400">Се пресметуваат потребите...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-red-50 p-2.5 rounded-lg"><AlertTriangle className="h-5 w-5 text-red-600" /></div>
          <div><p className="text-sm text-gray-500">Материјали што недостигаат</p>
            <p className="text-xl font-bold text-red-600">{data?.totals.count ?? 0}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-amber-50 p-2.5 rounded-lg"><Package className="h-5 w-5 text-amber-600" /></div>
          <div><p className="text-sm text-gray-500">Бараат отворени налози</p>
            <p className="text-xl font-bold">{data?.totals.fromWorkOrders ?? 0}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-emerald-50 p-2.5 rounded-lg"><Coins className="h-5 w-5 text-emerald-600" /></div>
          <div><p className="text-sm text-gray-500">Проценета вредност</p>
            <p className="text-xl font-bold">{(data?.totals.estCost ?? 0).toLocaleString("mk-MK")} <span className="text-sm text-gray-400">ден</span></p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-gray-100 p-2.5 rounded-lg"><Info className="h-5 w-5 text-gray-500" /></div>
          <div><p className="text-sm text-gray-500">Без добавувач</p>
            <p className="text-xl font-bold text-gray-600">{data?.totals.noSupplier ?? 0}</p></div>
        </CardContent></Card>
      </div>

      {result && (
        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-4 py-2.5">
          <span>{result}</span>
          <button onClick={() => setResult(null)} className="text-emerald-500 hover:text-emerald-700 px-2">×</button>
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-center">
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={includeMinStock}
            onChange={(e) => setIncludeMinStock(e.target.checked)} />
          Земи ја предвид и минималната залиха
        </label>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-gray-500">Очекувана испорака</span>
          <Input type="date" className="h-9 w-40" value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)} />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Материјал</TableHead>
                <TableHead className="text-right w-24">На залиха</TableHead>
                <TableHead className="text-right w-28">Бараат налози</TableHead>
                <TableHead className="text-right w-28">Веќе нарачано</TableHead>
                <TableHead className="text-right w-28">Недостига</TableHead>
                <TableHead className="w-44">Добавувач</TableHead>
                <TableHead className="text-right w-28">Проц. цена</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-12 text-gray-400">
                  Нема материјали што недостигаат. Залихите ги покриваат отворените налози.
                </TableCell></TableRow>
              ) : rows.map((r: any) => {
                const qty = qtyOf(r);
                const sup = supplierOf(r);
                return (
                  <TableRow key={r.id} className={checked[r.id] ? "bg-amber-50/60" : ""}>
                    <TableCell>
                      <input type="checkbox" checked={!!checked[r.id]}
                        onChange={(e) => setChecked({ ...checked, [r.id]: e.target.checked })} />
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium leading-tight">{r.name}</div>
                      <div className="text-[11px] text-gray-400 font-mono">{r.code}</div>
                      {r.workOrders.length > 0 && (
                        <div className="text-[11px] text-amber-700 mt-0.5">
                          {r.workOrders.slice(0, 3).join(", ")}
                          {r.workOrders.length > 3 ? ` +${r.workOrders.length - 3}` : ""}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {r.currentStock.toLocaleString("mk-MK")}
                      <span className="text-[11px] text-gray-400 ml-1">{UNIT_MK[r.unit] ?? r.unit}</span>
                      {r.minStock > 0 && (
                        <div className="text-[11px] text-gray-400">мин. {r.minStock}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {r.reservedQty > 0 ? (
                        <span className="font-medium text-amber-700">{r.reservedQty.toLocaleString("mk-MK")}</span>
                      ) : <span className="text-gray-300">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {r.incoming > 0 ? (
                        <span className="font-medium text-blue-600">{r.incoming.toLocaleString("mk-MK")}</span>
                      ) : <span className="text-gray-300">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Input className="h-8 text-xs text-right" type="number" step="0.001"
                        value={qty}
                        onChange={(e) => {
                          setQtyOverride({ ...qtyOverride, [r.id]: e.target.value });
                          setChecked({ ...checked, [r.id]: true });
                        }} />
                      {r.weightPerUnit > 0 && (
                        <div className="text-[11px] text-gray-400 mt-0.5">
                          ≈ {((Number(qty) || 0) * r.weightPerUnit).toFixed(0)} кг
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select value={sup} onValueChange={(v) => {
                        setSupOverride({ ...supOverride, [r.id]: v });
                        setChecked({ ...checked, [r.id]: true });
                      }}>
                        <SelectTrigger className={`h-8 text-xs ${!sup ? "border-red-200 text-red-500" : ""}`}>
                          <SelectValue placeholder="Избери…" />
                        </SelectTrigger>
                        <SelectContent>
                          {suppliers?.map((sp: any) => (
                            <SelectItem key={sp.id} value={String(sp.id)} className="text-xs">{sp.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {r.lastPrice > 0 ? (
                        <>
                          <span className="font-medium">
                            {((Number(qty) || 0) * r.lastPrice).toLocaleString("mk-MK", { maximumFractionDigits: 0 })}
                          </span>
                          <div className="text-[11px] text-gray-400">
                            {r.lastPrice.toLocaleString("mk-MK")} ден/{UNIT_MK[r.unit] ?? r.unit}
                          </div>
                        </>
                      ) : <Badge variant="outline" className="text-[10px] text-gray-400">нема цена</Badge>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selected.length > 0 && (
        <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 bg-white border shadow-lg rounded-lg px-4 py-3">
          <div className="text-sm">
            <b>{selected.length}</b> избрани · проценета вредност{" "}
            <b>{selectedCost.toLocaleString("mk-MK", { maximumFractionDigits: 0 })} ден</b>
            {missingSupplier > 0 && (
              <span className="text-red-600 ml-2">
                ({missingSupplier} без добавувач — нема да бидат вклучени)
              </span>
            )}
          </div>
          <Button className="bg-amber-500 hover:bg-amber-600 text-white"
            disabled={readyCount === 0 || createPOs.isPending} onClick={submit}>
            <ShoppingCart className="h-4 w-4 mr-2" />
            {createPOs.isPending ? "Се креира..." : `Креирај набавни нарачки (${readyCount})`}
          </Button>
        </div>
      )}
    </div>
  );
}
