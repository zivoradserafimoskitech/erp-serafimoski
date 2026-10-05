import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, ChevronDown } from "lucide-react";

export type PickItem<T extends string | number = number> = { id: T; label: string; sub?: string | null };

/** Избор со пребарување (за долги листи: налози, клиенти, добавувачи, материјали, конта). */
export default function SearchPick<T extends string | number = number>({ items, value, onChange, placeholder = "Пребарај...", emptyText = "Нема резултати", clearable = true }: {
  items: PickItem<T>[]; value: T | null; onChange: (id: T | null) => void; placeholder?: string; emptyText?: string; clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const sel = items.find(i => i.id === value) ?? null;
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? items.filter(i => `${i.label} ${i.sub ?? ""}`.toLowerCase().includes(s)) : items).slice(0, 60);
  }, [items, q]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => { setOpen(o => !o); setQ(""); }}
        className="w-full h-9 flex items-center gap-2 rounded-md border bg-white px-3 text-sm text-left hover:border-primary/40">
        {sel ? <span className="flex-1 truncate"><span className="font-medium">{sel.label}</span>{sel.sub && <span className="text-gray-400"> · {sel.sub}</span>}</span>
          : <span className="flex-1 text-gray-400 truncate">{placeholder}</span>}
        {sel && clearable ? <X className="h-4 w-4 text-gray-400 hover:text-red-500" onClick={(e) => { e.stopPropagation(); onChange(null); }} /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b px-2.5"><Search className="h-3.5 w-3.5 text-gray-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Пиши за пребарување..." className="h-9 flex-1 text-sm outline-none bg-transparent" /></div>
          <div className="max-h-60 overflow-y-auto py-1">
            {!list.length ? <p className="px-3 py-3 text-xs text-gray-400">{emptyText}</p> : list.map(i => (
              <button key={String(i.id)} type="button" onClick={() => { onChange(i.id); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent ${i.id === value ? "bg-primary/10" : ""}`}>
                <span className="font-medium">{i.label}</span>{i.sub && <span className="text-xs text-gray-500"> · {i.sub}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
