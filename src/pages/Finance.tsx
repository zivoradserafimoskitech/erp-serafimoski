import { Fragment, useEffect, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { BookOpen, Scale, FileSpreadsheet, Receipt, Wallet, Coins, ListTree, RefreshCw, Plus, Trash2, AlertTriangle, Download, TrendingUp } from "lucide-react";

const today = () => new Date().toISOString().slice(0, 10);
const yearStart = () => `${new Date().getFullYear()}-01-01`;
const monthStart = () => today().slice(0, 8) + "01";
const fmt = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: string) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "—");

const SOURCE_LBL: Record<string, string> = {
  invoice: "Фактура", incoming_invoice: "Влезна ф.", bank_alloc: "Банка", cash: "Благајна", payroll: "Плати", manual: "Рачен",
};

function PeriodPicker({ from, to, onChange }: { from: string; to: string; onChange: (f: string, t: string) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1"><Label className="text-xs text-gray-500">Од</Label><Input type="date" className="h-9 w-40" value={from} onChange={(e) => onChange(e.target.value, to)} /></div>
      <div className="space-y-1"><Label className="text-xs text-gray-500">До</Label><Input type="date" className="h-9 w-40" value={to} onChange={(e) => onChange(from, e.target.value)} /></div>
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" className="h-9" onClick={() => onChange(monthStart(), today())}>Овој месец</Button>
        <Button size="sm" variant="ghost" className="h-9" onClick={() => onChange(yearStart(), today())}>Оваа година</Button>
      </div>
    </div>
  );
}

function csvDownload(name: string, rows: (string | number)[][]) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}

// ───────────────────────── НАЛОЗИ ЗА КНИЖЕЊЕ ─────────────────────────
function JournalTab() {
  const utils = trpc.useUtils();
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  const { data, isLoading } = trpc.finance.journalList.useQuery({ from, to, search: search || undefined, limit: 50, offset: page * 50 });
  const { data: accounts } = trpc.finance.accountsList.useQuery();
  const sync = trpc.finance.ledgerSync.useMutation({
    onSuccess: (r) => {
      utils.finance.invalidate();
      const parts = [r.created && `${r.created} нови`, r.updated && `${r.updated} изменети`, r.removed && `${r.removed} отстранети`].filter(Boolean);
      toast.success(parts.length ? `Книжено: ${parts.join(", ")}` : "Главната книга е ажурна");
      if (r.problems.length) toast.warning(`${r.problems.length} документи не се книжени — види ја листата`);
    },
    onError: (e) => toast.error(e.message),
  });
  // Секое отворање го усогласува книжењето со документите
  useEffect(() => { sync.mutate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const del = trpc.finance.manualEntryDelete.useMutation({ onSuccess: () => utils.finance.journalList.invalidate(), onError: (e) => toast.error(e.message) });

  const [mDate, setMDate] = useState(today());
  const [mDesc, setMDesc] = useState("");
  const [mLines, setMLines] = useState([{ account: "", debit: "", credit: "" }, { account: "", debit: "", credit: "" }]);
  const dSum = mLines.reduce((a, l) => a + (parseFloat(l.debit) || 0), 0);
  const cSum = mLines.reduce((a, l) => a + (parseFloat(l.credit) || 0), 0);
  const manual = trpc.finance.manualEntryCreate.useMutation({
    onSuccess: (r) => { toast.success(`Внесен налог ${r.number}`); setManualOpen(false); setMDesc(""); setMLines([{ account: "", debit: "", credit: "" }, { account: "", debit: "", credit: "" }]); utils.finance.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodPicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); setPage(0); }} />
        <div className="flex gap-2">
          <Input placeholder="Пребарај..." className="h-9 w-48" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          <Button size="sm" variant="outline" className="h-9" onClick={() => sync.mutate()} disabled={sync.isPending}><RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${sync.isPending ? "animate-spin" : ""}`} />Книжи документи</Button>
          <Button size="sm" className="h-9 bg-amber-500 hover:bg-amber-600" onClick={() => setManualOpen(true)}><Plus className="h-3.5 w-3.5 mr-1.5" />Рачен налог</Button>
        </div>
      </div>

      {sync.data && sync.data.problems.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          <p className="font-medium text-amber-900 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />Не се книжени {sync.data.problems.length} документи</p>
          <ul className="mt-1 text-amber-800 text-xs space-y-0.5">
            {sync.data.problems.slice(0, 8).map((p, i) => <li key={i}>{p.ref}: {p.reason}</li>)}
          </ul>
          <p className="text-xs text-amber-700 mt-1">Најчеста причина е курс што недостасува. Внеси го во табот „Курсна листа“ и повторно кликни „Книжи документи“.</p>
        </div>
      )}

      <Card><CardContent className="p-0">
        {isLoading ? <p className="py-10 text-center text-gray-400 text-sm">Вчитување...</p>
          : !data?.entries.length ? <p className="py-10 text-center text-gray-400 text-sm">Нема налози за периодот</p>
          : data.entries.map((e) => (
            <div key={e.id} className="border-b last:border-b-0 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <span className="font-mono text-xs font-semibold text-gray-700">{e.number}</span>
                <span className="text-xs text-gray-400">{fmtDate(e.date)}</span>
                <Badge variant="outline" className="text-[10px] font-normal">{SOURCE_LBL[e.sourceType] ?? e.sourceType}</Badge>
                <span className="text-sm text-gray-700 flex-1 truncate">{e.description}</span>
                {e.sourceType === "manual" && (
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-gray-400 hover:text-red-500" onClick={() => { if (confirm("Да се избрише рачниот налог?")) del.mutate({ id: e.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                )}
              </div>
              <div className="grid grid-cols-[4.5rem_1fr_7rem_7rem] gap-x-3 text-xs">
                {e.lines.map((l, i) => (
                  <div key={i} className="contents">
                    <span className="font-mono text-gray-600">{l.account}</span>
                    <span className="text-gray-500 truncate">{l.accountName}</span>
                    <span className="text-right tabular-nums">{l.debit ? fmt(l.debit) : ""}</span>
                    <span className="text-right tabular-nums">{l.credit ? fmt(l.credit) : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
      </CardContent></Card>
      {data && data.total > 50 && (
        <div className="flex items-center justify-end gap-2 text-sm text-gray-500">
          <span>{page * 50 + 1}–{Math.min((page + 1) * 50, data.total)} од {data.total}</span>
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Претходни</Button>
          <Button size="sm" variant="outline" disabled={(page + 1) * 50 >= data.total} onClick={() => setPage(page + 1)}>Следни</Button>
        </div>
      )}

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Рачен налог за книжење</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-[10rem_1fr] gap-3">
              <div className="space-y-1"><Label className="text-xs">Датум</Label><Input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Опис</Label><Input value={mDesc} onChange={(e) => setMDesc(e.target.value)} placeholder="на пр. Почетна состојба, пресметка на камата..." /></div>
            </div>
            <div className="grid grid-cols-[1fr_8rem_8rem_2rem] gap-2 text-xs text-gray-500 font-medium"><span>Конто</span><span className="text-right">Должи</span><span className="text-right">Побарува</span><span /></div>
            {mLines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_8rem_8rem_2rem] gap-2">
                <Select value={l.account} onValueChange={(v) => setMLines(mLines.map((x, j) => j === i ? { ...x, account: v } : x))}>
                  <SelectTrigger><SelectValue placeholder="Избери конто" /></SelectTrigger>
                  <SelectContent>{accounts?.map(a => <SelectItem key={a.code} value={a.code}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" className="text-right" value={l.debit} onChange={(e) => setMLines(mLines.map((x, j) => j === i ? { ...x, debit: e.target.value, credit: e.target.value ? "" : x.credit } : x))} />
                <Input type="number" className="text-right" value={l.credit} onChange={(e) => setMLines(mLines.map((x, j) => j === i ? { ...x, credit: e.target.value, debit: e.target.value ? "" : x.debit } : x))} />
                <Button size="sm" variant="ghost" className="h-9 w-8 p-0 text-gray-400" disabled={mLines.length <= 2} onClick={() => setMLines(mLines.filter((_, j) => j !== i))}>×</Button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button size="sm" variant="ghost" onClick={() => setMLines([...mLines, { account: "", debit: "", credit: "" }])}><Plus className="h-3.5 w-3.5 mr-1" />Ред</Button>
              <span className={`text-sm tabular-nums ${Math.abs(dSum - cSum) < 0.005 && dSum > 0 ? "text-emerald-700" : "text-red-600"}`}>Должи {fmt(dSum)} · Побарува {fmt(cSum)}</span>
            </div>
            <Button className="w-full bg-amber-500 hover:bg-amber-600" disabled={manual.isPending || Math.abs(dSum - cSum) > 0.005 || dSum === 0 || mDesc.length < 2 || mLines.some(l => !l.account && (l.debit || l.credit))}
              onClick={() => manual.mutate({ date: mDate, description: mDesc, lines: mLines.filter(l => l.account).map(l => ({ account: l.account, debit: parseFloat(l.debit) || 0, credit: parseFloat(l.credit) || 0 })) })}>
              Внеси налог
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ───────────────────────── БРУТО БИЛАНС ─────────────────────────
function TrialBalanceTab({ onOpenCard }: { onOpenCard: (code: string) => void }) {
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const { data, isLoading } = trpc.finance.trialBalance.useQuery({ from, to });
  const classes = useMemo(() => {
    const m = new Map<string, { opening: number; debit: number; credit: number; closing: number }>();
    for (const a of data?.accounts ?? []) {
      const k = a.code[0];
      const g = m.get(k) ?? { opening: 0, debit: 0, credit: 0, closing: 0 };
      g.opening += a.opening; g.debit += a.debit; g.credit += a.credit; g.closing += a.closing;
      m.set(k, g);
    }
    return m;
  }, [data]);
  const exportCsv = () => csvDownload(`bruto-bilans-${from}-${to}.csv`, [
    ["Конто", "Назив", "Почетно салдо", "Должи", "Побарува", "Салдо"],
    ...(data?.accounts ?? []).map(a => [a.code, a.name, a.opening.toFixed(2), a.debit.toFixed(2), a.credit.toFixed(2), a.closing.toFixed(2)]),
  ]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodPicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!data?.accounts.length}><Download className="h-3.5 w-3.5 mr-1.5" />Excel (CSV)</Button>
      </div>
      {data && (data.unposted.invoices > 0 || data.unposted.incoming > 0) && (
        <p className="text-sm text-amber-700">Има некнижени документи ({data.unposted.invoices} излезни, {data.unposted.incoming} влезни фактури) — отвори „Налози“ за да се книжат.</p>
      )}
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-20">Конто</TableHead><TableHead>Назив</TableHead>
            <TableHead className="text-right">Почетно салдо</TableHead><TableHead className="text-right">Должи</TableHead>
            <TableHead className="text-right">Побарува</TableHead><TableHead className="text-right">Салдо</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-400">Вчитување...</TableCell></TableRow>
              : !data?.accounts.length ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-400">Нема промет за периодот</TableCell></TableRow>
              : data.accounts.map((a, i) => {
                const next = data.accounts[i + 1];
                const g = classes.get(a.code[0])!;
                return (
                  <Fragment key={a.code}>
                    <TableRow className="cursor-pointer hover:bg-amber-50/50" onClick={() => onOpenCard(a.code)}>
                      <TableCell className="font-mono">{a.code}</TableCell><TableCell>{a.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(a.opening)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(a.debit)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmt(a.credit)}</TableCell>
                      <TableCell className={`text-right tabular-nums font-medium ${a.closing < 0 ? "text-red-600" : ""}`}>{fmt(a.closing)}</TableCell>
                    </TableRow>
                    {(!next || next.code[0] !== a.code[0]) && (
                      <TableRow className="bg-gray-50 hover:bg-gray-50">
                        <TableCell colSpan={2} className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Класа {a.code[0]}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs font-semibold">{fmt(g.opening)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs font-semibold">{fmt(g.debit)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs font-semibold">{fmt(g.credit)}</TableCell>
                        <TableCell className="text-right tabular-nums text-xs font-semibold">{fmt(g.closing)}</TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            {data && data.accounts.length > 0 && (
              <TableRow className="bg-gray-900 hover:bg-gray-900 text-white">
                <TableCell colSpan={3} className="font-semibold text-white">Вкупно</TableCell>
                <TableCell className="text-right tabular-nums font-semibold text-white">{fmt(data.totals.debit)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold text-white">{fmt(data.totals.credit)}</TableCell>
                <TableCell className="text-right text-xs text-white">{Math.abs(data.totals.debit - data.totals.credit) < 0.01 ? "во рамнотежа ✓" : "НЕ Е ВО РАМНОТЕЖА"}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

// ───────────────────────── КАРТИЦА НА КОНТО ─────────────────────────
function AccountCardTab({ code, setCode }: { code: string; setCode: (c: string) => void }) {
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const { data: accounts } = trpc.finance.accountsList.useQuery();
  const { data, isLoading } = trpc.finance.accountCard.useQuery({ code, from, to }, { enabled: !!code });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label className="text-xs text-gray-500">Конто</Label>
          <Select value={code} onValueChange={setCode}>
            <SelectTrigger className="h-9 w-72"><SelectValue placeholder="Избери конто" /></SelectTrigger>
            <SelectContent>{accounts?.map(a => <SelectItem key={a.code} value={a.code}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <PeriodPicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>
      {!code ? <p className="text-sm text-gray-400 py-8 text-center">Избери конто за да ја видиш картицата</p> : (
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Датум</TableHead><TableHead>Налог</TableHead><TableHead>Опис</TableHead><TableHead>Партнер</TableHead>
              <TableHead className="text-right">Должи</TableHead><TableHead className="text-right">Побарува</TableHead><TableHead className="text-right">Салдо</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              <TableRow className="bg-gray-50 hover:bg-gray-50"><TableCell colSpan={6} className="text-xs text-gray-500">Почетно салдо</TableCell><TableCell className="text-right tabular-nums font-medium">{fmt(data?.opening)}</TableCell></TableRow>
              {isLoading ? <TableRow><TableCell colSpan={7} className="text-center py-6 text-gray-400">Вчитување...</TableCell></TableRow>
                : data?.items.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-nowrap">{fmtDate(r.date)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.number}</TableCell>
                    <TableCell className="max-w-xs truncate">{r.description}</TableCell>
                    <TableCell className="text-gray-500">{r.partner ?? ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.debit ? fmt(r.debit) : ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.credit ? fmt(r.credit) : ""}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{fmt(r.balance)}</TableCell>
                  </TableRow>
                ))}
              <TableRow className="bg-gray-50 hover:bg-gray-50"><TableCell colSpan={6} className="text-xs font-semibold">Крајно салдо</TableCell><TableCell className="text-right tabular-nums font-bold">{fmt(data?.closing)}</TableCell></TableRow>
            </TableBody>
          </Table>
        </CardContent></Card>
      )}
    </div>
  );
}

// ───────────────────────── ДДВ ─────────────────────────
const VAT_KEY: Record<string, string> = { "18": "Општа стапка 18%", "10": "Повластена 10%", "5": "Повластена 5%", "0-export": "Извоз / странство (0%)", "0-exempt": "Ослободено (0%)" };
function VatTab() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [book, setBook] = useState<"out" | "in">("out");
  const { data, isLoading } = trpc.finance.vatBooks.useQuery({ from, to });
  const rows = book === "out" ? data?.outgoing : data?.incoming;
  const exportCsv = () => csvDownload(`${book === "out" ? "kif" : "kuf"}-${from}-${to}.csv`, [
    ["Реден бр.", "Број", "Датум", "Партнер", "ЕДБ", "Држава", "Валута", "Стапка %", "Основица (ден)", "ДДВ (ден)", "Вкупно (ден)"],
    ...(rows ?? []).map((r, i) => [i + 1, r.number, r.date, r.partner ?? "", r.taxId, r.country, r.currency, r.vatRate, r.baseMkd.toFixed(2), r.vatMkd.toFixed(2), r.totalMkd.toFixed(2)]),
  ]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodPicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows?.length}><Download className="h-3.5 w-3.5 mr-1.5" />Excel (CSV)</Button>
      </div>
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card><CardContent className="p-4">
            <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-2">Излезен ДДВ (продажба)</p>
            {data.summary.output.map(g => <div key={g.key} className="flex justify-between text-sm py-0.5"><span className="text-gray-500">{VAT_KEY[g.key] ?? g.key + "%"}</span><span className="tabular-nums">{fmt(g.base)} / <b>{fmt(g.vat)}</b></span></div>)}
            <p className="text-lg font-bold mt-2 tabular-nums">{fmt(data.summary.outVat)} ден</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-2">Претходен ДДВ (набавки)</p>
            {data.summary.input.map(g => <div key={g.key} className="flex justify-between text-sm py-0.5"><span className="text-gray-500">{VAT_KEY[g.key] ?? g.key + "%"}</span><span className="tabular-nums">{fmt(g.base)} / <b>{fmt(g.vat)}</b></span></div>)}
            <p className="text-lg font-bold mt-2 tabular-nums">{fmt(data.summary.inVat)} ден</p>
          </CardContent></Card>
          <Card className={data.summary.payable >= 0 ? "border-amber-300 bg-amber-50/60" : "border-emerald-300 bg-emerald-50/60"}><CardContent className="p-4">
            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-2">{data.summary.payable >= 0 ? "ДДВ за уплата" : "ДДВ за поврат"}</p>
            <p className="text-3xl font-bold tabular-nums">{fmt(Math.abs(data.summary.payable))} <span className="text-base">ден</span></p>
            <p className="text-xs text-gray-500 mt-2">Помош за ДДВ пријавата. Бројките провери ги со сметководителот пред поднесување.</p>
          </CardContent></Card>
        </div>
      )}
      {data && data.missingRates.length > 0 && (
        <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />Нема курс за: {data.missingRates.slice(0, 5).join(", ")}{data.missingRates.length > 5 ? "..." : ""} — внеси го во „Курсна листа“.</p>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant={book === "out" ? "default" : "outline"} onClick={() => setBook("out")}>Книга на излезни фактури ({data?.outgoing.length ?? 0})</Button>
        <Button size="sm" variant={book === "in" ? "default" : "outline"} onClick={() => setBook("in")}>Книга на влезни фактури ({data?.incoming.length ?? 0})</Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-10">#</TableHead><TableHead>Број</TableHead><TableHead>Датум</TableHead><TableHead>Партнер</TableHead><TableHead>ЕДБ</TableHead>
            <TableHead className="text-right">Стапка</TableHead><TableHead className="text-right">Основица</TableHead><TableHead className="text-right">ДДВ</TableHead><TableHead className="text-right">Вкупно</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={9} className="text-center py-8 text-gray-400">Вчитување...</TableCell></TableRow>
              : !rows?.length ? <TableRow><TableCell colSpan={9} className="text-center py-8 text-gray-400">Нема фактури за периодот</TableCell></TableRow>
              : rows.map((r, i) => (
                <TableRow key={r.id}>
                  <TableCell className="text-gray-400">{i + 1}</TableCell>
                  <TableCell className="font-mono text-xs">{r.number}{r.creditNote && <Badge className="ml-1.5 bg-red-100 text-red-700 text-[10px]">КО</Badge>}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(r.date)}</TableCell>
                  <TableCell>{r.partner}{r.foreign && <span className="text-xs text-gray-400"> · {r.country || r.currency}</span>}</TableCell>
                  <TableCell className="text-xs text-gray-500">{r.taxId}</TableCell>
                  <TableCell className="text-right">{r.vatRate}%</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.baseMkd)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.vatMkd)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{fmt(r.totalMkd)}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

// ───────────────────────── БЛАГАЈНА ─────────────────────────
function CashTab() {
  const utils = trpc.useUtils();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const { data } = trpc.finance.cashList.useQuery({ from, to });
  const { data: open } = trpc.finance.cashOpenDocs.useQuery();
  const { data: accounts } = trpc.finance.accountsList.useQuery();
  const [dlg, setDlg] = useState<null | "in" | "out">(null);
  const [f, setF] = useState({ date: today(), amount: "", description: "", partnerName: "", docId: "", account: "" });
  const create = trpc.finance.cashCreate.useMutation({
    onSuccess: (r) => { toast.success(`Внесено ${r.docNumber}`); setDlg(null); utils.finance.cashList.invalidate(); utils.finance.cashOpenDocs.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.finance.cashDelete.useMutation({ onSuccess: () => utils.finance.cashList.invalidate(), onError: (e) => toast.error(e.message) });
  const docs = dlg === "in" ? open?.invoices : open?.incoming;
  const openDlg = (d: "in" | "out") => { setF({ date: today(), amount: "", description: "", partnerName: "", docId: "", account: "" }); setDlg(d); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodPicker from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} />
        <div className="flex gap-2">
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => openDlg("in")}><Plus className="h-3.5 w-3.5 mr-1" />Уплатница</Button>
          <Button size="sm" className="bg-red-600 hover:bg-red-700" onClick={() => openDlg("out")}><Plus className="h-3.5 w-3.5 mr-1" />Исплатница</Button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { l: "Почетно салдо", v: data?.opening, c: "" },
          { l: "Уплати", v: data?.ins, c: "text-emerald-700" },
          { l: "Исплати", v: data?.outs, c: "text-red-600" },
          { l: "Салдо во благајна", v: data?.closing, c: "text-amber-700" },
        ].map(k => (
          <Card key={k.l}><CardContent className="p-4">
            <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">{k.l}</p>
            <p className={`text-2xl font-bold tabular-nums ${k.c}`}>{fmt(k.v)}</p>
          </CardContent></Card>
        ))}
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Број</TableHead><TableHead>Датум</TableHead><TableHead>Опис</TableHead><TableHead>Документ</TableHead>
            <TableHead className="text-right">Уплата</TableHead><TableHead className="text-right">Исплата</TableHead><TableHead className="text-right">Салдо</TableHead><TableHead className="w-10" />
          </TableRow></TableHeader>
          <TableBody>
            {!data?.items.length ? <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-400">Нема промени во благајната за периодот</TableCell></TableRow>
              : data.items.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.docNumber}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(r.date)}</TableCell>
                  <TableCell>{r.description}{r.partnerName && <span className="text-gray-400"> · {r.partnerName}</span>}</TableCell>
                  <TableCell className="text-xs text-gray-500">{r.invoiceNumber ?? r.incomingNumber ?? (r.accountCode ? `конто ${r.accountCode}` : "")}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-700">{r.direction === "in" ? fmt(r.amount) : ""}</TableCell>
                  <TableCell className="text-right tabular-nums text-red-600">{r.direction === "out" ? fmt(r.amount) : ""}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{fmt(r.balance)}</TableCell>
                  <TableCell><Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-gray-400 hover:text-red-500" onClick={() => { if (confirm(`Да се избрише ${r.docNumber}?`)) del.mutate({ id: r.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button></TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{dlg === "in" ? "Уплатница — пари влегуваат" : "Исплатница — пари излегуваат"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Датум</Label><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
              <div className="space-y-1"><Label className="text-xs">Износ (ден)</Label><Input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">{dlg === "in" ? "Наплата по фактура (ако е)" : "Плаќање по влезна фактура (ако е)"}</Label>
              <Select value={f.docId || "none"} onValueChange={(v) => {
                const d = docs?.find(x => String(x.id) === v);
                setF({ ...f, docId: v === "none" ? "" : v, amount: d && d.currency === "MKD" ? String(d.open) : f.amount, partnerName: d?.partner ?? f.partnerName });
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— без документ —</SelectItem>
                  {docs?.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.number} · {d.partner} · отворено {fmt(d.open)} {d.currency}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {!f.docId && (
              <div className="space-y-1"><Label className="text-xs">Контра конто</Label>
                <Select value={f.account || "default"} onValueChange={(v) => setF({ ...f, account: v === "default" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Стандардно (од правилата за книжење)</SelectItem>
                    {accounts?.map(a => <SelectItem key={a.code} value={a.code}>{a.code} — {a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1"><Label className="text-xs">Лице / партнер</Label><Input value={f.partnerName} onChange={(e) => setF({ ...f, partnerName: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Опис</Label><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={dlg === "in" ? "на пр. Наплата готовина" : "на пр. Гориво, ситни набавки"} /></div>
            <Button className={`w-full ${dlg === "in" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}`} disabled={create.isPending || !(parseFloat(f.amount) > 0)}
              onClick={() => create.mutate({
                txDate: f.date, direction: dlg!, amount: parseFloat(f.amount), description: f.description || undefined, partnerName: f.partnerName || undefined,
                invoiceId: dlg === "in" && f.docId ? Number(f.docId) : undefined, incomingInvoiceId: dlg === "out" && f.docId ? Number(f.docId) : undefined,
                accountCode: f.account || undefined,
              })}>
              Внеси
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ───────────────────────── КУРСНА ЛИСТА ─────────────────────────
function RatesTab() {
  const utils = trpc.useUtils();
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today());
  const { data } = trpc.finance.ratesList.useQuery({ from, to });
  const fetchN = trpc.finance.ratesFetchNbrm.useMutation({
    onSuccess: (r) => { toast.success(`Преземени ${r.count} курсеви од НБРМ`); utils.finance.ratesList.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const [m, setM] = useState({ date: today(), currency: "EUR", rate: "" });
  const setRate = trpc.finance.rateSet.useMutation({ onSuccess: () => { toast.success("Курсот е зачуван"); utils.finance.ratesList.invalidate(); }, onError: (e) => toast.error(e.message) });
  const main = (data ?? []).filter(r => ["EUR", "USD", "GBP", "CHF"].includes(r.currency));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodPicker from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} />
        <Button size="sm" className="bg-amber-500 hover:bg-amber-600" onClick={() => fetchN.mutate({ from, to })} disabled={fetchN.isPending}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${fetchN.isPending ? "animate-spin" : ""}`} />Преземи од НБРМ
        </Button>
      </div>
      <Card><CardContent className="p-4">
        <p className="text-sm font-medium mb-2">Рачен внес (ако НБРМ не е достапна)</p>
        <div className="flex flex-wrap items-end gap-2">
          <Input type="date" className="w-40" value={m.date} onChange={(e) => setM({ ...m, date: e.target.value })} />
          <Select value={m.currency} onValueChange={(v) => setM({ ...m, currency: v })}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>{["EUR", "USD", "GBP", "CHF"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="number" step="0.0001" className="w-32" placeholder="61.5000" value={m.rate} onChange={(e) => setM({ ...m, rate: e.target.value })} />
          <Button size="sm" variant="outline" disabled={!(parseFloat(m.rate) > 0)} onClick={() => setRate.mutate({ date: m.date, currency: m.currency, rate: parseFloat(m.rate) })}>Зачувај</Button>
        </div>
        <p className="text-xs text-gray-400 mt-2">Курсот важи и за наредните денови без објава (викенд, празник) — до 10 дена.</p>
      </CardContent></Card>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Датум</TableHead><TableHead>Валута</TableHead><TableHead className="text-right">Среден курс (ден)</TableHead><TableHead>Извор</TableHead></TableRow></TableHeader>
          <TableBody>
            {!main.length ? <TableRow><TableCell colSpan={4} className="text-center py-8 text-gray-400">Нема курсеви за периодот — преземи ги од НБРМ или внеси рачно</TableCell></TableRow>
              : main.map(r => (
                <TableRow key={r.date + r.currency}>
                  <TableCell>{fmtDate(r.date)}</TableCell><TableCell className="font-medium">{r.currency}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.rate.toFixed(4)}</TableCell>
                  <TableCell><Badge variant="outline" className="font-normal">{r.source === "nbrm" ? "НБРМ" : "рачно"}</Badge></TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

// ───────────────────────── КОНТЕН ПЛАН ─────────────────────────
function ChartTab() {
  const utils = trpc.useUtils();
  const { data: accounts } = trpc.finance.accountsList.useQuery();
  const { data: rules } = trpc.finance.postingRulesGet.useQuery();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [na, setNa] = useState({ code: "", name: "", type: "expense" as const });
  const upsert = trpc.finance.accountUpsert.useMutation({ onSuccess: () => { toast.success("Контото е зачувано"); setNa({ code: "", name: "", type: "expense" }); utils.finance.accountsList.invalidate(); }, onError: (e) => toast.error(e.message) });
  const saveRules = trpc.finance.postingRulesSet.useMutation({ onSuccess: () => { toast.success("Правилата се зачувани — кликни „Книжи документи“ за прекнижување"); setEdits({}); utils.finance.postingRulesGet.invalidate(); }, onError: (e) => toast.error(e.message) });
  const TYPE_LBL: Record<string, string> = { asset: "Средство", liability: "Обврска", equity: "Капитал", revenue: "Приход", expense: "Расход" };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card><CardContent className="p-4 space-y-3">
        <div>
          <p className="font-semibold">Контен план</p>
          <p className="text-xs text-gray-500">Почетните конта се предлог — провери ги со сметководителот и додај ги оние што ти требаат.</p>
        </div>
        <div className="grid grid-cols-[5rem_1fr_8rem_auto] gap-2">
          <Input placeholder="Шифра" value={na.code} onChange={(e) => setNa({ ...na, code: e.target.value })} />
          <Input placeholder="Назив" value={na.name} onChange={(e) => setNa({ ...na, name: e.target.value })} />
          <Select value={na.type} onValueChange={(v: any) => setNa({ ...na, type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(TYPE_LBL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" disabled={!/^\d+$/.test(na.code) || na.name.length < 2} onClick={() => upsert.mutate(na)}>Додади</Button>
        </div>
        <div className="max-h-[28rem] overflow-y-auto border rounded-lg">
          {accounts?.map(a => (
            <div key={a.code} className="flex items-center gap-3 px-3 py-1.5 border-b last:border-b-0 text-sm">
              <span className="font-mono w-14">{a.code}</span><span className="flex-1">{a.name}</span>
              <span className="text-xs text-gray-400">{TYPE_LBL[a.type] ?? a.type}</span>
            </div>
          ))}
        </div>
      </CardContent></Card>
      <Card><CardContent className="p-4 space-y-3">
        <div>
          <p className="font-semibold">Правила за автоматско книжење</p>
          <p className="text-xs text-gray-500">На кое конто оди секој дел од фактурите, уплатите и благајната.</p>
        </div>
        <div className="space-y-1.5">
          {rules?.map(r => (
            <div key={r.key} className="flex items-center gap-3 text-sm">
              <span className="flex-1 text-gray-600">{r.label}</span>
              <Select value={edits[r.key] ?? r.accountCode} onValueChange={(v) => setEdits({ ...edits, [r.key]: v })}>
                <SelectTrigger className="w-64 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{accounts?.map(a => <SelectItem key={a.code} value={a.code}>{a.code} — {a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <Button className="bg-amber-500 hover:bg-amber-600" disabled={!Object.keys(edits).length || saveRules.isPending}
          onClick={() => saveRules.mutate(Object.entries(edits).map(([key, accountCode]) => ({ key, accountCode })))}>Зачувај правила</Button>
      </CardContent></Card>
    </div>
  );
}


// ───────────────────────── ДОБИВКА ПО НАРАЧКА ─────────────────────────
function ProfitTab() {
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const { data, isLoading } = trpc.ops.profitabilityReport.useQuery({ from, to });
  const t = data?.totals;
  const margin = t && t.revenue ? (t.profit / t.revenue) * 100 : null;
  const exportCsv = () => csvDownload(`dobivka-${from}-${to}.csv`, [
    ["Нарачка", "Клиент", "Датум", "Приход (ден)", "Извор", "План. трошок", "Реален трошок", "Материјал", "Операции", "Часови", "Добивка", "Маржа %"],
    ...(data?.rows ?? []).map(r => [r.orderNumber, r.customer ?? "", r.date, r.revenue ?? "", r.revenueSource === "invoiced" ? "фактурирано" : "по нарачка",
      r.plannedCost, r.actualCost, r.materialCost, r.operationCost, r.hours, r.profit ?? "", r.marginPct ?? ""]),
  ]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodPicker from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} />
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!data?.rows.length}><Download className="h-3.5 w-3.5 mr-1.5" />Excel (CSV)</Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { l: "Приход", v: fmt(t?.revenue), c: "" },
          { l: "Планиран трошок", v: fmt(t?.plannedCost), c: "text-gray-600" },
          { l: "Реален трошок", v: fmt(t?.actualCost), c: "text-gray-800" },
          { l: `Добивка${margin !== null ? ` · ${margin.toFixed(1)}%` : ""}`, v: fmt(t?.profit), c: (t?.profit ?? 0) >= 0 ? "text-emerald-700" : "text-red-600" },
        ].map(k => (
          <Card key={k.l}><CardContent className="p-4">
            <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">{k.l}</p>
            <p className={`text-2xl font-bold tabular-nums ${k.c}`}>{k.v}</p>
          </CardContent></Card>
        ))}
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Нарачка</TableHead><TableHead>Клиент</TableHead>
            <TableHead className="text-right">Приход</TableHead><TableHead className="text-right">План</TableHead><TableHead className="text-right">Реално</TableHead>
            <TableHead className="text-right">Отстапување</TableHead><TableHead className="text-right">Добивка</TableHead><TableHead className="w-40">Маржа</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading ? <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-400">Вчитување...</TableCell></TableRow>
              : !data?.rows.length ? <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-400">Нема нарачки за периодот</TableCell></TableRow>
              : data.rows.map(r => {
                const m = r.marginPct;
                return (
                  <TableRow key={r.orderId}>
                    <TableCell>
                      <div className="font-mono text-xs font-semibold">{r.orderNumber}</div>
                      <div className="text-[11px] text-gray-400">{fmtDate(r.date)}{r.workOrders.length ? ` · ${r.workOrders.join(", ")}` : " · без налог"}{!r.finished && r.workOrders.length ? " · во тек" : ""}</div>
                    </TableCell>
                    <TableCell className="text-sm">{r.customer}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.revenue === null ? <span className="text-red-600 text-xs">нема курс</span> : fmt(r.revenue)}
                      <div className="text-[10px] text-gray-400">{r.revenueSource === "invoiced" ? "фактурирано" : "по нарачка"}{r.currency !== "MKD" ? ` · ${r.currency}` : ""}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-500">{fmt(r.plannedCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(r.actualCost)}
                      <div className="text-[10px] text-gray-400">мат. {fmt(r.materialCost)} · опер. {fmt(r.operationCost)}</div>
                    </TableCell>
                    <TableCell className={`text-right tabular-nums text-sm ${r.variance > 0 ? "text-red-600" : "text-emerald-700"}`}>{r.variance > 0 ? "+" : ""}{fmt(r.variance)}</TableCell>
                    <TableCell className={`text-right tabular-nums font-semibold ${(r.profit ?? 0) >= 0 ? "text-emerald-700" : "text-red-600"}`}>{r.profit === null ? "—" : fmt(r.profit)}</TableCell>
                    <TableCell>
                      {m === null ? <span className="text-xs text-gray-400">—</span> : (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden">
                            <div className={`h-full rounded-full ${m >= 20 ? "bg-emerald-500" : m >= 0 ? "bg-amber-400" : "bg-red-500"}`} style={{ width: `${Math.min(100, Math.abs(m))}%` }} />
                          </div>
                          <span className={`text-xs tabular-nums w-12 text-right ${m < 0 ? "text-red-600" : ""}`}>{m.toFixed(1)}%</span>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </CardContent></Card>
      <p className="text-xs text-gray-400">Реален трошок = материјал на налозите (издаден, или планиран ако уште не е издаден) + операции (реално време × цена/час, или проценето). Приход = фактурирано без ДДВ, или вредноста на нарачката.</p>
    </div>
  );
}

export default function Finance() {
  const [tab, setTab] = useState("journal");
  const [cardCode, setCardCode] = useState("");
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Финансии</h2>
        <p className="text-gray-500 mt-1">Главна книга, ДДВ, благајна и курсна листа — фактурите и уплатите се книжат автоматски</p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-amber-50 flex-wrap h-auto">
          <TabsTrigger value="profit"><TrendingUp className="h-4 w-4 mr-1.5" />Добивка по нарачка</TabsTrigger>
          <TabsTrigger value="journal"><BookOpen className="h-4 w-4 mr-1.5" />Налози</TabsTrigger>
          <TabsTrigger value="trial"><Scale className="h-4 w-4 mr-1.5" />Бруто биланс</TabsTrigger>
          <TabsTrigger value="card"><FileSpreadsheet className="h-4 w-4 mr-1.5" />Картица</TabsTrigger>
          <TabsTrigger value="vat"><Receipt className="h-4 w-4 mr-1.5" />ДДВ</TabsTrigger>
          <TabsTrigger value="cash"><Wallet className="h-4 w-4 mr-1.5" />Благајна</TabsTrigger>
          <TabsTrigger value="rates"><Coins className="h-4 w-4 mr-1.5" />Курсна листа</TabsTrigger>
          <TabsTrigger value="chart"><ListTree className="h-4 w-4 mr-1.5" />Контен план</TabsTrigger>
        </TabsList>
        <TabsContent value="profit" className="mt-4"><ProfitTab /></TabsContent>
        <TabsContent value="journal" className="mt-4"><JournalTab /></TabsContent>
        <TabsContent value="trial" className="mt-4"><TrialBalanceTab onOpenCard={(c) => { setCardCode(c); setTab("card"); }} /></TabsContent>
        <TabsContent value="card" className="mt-4"><AccountCardTab code={cardCode} setCode={setCardCode} /></TabsContent>
        <TabsContent value="vat" className="mt-4"><VatTab /></TabsContent>
        <TabsContent value="cash" className="mt-4"><CashTab /></TabsContent>
        <TabsContent value="rates" className="mt-4"><RatesTab /></TabsContent>
        <TabsContent value="chart" className="mt-4"><ChartTab /></TabsContent>
      </Tabs>
    </div>
  );
}
