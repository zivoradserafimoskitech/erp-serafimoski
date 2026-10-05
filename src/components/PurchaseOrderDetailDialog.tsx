import { useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import SendEmailDialog from "@/components/SendEmailDialog";
import { printPurchaseOrder, purchaseOrderHtml, type DocLang } from "@/lib/print-documents";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";
import { ShoppingCart, Printer, Mail, Send, CheckCircle2, XCircle, Truck, CalendarDays, Phone, AtSign, X, PackageCheck } from "lucide-react";

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Нацрт", cls: "bg-gray-100 text-gray-700" },
  sent: { label: "Испратена", cls: "bg-blue-100 text-blue-700" },
  confirmed: { label: "Потврдена", cls: "bg-emerald-100 text-emerald-700" },
  partial: { label: "Делумно примена", cls: "bg-warning/15 text-foreground/80" },
  received: { label: "Примена", cls: "bg-teal-100 text-teal-700" },
  cancelled: { label: "Откажана", cls: "bg-red-100 text-red-700" },
};
const UNIT_MK: Record<string, string> = { kg: "кг", m: "м", m2: "м²", pcs: "ком", l: "л", sheet: "табла", hour: "ч", m_cut: "м", bend: "свив." };
const money = (v: any) => Number(v ?? 0).toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: any) => Number(v ?? 0).toLocaleString("mk-MK", { maximumFractionDigits: 3 });

/** Преглед на набавна нарачка: печатење (МК/EN), праќање до добавувачот со PDF, промена на статус. */
export default function PurchaseOrderDetailDialog({ poId, open, onOpenChange }: { poId: number | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const [lang, setLang] = useState<DocLang>("mk");
  const [mailOpen, setMailOpen] = useState(false);
  const { data: po } = trpc.procurement.poById.useQuery({ id: poId! }, { enabled: !!poId && open });
  const { data: settings } = trpc.settings.settingsGet.useQuery(undefined, { enabled: open });
  const upd = trpc.procurement.poUpdate.useMutation({
    onSuccess: () => { utils.procurement.poById.invalidate(); utils.procurement.poList.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const setStatus = (status: "sent" | "confirmed" | "cancelled" | "draft", msg: string) =>
    po && upd.mutate({ id: po.id, status }, { onSuccess: () => toast.success(msg) });

  const st = STATUS[po?.status ?? "draft"] ?? STATUS.draft;
  const sup: any = po?.supplier ?? {};
  const items: any[] = po?.items ?? [];
  const net = Number(po?.totalAmount ?? 0);
  const closed = po && ["received", "cancelled"].includes(po.status);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden max-h-[92vh] flex flex-col [&>button]:hidden">
          {/* Заглавие */}
          <div className="flex items-start gap-3 px-6 py-5 bg-gradient-to-r from-primary/10 to-white border-b">
            <div className="h-11 w-11 rounded-xl bg-primary text-white flex items-center justify-center shadow-sm shrink-0"><ShoppingCart className="h-5 w-5" /></div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
                Набавна нарачка <span className="font-mono text-primary">{po?.poNumber}</span>
                <span className={`text-xs font-medium rounded-full px-2.5 py-0.5 ${st.cls}`}>{st.label}</span>
              </DialogTitle>
              <DialogDescription className="text-sm text-gray-500 mt-0.5">Креирана {formatDate(po?.createdAt)}{po?.expectedDate ? ` · рок за испорака ${formatDate(po.expectedDate)}` : ""}</DialogDescription>
            </div>
            <button type="button" onClick={() => onOpenChange(false)} className="text-gray-400 hover:text-gray-600 -mr-2 -mt-1 p-1" aria-label="Затвори"><X className="h-4 w-4" /></button>
          </div>

          {/* Копчиња */}
          <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-b bg-white">
            <div className="inline-flex rounded-md border p-0.5 mr-1">
              {(["mk", "en"] as DocLang[]).map(l => (
                <button key={l} type="button" onClick={() => setLang(l)}
                  className={`px-2 py-1 text-xs rounded ${lang === l ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-800"}`}>{l === "mk" ? "МК" : "EN"}</button>
              ))}
            </div>
            <Button size="sm" variant="outline" disabled={!po} onClick={() => po && printPurchaseOrder(po, settings, lang)}><Printer className="h-4 w-4 mr-1.5" />Печати / PDF</Button>
            <Button size="sm" disabled={!po || po.status === "cancelled"} onClick={() => setMailOpen(true)}><Mail className="h-4 w-4 mr-1.5" />Прати на добавувачот</Button>
            {po && ["sent", "confirmed", "partial", "draft"].includes(po.status) && (
              <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" onClick={() => { onOpenChange(false); navigate(`/priemnici?po=${po.id}`); }}>
                <PackageCheck className="h-4 w-4 mr-1.5" />Прими роба
              </Button>
            )}
            <div className="flex-1" />
            {po?.status === "draft" && <Button size="sm" variant="outline" onClick={() => setStatus("sent", "Означена како испратена")}><Send className="h-4 w-4 mr-1.5" />Испратена</Button>}
            {po && ["draft", "sent"].includes(po.status) && <Button size="sm" variant="outline" className="text-emerald-700 border-emerald-200 hover:bg-emerald-50" onClick={() => setStatus("confirmed", "Добавувачот ја потврди нарачката")}><CheckCircle2 className="h-4 w-4 mr-1.5" />Потврдена</Button>}
            {po && !closed && po.status !== "partial" && <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => { if (confirm(`Да се откаже нарачката ${po.poNumber}?`)) setStatus("cancelled", "Нарачката е откажана"); }}><XCircle className="h-4 w-4 mr-1.5" />Откажи</Button>}
            {po?.status === "cancelled" && <Button size="sm" variant="outline" onClick={() => setStatus("draft", "Нарачката е вратена во нацрт")}>Врати во нацрт</Button>}
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {!po ? <p className="text-sm text-gray-400 py-8 text-center">Вчитување...</p> : (<>
              {/* Добавувач */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border p-4">
                  <div className="text-xs uppercase tracking-wider text-gray-400 flex items-center gap-1.5"><Truck className="h-3.5 w-3.5" />Добавувач</div>
                  <div className="font-semibold text-gray-900 mt-1">{sup.name ?? "—"}</div>
                  <div className="text-sm text-gray-500 mt-1 space-y-0.5">
                    {[sup.address, sup.city].filter(Boolean).length > 0 && <div>{[sup.address, sup.city].filter(Boolean).join(", ")}</div>}
                    {sup.contactPerson && <div>{sup.contactPerson}</div>}
                    {sup.phone && <div className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{sup.phone}</div>}
                    {sup.email ? <div className="flex items-center gap-1.5"><AtSign className="h-3.5 w-3.5" />{sup.email}</div>
                      : <div className="text-primary text-xs">Нема внесено е-пошта — внеси ја при праќањето или кај добавувачот</div>}
                  </div>
                </div>
                <div className="rounded-xl border p-4 grid grid-cols-2 gap-3 content-start">
                  <div><div className="text-xs text-gray-400">Износ без ДДВ</div><div className="text-lg font-bold tabular-nums">{money(net)} <span className="text-xs font-normal text-gray-400">ден.</span></div></div>
                  <div><div className="text-xs text-gray-400">Со ДДВ 18%</div><div className="text-lg font-bold tabular-nums text-gray-900">{money(net * 1.18)} <span className="text-xs font-normal text-gray-400">ден.</span></div></div>
                  <div className="col-span-2 flex items-center gap-1.5 text-sm text-gray-600"><CalendarDays className="h-4 w-4 text-gray-400" />Рок: <b>{po.expectedDate ? formatDate(po.expectedDate) : "не е зададен"}</b></div>
                </div>
              </div>

              {/* Ставки */}
              <div className="rounded-xl border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead><tr className="bg-gray-50 text-xs text-gray-500 border-b">
                      <th className="text-left font-medium px-3 py-2 w-8">#</th><th className="text-left font-medium px-2 py-2">Материјал</th>
                      <th className="text-right font-medium px-2 py-2">Количина</th><th className="text-right font-medium px-2 py-2">Цена</th>
                      <th className="text-right font-medium px-2 py-2">Вкупно</th><th className="text-right font-medium px-3 py-2">Примено</th>
                    </tr></thead>
                    <tbody>
                      {items.map((it, i) => {
                        const u = UNIT_MK[it.materialUnit] ?? it.materialUnit ?? "";
                        const rec = Number(it.receivedQuantity ?? 0), q = Number(it.quantity ?? 0);
                        return (
                          <tr key={it.id} className="border-b last:border-b-0">
                            <td className="px-3 py-2.5 text-xs text-gray-400">{i + 1}</td>
                            <td className="px-2 py-2.5">
                              <div className="font-medium text-gray-900">{it.materialName ?? it.description}</div>
                              {it.description && it.description !== it.materialName && <div className="text-xs text-gray-500">{it.description}</div>}
                            </td>
                            <td className="px-2 py-2.5 text-right tabular-nums">{qty(q)} <span className="text-gray-400 text-xs">{u}</span></td>
                            <td className="px-2 py-2.5 text-right tabular-nums">{money(it.unitPrice)}</td>
                            <td className="px-2 py-2.5 text-right tabular-nums font-medium">{money(it.totalPrice)}</td>
                            <td className={`px-3 py-2.5 text-right tabular-nums text-xs ${rec >= q && q > 0 ? "text-emerald-700" : rec > 0 ? "text-primary" : "text-gray-400"}`}>
                              {rec >= q && q > 0 ? <span className="inline-flex items-center gap-1"><PackageCheck className="h-3.5 w-3.5" />целосно</span> : `${qty(rec)} / ${qty(q)}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {po.notes && <div className="rounded-lg bg-primary/10 border border-primary/20 px-4 py-3 text-sm text-gray-700"><span className="text-gray-500">Белешка:</span> {po.notes}</div>}
            </>)}
          </div>
        </DialogContent>
      </Dialog>

      {po && (
        <SendEmailDialog open={mailOpen} onOpenChange={setMailOpen} docType="purchase_order" docId={po.id} docNumber={po.poNumber}
          defaultTo={sup.email} companyName={settings?.name} defaultLang={lang}
          buildHtml={(l) => purchaseOrderHtml(po, settings, l)}
          onSent={() => { if (po.status === "draft") setStatus("sent", "Нарачката е означена како испратена"); }} />
      )}
    </>
  );
}
