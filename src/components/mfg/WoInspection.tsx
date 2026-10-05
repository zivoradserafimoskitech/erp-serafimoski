import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/utils";
import { CheckCircle2, XCircle, Trash2 } from "lucide-react";

const tol = (n: number | null, p: number | null, m: number | null, u: string) => (n === null ? "" : `${n}${p || m ? ` +${p ?? 0}/−${m ?? 0}` : ""} ${u ?? ""}`);

/** Контрола на налогот: што пропишува планот, внес на измерено, резултат по толеранција. */
export default function WoInspection({ workOrderId }: { workOrderId: number }) {
  const utils = trpc.useUtils();
  const { data } = trpc.mfg.inspectionForWorkOrder.useQuery({ workOrderId });
  const [val, setVal] = useState<Record<number, string>>({});
  const [free, setFree] = useState({ characteristic: "", ok: true, notes: "" });
  const rec = trpc.mfg.inspectionRecord.useMutation({
    onSuccess: (r) => { r.result === "ok" ? toast.success("Во ред") : toast.error("Надвор од толеранција — пријави неусогласеност ако е потребно"); utils.mfg.inspectionForWorkOrder.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.mfg.inspectionRecordDelete.useMutation({ onSuccess: () => utils.mfg.inspectionForWorkOrder.invalidate(), onError: (e) => toast.error(e.message) });
  if (!data) return null;
  const nok = data.records.filter((r) => r.result === "nok").length;
  return (
    <div className="space-y-3">
      {!data.plan.length && <p className="text-sm text-gray-500">Нема план на контрола за производите на овој налог. Внеси го во Квалитет → ISO → План на контрола (или општ план за сите налози). Може да се запише и слободна проверка подолу.</p>}
      {data.plan.map((p) => {
        const done = data.records.filter((r) => r.planId === p.id);
        return (
          <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <span className="flex-1 min-w-[12rem]"><b>{p.characteristic}</b> <span className="text-xs text-gray-500">{tol(p.nominal, p.tolPlus, p.tolMinus, p.unit)}{p.instrument ? ` · ${p.instrument}` : ""}{p.frequency ? ` · ${p.frequency}` : ""}{p.product ? ` · ${p.product}` : ""}</span></span>
            {done.map((r) => <span key={r.id} className={`text-xs rounded px-1.5 py-0.5 ${r.result === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{r.measured ?? (r.result === "ok" ? "OK" : "НЕ")}</span>)}
            {p.nominal !== null ? (
              <>
                <Input className="h-8 w-28" placeholder="измерено" value={val[p.id] ?? ""} onChange={(e) => setVal({ ...val, [p.id]: e.target.value })} />
                <Button size="sm" className="h-8" disabled={!val[p.id] || rec.isPending} onClick={() => { rec.mutate({ workOrderId, planId: p.id, characteristic: p.characteristic, nominal: p.nominal, tolPlus: p.tolPlus, tolMinus: p.tolMinus, measured: parseFloat(val[p.id].replace(",", ".")), sampleNo: done.length + 1, instrumentId: p.instrumentId }); setVal({ ...val, [p.id]: "" }); }}>Запиши</Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" className="h-8 text-emerald-700" onClick={() => rec.mutate({ workOrderId, planId: p.id, characteristic: p.characteristic, okManual: true, sampleNo: done.length + 1, instrumentId: p.instrumentId })}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Во ред</Button>
                <Button size="sm" variant="outline" className="h-8 text-red-600" onClick={() => rec.mutate({ workOrderId, planId: p.id, characteristic: p.characteristic, okManual: false, sampleNo: done.length + 1, instrumentId: p.instrumentId })}><XCircle className="h-3.5 w-3.5 mr-1" />Не</Button>
              </>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Input className="h-8 flex-1 min-w-[12rem]" placeholder="Слободна проверка (на пр. визуелно — завар)" value={free.characteristic} onChange={(e) => setFree({ ...free, characteristic: e.target.value })} />
        <Button size="sm" variant="outline" className="h-8 text-emerald-700" disabled={!free.characteristic} onClick={() => { rec.mutate({ workOrderId, characteristic: free.characteristic, okManual: true }); setFree({ ...free, characteristic: "" }); }}>Во ред</Button>
        <Button size="sm" variant="outline" className="h-8 text-red-600" disabled={!free.characteristic} onClick={() => { rec.mutate({ workOrderId, characteristic: free.characteristic, okManual: false }); setFree({ ...free, characteristic: "" }); }}>Не</Button>
      </div>
      {!!data.records.length && (
        <div className="border-t pt-2 text-xs space-y-1">
          <p className="font-semibold text-gray-600">Записи ({data.records.length}{nok ? `, ${nok} надвор од толеранција` : ""})</p>
          {data.records.map((r) => (
            <div key={r.id} className="flex items-center gap-2">
              {r.result === "ok" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 text-red-600" />}
              <span className="w-32 text-gray-500">{formatDateTime(r.at)}</span>
              <span className="flex-1">{r.characteristic}{r.measured !== null ? ` = ${r.measured}` : ""} <span className="text-gray-400">{tol(r.nominal, r.tolPlus, r.tolMinus, "")}{r.instrument ? ` · ${r.instrument}` : ""}{r.inspector ? ` · ${r.inspector}` : ""}</span></span>
              <button className="text-gray-400 hover:text-red-600" onClick={() => { if (confirm("Да се избрише записот?")) del.mutate({ id: r.id }); }}><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
