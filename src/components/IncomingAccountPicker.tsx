import { trpc } from "@/providers/trpc";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EXPENSE_CHOICES } from "@contracts/finance";
import { Sparkles } from "lucide-react";

/**
 * Конто за влезна фактура: 310 материјали за залиха или трошок (енергија, закупнина, услуги...).
 * Празно = се зема предлогот (последно кај добавувачот, или по името/текстот).
 */
export default function IncomingAccountPicker({ supplierId, text, value, onChange }: { supplierId?: number; text?: string; value: string; onChange: (v: string) => void }) {
  const { data: sug } = trpc.accounting.incomingAccountSuggest.useQuery({ supplierId, text: (text ?? "").slice(0, 2000) }, { enabled: !!supplierId });
  const shown = value || sug?.account || "310";
  return (
    <div className="space-y-1">
      <Label>Конто — вид на набавка</Label>
      <Select value={shown} onValueChange={onChange}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          {EXPENSE_CHOICES.map(c => <SelectItem key={c.code} value={c.code}><span className="font-mono text-xs mr-1.5">{c.code}</span>{c.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {!value && sug && (
        <p className="text-[11px] text-amber-700 flex items-center gap-1"><Sparkles className="h-3 w-3" />Предлог: {sug.reason}</p>
      )}
    </div>
  );
}
