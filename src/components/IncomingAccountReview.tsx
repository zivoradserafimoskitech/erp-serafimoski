import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import PurchaseKindQuestion from "@/components/PurchaseKindQuestion";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";
import { HelpCircle, ChevronRight } from "lucide-react";

/** Влезни фактури каде програмата не знае што е купено: прашање една по една, со обични зборови. */
export default function IncomingAccountReview() {
  const utils = trpc.useUtils();
  const { data: list } = trpc.accounting.incomingAccountReview.useQuery();
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [remember, setRemember] = useState(true);
  const upd = trpc.accounting.incomingInvoiceUpdate.useMutation({ onError: (e) => toast.error(e.message) });

  const items = list ?? [];
  if (!items.length && !open) return null;
  const cur = items[Math.min(idx, Math.max(0, items.length - 1))];

  const answer = async (code: string) => {
    if (!cur) return;
    await upd.mutateAsync({ id: cur.id, expenseAccount: code, rememberForSupplier: remember });
    await utils.accounting.incomingAccountReview.invalidate();
    utils.accounting.incomingInvoiceList.invalidate();
    const left = (await utils.accounting.incomingAccountReview.fetch()).length;
    toast.success(left ? `Зачувано · уште ${left}` : "Зачувано — нема повеќе фактури што чекаат");
    setIdx(0);
    if (!left) setOpen(false);
  };

  return (
    <>
      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 mb-3">
          <HelpCircle className="h-5 w-5 text-amber-600 shrink-0" />
          <div className="flex-1 min-w-[220px] text-sm text-amber-900">
            <b>{items.length} {items.length === 1 ? "влезна фактура чека" : "влезни фактури чекаат"} одговор</b> — програмата не знае што е купено (материјал, струја, закупнина...).
          </div>
          <Button size="sm" className="bg-amber-500 hover:bg-amber-600" onClick={() => { setIdx(0); setOpen(true); }}>Одговори <ChevronRight className="h-4 w-4 ml-1" /></Button>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogTitle className="flex items-center gap-2"><HelpCircle className="h-5 w-5 text-amber-600" />Што е купено со оваа фактура?</DialogTitle>
          <DialogDescription>Избери што најмногу одговара — не треба да знаеш конта. {items.length > 1 ? `(${Math.min(idx, items.length - 1) + 1} од ${items.length})` : ""}</DialogDescription>
          {cur ? (
            <div className="space-y-3">
              <div className="rounded-lg border bg-gray-50 px-4 py-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-semibold text-gray-900">{cur.supplier ?? "—"}</span>
                  <span className="tabular-nums font-semibold">{cur.total.toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {cur.currency === "MKD" ? "ден." : cur.currency}</span>
                </div>
                <div className="text-gray-500 text-xs mt-0.5">Фактура {cur.number} · {formatDate(cur.date)}</div>
                {(cur.items || cur.notes) && <div className="text-gray-700 text-xs mt-2 line-clamp-3">{[cur.items, cur.notes].filter(Boolean).join(" · ")}</div>}
              </div>
              <PurchaseKindQuestion onChange={answer} />
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  Запамети за {cur.supplier ?? "овој добавувач"} (следниот пат не прашува)
                </label>
                {items.length > 1 && <Button variant="ghost" size="sm" onClick={() => setIdx((idx + 1) % items.length)}>Прескокни засега</Button>}
              </div>
            </div>
          ) : <p className="text-sm text-gray-500 py-6 text-center">Нема фактури што чекаат.</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
