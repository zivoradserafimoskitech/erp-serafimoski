import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Mat = { id: number; code?: string | null; name: string; unit?: string | null; lastPurchasePrice?: any; avgCost?: any; currentStock?: any };

export function MaterialPicker({
  materials,
  value,
  onSelect,
  placeholder = "Избери материјал…",
}: {
  materials: Mat[] | undefined;
  value?: string | number | null;
  onSelect: (m: Mat) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const selected = useMemo(
    () => materials?.find((m) => String(m.id) === String(value ?? "")),
    [materials, value]
  );

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = materials ?? [];
    if (!s) return list.slice(0, 200);
    return list
      .filter((m) => m.name.toLowerCase().includes(s) || (m.code ?? "").toLowerCase().includes(s))
      .slice(0, 200);
  }, [materials, q]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full justify-start font-normal text-xs h-9 overflow-hidden"
        onClick={() => { setQ(""); setOpen(true); }}
      >
        {selected ? (
          <span className="truncate">
            <span className="font-mono text-[10px] text-gray-400 mr-1">{selected.code}</span>
            {selected.name}
          </span>
        ) : (
          <span className="text-gray-400">{placeholder}</span>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader><DialogTitle>Избери материјал</DialogTitle></DialogHeader>
          <Input
            autoFocus
            placeholder="Барај по име или код… (пр. рифел, C409, винкла 40)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="overflow-y-auto flex-1 -mx-2 px-2 space-y-1 mt-2">
            {filtered.length === 0 && <p className="text-sm text-gray-400 text-center py-6">Нема резултати за „{q}"</p>}
            {filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                className="w-full text-left grid grid-cols-[3.5rem_1fr_2.5rem_5.5rem] gap-2 items-center border rounded-md px-2 py-2 hover:bg-amber-50 hover:border-amber-300 transition-colors"
                onClick={() => { onSelect(m); setOpen(false); }}
              >
                <span className="font-mono text-[10px] text-gray-400">{m.code}</span>
                <span className="text-xs truncate">{m.name}</span>
                <span className="text-[11px] text-gray-500 text-center">{m.unit}</span>
                <span className="text-xs text-right font-medium whitespace-nowrap">
                  {m.lastPurchasePrice ? Number(m.lastPurchasePrice).toLocaleString("mk-MK") + " ден" : "—"}
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
