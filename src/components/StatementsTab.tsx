import { Fragment, useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { toast } from "sonner";
import { downloadXlsx, saveBlob, type Cell } from "@/lib/xlsx";
import { simpleReportHtml, printHtml, htmlToPdfBlob, type ReportRow } from "@/lib/print-documents";
import { AlertTriangle, ChevronDown, ChevronRight, Download, FileText, Printer, Hash, CheckCircle2 } from "lucide-react";

const fmt = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (d: string) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "—");
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Row = { key: string; label: string; amount: number; accounts: { code: string; name: string; amount: number }[] };
type Line = { kind: "section" | "row" | "total" | "grand"; key: string; label: string; cur: number | null; prev: number | null; accounts?: Row["accounts"] };

/** Биланс на состојба и Биланс на успех од главната книга, со претходната година за споредба. */
export default function StatementsTab() {
  const [view, setView] = useState<"bs" | "is">("bs");
  const [date, setDate] = useState(() => { const n = new Date(); return ymd(new Date(n.getFullYear(), n.getMonth(), 0)); });
  const [from, setFrom] = useState(() => `${date.slice(0, 4)}-01-01`);
  useEffect(() => { if (from.slice(0, 4) !== date.slice(0, 4)) setFrom(`${date.slice(0, 4)}-01-01`); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data, isLoading } = trpc.finance.financialStatements.useQuery({ date, from });
  const { data: settings } = trpc.settings.settingsGet.useQuery(undefined, { staleTime: 300_000 });
  const utils = trpc.useUtils();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editCodes, setEditCodes] = useState(false);
  const [codes, setCodes] = useState<Record<string, string>>({});
  useEffect(() => { if (data) setCodes(data.codes); }, [data?.codes]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveCodes = trpc.finance.statementCodesSave.useMutation({ onSuccess: () => { toast.success("Броевите на полињата се зачувани"); setEditCodes(false); utils.finance.financialStatements.invalidate(); }, onError: (e) => toast.error(e.message) });

  const lines: Line[] = [];
  if (data) {
    const prevOf = (rows: Row[], key: string) => rows.find((r) => r.key === key)?.amount ?? 0;
    if (view === "bs") {
      const side = (title: string, secs: { key: string; label: string; rows: Row[] }[], prevSecs: { rows: Row[] }[], total: number, prevTotal: number) => {
        lines.push({ kind: "grand", key: title, label: title, cur: null, prev: null });
        const prevRows = prevSecs.flatMap((s) => s.rows);
        for (const s of secs) {
          lines.push({ kind: "section", key: s.key, label: s.label, cur: s.rows.reduce((a, r) => a + r.amount, 0), prev: s.rows.reduce((a, r) => a + prevOf(prevRows, r.key), 0) });
          for (const r of s.rows) lines.push({ kind: "row", key: r.key, label: r.label, cur: r.amount, prev: prevOf(prevRows, r.key), accounts: r.accounts });
        }
        lines.push({ kind: "total", key: title + "_t", label: `Вкупно ${title.toLowerCase()}`, cur: total, prev: prevTotal });
      };
      side("Актива", data.balanceSheet.assets, data.balanceSheetPrev.assets, data.balanceSheet.totalAssets, data.balanceSheetPrev.totalAssets);
      side("Пасива", data.balanceSheet.liabilities, data.balanceSheetPrev.liabilities, data.balanceSheet.totalLiabilities, data.balanceSheetPrev.totalLiabilities);
    } else {
      const c = data.incomeStatement, p = data.incomeStatementPrev;
      lines.push({ kind: "section", key: "rev", label: "Приходи", cur: c.totalRevenue, prev: p.totalRevenue });
      for (const r of c.revenue) lines.push({ kind: "row", key: r.key, label: r.label, cur: r.amount, prev: prevOf(p.revenue, r.key), accounts: r.accounts });
      lines.push({ kind: "section", key: "exp", label: "Расходи", cur: c.totalExpense, prev: p.totalExpense });
      for (const r of c.expense) lines.push({ kind: "row", key: r.key, label: r.label, cur: r.amount, prev: prevOf(p.expense, r.key), accounts: r.accounts });
      lines.push({ kind: "total", key: "before", label: c.beforeTax >= 0 ? "Добивка пред оданочување" : "Загуба пред оданочување", cur: c.beforeTax, prev: p.beforeTax });
      lines.push({ kind: "row", key: c.tax.key, label: c.tax.label, cur: c.tax.amount, prev: p.tax.amount, accounts: c.tax.accounts });
      lines.push({ kind: "grand", key: "net", label: c.net >= 0 ? "Нето добивка" : "Нето загуба", cur: c.net, prev: p.net });
    }
  }

  const title = view === "bs" ? "Биланс на состојба" : "Биланс на успех";
  const subtitle = data ? (view === "bs" ? `на ${fmtD(data.date)} (претходна година: ${fmtD(data.prevDate)})` : `за периодот ${fmtD(data.from)} – ${fmtD(data.date)} (претходна година: ${fmtD(data.prevFrom)} – ${fmtD(data.prevTo)})`) : "";
  const curHead = view === "bs" ? fmtD(date) : `${fmtD(from)}–${fmtD(date)}`;
  const prevHead = data ? (view === "bs" ? fmtD(data.prevDate) : `${fmtD(data.prevFrom)}–${fmtD(data.prevTo)}`) : "Претходна";
  const notes: string[] = [];
  if (data) {
    if (data.notes.unpostedInvoices || data.notes.unpostedIncoming) notes.push(`Има некнижени документи (${data.notes.unpostedInvoices} излезни, ${data.notes.unpostedIncoming} влезни фактури) — книжи ги пред билансот.`);
    if (!data.notes.lastInventoryValuation || data.notes.lastInventoryValuation < date.slice(0, 8) + "01") notes.push(`Залихите на недовршено производство и готови производи ${data.notes.lastInventoryValuation ? `се пресметани до ${fmtD(data.notes.lastInventoryValuation)}` : "уште не се пресметани"} — Финансии → Крај на период.`);
    if (view === "bs" && data.notes.assetRegister - data.notes.assetGl > 1) notes.push(`Основните средства во регистарот вредат ${fmt(data.notes.assetRegister)}, а во главната книга (класа 0) се книжени ${fmt(data.notes.assetGl)} — книжена е само амортизацијата. Внеси ја набавната вредност: влезна фактура на конто 01x или налог „Почетна состојба“ (D 01x / P 9xx).`);
    if (view === "bs" && Math.abs(data.balanceSheet.difference) >= 0.01) notes.push(`Активата и пасивата се разликуваат за ${fmt(data.balanceSheet.difference)} — провери ги контата без класа.`);
    if (view === "bs" && data.balanceSheet.unmapped.length) notes.push(`Конта што не влегуваат во ниту една позиција: ${data.balanceSheet.unmapped.map((u) => u.code).join(", ")}.`);
  }
  const reportRows = (): ReportRow[] => lines.flatMap((l) => {
    const head: ReportRow = { cells: [codes[l.key] ?? "", l.label, l.cur, l.prev], bold: l.kind !== "row", indent: l.kind === "row" ? 1 : 0 };
    return open.has(l.key) && l.accounts ? [head, ...l.accounts.map((a) => ({ cells: ["", `${a.code} ${a.name}`, a.amount, null], muted: true, indent: 2 }))] : [head];
  });
  const reportHtml = () => simpleReportHtml({
    title, subtitle, settings, head: ["АОП", "Позиција", curHead, prevHead], rows: reportRows(), numCols: [2, 3],
    notes: ["Составено од главната книга по класи на контниот план. Броевите на полињата (АОП) ги потврдува сметководителот.", ...notes],
    signatures: ["Составил", "Одговорно лице"],
  });
  const exportXlsx = () => {
    const rows: Cell[][] = lines.flatMap((l) => [[codes[l.key] ?? "", l.label, l.cur, l.prev], ...(l.accounts ?? []).map((a) => ["", `   ${a.code} ${a.name}`, a.amount, null])]);
    const bold = lines.reduce<number[]>((acc, l, i) => { if (l.kind !== "row") acc.push(lines.slice(0, i).reduce((n, x) => n + 1 + (x.accounts?.length ?? 0), 0)); return acc; }, []);
    void downloadXlsx(`${view === "bs" ? "bilans-sostojba" : "bilans-uspeh"}-${date}.xlsx`, [{ name: title, title: [settings?.name ?? "", `${title} ${subtitle}`], header: ["АОП", "Позиција", curHead, prevHead], rows, boldRows: bold, widths: [8, 70, 18, 18] }]);
  };
  const exportPdf = async () => { try { saveBlob(await htmlToPdfBlob(reportHtml()), `${view === "bs" ? "bilans-sostojba" : "bilans-uspeh"}-${date}.pdf`); } catch (e: any) { toast.error(e.message); } };
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex rounded-lg border bg-white p-0.5">
            <Button size="sm" variant={view === "bs" ? "default" : "ghost"} className="h-8" onClick={() => setView("bs")}>Биланс на состојба</Button>
            <Button size="sm" variant={view === "is" ? "default" : "ghost"} className="h-8" onClick={() => setView("is")}>Биланс на успех</Button>
          </div>
          {view === "is" && <div className="space-y-1"><Label className="text-xs text-gray-500">Од</Label><DateInput className="h-9 w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>}
          <div className="space-y-1"><Label className="text-xs text-gray-500">{view === "bs" ? "На датум" : "До"}</Label><DateInput className="h-9 w-40" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <Button size="sm" variant="ghost" className="h-9" onClick={() => setDate(`${Number(date.slice(0, 4)) - 1}-12-31`)}>31.12.{Number(date.slice(0, 4)) - 1}</Button>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setEditCodes(!editCodes)}><Hash className="h-3.5 w-3.5 mr-1.5" />{editCodes ? "Откажи" : "Броеви на полиња"}</Button>
          <Button size="sm" variant="outline" disabled={!data} onClick={exportXlsx}><Download className="h-3.5 w-3.5 mr-1.5" />Excel</Button>
          <Button size="sm" variant="outline" disabled={!data} onClick={exportPdf}><FileText className="h-3.5 w-3.5 mr-1.5" />PDF</Button>
          <Button size="sm" variant="outline" disabled={!data} onClick={() => printHtml(reportHtml())}><Printer className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      {notes.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 space-y-0.5">
          {notes.map((n, i) => <p key={i} className="flex items-start gap-1.5"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />{n}</p>)}
        </div>
      )}
      {editCodes && (
        <div className="rounded-lg border bg-white px-3 py-2 text-sm flex flex-wrap items-center justify-between gap-2">
          <span className="text-gray-600">Внеси ги броевите на полињата (АОП) од образецот што го користи сметководителот — се памтат и се печатат во извештајот.</span>
          <Button size="sm" className="bg-amber-500 hover:bg-amber-600" disabled={saveCodes.isPending} onClick={() => saveCodes.mutate({ kind: "statement", codes })}>Зачувај броеви</Button>
        </div>
      )}

      <Card><CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-xs text-gray-500">
            <th className="text-left font-medium px-3 py-2 w-20">АОП</th>
            <th className="text-left font-medium px-3 py-2">Позиција</th>
            <th className="text-right font-medium px-3 py-2 w-40">{curHead}</th>
            <th className="text-right font-medium px-3 py-2 w-40">{prevHead}</th>
          </tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={4} className="text-center py-8 text-gray-400">Вчитување...</td></tr> : lines.map((l) => (
              <Fragment key={l.key}>
                <tr className={l.kind === "grand" ? "bg-gray-900 text-white" : l.kind === "section" ? "bg-gray-50 font-semibold" : l.kind === "total" ? "bg-amber-50 font-semibold border-t" : "border-b border-gray-100 hover:bg-amber-50/40"}>
                  <td className="px-3 py-1.5">
                    {editCodes ? <Input className="h-7 w-16 text-xs" value={codes[l.key] ?? ""} onChange={(e) => setCodes({ ...codes, [l.key]: e.target.value })} />
                      : <span className="font-mono text-xs text-gray-500">{codes[l.key] ?? ""}</span>}
                  </td>
                  <td className={`px-3 py-1.5 ${l.kind === "row" ? "pl-6" : ""}`}>
                    {l.accounts?.length ? (
                      <button className="flex items-center gap-1 text-left" onClick={() => toggle(l.key)}>
                        {open.has(l.key) ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}{l.label}
                      </button>
                    ) : l.label}
                  </td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${l.cur !== null && l.cur < 0 ? (l.kind === "grand" ? "text-red-300" : "text-red-600") : ""}`}>{l.cur === null ? "" : fmt(l.cur)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${l.kind === "grand" ? "text-gray-300" : "text-gray-500"}`}>{l.prev === null ? "" : fmt(l.prev)}</td>
                </tr>
                {open.has(l.key) && l.accounts?.map((a) => (
                  <tr key={l.key + a.code} className="text-xs text-gray-500">
                    <td />
                    <td className="px-3 py-1 pl-12"><span className="font-mono">{a.code}</span> {a.name}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{fmt(a.amount)}</td>
                    <td />
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
      {data && view === "bs" && Math.abs(data.balanceSheet.difference) < 0.01 && (
        <p className="text-xs text-emerald-700 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Активата е еднаква на пасивата.</p>
      )}
      <p className="text-xs text-gray-500">
        Составено од главната книга: секое конто оди во позицијата според класата (на пр. 10 — парични средства, 12 — купувачи, 22 — добавувачи).
        Кликни на позиција за да ги видиш контата. Тековниот резултат (класи 4 и 7) е во главнината сè додека годината не се затвори.
        Ова е работна верзија за проверка — официјалните обрасци ги поднесува сметководителот.
      </p>
    </div>
  );
}
