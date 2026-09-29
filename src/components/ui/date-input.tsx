import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

// Поле за датум секогаш во ДД.ММ.ГГГГ (прелистувачот на англиски го прикажува <input type="date"> како мм/дд/гггг
// и 03.09 лесно станува 9 март). Вредноста надвор е ISO „ГГГГ-ММ-ДД“, како кај обичното поле.
type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value?: string | null;
  onChange?: (e: { target: { value: string } }) => void;
};

const toText = (iso?: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "");
function toIso(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})[.\-/ ](\d{1,2})[.\-/ ](\d{2}|\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function DateInput({ value, onChange, className, min, max, disabled, required, placeholder, ...rest }: Props) {
  const [text, setText] = useState(toText(value));
  const [bad, setBad] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { setText(toText(value)); setBad(false); }, [value]);

  const emit = (iso: string) => onChange?.({ target: { value: iso } });
  const commit = (t: string) => {
    if (!t.trim()) { setBad(false); if (value) emit(""); return; }
    const iso = toIso(t);
    if (!iso) { setBad(true); return; }
    setBad(false);
    setText(toText(iso));
    if (iso !== value) emit(iso);
  };
  const onType = (raw: string) => {
    // автоматски точки: 03092026 -> 03.09.2026
    let t = raw.replace(/[^\d.\-/ ]/g, "");
    if (/^\d{3,}$/.test(t)) t = t.length <= 4 ? `${t.slice(0, 2)}.${t.slice(2)}` : `${t.slice(0, 2)}.${t.slice(2, 4)}.${t.slice(4, 8)}`;
    setText(t.slice(0, 10));
    const iso = toIso(t);
    if (iso) { setBad(false); if (iso !== value) emit(iso); }
  };

  return (
    <div className={cn("relative", (className ?? "").split(/\s+/).find(c => /^w-/.test(c)) ?? "w-full")}>
      <input
        {...rest}
        type="text" inputMode="numeric" autoComplete="off" disabled={disabled} required={required}
        placeholder={placeholder ?? "ДД.ММ.ГГГГ"} value={text}
        onChange={(e) => onType(e.target.value)} onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }}
        className={cn(
          "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent pl-3 pr-9 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] tabular-nums",
          bad && "border-red-400 focus-visible:ring-red-200",
          className,
        )}
      />
      <button type="button" tabIndex={-1} disabled={disabled} aria-label="Избери датум"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-700"
        onClick={() => { const p = picker.current; if (!p) return; try { p.showPicker(); } catch { p.focus(); p.click(); } }}>
        <CalendarDays className="h-4 w-4" />
      </button>
      <input ref={picker} type="date" tabIndex={-1} aria-hidden className="absolute right-0 bottom-0 h-0 w-0 opacity-0 pointer-events-none"
        value={value ?? ""} min={min as any} max={max as any} onChange={(e) => { if (e.target.value) emit(e.target.value); }} />
    </div>
  );
}

export default DateInput;
