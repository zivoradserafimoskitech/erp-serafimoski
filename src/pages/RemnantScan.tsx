import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Scissors, ArrowLeft, MapPin, Trash2, CheckCircle2, AlertCircle } from "lucide-react";

const UNIT_MK: Record<string, string> = { kg: "кг", m: "м", m2: "м²", pcs: "ком", l: "л", sheet: "табла" };

export default function RemnantScan() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const [usedLength, setUsedLength] = useState("");
  const [ref, setRef] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const { data: r, isLoading } = trpc.remnants.remnantByCode.useQuery(
    { code: code ?? "" },
    { enabled: !!code }
  );
  const { data: cutParams } = trpc.remnants.cutParamsGet.useQuery();

  const useMut = trpc.remnants.remnantUse.useMutation({
    onSuccess: (res) => {
      utils.remnants.remnantByCode.invalidate();
      utils.remnants.remnantList.invalidate();
      utils.remnants.remnantStats.invalidate();
      if (res.newCode) setDone(`Останаа ${res.restMm} mm → нов остаток ${res.newCode}`);
      else if (res.scrapMm > 0) setDone(`Останаа ${res.scrapMm} mm — под минимумот, не е заведен`);
      else setDone("Остатокот е целосно искористен");
    },
  });

  const scrapMut = trpc.remnants.remnantScrap.useMutation({
    onSuccess: () => {
      utils.remnants.remnantByCode.invalidate();
      utils.remnants.remnantList.invalidate();
      utils.remnants.remnantStats.invalidate();
      setDone("Остатокот е отпишан");
    },
  });

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">Вчитување...</div>;
  }

  if (!r) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <AlertCircle className="h-12 w-12 text-amber-500" />
        <div>
          <p className="font-semibold">Не е пронајден остаток</p>
          <p className="text-sm text-gray-500 mt-1 font-mono">{code}</p>
        </div>
        <Button variant="outline" onClick={() => navigate("/sklad")}>
          <ArrowLeft className="h-4 w-4 mr-2" />Кон складот
        </Button>
      </div>
    );
  }

  const total = Number(r.lengthMm);
  const kerf = cutParams?.kerf ?? 2;
  const minRem = cutParams?.minRemnant ?? 300;
  const rest = Math.max(0, total - (Number(usedLength) || 0) - kerf);
  const available = r.status === "available";

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto space-y-4">
        {/* Заглавие */}
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-2xl font-extrabold text-amber-700">{r.code}</div>
              <div className="text-sm font-medium mt-1.5 leading-tight">{r.materialName}</div>
              <div className="text-xs text-gray-400 font-mono">{r.materialCode}</div>
            </div>
            <Badge variant="outline" className={
              r.status === "available" ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                : r.status === "used" ? "border-gray-300 text-gray-500"
                : "border-red-300 text-red-600 bg-red-50"
            }>
              {r.status === "available" ? "Достапен" : r.status === "used" ? "Искористен" : "Отпишан"}
            </Badge>
          </div>

          <div className="mt-4 flex items-end gap-4">
            <div>
              <div className="text-4xl font-extrabold leading-none">{total.toFixed(0)}</div>
              <div className="text-xs text-gray-400 mt-0.5">mm · {(total / 1000).toFixed(2)} м</div>
            </div>
            {Number(r.weightKg ?? 0) > 0 && (
              <div className="pb-1">
                <div className="text-xl font-bold text-slate-700">{Number(r.weightKg).toFixed(1)} <span className="text-sm text-gray-400">кг</span></div>
                {Number(r.estValue ?? 0) > 0 && (
                  <div className="text-xs text-emerald-600">≈ {Number(r.estValue).toLocaleString("mk-MK")} ден</div>
                )}
              </div>
            )}
          </div>

          {r.location && (
            <div className="mt-3 flex items-center gap-1.5 text-sm text-gray-600">
              <MapPin className="h-4 w-4 text-gray-400" />{r.location}
            </div>
          )}
          {(r.quantity ?? 1) > 1 && (
            <div className="mt-1 text-sm text-gray-600">{r.quantity} парчиња со иста должина</div>
          )}
        </div>

        {done && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-sm text-emerald-800">{done}</div>
          </div>
        )}

        {/* Искористување */}
        {available && !done && (
          <div className="bg-white rounded-xl border shadow-sm p-5 space-y-4">
            <div className="space-y-2">
              <Label className="text-base">Колку земаш? (mm)</Label>
              <Input type="number" inputMode="numeric" className="h-14 text-2xl text-center font-bold"
                placeholder="0" value={usedLength} max={total}
                onChange={(e) => setUsedLength(e.target.value)} />
              {usedLength && (
                <p className="text-sm text-center text-gray-600">
                  Останува ≈ <b>{rest.toFixed(0)} mm</b>
                  {rest > 0 && rest < minRem && (
                    <span className="text-amber-600"> — под {minRem} mm, оди во отпад</span>
                  )}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>За налог (по желба)</Label>
              <Input className="h-11" placeholder="РН-012/2026" value={ref}
                onChange={(e) => setRef(e.target.value)} />
            </div>

            <Button className="w-full h-14 text-base bg-amber-500 hover:bg-amber-600 text-white"
              disabled={!usedLength || Number(usedLength) <= 0 || Number(usedLength) > total || useMut.isPending}
              onClick={() => useMut.mutate({
                id: r.id, usedLengthMm: Number(usedLength),
                ref: ref || undefined, keepRemainder: true,
              })}>
              <Scissors className="h-5 w-5 mr-2" />
              {useMut.isPending ? "Се зачувува..." : "Потврди"}
            </Button>

            {Number(usedLength) > total && (
              <p className="text-sm text-red-600 text-center">
                Внесената должина е поголема од остатокот
              </p>
            )}

            <button
              className="w-full text-sm text-red-500 py-2"
              onClick={() => { if (confirm(`Отпиши ${r.code}?`)) scrapMut.mutate({ id: r.id }); }}>
              <Trash2 className="h-4 w-4 inline mr-1.5" />Отпиши го целиот остаток
            </button>
          </div>
        )}

        {!available && !done && (
          <div className="bg-white rounded-xl border p-5 text-center text-sm text-gray-500">
            Овој остаток веќе не е достапен.
            {r.usedInRef && <div className="mt-1 text-gray-400">{r.usedInRef}</div>}
          </div>
        )}

        <Button variant="outline" className="w-full h-12" onClick={() => navigate("/sklad")}>
          <ArrowLeft className="h-4 w-4 mr-2" />Кон складот
        </Button>
      </div>
    </div>
  );
}
