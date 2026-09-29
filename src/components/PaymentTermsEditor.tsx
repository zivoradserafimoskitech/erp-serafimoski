import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import {
  type Installment, type PaymentWhen, WHEN_OPTIONS, PAYMENT_PRESETS, needsDays, scheduleTotal, describeSchedule,
} from "@contracts/payment-terms";

/** Уредувач на услови за плаќање по рати (процент + кога). total/currency се за приказ на износите. */
export function PaymentTermsEditor({ value, onChange, total, currency }: {
  value: Installment[];
  onChange: (s: Installment[]) => void;
  total?: number;
  currency?: string;
}) {
  const sum = scheduleTotal(value);
  const set = (i: number, patch: Partial<Installment>) =>
    onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="space-y-2 rounded-lg border p-3 bg-white">
      <div className="flex flex-wrap gap-1.5">
        {PAYMENT_PRESETS.map(p => (
          <Button key={p.label} type="button" size="sm" variant="outline" className="h-7 text-xs"
            onClick={() => onChange(p.schedule.map(x => ({ ...x })))}>{p.label}</Button>
        ))}
      </div>
      {value.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="relative w-20 shrink-0">
            <Input type="number" min={0} max={100} step="any" value={row.percent}
              onChange={e => set(i, { percent: parseFloat(e.target.value) || 0 })} className="pr-6" />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
          </div>
          {needsDays(row.when) && (
            <Input type="number" min={0} className="w-20 shrink-0" value={row.days ?? 0}
              onChange={e => set(i, { days: parseInt(e.target.value) || 0 })} />
          )}
          <Select value={row.when} onValueChange={v => set(i, { when: v as PaymentWhen, days: needsDays(v as PaymentWhen) ? (row.days ?? 30) : undefined })}>
            <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>{WHEN_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.mk}</SelectItem>)}</SelectContent>
          </Select>
          {total !== undefined && (
            <span className="text-xs text-gray-500 w-28 text-right whitespace-nowrap">
              {(total * (row.percent || 0) / 100).toLocaleString("mk-MK", { maximumFractionDigits: 2 })} {currency}
            </span>
          )}
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500"
            disabled={value.length <= 1} onClick={() => onChange(value.filter((_, j) => j !== i))}>×</Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs"
          onClick={() => onChange([...value, { percent: Math.max(0, 100 - sum), when: "before_delivery" }])}>
          <Plus className="h-3 w-3 mr-1" />Додади рата
        </Button>
        <span className={`text-xs ${sum === 100 ? "text-gray-500" : "text-red-600 font-medium"}`}>
          Вкупно {sum}%{sum !== 100 && " — мора да е 100%"}
        </span>
      </div>
      <p className="text-xs text-gray-500">{describeSchedule(value, "mk")}</p>
    </div>
  );
}
