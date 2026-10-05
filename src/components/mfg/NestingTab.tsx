import { useMemo, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { saveBlob } from "@/lib/xlsx";
import { formatDateTime } from "@/lib/utils";
import { Download, Upload, Layers, FileArchive } from "lucide-react";

type SheetRow = { materialId: string; sheets: string; thicknessMm: string; widthMm: string; lengthMm: string; utilization: string; remW: string; remL: string; remQ: string };
const EMPTY: SheetRow = { materialId: "", sheets: "1", thicknessMm: "", widthMm: "1500", lengthMm: "3000", utilization: "", remW: "", remL: "", remQ: "1" };
const csvCell = (v: any) => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/**
 * Нестинг (распоредување на делови на табли) се прави во програмата на машината.
 * Од тука: (1) список на делови + DXF цртежите за програмата, (2) внес на резултатот —
 * колку табли се потрошени (се издаваат на налогот) и кои остатоци останаа (се внесуваат како остатоци).
 */
export default function NestingTab() {
  const utils = trpc.useUtils();
  const { data: wos } = trpc.production.workOrderList.useQuery({});
  const open = useMemo(() => (wos ?? []).filter((w: any) => !["completed", "cancelled"].includes(w.status)), [wos]);
  const [sel, setSel] = useState<number[]>([]);
  const { data: parts } = trpc.mfg.nestingParts.useQuery({ workOrderIds: sel }, { enabled: sel.length > 0 });
  const { data: materials } = trpc.quotation.materialList.useQuery({});
  const { data: jobs } = trpc.mfg.nestingJobs.useQuery();
  const log = trpc.mfg.nestingExportLog.useMutation({ onSuccess: () => utils.mfg.nestingJobs.invalidate() });
  const [jobId, setJobId] = useState<number | null>(null);
  const [woId, setWoId] = useState<string>("");
  const [rows, setRows] = useState<SheetRow[]>([{ ...EMPTY }]);
  const fileRef = useRef<HTMLInputElement>(null);
  const imp = trpc.mfg.nestingImport.useMutation({
    onSuccess: (r) => { toast.success(`Издадено: ${r.issued.map((i: any) => `${i.quantity} ${i.unit} ${i.name}`).join(", ")}${r.remnants.length ? ` · остатоци ${r.remnants.join(", ")}` : ""}`); setRows([{ ...EMPTY }]); utils.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const sheetMats = (materials ?? []).filter((m: any) => /sheet|лим/i.test(`${m.type} ${m.name}`));

  const exportCsv = async () => {
    if (!parts?.parts.length) return;
    const head = ["Дел", "Количина", "Материјал", "Дебелина mm", "Ширина mm", "Висина mm", "Цртеж", "Налог"];
    const body = parts.parts.map((p) => [p.part, p.quantity, p.material, p.thickness, p.widthMm ?? "", p.heightMm ?? "", p.drawing ?? "", p.workOrder]);
    saveBlob(new Blob(["﻿" + [head, ...body].map((r) => r.map(csvCell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" }), `nesting-delovi-${new Date().toISOString().slice(0, 10)}.csv`);
    const r = await log.mutateAsync({ workOrderIds: sel, parts: parts.parts });
    setJobId(r.id);
  };
  const exportZip = async () => {
    if (!parts?.parts.length) return;
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    for (const p of parts.parts) {
      if (!p.drawingId) continue;
      const d = await utils.quotation.drawingGet.fetch({ id: p.drawingId });
      if (d) zip.file(`${p.workOrder.replace(/[^\wа-шА-Ш-]+/g, "_")}_${p.quantity}x_${d.fileName}`, d.dxf);
    }
    saveBlob(await zip.generateAsync({ type: "blob", compression: "DEFLATE" }), `nesting-crtezi-${new Date().toISOString().slice(0, 10)}.zip`);
  };
  /** Увоз на резултат од CSV: материјал(шифра);табли;дебелина;ширина;должина;искористеност;остаток_ширина;остаток_должина;остаток_број */
  const importCsv = async (f: File) => {
    const lines = (await f.text()).replace(/^﻿/, "").split(/\r?\n/).map((l) => l.split(/[;,\t]/).map((x) => x.trim())).filter((l) => l.length >= 5 && l[0]);
    const out: SheetRow[] = [];
    for (const l of lines) {
      if (!/\d/.test(l[1] ?? "")) continue; // наслов
      const m = (materials ?? []).find((x: any) => x.code === l[0] || x.name === l[0]);
      out.push({ materialId: m ? String(m.id) : "", sheets: l[1], thicknessMm: l[2], widthMm: l[3], lengthMm: l[4], utilization: l[5] ?? "", remW: l[6] ?? "", remL: l[7] ?? "", remQ: l[8] || "1" });
    }
    if (!out.length) { toast.error("Не се најдени редови во датотеката"); return; }
    setRows(out);
    if (out.some((r) => !r.materialId)) toast.warning("За некои редови материјалот не е препознаен по шифра — избери го рачно");
  };
  const n = (s: string) => parseFloat(s.replace(",", ".")) || 0;
  const valid = woId && rows.every((r) => r.materialId && n(r.sheets) > 0 && n(r.thicknessMm) > 0 && n(r.widthMm) > 0 && n(r.lengthMm) > 0);

  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4 space-y-3">
        <p className="font-semibold flex items-center gap-2"><Layers className="h-4 w-4 text-amber-600" />1. Делови за распоредување</p>
        <p className="text-xs text-gray-500">Избери ги налозите. Деловите се земаат од ставките во понудата што се направени од DXF цртеж (со дебелина и материјал).</p>
        <div className="flex flex-wrap gap-1.5">
          {open.map((w: any) => (
            <button key={w.id} type="button" onClick={() => setSel(sel.includes(w.id) ? sel.filter((x) => x !== w.id) : [...sel, w.id])}
              className={`rounded-full border px-2.5 py-1 text-xs ${sel.includes(w.id) ? "bg-amber-100 border-amber-400" : "bg-white hover:border-amber-300"}`}>{w.woNumber}</button>
          ))}
          {!open.length && <span className="text-sm text-gray-400">Нема отворени налози</span>}
        </div>
        {parts && (
          parts.parts.length ? (
            <>
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-gray-500 border-b"><th className="text-left font-medium py-1.5">Дел</th><th className="text-right font-medium">Кол.</th><th className="text-left font-medium pl-3">Материјал</th><th className="text-right font-medium">mm</th><th className="text-right font-medium">Габарит</th><th className="text-left font-medium pl-3">Налог</th></tr></thead>
                <tbody>{parts.parts.map((p, i) => (
                  <tr key={i} className="border-b border-gray-100"><td className="py-1.5">{p.part}</td><td className="text-right">{p.quantity}</td><td className="pl-3">{p.material || "—"}</td><td className="text-right">{p.thickness}</td>
                    <td className="text-right text-xs text-gray-500">{p.widthMm ? `${p.widthMm}×${p.heightMm}` : "—"}</td><td className="pl-3 font-mono text-xs">{p.workOrder}</td></tr>
                ))}</tbody>
              </table>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={exportCsv}><Download className="h-3.5 w-3.5 mr-1.5" />Список (CSV)</Button>
                <Button size="sm" variant="outline" onClick={exportZip}><FileArchive className="h-3.5 w-3.5 mr-1.5" />DXF цртежи (ZIP)</Button>
              </div>
            </>
          ) : <p className="text-sm text-gray-400">Избраните налози немаат делови од DXF цртеж.</p>
        )}
      </CardContent></Card>

      <Card><CardContent className="p-4 space-y-3">
        <p className="font-semibold flex items-center gap-2"><Upload className="h-4 w-4 text-amber-600" />2. Резултат од нестинг → издавање и остатоци</p>
        <p className="text-xs text-gray-500">Внеси го резултатот (или вчитај CSV со колони: шифра на материјал; табли; дебелина; ширина; должина; искористеност %; остаток ширина; остаток должина; број остатоци). Таблите се издаваат на налогот (во кг/табли/m² — според единицата на материјалот), а остатоците се внесуваат во „Остатоци“ со своја шифра.</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label className="text-xs">Налог</Label>
            <Select value={woId} onValueChange={setWoId}><SelectTrigger className="h-9 w-48"><SelectValue placeholder="Избери налог" /></SelectTrigger>
              <SelectContent>{open.map((w: any) => <SelectItem key={w.id} value={String(w.id)}>{w.woNumber}</SelectItem>)}</SelectContent></Select>
          </div>
          <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = ""; }} />
          <Button size="sm" variant="outline" className="h-9" onClick={() => fileRef.current?.click()}>Вчитај CSV</Button>
        </div>
        <div className="space-y-1.5">
          <div className="grid grid-cols-[1fr_4rem_4.5rem_5rem_5rem_4.5rem_5rem_5rem_3.5rem] gap-1.5 text-[11px] text-gray-500"><span>Материјал (лим)</span><span>Табли</span><span>Деб. mm</span><span>Шир. mm</span><span>Долж. mm</span><span>Искор. %</span><span>Ост. шир.</span><span>Ост. долж.</span><span>Бр.</span></div>
          {rows.map((r, i) => {
            const u = (p: Partial<SheetRow>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...p } : x)));
            return (
              <div key={i} className="grid grid-cols-[1fr_4rem_4.5rem_5rem_5rem_4.5rem_5rem_5rem_3.5rem] gap-1.5">
                <Select value={r.materialId} onValueChange={(v) => u({ materialId: v })}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Избери" /></SelectTrigger>
                  <SelectContent>{sheetMats.map((m: any) => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}</SelectContent></Select>
                {(["sheets", "thicknessMm", "widthMm", "lengthMm", "utilization", "remW", "remL", "remQ"] as const).map((k) => <Input key={k} className="h-8 text-xs" value={r[k]} onChange={(e) => u({ [k]: e.target.value } as any)} />)}
              </div>
            );
          })}
        </div>
        <div className="flex justify-between">
          <Button size="sm" variant="ghost" onClick={() => setRows([...rows, { ...EMPTY }])}>+ табла</Button>
          <Button size="sm" className="bg-amber-500 hover:bg-amber-600" disabled={!valid || imp.isPending}
            onClick={() => imp.mutate({ jobId: jobId ?? undefined, workOrderId: Number(woId), sheets: rows.map((r) => ({
              materialId: Number(r.materialId), sheets: n(r.sheets), thicknessMm: n(r.thicknessMm), widthMm: n(r.widthMm), lengthMm: n(r.lengthMm), utilization: r.utilization ? n(r.utilization) : undefined,
              remnants: n(r.remW) > 0 && n(r.remL) > 0 ? [{ widthMm: n(r.remW), lengthMm: n(r.remL), quantity: Math.max(1, Math.round(n(r.remQ))) }] : [] })) })}>
            Издај на налогот и внеси остатоци
          </Button>
        </div>
      </CardContent></Card>

      {!!jobs?.length && (
        <Card><CardContent className="p-4 text-sm space-y-1">
          <p className="font-semibold">Историја</p>
          {jobs.map((j) => <p key={j.id} className="text-xs text-gray-600">{formatDateTime(j.createdAt)} · {j.workOrders} · {j.parts} делови · {j.status === "imported" ? `внесен резултат ${formatDateTime(j.importedAt)}` : "извезено, чека резултат"}{j.createdBy ? ` · ${j.createdBy}` : ""}</p>)}
        </CardContent></Card>
      )}
    </div>
  );
}
