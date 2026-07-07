import { useState, useRef } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Search, Plus, Trash2, Eye, FileText, Download, FileUp,
  Receipt, Truck, ArrowUpRight, ArrowDownLeft, Calculator,
} from "lucide-react";

// ===== STATUS CONFIGS =====
const invStatus: Record<string, { label: string; cls: string }> = {
  draft: { label: "Нацрт", cls: "bg-gray-100 text-gray-700" },
  issued: { label: "Издадена", cls: "bg-blue-100 text-blue-700" },
  sent: { label: "Испратена", cls: "bg-amber-100 text-amber-700" },
  paid: { label: "Платена", cls: "bg-emerald-100 text-emerald-700" },
  overdue: { label: "Задоцнета", cls: "bg-red-100 text-red-700" },
  cancelled: { label: "Откажана", cls: "bg-gray-100 text-gray-500" },
};
const incStatus: Record<string, { label: string; cls: string }> = {
  received: { label: "Примена", cls: "bg-blue-100 text-blue-700" },
  verified: { label: "Верифицирана", cls: "bg-emerald-100 text-emerald-700" },
  paid: { label: "Платена", cls: "bg-emerald-100 text-emerald-700" },
  disputed: { label: "Оспорена", cls: "bg-red-100 text-red-700" },
  cancelled: { label: "Откажана", cls: "bg-gray-100 text-gray-500" },
};
const recStatus: Record<string, { label: string; cls: string }> = {
  draft: { label: "Нацрт", cls: "bg-gray-100 text-gray-700" },
  confirmed: { label: "Потврден", cls: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Откажан", cls: "bg-gray-100 text-gray-500" },
};
const dnStatus: Record<string, { label: string; cls: string }> = {
  draft: { label: "Нацрт", cls: "bg-gray-100 text-gray-700" },
  issued: { label: "Издаден", cls: "bg-blue-100 text-blue-700" },
  delivered: { label: "Испорачан", cls: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Откажан", cls: "bg-gray-100 text-gray-500" },
};

// ===== CSV EXPORT =====
function exportCSV(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers.join(";"), ...rows.map(r => r.join(";"))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ===== PDF EXPORT =====
function exportPDF(title: string, headers: string[], rows: (string | number)[][]) {
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text(title, 14, 20);
  doc.setFontSize(10);
  autoTable(doc, { head: [headers], body: rows, startY: 30, theme: "grid" });
  doc.save(`${title.replace(/\s+/g, "_")}.pdf`);
}

export default function Accounting() {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState("outgoing");
  const [search, setSearch] = useState("");

  // Data queries
  const { data: outgoing } = trpc.accounting.invoiceList.useQuery({ search: search || undefined });
  const { data: incoming } = trpc.accounting.incomingInvoiceList.useQuery({ search: search || undefined });
  const { data: receiptsData } = trpc.accounting.receiptList.useQuery({ search: search || undefined });
  const { data: dnData } = trpc.accounting.deliveryNoteList.useQuery({ search: search || undefined });
  const { data: parsedData } = trpc.accounting.parsedInvoiceList.useQuery({});

  // Mutations
  const delOut = trpc.accounting.invoiceDelete.useMutation({ onSuccess: () => utils.accounting.invoiceList.invalidate() });
  const delInc = trpc.accounting.incomingInvoiceDelete.useMutation({ onSuccess: () => utils.accounting.incomingInvoiceList.invalidate() });
  const delRec = trpc.accounting.receiptDelete.useMutation({ onSuccess: () => utils.accounting.receiptList.invalidate() });
  const delDN = trpc.accounting.deliveryNoteDelete.useMutation({ onSuccess: () => utils.accounting.deliveryNoteList.invalidate() });
  const createParsed = trpc.accounting.parsedInvoiceCreate.useMutation({ onSuccess: () => utils.accounting.parsedInvoiceList.invalidate() });

  // Detail dialog
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailType, setDetailType] = useState<"" | "out" | "inc">("");
  const [selId, setSelId] = useState<number | null>(null);
  const { data: outDetail } = trpc.accounting.invoiceById.useQuery({ id: selId! }, { enabled: detailType === "out" && !!selId });
  const { data: incDetail } = trpc.accounting.incomingInvoiceById.useQuery({ id: selId! }, { enabled: detailType === "inc" && !!selId });

  // Dialogs
  const [outDialog, setOutDialog] = useState(false);
  const [incDialog, setIncDialog] = useState(false);
  const [recDialog, setRecDialog] = useState(false);
  const [dnDialog, setDnDialog] = useState(false);
  const [reportDialog, setReportDialog] = useState(false);

  // Forms
  const [outForm, setOutForm] = useState({ invoiceNumber: "", customerId: "", issueDate: "", dueDate: "", subtotal: "0", vatRate: "18", vatAmount: "0", totalAmount: "0", currency: "MKD", notes: "", invoiceType: "standard" as const });
  const [incForm, setIncForm] = useState({ supplierInvoiceNumber: "", supplierId: "", receivedDate: "", issueDate: "", dueDate: "", subtotal: "0", vatRate: "18", vatAmount: "0", totalAmount: "0", currency: "MKD", notes: "" });
  const [recForm, setRecForm] = useState({ receiptNumber: "", supplierId: "", receiptDate: "", totalAmount: "0", notes: "" });
  const [dnForm, setDnForm] = useState({ dnNumber: "", customerId: "", issueDate: "", deliveryDate: "", totalItems: 0, notes: "" });
  const [reportPeriod, setReportPeriod] = useState({ startDate: "", endDate: "" });

  const { data: reportData } = trpc.accounting.accountantReport.useQuery(
    { startDate: reportPeriod.startDate, endDate: reportPeriod.endDate },
    { enabled: reportDialog && !!reportPeriod.startDate && !!reportPeriod.endDate }
  );

  const { data: customers } = trpc.customers.customerList.useQuery({});
  const { data: suppliers } = trpc.procurement.supplierList.useQuery({});

  const createOut = trpc.accounting.invoiceCreate.useMutation({
    onSuccess: () => { utils.accounting.invoiceList.invalidate(); setOutDialog(false); setOutForm({ invoiceNumber: "", customerId: "", issueDate: "", dueDate: "", subtotal: "0", vatRate: "18", vatAmount: "0", totalAmount: "0", currency: "MKD", notes: "", invoiceType: "standard" }); },
  });
  const createInc = trpc.accounting.incomingInvoiceCreate.useMutation({
    onSuccess: () => { utils.accounting.incomingInvoiceList.invalidate(); setIncDialog(false); setIncForm({ supplierInvoiceNumber: "", supplierId: "", receivedDate: "", issueDate: "", dueDate: "", subtotal: "0", vatRate: "18", vatAmount: "0", totalAmount: "0", currency: "MKD", notes: "" }); },
  });
  const createRec = trpc.accounting.receiptCreate.useMutation({
    onSuccess: () => { utils.accounting.receiptList.invalidate(); setRecDialog(false); setRecForm({ receiptNumber: "", supplierId: "", receiptDate: "", totalAmount: "0", notes: "" }); },
  });
  const createDN = trpc.accounting.deliveryNoteCreate.useMutation({
    onSuccess: () => { utils.accounting.deliveryNoteList.invalidate(); setDnDialog(false); setDnForm({ dnNumber: "", customerId: "", issueDate: "", deliveryDate: "", totalItems: 0, notes: "" }); },
  });

  // PDF upload ref
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Parse PDF text using pdf-parse via API
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/parse-pdf", { method: "POST", body: formData });
      const data = await res.json();
      if (data.text) {
        // Extract basic info from text
        const text = data.text;
        const invMatch = text.match(/(?:фактура|invoice)\s*[#:]?\s*(\w+[-\/\d]+)/i);
        const totalMatch = text.match(/(?:вкупно|total|износ)\s*[:]?\s*(\d+[\.,]?\d*)/i);
        createParsed.mutate({
          originalFileName: file.name,
          rawText: text.substring(0, 5000),
          invoiceNumber: invMatch?.[1] || undefined,
          totalAmount: totalMatch?.[1]?.replace(",", ".") || undefined,
        });
      }
    } catch {
      // Fallback: just save filename
      createParsed.mutate({ originalFileName: file.name });
    }
  };

  // Generate UJP e-Invoice XML
  const generateUJPXml = (inv: any) => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="https://ujp.gov.mk/e-faktura">
  <ID>${inv.invoiceNumber}</ID>
  <IssueDate>${inv.issueDate}</IssueDate>
  <InvoiceTypeCode>380</InvoiceTypeCode>
  <DocumentCurrencyCode>${inv.currency || "MKD"}</DocumentCurrencyCode>
  <AccountingSupplierParty>
    <Party>
      <PartyName><Name>Вашата Фирма ДОО</Name></PartyName>
      <CompanyID>MK1234567890</CompanyID>
    </Party>
  </AccountingSupplierParty>
  <AccountingCustomerParty>
    <Party>
      <PartyName><Name>${inv.customerName || ""}</Name></PartyName>
    </Party>
  </AccountingCustomerParty>
  <LegalMonetaryTotal>
    <TaxInclusiveAmount currencyID="${inv.currency || "MKD"}">${inv.totalAmount}</TaxInclusiveAmount>
  </LegalMonetaryTotal>
</Invoice>`;
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `UJP_${inv.invoiceNumber}.xml`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Сметководство</h2>
          <p className="text-gray-500 mt-1">Фактури, приемници, испратници и извештаи</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {tab === "outgoing" && (
            <Dialog open={outDialog} onOpenChange={setOutDialog}>
              <DialogTrigger asChild><Button className="bg-amber-500 hover:bg-amber-600 text-white"><Plus className="h-4 w-4 mr-2" />Нова фактура</Button></DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Нова излезна фактура</DialogTitle></DialogHeader>
                <form onSubmit={(e) => { e.preventDefault(); createOut.mutate({ ...outForm, customerId: parseInt(outForm.customerId), issueDate: outForm.issueDate, dueDate: outForm.dueDate || undefined } as any); }} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Број *</Label><Input value={outForm.invoiceNumber} onChange={(e) => setOutForm({ ...outForm, invoiceNumber: e.target.value })} required /></div>
                    <div className="space-y-2"><Label>Клиент *</Label><Select value={outForm.customerId} onValueChange={(v) => setOutForm({ ...outForm, customerId: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{customers?.map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}</SelectContent></Select></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Датум на издавање *</Label><Input type="date" value={outForm.issueDate} onChange={(e) => setOutForm({ ...outForm, issueDate: e.target.value })} required /></div>
                    <div className="space-y-2"><Label>Датум на плаќање</Label><Input type="date" value={outForm.dueDate} onChange={(e) => setOutForm({ ...outForm, dueDate: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-2"><Label>Износ без ДДВ</Label><Input type="number" step="0.01" value={outForm.subtotal} onChange={(e) => { const s = e.target.value; const v = (parseFloat(s) * 0.18).toFixed(2); const t = (parseFloat(s) * 1.18).toFixed(2); setOutForm({ ...outForm, subtotal: s, vatAmount: v, totalAmount: t }); }} /></div>
                    <div className="space-y-2"><Label>ДДВ %</Label><Input value={outForm.vatRate} disabled /></div>
                    <div className="space-y-2"><Label>Вкупно</Label><Input value={outForm.totalAmount} disabled /></div>
                  </div>
                  <div className="space-y-2"><Label>Белешки</Label><Textarea value={outForm.notes} onChange={(e) => setOutForm({ ...outForm, notes: e.target.value })} /></div>
                  <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600" disabled={createOut.isPending}>{createOut.isPending ? "Зачувување..." : "Креирај фактура"}</Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
          {tab === "incoming" && (
            <Dialog open={incDialog} onOpenChange={setIncDialog}>
              <DialogTrigger asChild><Button className="bg-amber-500 hover:bg-amber-600 text-white"><Plus className="h-4 w-4 mr-2" />Нова влезна фактура</Button></DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Нова влезна фактура</DialogTitle></DialogHeader>
                <form onSubmit={(e) => { e.preventDefault(); createInc.mutate({ ...incForm, supplierId: parseInt(incForm.supplierId), receivedDate: incForm.receivedDate, issueDate: incForm.issueDate || undefined, dueDate: incForm.dueDate || undefined } as any); }} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Број од добавувач *</Label><Input value={incForm.supplierInvoiceNumber} onChange={(e) => setIncForm({ ...incForm, supplierInvoiceNumber: e.target.value })} required /></div>
                    <div className="space-y-2"><Label>Добавувач *</Label><Select value={incForm.supplierId} onValueChange={(v) => setIncForm({ ...incForm, supplierId: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{suppliers?.map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}</SelectContent></Select></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Датум на прием *</Label><Input type="date" value={incForm.receivedDate} onChange={(e) => setIncForm({ ...incForm, receivedDate: e.target.value })} required /></div>
                    <div className="space-y-2"><Label>Датум на фактура</Label><Input type="date" value={incForm.issueDate} onChange={(e) => setIncForm({ ...incForm, issueDate: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-2"><Label>Износ без ДДВ</Label><Input type="number" step="0.01" value={incForm.subtotal} onChange={(e) => { const s = e.target.value; const v = (parseFloat(s) * 0.18).toFixed(2); const t = (parseFloat(s) * 1.18).toFixed(2); setIncForm({ ...incForm, subtotal: s, vatAmount: v, totalAmount: t }); }} /></div>
                    <div className="space-y-2"><Label>ДДВ %</Label><Input value={incForm.vatRate} disabled /></div>
                    <div className="space-y-2"><Label>Вкупно</Label><Input value={incForm.totalAmount} disabled /></div>
                  </div>
                  <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600" disabled={createInc.isPending}>{createInc.isPending ? "Зачувување..." : "Зачувај"}</Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
          {tab === "receipts" && (
            <Dialog open={recDialog} onOpenChange={setRecDialog}>
              <DialogTrigger asChild><Button className="bg-amber-500 hover:bg-amber-600 text-white"><Plus className="h-4 w-4 mr-2" />Нов приемник</Button></DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Нов приемник</DialogTitle></DialogHeader>
                <form onSubmit={(e) => { e.preventDefault(); createRec.mutate({ ...recForm, supplierId: recForm.supplierId ? parseInt(recForm.supplierId) : undefined, receiptDate: recForm.receiptDate } as any); }} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Број *</Label><Input value={recForm.receiptNumber} onChange={(e) => setRecForm({ ...recForm, receiptNumber: e.target.value })} required /></div>
                    <div className="space-y-2"><Label>Добавувач</Label><Select value={recForm.supplierId} onValueChange={(v) => setRecForm({ ...recForm, supplierId: v })}><SelectTrigger><SelectValue placeholder="Избери" /></SelectTrigger><SelectContent>{suppliers?.map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}</SelectContent></Select></div>
                  </div>
                  <div className="space-y-2"><Label>Датум *</Label><Input type="date" value={recForm.receiptDate} onChange={(e) => setRecForm({ ...recForm, receiptDate: e.target.value })} required /></div>
                  <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600" disabled={createRec.isPending}>{createRec.isPending ? "Зачувување..." : "Креирај приемник"}</Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
          {tab === "delivery" && (
            <Dialog open={dnDialog} onOpenChange={setDnDialog}>
              <DialogTrigger asChild><Button className="bg-amber-500 hover:bg-amber-600 text-white"><Plus className="h-4 w-4 mr-2" />Нов испратник</Button></DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Нов испратник</DialogTitle></DialogHeader>
                <form onSubmit={(e) => { e.preventDefault(); createDN.mutate({ ...dnForm, customerId: parseInt(dnForm.customerId), issueDate: dnForm.issueDate, deliveryDate: dnForm.deliveryDate || undefined } as any); }} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Број *</Label><Input value={dnForm.dnNumber} onChange={(e) => setDnForm({ ...dnForm, dnNumber: e.target.value })} required /></div>
                    <div className="space-y-2"><Label>Клиент *</Label><Select value={dnForm.customerId} onValueChange={(v) => setDnForm({ ...dnForm, customerId: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{customers?.map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}</SelectContent></Select></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Датум на издавање *</Label><Input type="date" value={dnForm.issueDate} onChange={(e) => setDnForm({ ...dnForm, issueDate: e.target.value })} required /></div>
                    <div className="space-y-2"><Label>Датум на испорака</Label><Input type="date" value={dnForm.deliveryDate} onChange={(e) => setDnForm({ ...dnForm, deliveryDate: e.target.value })} /></div>
                  </div>
                  <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600" disabled={createDN.isPending}>{createDN.isPending ? "Зачувување..." : "Креирај испратник"}</Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
          <Dialog open={reportDialog} onOpenChange={setReportDialog}>
            <DialogTrigger asChild><Button variant="outline"><Calculator className="h-4 w-4 mr-2" />Извештај за сметководител</Button></DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Извештај за сметководител</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>Од датум</Label><Input type="date" value={reportPeriod.startDate} onChange={(e) => setReportPeriod({ ...reportPeriod, startDate: e.target.value })} /></div>
                  <div className="space-y-2"><Label>До датум</Label><Input type="date" value={reportPeriod.endDate} onChange={(e) => setReportPeriod({ ...reportPeriod, endDate: e.target.value })} /></div>
                </div>
                {reportData && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <Card className="bg-blue-50"><CardContent className="p-4"><p className="text-sm text-gray-600">Излезни фактури</p><p className="text-xl font-bold text-blue-700">{reportData.outgoing.count} ({reportData.outgoing.total} ден.)</p></CardContent></Card>
                      <Card className="bg-emerald-50"><CardContent className="p-4"><p className="text-sm text-gray-600">Влезни фактури</p><p className="text-xl font-bold text-emerald-700">{reportData.incoming.count} ({reportData.incoming.total} ден.)</p></CardContent></Card>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <Card className="bg-amber-50"><CardContent className="p-4"><p className="text-sm text-gray-600">ДДВ излез</p><p className="text-xl font-bold text-amber-700">{reportData.outgoing.totalVat} ден.</p></CardContent></Card>
                      <Card className="bg-purple-50"><CardContent className="p-4"><p className="text-sm text-gray-600">ДДВ влез</p><p className="text-xl font-bold text-purple-700">{reportData.incoming.totalVat} ден.</p></CardContent></Card>
                    </div>
                    <div className="bg-gray-100 p-3 rounded-lg text-center">
                      <span className="text-gray-600">ДДВ салдо: </span>
                      <span className="font-bold text-lg">{reportData.vatBalance} ден.</span>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => exportPDF(`Извештај_${reportData.period.start}_${reportData.period.end}`, ["Тип", "Број", "Износ", "ДДВ"],
                        [...reportData.outgoing.items.map((i: any) => ["Излезна", i.invoiceNumber, i.totalAmount, i.vatAmount]),
                         ...reportData.incoming.items.map((i: any) => ["Влезна", i.supplierInvoiceNumber, i.totalAmount, i.vatAmount])])}>
                        <Download className="h-4 w-4 mr-1" /> PDF
                      </Button>
                      <Button variant="outline" onClick={() => exportCSV(`извештај_${reportData.period.start}_${reportData.period.end}.csv`, ["Тип", "Број", "Износ", "ДДВ", "Датум"],
                        [...reportData.outgoing.items.map((i: any) => ["Излезна", i.invoiceNumber, i.totalAmount, i.vatAmount, i.issueDate ? String(i.issueDate).split("T")[0] : ""]),
                         ...reportData.incoming.items.map((i: any) => ["Влезна", i.supplierInvoiceNumber, i.totalAmount, i.vatAmount, i.receivedDate ? String(i.receivedDate).split("T")[0] : ""])])}>
                        <Download className="h-4 w-4 mr-1" /> CSV
                      </Button>
                      <Button variant="outline" onClick={() => {
                        const allInv = [...(reportData.outgoing.items || []), ...(reportData.incoming.items || [])];
                        exportCSV(`фактури_${reportData.period.start}_${reportData.period.end}.csv`, ["Број", "Клиент/Добавувач", "Износ", "ДДВ", "Вкупно", "Датум"],
                          allInv.map((i: any) => [i.invoiceNumber || i.supplierInvoiceNumber, i.customerName || i.supplierName || "", i.subtotal || i.totalAmount, i.vatAmount, i.totalAmount, i.issueDate || i.receivedDate || ""]));
                      }}>
                        <FileText className="h-4 w-4 mr-1" /> Сите фактури (CSV)
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input placeholder="Пребарувај..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {[
          { key: "outgoing", label: "Излезни фактури", icon: ArrowUpRight },
          { key: "incoming", label: "Влезни фактури", icon: ArrowDownLeft },
          { key: "receipts", label: "Приемници", icon: Receipt },
          { key: "delivery", label: "Испратници", icon: Truck },
          { key: "einvoice", label: "УЈП е-фактури", icon: FileText },
          { key: "parsed", label: "PDF Парсирање", icon: FileUp },
        ].map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-1 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? "border-amber-500 text-amber-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
              <Icon className="h-4 w-4" />{t.label}
            </button>
          );
        })}
      </div>

      {/* ===== OUTGOING INVOICES ===== */}
      {tab === "outgoing" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Број</TableHead><TableHead>Клиент</TableHead><TableHead>Статус</TableHead>
                  <TableHead>Тип</TableHead><TableHead>Износ</TableHead><TableHead>ДДВ</TableHead><TableHead>Датум</TableHead><TableHead>Акции</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!outgoing?.length ? <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-400">Нема фактури</TableCell></TableRow> :
                  outgoing.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-sm font-medium">{inv.invoiceNumber}</TableCell>
                      <TableCell>{inv.customerName} {inv.customerCompany ? `(${inv.customerCompany})` : ""}</TableCell>
                      <TableCell><Badge className={invStatus[inv.status]?.cls}>{invStatus[inv.status]?.label}</Badge></TableCell>
                      <TableCell>{inv.invoiceType === "standard" ? "Стандардна" : inv.invoiceType === "proforma" ? "Проформа" : "Кредитна"}</TableCell>
                      <TableCell className="font-medium">{inv.totalAmount} {inv.currency}</TableCell>
                      <TableCell>{inv.vatAmount}</TableCell>
                      <TableCell className="text-gray-500">{inv.issueDate ? String(inv.issueDate).split("T")[0] : "-"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => { setSelId(inv.id); setDetailType("out"); setDetailOpen(true); }}><Eye className="h-3.5 w-3.5" /></Button>
                          <Button size="sm" variant="outline" onClick={() => generateUJPXml(inv)}><FileText className="h-3.5 w-3.5" /></Button>
                          <Button size="sm" variant="ghost" className="text-red-500" onClick={() => { if (confirm("Дали сте сигурни?")) delOut.mutate({ id: inv.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ===== INCOMING INVOICES ===== */}
      {tab === "incoming" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Број</TableHead><TableHead>Добавувач</TableHead><TableHead>Статус</TableHead>
                  <TableHead>Износ</TableHead><TableHead>ДДВ</TableHead><TableHead>Прием</TableHead><TableHead>Акции</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!incoming?.length ? <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-400">Нема влезни фактури</TableCell></TableRow> :
                  incoming.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-sm font-medium">{inv.supplierInvoiceNumber}</TableCell>
                      <TableCell>{inv.supplierName}</TableCell>
                      <TableCell><Badge className={incStatus[inv.status]?.cls}>{incStatus[inv.status]?.label}</Badge></TableCell>
                      <TableCell className="font-medium">{inv.totalAmount} {inv.currency}</TableCell>
                      <TableCell>{inv.vatAmount}</TableCell>
                      <TableCell className="text-gray-500">{inv.receivedDate ? String(inv.receivedDate).split("T")[0] : "-"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => { setSelId(inv.id); setDetailType("inc"); setDetailOpen(true); }}><Eye className="h-3.5 w-3.5" /></Button>
                          <Button size="sm" variant="ghost" className="text-red-500" onClick={() => { if (confirm("Дали сте сигурни?")) delInc.mutate({ id: inv.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ===== RECEIPTS ===== */}
      {tab === "receipts" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Број</TableHead><TableHead>Добавувач</TableHead><TableHead>Статус</TableHead><TableHead>Датум</TableHead><TableHead>Износ</TableHead><TableHead>Акции</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {!receiptsData?.length ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-400">Нема приемници</TableCell></TableRow> :
                  receiptsData.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-sm font-medium">{r.receiptNumber}</TableCell>
                      <TableCell>{r.supplierName || "-"}</TableCell>
                      <TableCell><Badge className={recStatus[r.status]?.cls}>{recStatus[r.status]?.label}</Badge></TableCell>
                      <TableCell className="text-gray-500">{r.receiptDate ? String(r.receiptDate).split("T")[0] : "-"}</TableCell>
                      <TableCell className="font-medium">{r.totalAmount} ден.</TableCell>
                      <TableCell><Button size="sm" variant="ghost" className="text-red-500" onClick={() => { if (confirm("Дали сте сигурни?")) delRec.mutate({ id: r.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button></TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ===== DELIVERY NOTES ===== */}
      {tab === "delivery" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Број</TableHead><TableHead>Клиент</TableHead><TableHead>Статус</TableHead><TableHead>Датум</TableHead><TableHead>Ставки</TableHead><TableHead>Акции</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {!dnData?.length ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-400">Нема испратници</TableCell></TableRow> :
                  dnData.map((dn) => (
                    <TableRow key={dn.id}>
                      <TableCell className="font-mono text-sm font-medium">{dn.dnNumber}</TableCell>
                      <TableCell>{dn.customerName} {dn.customerCompany ? `(${dn.customerCompany})` : ""}</TableCell>
                      <TableCell><Badge className={dnStatus[dn.status]?.cls}>{dnStatus[dn.status]?.label}</Badge></TableCell>
                      <TableCell className="text-gray-500">{dn.issueDate ? String(dn.issueDate).split("T")[0] : "-"}</TableCell>
                      <TableCell>{dn.totalItems}</TableCell>
                      <TableCell><Button size="sm" variant="ghost" className="text-red-500" onClick={() => { if (confirm("Дали сте сигурни?")) delDN.mutate({ id: dn.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button></TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ===== UJP E-INVOICES ===== */}
      {tab === "einvoice" && (
        <div className="space-y-6">
          <Card>
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold mb-4">УЈП е-фактура систем</h3>
              <div className="space-y-4 text-sm text-gray-600">
                <p>Овој модул овозможува креирање на XML фактури во формат согласно со македонскиот УЈП е-фактура систем.</p>
                <div className="bg-blue-50 p-4 rounded-lg">
                  <h4 className="font-semibold text-blue-800 mb-2">Како да испратите е-фактура:</h4>
                  <ol className="list-decimal list-inside space-y-1 text-blue-700">
                    <li>Креирајте фактура во табот "Излезни фактури"</li>
                    <li>Кликнете на иконата за XML експорт</li>
                    <li>Превземете го XML фајлот</li>
                    <li>Поставете го на УЈП порталот</li>
                  </ol>
                </div>
                <div className="bg-amber-50 p-4 rounded-lg">
                  <h4 className="font-semibold text-amber-800 mb-2">XML формат:</h4>
                  <p className="text-amber-700">Фактурата се генерира во UBL 2.1 Invoice формат (ISO 20022) со македонски УЈП спецификации:</p>
                  <ul className="list-disc list-inside mt-2 text-amber-700 space-y-1">
                    <li>InvoiceTypeCode: 380 (Стандардна фактура)</li>
                    <li>DocumentCurrencyCode: MKD</li>
                    <li>TaxScheme: VAT со стандардна стапка 18%</li>
                    <li>AccountingSupplierParty - податоци за вашата фирма</li>
                    <li>AccountingCustomerParty - податоци за клиентот</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ===== PDF PARSING ===== */}
      {tab === "parsed" && (
        <div className="space-y-6">
          <Card>
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold mb-4">Вчитај фактура од PDF</h3>
              <p className="text-sm text-gray-600 mb-4">Вчитајте PDF фактура за автоматско препознавање на податоците (број на фактура, износ, добавувач).</p>
              <div className="flex gap-3">
                <input type="file" ref={fileRef} accept=".pdf" className="hidden" onChange={handleFileUpload} />
                <Button onClick={() => fileRef.current?.click()} className="bg-amber-500 hover:bg-amber-600">
                  <FileUp className="h-4 w-4 mr-2" />Избери PDF
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Фајл</TableHead><TableHead>Добавувач</TableHead><TableHead>Број</TableHead><TableHead>Износ</TableHead><TableHead>Датум</TableHead><TableHead>Статус</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {!parsedData?.length ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-400">Нема парсирани фактури</TableCell></TableRow> :
                    parsedData.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="max-w-xs truncate">{p.originalFileName}</TableCell>
                        <TableCell>{p.supplierName || "-"}</TableCell>
                        <TableCell className="font-mono text-sm">{p.invoiceNumber || "-"}</TableCell>
                        <TableCell className="font-medium">{p.totalAmount || "-"}</TableCell>
                        <TableCell className="text-gray-500">{p.issueDate ? String(p.issueDate).split("T")[0] : "-"}</TableCell>
                        <TableCell><Badge className={p.status === "imported" ? "bg-emerald-100 text-emerald-700" : p.status === "verified" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"}>
                          {p.status === "imported" ? "Импортирана" : p.status === "verified" ? "Верифицирана" : "Парсирана"}
                        </Badge></TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Детали за фактура</DialogTitle></DialogHeader>
          {detailType === "out" && outDetail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-gray-500">Број:</span> {outDetail.invoiceNumber}</div>
                <div><span className="text-gray-500">Клиент:</span> {outDetail.customer?.name}</div>
                <div><span className="text-gray-500">Статус:</span> <Badge className={invStatus[outDetail.status]?.cls}>{invStatus[outDetail.status]?.label}</Badge></div>
                <div><span className="text-gray-500">Тип:</span> {outDetail.invoiceType}</div>
                <div><span className="text-gray-500">Износ:</span> <span className="font-semibold">{outDetail.totalAmount} {outDetail.currency}</span></div>
                <div><span className="text-gray-500">ДДВ:</span> {outDetail.vatAmount} ({outDetail.vatRate}%)</div>
                <div><span className="text-gray-500">Датум:</span> {outDetail.issueDate ? String(outDetail.issueDate).split("T")[0] : "-"}</div>
                <div><span className="text-gray-500">Рок:</span> {outDetail.dueDate ? String(outDetail.dueDate).split("T")[0] : "-"}</div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button size="sm" variant="outline" onClick={() => generateUJPXml(outDetail)}><FileText className="h-3.5 w-3.5 mr-1" />УЈП XML</Button>
                <Button size="sm" variant="outline" onClick={() => exportPDF(`Фактура_${outDetail.invoiceNumber}`, ["Опис", "Кол", "Цена", "Вкупно"], outDetail.items?.map((i: any) => [i.description, i.quantity, i.unitPrice, i.totalPrice]) || [])}><Download className="h-3.5 w-3.5 mr-1" />PDF</Button>
              </div>
            </div>
          )}
          {detailType === "inc" && incDetail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-gray-500">Број:</span> {incDetail.supplierInvoiceNumber}</div>
                <div><span className="text-gray-500">Добавувач:</span> {incDetail.supplier?.name}</div>
                <div><span className="text-gray-500">Статус:</span> <Badge className={incStatus[incDetail.status]?.cls}>{incStatus[incDetail.status]?.label}</Badge></div>
                <div><span className="text-gray-500">Износ:</span> <span className="font-semibold">{incDetail.totalAmount} {incDetail.currency}</span></div>
                <div><span className="text-gray-500">ДДВ:</span> {incDetail.vatAmount}</div>
                <div><span className="text-gray-500">Прием:</span> {incDetail.receivedDate ? String(incDetail.receivedDate).split("T")[0] : "-"}</div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
