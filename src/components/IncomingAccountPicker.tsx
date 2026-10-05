import { useEffect } from "react";
import { trpc } from "@/providers/trpc";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EXPENSE_CHOICES, PURCHASE_KINDS } from "@contracts/finance";
import PurchaseKindQuestion from "@/components/PurchaseKindQuestion";
import { Sparkles, HelpCircle } from "lucide-react";

/**
 * Конто за влезна фактура.
 * Сигурно (запаметено кај добавувачот / јасно од текстот) -> се пополнува само, може да се смени.
 * Несигурно -> се прашува „Што е купено?“ со обични зборови; без одговор фактурата не се зачувува (needsAnswer).
 */
export default function IncomingAccountPicker({ supplierId, text, value, onChange, onNeedsAnswer }: {
  supplierId?: number; text?: string; value: string; onChange: (v: string) => void; onNeedsAnswer?: (needs: boolean) => void;
}) {
  const { data: g } = trpc.accounting.incomingAccountSuggest.useQuery({ supplierId, text: (text ?? "").slice(0, 2000) }, { enabled: !!supplierId });
  const unsure = !!supplierId && !!g && !g.sure;
  const needs = unsure && !value;
  useEffect(() => { onNeedsAnswer?.(needs); }, [needs]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!supplierId) return null;
  if (unsure) {
    const picked = PURCHASE_KINDS.find(k => k.code === value);
    return (
      <div className={`rounded-lg border p-3 space-y-2 ${needs ? "border-primary/40 bg-primary/10" : "bg-gray-50/60"}`}>
        <Label className="flex items-center gap-1.5 text-gray-800"><HelpCircle className="h-4 w-4 text-primary" />Што е купено со оваа фактура? *</Label>
        <p className="text-xs text-gray-500">Програмата не може сама да препознае — избери што најмногу одговара. Изборот се памети за овој добавувач.</p>
        <PurchaseKindQuestion value={value} onChange={onChange} compact />
        {picked && <p className="text-[11px] text-gray-500">Ќе се книжи на конто {picked.code}.</p>}
      </div>
    );
  }
  const shown = value || g?.account || "310";
  return (
    <div className="space-y-1">
      <Label>Што е купено (конто)</Label>
      <Select value={shown} onValueChange={onChange}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          {EXPENSE_CHOICES.map(c => <SelectItem key={c.code} value={c.code}><span className="font-mono text-xs mr-1.5">{c.code}</span>{c.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {!value && g?.sure && <p className="text-[11px] text-primary flex items-center gap-1"><Sparkles className="h-3 w-3" />Пополнето само: {g.reason}</p>}
    </div>
  );
}
