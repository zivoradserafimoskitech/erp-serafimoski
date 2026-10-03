import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import SearchPick from "@/components/SearchPick";
import { toast } from "sonner";
import { Plus, Pencil, Copy, Trash2, ArrowUp, ArrowDown, X, ListChecks } from "lucide-react";

export type TerkLine = { account: string; side: "D" | "P"; note: string };
export type Terk = { id: number; name: string; description: string; lines: (TerkLine & { accountName?: string })[] };
type Draft = { id?: number; name: string; description: string; lines: TerkLine[] };

const blankDraft = (): Draft => ({ name: "", description: "", lines: [{ account: "", side: "D", note: "" }, { account: "", side: "P", note: "" }] });

/** Конта за избор: шифра + назив, пребарување по двете. */
export function useAccountItems() {
  const { data: accounts } = trpc.finance.accountsList.useQuery();
  return (accounts ?? []).map(a => ({ id: a.code as string, label: a.code, sub: a.name }));
}

/** Терк — зачувани шеми на книжење: само конта и страна (Должи/Побарува), без износи. */
export default function TerkTab() {
  const { data: terks, isLoading } = trpc.finance.terkList.useQuery();
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<Draft | null>(null);
  const remove = trpc.finance.terkRemove.useMutation({
    onSuccess: () => { toast.success("Теркот е избришан"); utils.finance.terkList.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <p className="text-sm text-gray-600">
            <b>Терк</b> е зачувана шема на книжење: кои конта и на која страна, без износи.
            При „Нов налог“ го избираш теркот од листата и ги пополнуваш само износите.
          </p>
        </div>
        <Button className="bg-amber-500 hover:bg-amber-600" onClick={() => setDraft(blankDraft())}><Plus className="h-4 w-4 mr-1.5" />Нов терк</Button>
      </div>

      {isLoading ? <p className="text-sm text-gray-400 py-8 text-center">Вчитување...</p>
        : !terks?.length ? (
          <Card><CardContent className="py-10 text-center space-y-2">
            <ListChecks className="h-8 w-8 text-gray-300 mx-auto" />
            <p className="text-sm text-gray-500">Нема зачувани терк-ови. Направи прв — на пр. „Закупнина“: 412 Должи · 130 Должи · 220 Побарува.</p>
          </CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {terks.map(t => (
              <Card key={t.id}><CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{t.name}</p>
                    {t.description && <p className="text-xs text-gray-500">{t.description}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Измени" onClick={() => setDraft({ id: t.id, name: t.name, description: t.description, lines: t.lines.map(l => ({ account: l.account, side: l.side, note: l.note })) })}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Копирај" onClick={() => setDraft({ name: `${t.name} (копија)`, description: t.description, lines: t.lines.map(l => ({ account: l.account, side: l.side, note: l.note })) })}><Copy className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-gray-400 hover:text-red-500" title="Избриши" onClick={() => { if (confirm(`Да се избрише теркот „${t.name}“? Веќе внесените налози остануваат.`)) remove.mutate({ id: t.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_4.5rem] gap-x-3 gap-y-0.5 text-xs">
                  {t.lines.map((l, i) => (
                    <div key={i} className="contents">
                      <span className="font-mono text-gray-700">{l.account}</span>
                      <span className="text-gray-500 truncate">{l.accountName}{l.note ? ` · ${l.note}` : ""}</span>
                      <span className={`text-right font-medium ${l.side === "D" ? "text-blue-700" : "text-emerald-700"}`}>{l.side === "D" ? "Должи" : "Побарува"}</span>
                    </div>
                  ))}
                </div>
              </CardContent></Card>
            ))}
          </div>
        )}
      <TerkEditor draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}

/** Уредник на терк — се користи и од „Нов налог“ („Зачувај како терк“). */
export function TerkEditor({ draft, onClose, onSaved }: { draft: Draft | null; onClose: () => void; onSaved?: (id: number, name: string) => void }) {
  const utils = trpc.useUtils();
  const items = useAccountItems();
  const [d, setD] = useState<Draft | null>(null);
  const [opened, setOpened] = useState<Draft | null>(null);
  if (draft !== opened) { setOpened(draft); setD(draft ? { ...draft, lines: draft.lines.map(l => ({ ...l })) } : null); }
  const save = trpc.finance.terkSave.useMutation({
    onSuccess: (r) => { toast.success("Теркот е зачуван"); utils.finance.terkList.invalidate(); onSaved?.(r.id, d?.name ?? ""); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  if (!d) return null;
  const setLine = (i: number, p: Partial<TerkLine>) => setD({ ...d, lines: d.lines.map((l, j) => j === i ? { ...l, ...p } : l) });
  const move = (i: number, dir: -1 | 1) => { const j = i + dir; if (j < 0 || j >= d.lines.length) return; const ls = [...d.lines]; [ls[i], ls[j]] = [ls[j], ls[i]]; setD({ ...d, lines: ls }); };
  const filled = d.lines.filter(l => l.account);
  const blocker = d.name.trim().length < 2 ? "Внеси назив на теркот"
    : filled.length < 2 ? "Избери најмалку две конта"
    : !filled.some(l => l.side === "D") || !filled.some(l => l.side === "P") ? "Треба барем едно конто на Должи и едно на Побарува" : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogTitle>{d.id ? "Измени терк" : "Нов терк"}</DialogTitle>
        <DialogDescription>Само конта и страна — износите се пишуваат при книжење.</DialogDescription>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Назив *</Label><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="на пр. Закупнина, Камата, Почетна состојба" /></div>
            <div className="space-y-1"><Label className="text-xs">Опис (за што служи)</Label><Input value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="не е задолжително" /></div>
          </div>
          <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_11rem_minmax(0,9rem)_5.5rem] gap-2 text-xs text-gray-500 font-medium"><span>Конто</span><span>Страна</span><span>Белешка за редот</span><span /></div>
          {d.lines.map((l, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_11rem_minmax(0,9rem)_5.5rem] gap-2 rounded-md sm:rounded-none border sm:border-0 p-2 sm:p-0">
              <SearchPick<string> items={items} value={l.account || null} onChange={(v) => setLine(i, { account: v ?? "" })} placeholder="Избери конто" clearable={false} />
              <div className="flex rounded-md border overflow-hidden h-9 text-sm">
                {(["D", "P"] as const).map(sd => (
                  <button key={sd} type="button" onClick={() => setLine(i, { side: sd })}
                    className={`flex-1 ${l.side === sd ? (sd === "D" ? "bg-blue-600 text-white" : "bg-emerald-600 text-white") : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                    {sd === "D" ? "Должи" : "Побарува"}</button>
                ))}
              </div>
              <Input className="h-9" value={l.note} onChange={(e) => setLine(i, { note: e.target.value })} placeholder="на пр. ДДВ 18%" />
              <div className="flex items-center justify-end gap-0.5">
                <Button type="button" size="sm" variant="ghost" className="h-8 w-7 p-0" disabled={i === 0} onClick={() => move(i, -1)} title="Нагоре"><ArrowUp className="h-3.5 w-3.5" /></Button>
                <Button type="button" size="sm" variant="ghost" className="h-8 w-7 p-0" disabled={i === d.lines.length - 1} onClick={() => move(i, 1)} title="Надолу"><ArrowDown className="h-3.5 w-3.5" /></Button>
                <Button type="button" size="sm" variant="ghost" className="h-8 w-7 p-0 text-gray-400 hover:text-red-500" disabled={d.lines.length <= 2} onClick={() => setD({ ...d, lines: d.lines.filter((_, j) => j !== i) })} title="Тргни ред"><X className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setD({ ...d, lines: [...d.lines, { account: "", side: "D", note: "" }] })}><Plus className="h-3.5 w-3.5 mr-1" />Ред на Должи</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setD({ ...d, lines: [...d.lines, { account: "", side: "P", note: "" }] })}><Plus className="h-3.5 w-3.5 mr-1" />Ред на Побарува</Button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 pt-2">
          <span className={`text-sm ${blocker ? "text-amber-700" : "text-emerald-700"}`}>{blocker ?? `${filled.length} реда · ${filled.filter(l => l.side === "D").length} Должи, ${filled.filter(l => l.side === "P").length} Побарува`}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Откажи</Button>
            <Button className="bg-amber-500 hover:bg-amber-600" disabled={!!blocker || save.isPending}
              onClick={() => save.mutate({ id: d.id, name: d.name.trim(), description: d.description.trim() || undefined, lines: filled.map(l => ({ account: l.account, side: l.side, note: l.note.trim() || undefined })) })}>
              Зачувај терк</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
