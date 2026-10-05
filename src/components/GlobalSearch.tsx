import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Search, FileText, Receipt, Users, Truck, Package, Factory, ClipboardList, ShoppingCart, Loader2 } from "lucide-react";

const ICON: Record<string, any> = {
  "Понуда": FileText, "Фактура": Receipt, "Про-фактура": Receipt, "Книжно одобрување": Receipt, "Влезна фактура": Receipt,
  "Нарачка": ShoppingCart, "Работен налог": Factory, "Клиент": Users, "Добавувач": Truck, "Материјал": Package,
  "Испратница": Truck, "Приемница": ClipboardList,
};

/** Брзо пребарување: Ctrl+K (или Cmd+K) од било каде. */
export default function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 180); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (!open) { setQ(""); setDebounced(""); } }, [open]);
  const { data, isFetching } = trpc.search.globalSearch.useQuery({ q: debounced }, { enabled: open && debounced.length >= 2 });
  const hits = useMemo(() => data ?? [], [data]);
  useEffect(() => setActive(0), [debounced]);

  const go = (href: string) => { onOpenChange(false); navigate(href); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(hits.length - 1, a + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    if (e.key === "Enter" && hits[active]) { e.preventDefault(); go(hits[active].href); }
  };
  useEffect(() => { listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden top-[20%] translate-y-0">
        <DialogTitle className="sr-only">Пребарување</DialogTitle>
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="h-4 w-4 text-gray-400" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Барај клиент, понуда, фактура, налог, материјал..."
            className="flex-1 h-12 outline-none text-sm bg-transparent" />
          {isFetching && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
        </div>
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto py-1">
          {debounced.length < 2 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">Внеси барем 2 знаци. Со ↑ ↓ избираш, со Enter отвораш.</p>
          ) : !hits.length && !isFetching ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">Нема резултати за „{debounced}“</p>
          ) : hits.map((h, i) => {
            const Icon = ICON[h.type] ?? FileText;
            return (
              <button key={`${h.type}-${h.id}`} data-i={i} onMouseEnter={() => setActive(i)} onClick={() => go(h.href)}
                className={`w-full flex items-center gap-3 px-4 py-2 text-left ${i === active ? "bg-primary/10" : ""}`}>
                <Icon className={`h-4 w-4 shrink-0 ${i === active ? "text-primary" : "text-gray-400"}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-800 truncate">{h.title}</div>
                  {h.subtitle && <div className="text-xs text-gray-500 truncate">{h.subtitle}</div>}
                </div>
                <span className="text-[10px] uppercase tracking-wider text-gray-400 shrink-0">{h.type}</span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
