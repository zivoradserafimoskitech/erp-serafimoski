import { PURCHASE_KINDS } from "@contracts/finance";
import { Package, Wrench, Zap, Building2, Truck, Hammer, Phone, HelpCircle, Check } from "lucide-react";

const ICON: Record<string, any> = { "310": Package, "402": Wrench, "401": Zap, "412": Building2, "410": Truck, "411": Hammer, "413": Phone, "449": HelpCircle };

/** „Што е купено?“ — избор со обични зборови за операторот; позади секој одговор е конто од контниот план. */
export default function PurchaseKindQuestion({ value, onChange, compact = false }: { value?: string | null; onChange: (code: string) => void; compact?: boolean }) {
  return (
    <div className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4"}`}>
      {PURCHASE_KINDS.map(k => {
        const Icon = ICON[k.code] ?? HelpCircle;
        const on = value === k.code;
        return (
          <button key={k.code} type="button" onClick={() => onChange(k.code)}
            className={`relative text-left rounded-lg border p-2.5 transition ${on ? "border-amber-400 bg-amber-50 ring-1 ring-amber-300" : "bg-white hover:border-amber-300 hover:bg-amber-50/40"}`}>
            {on && <Check className="absolute right-2 top-2 h-4 w-4 text-amber-600" />}
            <div className="flex items-center gap-1.5 font-medium text-sm text-gray-900 pr-5 break-words"><Icon className="h-4 w-4 text-amber-600 shrink-0" />{k.title}</div>
            <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">{k.examples}</div>
          </button>
        );
      })}
    </div>
  );
}
