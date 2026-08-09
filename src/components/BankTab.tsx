import { useState, useRef } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Upload, Search, Link2, Link2Off, EyeOff, Wand2, ArrowDownLeft,
  ArrowUpRight, Landmark, AlertCircle, CheckCircle2,
} from "lucide-react";

const den = (v: any) =>
  Number(v ?? 0).toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BankTab() {
  const utils = trpc.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<"all" | "unmatched" | "matched" | "ignored">("unmatched");
  const [direction, setDirection] = useState<"all" | "in" | "out">("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [warn, setWarn] = useState<string[]>([]);
  const [matchTx, setMatchTx] = useState<any>(null);

  const { data: stats } = trpc.bank.bankStats.useQuery();
  const { data: rows, isLoading } = trpc.bank.bankTxList.useQuery({
    status, direction, search: search || undefined,
  });
  const { data: suggestion, isLoading: sugLoading } = trpc.bank.bankSuggest.useQuery(
    { txId: matchTx?.id ?? 0 },
    { enabled: !!matchTx }
  );

  const refresh = () => {
    utils.bank.bankTxList.invalidate();
    utils.bank.bankStats.invalidate();
    utils.bank.bankStatementList.invalidate();
    utils.accounting.invoiceList.invalidate();
  };

  const importMut = trpc.bank.bankImport.useMutation({
    onSuccess: (r) => {
      refresh();
      setMsg(
        `Внесени ${r.statementsAdded} изводи и ${r.txAdded} ставки` +
        (r.txSkipped ? ` · ${r.txSkipped} веќе постоеја` : "") +
        ` · формати: ${r.formats.join(", ")}`
      );
      setWarn(r.warnings ?? []);
      setBusy(false);
    },
    onError: (e) => { setMsg(`Грешка: ${e.message}`); setBusy(false); },
  });

  const matchMut = trpc.bank.bankMatch.useMutation({
    onSuccess: (r) => { refresh(); setMatchTx(null); setMsg(`Поврзано со ${r.ref}`); },
  });
  const unmatchMut = trpc.bank.bankUnmatch.useMutation({ onSuccess: refresh });
  const ignoreMut = trpc.bank.bankIgnore.useMutation({ onSuccess: refresh });
  const autoMut = trpc.bank.bankAutoMatch.useMutation({
    onSuccess: (r) => { refresh(); setMsg(`Автоматски поврзани ${r.matched} од ${r.checked} ставки`); },
  });

  /** Ги чита сите избрани датотеки: .300, .txt, .zip, .pdf */
  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setMsg(null);
    setWarn([]);
    const payload: { name: string; text: string }[] = [];

    try {
      for (const f of Array.from(files)) {
        const lower = f.name.toLowerCase();

        if (lower.endsWith(".zip")) {
          const JSZip = (await import("jszip")).default;
          const zip = await JSZip.loadAsync(await f.arrayBuffer());
          for (const entry of Object.values(zip.files)) {
            if ((entry as any).dir) continue;
            const text = await (entry as any).async("string");
            payload.push({ name: (entry as any).name, text });
          }
          continue;
        }

        if (lower.endsWith(".pdf")) {
          const pdfjs: any = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc =
            (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
          const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
          let text = "";
          for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const c = await page.getTextContent();
            text += c.items.map((it: any) => it.str).join(" ") + "\n";
          }
          payload.push({ name: f.name, text });
          continue;
        }

        // .300 доаѓа во централноевропска кодна страница
        const buf = await f.arrayBuffer();
        let text: string;
        try {
          text = new TextDecoder("windows-1250").decode(buf);
        } catch {
          text = new TextDecoder("utf-8").decode(buf);
        }
        payload.push({ name: f.name, text });
      }

      if (payload.length === 0) { setBusy(false); return; }
      importMut.mutate({ files: payload });
    } catch (e: any) {
      setMsg(`Не можам да ја прочитам датотеката: ${e?.message ?? e}`);
      setBusy(false);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-5">
      {/* Резиме */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-blue-50 p-2.5 rounded-lg"><Landmark className="h-5 w-5 text-blue-600" /></div>
          <div>
            <p className="text-sm text-gray-500">Салдо по последен извод</p>
            <p className="text-xl font-bold">{den(stats?.lastBalance)} <span className="text-sm text-gray-400">ден</span></p>
            {stats?.lastDate && <p className="text-[11px] text-gray-400">{String(stats.lastDate)}</p>}
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-amber-50 p-2.5 rounded-lg"><AlertCircle className="h-5 w-5 text-amber-600" /></div>
          <div><p className="text-sm text-gray-500">Неповрзани ставки</p>
            <p className="text-xl font-bold text-amber-700">{stats?.unmatched ?? 0}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-emerald-50 p-2.5 rounded-lg"><ArrowDownLeft className="h-5 w-5 text-emerald-600" /></div>
          <div><p className="text-sm text-gray-500">Неповрзани приливи</p>
            <p className="text-xl font-bold text-emerald-700">{den(stats?.unmatchedIn)}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="bg-red-50 p-2.5 rounded-lg"><ArrowUpRight className="h-5 w-5 text-red-600" /></div>
          <div><p className="text-sm text-gray-500">Неповрзани одливи</p>
            <p className="text-xl font-bold text-red-600">{den(stats?.unmatchedOut)}</p></div>
        </CardContent></Card>
      </div>

      {msg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-4 py-2.5 flex items-start justify-between gap-2">
          <span>{msg}</span>
          <button onClick={() => setMsg(null)} className="text-emerald-500 px-1">×</button>
        </div>
      )}
      {warn.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-4 py-2.5 space-y-1">
          {warn.map((w, i) => <div key={i}>• {w}</div>)}
        </div>
      )}

      {/* Алатки */}
      <div className="flex flex-wrap gap-3 items-center">
        <input ref={fileRef} type="file" multiple className="hidden"
          accept=".300,.txt,.zip,.pdf,.sta,.mt940"
          onChange={(e) => handleFiles(e.target.files)} />
        <Button className="bg-amber-500 hover:bg-amber-600 text-white"
          disabled={busy || importMut.isPending}
          onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4 mr-2" />
          {busy || importMut.isPending ? "Се внесува..." : "Внеси извод"}
        </Button>
        <Button variant="outline" disabled={autoMut.isPending}
          onClick={() => autoMut.mutate({ minScore: 85 })}>
          <Wand2 className="h-4 w-4 mr-2" />
          {autoMut.isPending ? "Се поврзува..." : "Автоматско поврзување"}
        </Button>

        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input placeholder="Партнер, цел, сметка..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as any)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="unmatched">Неповрзани</SelectItem>
            <SelectItem value="matched">Поврзани</SelectItem>
            <SelectItem value="ignored">Занемарени</SelectItem>
            <SelectItem value="all">Сите</SelectItem>
          </SelectContent>
        </Select>
        <Select value={direction} onValueChange={(v) => setDirection(v as any)}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Сè</SelectItem>
            <SelectItem value="in">Приливи</SelectItem>
            <SelectItem value="out">Одливи</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-gray-400">
        Поддржани: КБ „ставки" и „водечки слог" (.300), MT940 (.txt или .zip) и PDF извод.
        Ставките што веќе постојат нема да се дуплираат.
      </p>

      {/* Ставки */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Датум</TableHead>
                <TableHead>Партнер и цел</TableHead>
                <TableHead className="text-right w-32">Износ</TableHead>
                <TableHead className="w-40">Поврзано со</TableHead>
                <TableHead className="w-32">Акции</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-400">Вчитување...</TableCell></TableRow>
              ) : !rows || rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-12 text-gray-400">
                  Нема ставки. Внеси извод од банката со копчето горе.
                </TableCell></TableRow>
              ) : rows.map((t: any) => (
                <TableRow key={t.id} className={t.matchStatus === "ignored" ? "opacity-50" : ""}>
                  <TableCell className="text-sm">{String(t.txDate)}</TableCell>
                  <TableCell>
                    <div className="text-sm font-medium leading-tight">{t.counterpartyName || "—"}</div>
                    <div className="text-[11px] text-gray-500 leading-snug">{t.purpose}</div>
                    <div className="text-[10px] text-gray-400 font-mono">
                      {t.counterpartyAccount}{t.code ? ` · шифра ${t.code}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={`font-bold ${t.direction === "in" ? "text-emerald-700" : "text-red-600"}`}>
                      {t.direction === "in" ? "+" : "−"}{den(t.amount)}
                    </span>
                    {Number(t.provision) > 0 && (
                      <div className="text-[11px] text-gray-400">пров. {den(t.provision)}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {t.matchStatus === "matched" ? (
                      <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50">
                        <CheckCircle2 className="h-3 w-3 mr-1" />{t.matchedRef}
                      </Badge>
                    ) : t.matchStatus === "ignored" ? (
                      <span className="text-xs text-gray-400">занемарено</span>
                    ) : (
                      <span className="text-xs text-amber-600">неповрзано</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {t.matchStatus === "matched" ? (
                        <Button size="sm" variant="outline" title="Раскини"
                          onClick={() => unmatchMut.mutate({ txId: t.id })}>
                          <Link2Off className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" title="Поврзи"
                            onClick={() => setMatchTx(t)}>
                            <Link2 className="h-3.5 w-3.5" />
                          </Button>
                          {t.matchStatus !== "ignored" && (
                            <Button size="sm" variant="outline" className="text-gray-400" title="Занемари"
                              onClick={() => ignoreMut.mutate({ txId: t.id })}>
                              <EyeOff className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Дијалог за поврзување */}
      <Dialog open={!!matchTx} onOpenChange={(v) => { if (!v) setMatchTx(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Поврзи со документ</DialogTitle></DialogHeader>
          {matchTx && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium">{matchTx.counterpartyName}</span>
                  <span className={`font-bold ${matchTx.direction === "in" ? "text-emerald-700" : "text-red-600"}`}>
                    {matchTx.direction === "in" ? "+" : "−"}{den(matchTx.amount)} ден
                  </span>
                </div>
                <div className="text-gray-500 text-xs mt-1">{matchTx.purpose}</div>
                <div className="text-gray-400 text-[11px]">{String(matchTx.txDate)}</div>
              </div>

              {sugLoading ? (
                <p className="py-8 text-center text-gray-400 text-sm">Се бараат документи...</p>
              ) : !suggestion?.candidates || suggestion.candidates.length === 0 ? (
                <div className="py-8 text-center space-y-2">
                  <p className="text-sm text-gray-600">Нема документ што одговара</p>
                  <p className="text-xs text-gray-400 max-w-sm mx-auto">
                    Или фактурата не е внесена, или веќе е означена како платена.
                    Можеш да ја занемариш ставката ако е трошок што не води преку фактура
                    (провизија, плата, позајмица).
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {suggestion.candidates.map((c: any) => (
                    <button key={`${c.type}-${c.id}`}
                      className="w-full text-left border rounded-lg px-4 py-3 hover:bg-amber-50 hover:border-amber-300 transition-colors"
                      onClick={() => matchMut.mutate({
                        txId: matchTx.id, type: c.type, targetId: c.id, markPaid: true,
                      })}>
                      <div className="flex justify-between items-start gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-sm">{c.ref}</div>
                          <div className="text-xs text-gray-500">{c.partnerName}</div>
                          <div className="text-[11px] text-gray-400 mt-0.5">
                            {c.reasons.join(" · ")}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-bold text-sm">{den(c.amount)}</div>
                          <div className="text-[11px] text-gray-400">{String(c.date ?? "")}</div>
                          <Badge variant="outline" className={
                            c.score >= 85 ? "border-emerald-300 text-emerald-700 bg-emerald-50 mt-1"
                              : "border-gray-300 text-gray-500 mt-1"
                          }>{c.score}%</Badge>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <p className="text-[11px] text-gray-400">
                Поврзувањето ја означува фактурата како платена.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
