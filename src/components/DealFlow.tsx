import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Check, ChevronRight, Loader2, ExternalLink, Minus } from "lucide-react";

export type DealStage = { key: string; label: string; status: "done" | "current" | "todo" | "skipped"; detail: string; href?: string; action?: string; actionLabel?: string; refId?: number };
export type Deal = { quotationId: number; quoteNumber: string; customer: string | null; total: number; currency: string; orderId: number | null; closed: boolean; currentStage: string | null; stages: DealStage[] };

/** Мала лента (за листа): точки со боја по статус. */
export function DealFlowMini({ stages }: { stages: DealStage[] }) {
  return (
    <div className="flex items-center gap-1">
      {stages.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1" title={`${s.label}: ${s.detail}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${s.status === "done" ? "bg-emerald-500" : s.status === "current" ? "bg-amber-500 ring-4 ring-amber-100" : s.status === "skipped" ? "bg-gray-200" : "bg-gray-300"}`} />
          {i < stages.length - 1 && <span className={`h-0.5 w-3 ${s.status === "done" || s.status === "skipped" ? "bg-emerald-300" : "bg-gray-200"}`} />}
        </div>
      ))}
    </div>
  );
}

/**
 * Цела картичка: лента со чекори + копче за следниот чекор.
 * onProforma: кога е вградена во Понуди, про-фактурата се отвора таму; инаку се оди на понудата.
 */
export default function DealFlow({ quotationId, onProforma, compact = false }: { quotationId: number; onProforma?: () => void; compact?: boolean }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data: deal, isLoading } = trpc.ops.dealFlow.useQuery({ quotationId });
  const refresh = () => { utils.ops.dealFlow.invalidate(); utils.ops.dealList.invalidate(); utils.quotation.invalidate(); utils.production.workOrderList.invalidate(); utils.accounting.invoiceList.invalidate(); };
  const onErr = (e: any) => toast.error(e.message);
  const accept = trpc.quotation.quotationUpdate.useMutation({ onSuccess: () => { toast.success("Понудата е прифатена"); refresh(); }, onError: onErr });
  const convert = trpc.quotation.quotationConvert.useMutation({ onSuccess: () => { toast.success("Нарачката е потврдена"); refresh(); }, onError: onErr });
  const linkWo = trpc.ops.dealCreateWorkOrder.useMutation({ onError: onErr });
  const chainWo = trpc.production.orderFromChain.useMutation({ onSuccess: (d) => { toast.success(`Отворен налог ${d.woNumber}`); refresh(); }, onError: onErr });
  const dn = trpc.production.workOrderToDeliveryNote.useMutation({ onSuccess: (d: any) => { toast.success(`Испратница ${d.dnNumber}`); refresh(); }, onError: onErr });
  const inv = trpc.production.workOrderToInvoice.useMutation({ onSuccess: (d) => { toast.success(`Фактура ${d.invoiceNumber} (нацрт)`); refresh(); }, onError: onErr });
  const busy = accept.isPending || convert.isPending || linkWo.isPending || chainWo.isPending || dn.isPending || inv.isPending;

  const run = async (s: DealStage) => {
    if (!deal) return;
    switch (s.action) {
      case "accept": accept.mutate({ id: deal.quotationId, status: "accepted" }); break;
      case "proforma": onProforma ? onProforma() : navigate(`/ponudi?open=${deal.quotationId}&action=proforma`); break;
      case "convert": {
        const num = await utils.settings.nextDocNumber.fetch({ kind: "order" });
        convert.mutate({ quotationId: deal.quotationId, orderNumber: num });
        break;
      }
      case "workorder": {
        const r = await linkWo.mutateAsync({ quotationId: deal.quotationId });
        if (r.linked) { toast.success(`Налогот ${r.woNumber} е поврзан со нарачката`); refresh(); }
        else chainWo.mutate({ orderId: r.orderId });
        break;
      }
      case "delivery": if (s.refId) dn.mutate({ workOrderId: s.refId }); break;
      case "invoice": if (s.refId) inv.mutate({ workOrderId: s.refId }); break;
      case "payment": navigate(`/finansii?tab=cash${s.refId ? `&invoice=${s.refId}` : ""}`); break;
    }
  };

  if (isLoading || !deal) return <div className="h-20 rounded-xl border bg-gray-50 animate-pulse" />;
  const current = deal.stages.find(s => s.status === "current");

  return (
    <div className="rounded-xl border bg-white">
      <div className={`grid grid-cols-4 md:grid-cols-8 ${compact ? "" : "border-b"}`}>
        {deal.stages.map((s, i) => {
          const done = s.status === "done", cur = s.status === "current", skip = s.status === "skipped";
          return (
            <button key={s.key} onClick={() => s.href && navigate(s.href)} disabled={!s.href}
              className={`relative text-left px-3 py-2.5 border-r last:border-r-0 ${cur ? "bg-amber-50" : ""} ${s.href ? "hover:bg-gray-50" : "cursor-default"}`}
              title={s.detail}>
              <div className="flex items-start gap-1.5">
                <span className={`h-5 w-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold
                  ${done ? "bg-emerald-500 text-white" : cur ? "bg-amber-500 text-white" : skip ? "bg-gray-100 text-gray-300" : "bg-gray-200 text-gray-500"}`}>
                  {done ? <Check className="h-3 w-3" /> : skip ? <Minus className="h-3 w-3" /> : i + 1}
                </span>
                <span className={`text-[11.5px] font-semibold leading-tight ${skip ? "text-gray-300" : cur ? "text-amber-800" : done ? "text-gray-700" : "text-gray-400"}`}>{s.label}</span>
              </div>
              {!compact && <p className={`text-[10.5px] mt-1 leading-tight line-clamp-2 ${skip ? "text-gray-300" : "text-gray-500"}`}>{s.detail}</p>}
            </button>
          );
        })}
      </div>
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          {deal.closed ? (
            <p className="text-sm font-medium text-emerald-700 flex items-center gap-1.5"><Check className="h-4 w-4" />Нарачката е завршена и наплатена</p>
          ) : current ? (
            <p className="text-sm text-gray-600">Следен чекор: <b className="text-gray-900">{current.label}</b> <span className="text-gray-400">— {current.detail}</span></p>
          ) : <span />}
          <div className="flex gap-2">
            {current?.action && (
              <Button size="sm" className="bg-amber-500 hover:bg-amber-600" disabled={busy} onClick={() => run(current)}>
                {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <ChevronRight className="h-4 w-4 mr-1" />}{current.actionLabel}
              </Button>
            )}
            {current && !current.action && current.href && (
              <Button size="sm" variant="outline" onClick={() => navigate(current.href!)}><ExternalLink className="h-3.5 w-3.5 mr-1.5" />Отвори</Button>
            )}
            {/* Незадолжителни чекори што може да се прескокнат/направат однапред */}
            {deal.stages.filter(s => s !== current && s.action && s.status === "todo" && ["proforma", "convert"].includes(s.action)).slice(0, 1).map(s => (
              <Button key={s.key} size="sm" variant="outline" disabled={busy} onClick={() => run(s)}>{s.actionLabel}</Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
