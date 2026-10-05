import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import SearchPick from "@/components/SearchPick";
import { useAccountItems } from "@/components/TerkTab";
import { toast } from "sonner";
import { Check, Wallet, Users, Landmark, Receipt, Banknote, HelpCircle, Percent } from "lucide-react";

const ICON: Record<string, any> = { salary: Users, contrib: Landmark, pit: Percent, vat: Receipt, fee: Banknote, cash: Wallet, other: HelpCircle };
const den = (v: any) => Number(v ?? 0).toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Ставка од извод без фактура: „Што е ова?“ со обични зборови → конто.
 * Остатокот по поврзаните фактури (ако го има) се книжи на истото конто.
 */
export default function BankPostDialog({ tx, onClose, onDone }: { tx: any | null; onClose: () => void; onDone: () => void }) {
  const accountItems = useAccountItems();
  const { data } = trpc.bank.bankKindSuggest.useQuery({ txId: tx?.id ?? 0 }, { enabled: !!tx });
  const [kind, setKind] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  useEffect(() => {
    if (!tx) return;
    setAccount(tx.accountCode ?? null);
    setKind(null);
  }, [tx?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!data || !tx || tx.accountCode) return;
    const s = data.suggestion;
    if (s?.sure) { setKind(s.key); setAccount(data.kinds.find(k => k.key === s.key)?.accountCode ?? null); }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const post = trpc.bank.bankPostToAccount.useMutation({
    onSuccess: () => { toast.success("Ставката е книжена"); onDone(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  if (!tx) return null;
  const pick = (k: { key: string; accountCode: string | null }) => { setKind(k.key); setAccount(k.accountCode); };
  const unsure = data?.suggestion && !data.suggestion.sure ? data.kinds.find(k => k.key === data.suggestion!.key) : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogTitle>Што е оваа ставка?</DialogTitle>
        <DialogDescription>
          {String(tx.txDate).slice(0, 10).split("-").reverse().join(".")} · <b className={tx.direction === "in" ? "text-emerald-700" : "text-red-600"}>{tx.direction === "in" ? "+" : "−"}{den(tx.amount)}</b> · {tx.counterpartyName || "—"}
          {tx.purpose ? <span className="block text-xs text-gray-500 mt-0.5">{tx.purpose}</span> : null}
        </DialogDescription>
        {unsure && !kind && <p className="text-xs rounded-md bg-primary/10 border border-primary/20 px-2 py-1 text-foreground/80">Можеби е „{unsure.title}“ — не сум сигурен, избери ти.</p>}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {(data?.kinds ?? []).map(k => {
            const I = ICON[k.key] ?? HelpCircle; const on = kind === k.key;
            return (
              <button key={k.key} type="button" onClick={() => pick(k)}
                className={`relative text-left rounded-lg border p-2.5 transition ${on ? "border-primary/50 bg-primary/10 ring-1 ring-primary/30" : "bg-white hover:border-primary/40"}`}>
                {on && <Check className="absolute right-2 top-2 h-4 w-4 text-primary" />}
                <div className="flex items-center gap-1.5 text-sm font-medium pr-5"><I className="h-4 w-4 text-primary shrink-0" />{k.title}</div>
                <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">{k.examples}{k.accountCode ? ` · конто ${k.accountCode}` : ""}</div>
              </button>);
          })}
        </div>
        {(kind === "other" || (!kind && account)) && (
          <div className="space-y-1">
            <p className="text-xs text-gray-600">Конто</p>
            <SearchPick<string> items={accountItems} value={account} onChange={setAccount} placeholder="Избери конто (на пр. кредит, камата, капитал)" clearable={false} />
          </div>
        )}
        <p className="text-[11px] text-gray-500">
          {tx.direction === "in" ? "Прилив: Должи банка / Побарува избраното конто." : "Одлив: Должи избраното конто / Побарува банка."}
          {Number(tx.provision) > 0 ? ` Провизијата (${den(tx.provision)}) се книжи сама на трошоци за платен промет.` : ""}
        </p>
        <div className="flex justify-between gap-2 pt-1">
          {tx.accountCode ? <Button variant="ghost" className="text-red-600" onClick={() => post.mutate({ txId: tx.id, accountCode: null })}>Тргни го книжењето</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Откажи</Button>
            <Button disabled={!account || post.isPending} onClick={() => post.mutate({ txId: tx.id, accountCode: account })}>Книжи{account ? ` на ${account}` : ""}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
