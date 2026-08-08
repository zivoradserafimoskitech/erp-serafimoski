import { useState, useEffect } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { printCertificateStatement } from "@/lib/print-documents";
import { ShieldCheck, Printer, AlertTriangle } from "lucide-react";

const UNIT_MK: Record<string, string> = { kg: "кг", m: "м", m2: "м²", pcs: "ком", l: "л", sheet: "табла" };

export function DnCertificates({
  deliveryNote,
  settings,
  open,
  onOpenChange,
}: {
  deliveryNote: any;
  settings: any;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const dnId = deliveryNote?.id;
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const [saved, setSaved] = useState(false);

  const { data: attached } = trpc.certificates.dnCertList.useQuery(
    { deliveryNoteId: dnId ?? 0 },
    { enabled: open && !!dnId }
  );
  const { data: suggestion, isLoading } = trpc.certificates.dnCertSuggest.useQuery(
    { deliveryNoteId: dnId ?? 0 },
    { enabled: open && !!dnId }
  );

  const setMut = trpc.certificates.dnCertSet.useMutation({
    onSuccess: () => {
      utils.certificates.dnCertList.invalidate();
      setSaved(true);
    },
  });

  // Штиклирај го она што веќе е закачено
  useEffect(() => {
    if (!attached || !suggestion) return;
    const heats = new Set(attached.map((a: any) => `${a.materialId}|${a.heatNumber}`));
    const next: Record<number, boolean> = {};
    for (const l of suggestion.lots as any[]) {
      next[l.id] = heats.has(`${l.materialId}|${l.heatNumber}`);
    }
    setPicked(next);
    setSaved(false);
  }, [attached, suggestion]);

  const lots = (suggestion?.lots ?? []) as any[];
  const selected = lots.filter((l) => picked[l.id]);

  const save = () => {
    if (!dnId) return;
    setMut.mutate({
      deliveryNoteId: dnId,
      entries: selected.map((l) => ({
        lotId: l.id,
        materialId: l.materialId,
        materialName: l.materialName ?? "",
        heatNumber: l.heatNumber ?? "",
        certNumber: l.certNumber ?? "",
        certStandard: l.certStandard ?? "",
        certUrl: l.certUrl ?? "",
        supplierName: l.supplierName ?? "",
        quantity: String(l.quantity ?? "0"),
        unit: l.materialUnit ?? "",
      })),
    });
  };

  const print = () => {
    const source = (attached && attached.length > 0 && !saved)
      ? attached
      : selected.map((l) => ({
          materialName: l.materialName, heatNumber: l.heatNumber,
          certNumber: l.certNumber, certStandard: l.certStandard,
          supplierName: l.supplierName, quantity: l.quantity, unit: l.materialUnit,
        }));
    printCertificateStatement(deliveryNote, source as any[], settings);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-600" />
            Вградени материјали — {deliveryNote?.dnNumber}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-16 text-center text-gray-400">Се бараат партии...</div>
        ) : lots.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto" />
            <p className="text-sm text-gray-600">
              Нема партии со внесена шаржа за материјалите од оваа испорака.
            </p>
            <p className="text-xs text-gray-400 max-w-md mx-auto">
              Шаржата се внесува при потврда на приемница, или дополнително во
              Склад → Атести / шаржи.
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-500">
              Означи ги шаржите што се вградени во оваа испорака. Предложени се сите партии
              од материјалите на испратницата, најстарите први.
            </p>

            <div className="flex-1 overflow-y-auto border rounded-lg">
              <Table>
                <TableHeader className="sticky top-0 bg-white z-10">
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Материјал</TableHead>
                    <TableHead className="w-24">Шаржа</TableHead>
                    <TableHead className="w-32">Атест</TableHead>
                    <TableHead className="w-28">Квалитет</TableHead>
                    <TableHead className="text-right w-24">Примено</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lots.map((l) => (
                    <TableRow key={l.id} className={picked[l.id] ? "bg-blue-50/60" : ""}>
                      <TableCell>
                        <input type="checkbox" checked={!!picked[l.id]}
                          onChange={(e) => { setPicked({ ...picked, [l.id]: e.target.checked }); setSaved(false); }} />
                      </TableCell>
                      <TableCell>
                        <div className="text-sm leading-tight">{l.materialName}</div>
                        <div className="text-[11px] text-gray-400 font-mono">
                          {l.materialCode}{l.receiptNumber ? ` · ${l.receiptNumber}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold text-blue-800">
                        {l.heatNumber ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">{l.certNumber ?? "—"}</TableCell>
                      <TableCell>
                        {l.certStandard ? (
                          <Badge variant="outline" className="text-[10px] border-blue-200 text-blue-700">
                            {l.certStandard}
                          </Badge>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {Number(l.quantity).toLocaleString("mk-MK")}
                        <span className="text-gray-400 ml-1">{UNIT_MK[l.materialUnit] ?? l.materialUnit}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="text-xs text-gray-500">
                {selected.length > 0
                  ? <><b>{selected.length}</b> {selected.length === 1 ? "шаржа означена" : "шаржи означени"}
                      {saved && <span className="text-emerald-600 ml-2">· зачувано</span>}</>
                  : "Ниту една шаржа не е означена"}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Затвори</Button>
                <Button variant="outline" disabled={selected.length === 0 && (attached ?? []).length === 0}
                  onClick={print}>
                  <Printer className="h-4 w-4 mr-2" />Печати изјава
                </Button>
                <Button className="bg-amber-500 hover:bg-amber-600 text-white"
                  disabled={setMut.isPending} onClick={save}>
                  {setMut.isPending ? "Зачувување..." : "Зачувај"}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
