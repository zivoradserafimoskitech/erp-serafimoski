import { useState, useRef, useEffect } from "react";
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

  const [status, setStatus] = useState<"all" | "open" | "unmatched" | "partial" | "matched" | "ignored">("open");
  const [direction, setDirection] = useState<"all" | "in" | "out">("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [warn, setWarn] = useState<string[]>([]);
  const [matchTx, setMatchTx] = useState<any>(null);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [docSearch, setDocSearch] = useState("");
  const [openSide, setOpenSide] = useState<"suppliers" | "customers" | null>(null);

  const { data: stats } = trpc.bank.bankStats.useQuery();
  const { data: openItems } = trpc.bank.openItemsByPartner.useQuery(
    { side: openSide ?? "suppliers" }, { enabled: !!openSide }
  );
  const { data: rows, isLoading } = trpc.bank.bankTxList.useQuery({
    status, direction, search: search || undefined,
  });
  const { data: openDocs, isLoading: sugLoading } = trpc.bank.bankOpenDocs.useQuery(
    { txId: matchTx?.id ?? 0, search: docSearch || undefined },
    { enabled: !!matchTx }
  );
  const { data: existingAlloc } = trpc.bank.bankAllocationsOf.useQuery(
    { txId: matchTx?.id ?? 0 },
    { enabled: !!matchTx }
  );

  // Ако ставката веќе е распределена, полињата тргнуваат од постојното
  useEffect(() => {
    if (!matchTx || !existingAlloc) return;
    const next: Record<string, string> = {};
    for (const a of existingAlloc as any[]) next[`${a.docType}:${a.docId}`] = String(Number(a.amount));
    setAlloc(next);
  }, [matchTx?.id, existingAlloc]);

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

  const allocMut = trpc.bank.bankAllocate.useMutation({
    onSuccess: (r) => {
      refresh(); setMatchTx(null); setAlloc({});
      setMsg(
        r.remaining > 0.005
          ? `Распределено ${den(r.allocated)} ден · останува нераспределено ${den(r.remaining)} ден`
          : `Распределено ${den(r.allocated)} ден`
      );
    },
    onError: (e) => setMsg(`Грешка: ${e.message}`),
  });
  const unmatchMut = trpc.bank.bankUnmatch.useMutation({ onSuccess: refresh });
  const ignoreMut = trpc.bank.bankIgnore.useMutation({ onSuccess: refresh });
  const autoMut = trpc.bank.bankAutoMatch.useMutation({
    onSuccess: (r) => {
      refresh();
      setMsg(`Автоматски затворени ${r.matched}` + (r.partial ? `, делумно ${r.partial}` : "") + ` од ${r.checked} ставки`);
    },
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
        <Button variant="outline" onClick={() => setOpenSide("suppliers")}>
          Отворени ставки
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
            <SelectItem value="open">Отворени</SelectItem>
            <SelectItem value="unmatched">Нераспределени</SelectItem>
            <SelectItem value="partial">Делумно</SelectItem>
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
                    ) : t.matchStatus === "partial" ? (
                      <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50">
                        делумно · {t.matchedRef}
                      </Badge>
                    ) : t.matchStatus === "ignored" ? (
                      <span className="text-xs text-gray-400">занемарено</span>
                    ) : (
                      <span className="text-xs text-amber-600">неповрзано</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {t.matchStatus === "matched" || t.matchStatus === "partial" ? (
                        <>
                          <Button size="sm" variant="outline" title="Промени распределба"
                            onClick={() => setMatchTx(t)}>
                            <Link2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="outline" title="Раскини"
                            onClick={() => unmatchMut.mutate({ txId: t.id })}>
                            <Link2Off className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : false ? (
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

      {/* Отворени ставки по партнер */}
      <Dialog open={!!openSide} onOpenChange={(v) => { if (!v) setOpenSide(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Отворени ставки</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button size="sm" variant={openSide === "suppliers" ? "default" : "outline"}
                className={openSide === "suppliers" ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}
                onClick={() => setOpenSide("suppliers")}>Кому должиме</Button>
              <Button size="sm" variant={openSide === "customers" ? "default" : "outline"}
                className={openSide === "customers" ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}
                onClick={() => setOpenSide("customers")}>Кој ни должи</Button>
              <div className="ml-auto text-sm">
                Вкупно: <b>{den(openItems?.total)} ден</b>
              </div>
            </div>

            {!openItems || openItems.groups.length === 0 ? (
              <p className="py-10 text-center text-gray-400 text-sm">Нема отворени ставки</p>
            ) : (
              <div className="space-y-3">
                {openItems.groups.map((g: any) => (
                  <div key={g.partner} className="border rounded-lg overflow-hidden">
                    <div className="flex justify-between items-center px-4 py-2.5 bg-gray-50">
                      <div>
                        <div className="font-medium text-sm">{g.partner}</div>
                        <div className="text-[11px] text-gray-400">
                          {g.count} {g.count === 1 ? "фактура" : "фактури"} · најстара {String(g.oldest ?? "").slice(0, 10)}
                        </div>
                      </div>
                      <div className="font-bold">{den(g.open)} ден</div>
                    </div>
                    <div className="divide-y">
                      {g.docs.map((d: any) => (
                        <div key={d.ref} className="flex justify-between items-center px-4 py-1.5 text-xs">
                          <span className="font-mono">{d.ref}</span>
                          <span className="text-gray-400">{String(d.date ?? "").slice(0, 10)}</span>
                          <span className="text-gray-500">од {den(d.total)}</span>
                          <span className="font-semibold w-24 text-right">{den(d.open)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Дијалог: распределба на уплата */}
      <Dialog open={!!matchTx} onOpenChange={(v) => { if (!v) { setMatchTx(null); setAlloc({}); setDocSearch(""); } }}>
        <DialogContent className="max-w-3xl max-h-[92vh] flex flex-col">
          <DialogHeader><DialogTitle>Распредели ја уплатата</DialogTitle></DialogHeader>
          {matchTx && (() => {
            const amount = Number(matchTx.amount);
            const allocated = Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0);
            const remaining = Math.round((amount - allocated) * 100) / 100;
            const docs = openDocs?.docs ?? [];

            const setLine = (key: string, v: string) => setAlloc({ ...alloc, [key]: v });
            const fill = (key: string, open: number) => {
              const others = Object.entries(alloc)
                .filter(([k]) => k !== key)
                .reduce((s, [, v]) => s + (Number(v) || 0), 0);
              const free = Math.max(0, Math.round((amount - others) * 100) / 100);
              setLine(key, String(Math.min(open, free)));
            };

            return (
              <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
                <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm shrink-0">
                  <div className="flex justify-between">
                    <span className="font-medium">{matchTx.counterpartyName}</span>
                    <span className={`font-bold ${matchTx.direction === "in" ? "text-emerald-700" : "text-red-600"}`}>
                      {matchTx.direction === "in" ? "+" : "−"}{den(amount)} ден
                    </span>
                  </div>
                  <div className="text-gray-500 text-xs mt-1">{matchTx.purpose}</div>
                  <div className="text-gray-400 text-[11px]">{String(matchTx.txDate)}</div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input className="pl-9 h-9" placeholder="Барај фактура или партнер..."
                      value={docSearch} onChange={(e) => setDocSearch(e.target.value)} />
                  </div>
                  <div className={`text-sm px-3 py-1.5 rounded-lg border ${
                    Math.abs(remaining) < 0.005
                      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                      : remaining < 0
                      ? "bg-red-50 border-red-200 text-red-700"
                      : "bg-amber-50 border-amber-200 text-amber-800"
                  }`}>
                    Нераспределено: <b>{den(remaining)}</b>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto border rounded-lg">
                  {sugLoading ? (
                    <p className="py-10 text-center text-gray-400 text-sm">Се бараат отворени фактури...</p>
                  ) : docs.length === 0 ? (
                    <div className="py-10 text-center space-y-2 px-6">
                      <p className="text-sm text-gray-600">Нема отворени фактури</p>
                      <p className="text-xs text-gray-400">
                        Ако е трошок што не оди преку фактура — провизија, плата, позајмица —
                        затвори го дијалогот и означи ја ставката како занемарена.
                      </p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader className="sticky top-0 bg-white z-10">
                        <TableRow>
                          <TableHead>Фактура</TableHead>
                          <TableHead className="text-right w-28">Вкупно</TableHead>
                          <TableHead className="text-right w-28">Отворено</TableHead>
                          <TableHead className="w-40">Плаќам</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {docs.map((d: any) => {
                          const key = `${d.docType}:${d.docId}`;
                          return (
                            <TableRow key={key} className={alloc[key] ? "bg-amber-50/60" : d.inPurpose ? "bg-blue-50/40" : ""}>
                              <TableCell>
                                <div className="text-sm font-medium flex items-center gap-1.5">
                                  {d.ref}
                                  {d.inPurpose && (
                                    <Badge variant="outline" className="border-blue-300 text-blue-700 bg-blue-50 text-[10px]">
                                      во дознаката
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-[11px] text-gray-500">{d.partnerName}</div>
                                <div className="text-[10px] text-gray-400">
                                  {String(d.date ?? "").slice(0, 10)}
                                  {d.paid > 0 && ` · веќе платено ${den(d.paid)}`}
                                </div>
                              </TableCell>
                              <TableCell className="text-right text-sm text-gray-500">{den(d.total)}</TableCell>
                              <TableCell className="text-right text-sm font-medium">{den(d.open)}</TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  <Input className="h-8 text-xs text-right" type="number" step="0.01"
                                    placeholder="0" value={alloc[key] ?? ""}
                                    onChange={(e) => setLine(key, e.target.value)} />
                                  <Button size="sm" variant="outline" className="h-8 px-2 text-[10px]"
                                    onClick={() => fill(key, d.open)}>сè</Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 shrink-0">
                  <p className="text-[11px] text-gray-400 max-w-sm">
                    Може да се плати дел од фактура, или една уплата да покрие повеќе фактури.
                    Статусот се пресметува од распределеното.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setAlloc({})}>Исчисти</Button>
                    <Button className="bg-amber-500 hover:bg-amber-600 text-white"
                      disabled={allocated <= 0 || remaining < -0.005 || allocMut.isPending}
                      onClick={() => allocMut.mutate({
                        txId: matchTx.id,
                        lines: Object.entries(alloc)
                          .filter(([, v]) => Number(v) > 0)
                          .map(([k, v]) => {
                            const [docType, docId] = k.split(":");
                            const d = docs.find((x: any) => `${x.docType}:${x.docId}` === k);
                            return {
                              docType: docType as "invoice" | "incoming_invoice",
                              docId: Number(docId), docRef: d?.ref, amount: Number(v),
                            };
                          }),
                      })}>
                      {allocMut.isPending ? "Зачувување..." : "Зачувај распределба"}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
