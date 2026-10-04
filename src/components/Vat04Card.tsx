import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { downloadXlsx, saveBlob } from "@/lib/xlsx";
import { simpleReportHtml, htmlToPdfBlob } from "@/lib/print-documents";
import { Download, FileText, Hash, ClipboardList } from "lucide-react";

const fmt = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (d: string) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "—");
const SIDE: Record<string, string> = { out: "Излезен промет (КИФ)", in: "Влезен промет (КУФ)", total: "Пресметка" };

/** ДДВ-04 по полиња: износите за пренос во пријавата, со број на поле што го внесува сметководителот. */
export default function Vat04Card({ from, to }: { from: string; to: string }) {
  const { data } = trpc.finance.vat04.useQuery({ from, to });
  const { data: settings } = trpc.settings.settingsGet.useQuery(undefined, { staleTime: 300_000 });
  const utils = trpc.useUtils();
  const [edit, setEdit] = useState(false);
  const [codes, setCodes] = useState<Record<string, string>>({});
  useEffect(() => { if (data) setCodes(data.codes); }, [data?.codes]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = trpc.finance.statementCodesSave.useMutation({ onSuccess: () => { toast.success("Зачувано"); setEdit(false); utils.finance.vat04.invalidate(); }, onError: (e) => toast.error(e.message) });
  if (!data) return null;
  const lines = data.lines;
  const sub = `за периодот ${fmtD(from)} – ${fmtD(to)}`;
  const rows = () => lines.map((l) => ({ cells: [codes[l.key] ?? "", l.label, l.base, l.vat] as (string | number | null)[], bold: l.side === "total" }));
  const pdf = async () => {
    try {
      const html = simpleReportHtml({ title: "ДДВ-04 — работен лист", subtitle: sub, settings, head: ["Поле", "Опис", "Основица (ден)", "ДДВ (ден)"], rows: rows(), numCols: [2, 3],
        notes: ["Износите се од книгите на излезни и влезни фактури (во денари по курсот на НБРМ). Броевите на полињата ги потврдува сметководителот.", ...data.warnings.slice(0, 8)] });
      saveBlob(await htmlToPdfBlob(html), `ddv-04-${from}-${to}.pdf`);
    } catch (e: any) { toast.error(e.message); }
  };
  const xlsx = () => downloadXlsx(`ddv-04-${from}-${to}.xlsx`, [{ name: "ДДВ-04", title: [settings?.name ?? "", `ДДВ-04 ${sub}`], header: ["Поле", "Опис", "Основица (ден)", "ДДВ (ден)"],
    rows: rows().map((r) => r.cells), boldRows: lines.map((l, i) => (l.side === "total" ? i : -1)).filter((i) => i >= 0), widths: [8, 80, 18, 18] }]);
  let lastSide = "";
  return (
    <Card><CardContent className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <p className="font-semibold flex items-center gap-2"><ClipboardList className="h-4 w-4 text-amber-600" />ДДВ-04 по полиња</p>
        <div className="flex gap-1.5">
          {edit ? <Button size="sm" className="bg-amber-500 hover:bg-amber-600" disabled={save.isPending} onClick={() => save.mutate({ kind: "vat04", codes })}>Зачувај броеви</Button> : null}
          <Button size="sm" variant="outline" onClick={() => setEdit(!edit)}><Hash className="h-3.5 w-3.5 mr-1.5" />{edit ? "Откажи" : "Броеви на полиња"}</Button>
          <Button size="sm" variant="outline" onClick={xlsx}><Download className="h-3.5 w-3.5 mr-1.5" />Excel</Button>
          <Button size="sm" variant="outline" onClick={pdf}><FileText className="h-3.5 w-3.5 mr-1.5" />PDF</Button>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-gray-500 border-b">
          <th className="text-left font-medium px-3 py-2 w-20">Поле</th><th className="text-left font-medium px-3 py-2">Опис</th>
          <th className="text-right font-medium px-3 py-2 w-36">Основица</th><th className="text-right font-medium px-3 py-2 w-36">ДДВ</th>
        </tr></thead>
        <tbody>
          {lines.map((l) => {
            const head = l.side !== lastSide ? (lastSide = l.side, <tr key={l.side + "_h"} className="bg-gray-50"><td colSpan={4} className="px-3 py-1 text-[11px] uppercase tracking-wider text-gray-500 font-semibold">{SIDE[l.side]}</td></tr>) : null;
            const empty = l.side !== "total" && !l.count;
            return [head, (
              <tr key={l.key} className={`${l.key === "t_pay" ? "bg-amber-50 font-bold" : l.side === "total" ? "font-semibold" : ""} ${empty ? "text-gray-400" : ""} border-b border-gray-100`}>
                <td className="px-3 py-1.5">{edit ? <Input className="h-7 w-16 text-xs" value={codes[l.key] ?? ""} onChange={(e) => setCodes({ ...codes, [l.key]: e.target.value })} /> : <span className="font-mono text-xs text-gray-500">{codes[l.key] ?? ""}</span>}</td>
                <td className="px-3 py-1.5">{l.label}{l.count ? <span className="text-xs text-gray-400"> · {l.count} док.</span> : null}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{l.base === null ? "" : fmt(l.base)}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${l.vat !== null && l.vat < 0 ? "text-emerald-700" : ""}`}>{l.vat === null ? "" : fmt(l.vat)}</td>
              </tr>
            )];
          })}
        </tbody>
      </table>
      <p className="px-4 py-2 text-xs text-gray-500">Износите се префрлаат во соодветните полиња на ДДВ-04 во е-даноци. Првиот пат внеси ги броевите на полињата („Броеви на полиња“) според образецот — се памтат. Книжните одобрувања ја намалуваат основицата во својата стапка.</p>
    </CardContent></Card>
  );
}
