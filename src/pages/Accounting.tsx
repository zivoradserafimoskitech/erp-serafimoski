import { useState, useRef, useEffect } from "react";
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
import { toast } from "sonner";
import { MaterialPicker } from "@/components/MaterialPicker";
import { jsPDF } from "jspdf";
import { printInvoice, printDeliveryNote, printAccountantReport } from "@/lib/print-documents";
import autoTable from "jspdf-autotable";
import {
  Search, Plus, Trash2, Eye, FileText, Download, FileUp,
  Receipt, Truck, ArrowUpRight, ArrowDownLeft, Calculator,
  Radio, RefreshCw, Send, SearchIcon, Upload, Building2, Zap,
  HardHat, Paintbrush, Fuel, ClipboardList, Star, CheckCircle,
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
  const { data: companySettings } = trpc.settings.settingsGet.useQuery();
  const { data: outgoing } = trpc.accounting.invoiceList.useQuery({ search: search || undefined });
  const { data: incoming } = trpc.accounting.incomingInvoiceList.useQuery({ search: search || undefined });
  const { data: receiptsData } = trpc.accounting.receiptList.useQuery({ search: search || undefined });
  const { data: dnData } = trpc.accounting.deliveryNoteList.useQuery({ search: search || undefined });
  const { data: parsedData } = trpc.accounting.parsedInvoiceList.useQuery({});

  // Mutations
  const delOut = trpc.accounting.invoiceDelete.useMutation({ onSuccess: () => utils.accounting.invoiceList.invalidate() });
  const delInc = trpc.accounting.incomingInvoiceDelete.useMutation({ onSuccess: () => utils.accounting.incomingInvoiceList.invalidate() });
  const delRec = trpc.accounting.receiptDelete.useMutation({ onSuccess: () => utils.accounting.receiptList.invalidate() });
  const delDN = trpc.accounting.deliveryNoteDelete.useMutation({ onSuccess: () => { utils.accounting.deliveryNoteList.invalidate(); utils.accounting.finishedGoodsList.invalidate(); } });
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
  const { data: nextReceiptNum } = trpc.settings.nextDocNumber.useQuery({ kind: "receipt" }, { enabled: recDialog });
  const [dnDialog, setDnDialog] = useState(false);
  const { data: nextDeliveryNoteNum } = trpc.settings.nextDocNumber.useQuery({ kind: "deliveryNote" }, { enabled: dnDialog });
  const [reportDialog, setReportDialog] = useState(false);

  // Forms
  const [outForm, setOutForm] = useState({ invoiceNumber: "", customerId: "", issueDate: "", dueDate: "", subtotal: "0", vatRate: "18", vatAmount: "0", totalAmount: "0", currency: "MKD", notes: "", invoiceType: "standard" as const });
  const [outItems, setOutItems] = useState<Array<{
    description: string; quantity: string; unit: string; unitPrice: string;
    discount: string; totalPrice: string; vatRate: string; notes: string;
    productId?: number; serviceId?: number; itemType: "product" | "service" | "manual";
  }>>([]);
  const [incForm, setIncForm] = useState({ supplierInvoiceNumber: "", supplierId: "", receivedDate: "", issueDate: "", dueDate: "", subtotal: "0", vatRate: "18", vatAmount: "0", totalAmount: "0", currency: "MKD", notes: "", pdfBase64: "" });
  const [incItems, setIncItems] = useState<Array<{
    description: string; quantity: string; unit: string; unitPrice: string;
    totalPrice: string; vatRate: string; notes: string;
  }>>([]);
  const [incItemForm, setIncItemForm] = useState({ description: "", quantity: "1", unit: "кг", unitPrice: "", vatRate: "18" });
  const [recForm, setRecForm] = useState({ receiptNumber: "", supplierId: "", receiptDate: "", totalAmount: "0", notes: "" });
  const [dnForm, setDnForm] = useState({ dnNumber: "", customerId: "", issueDate: "", deliveryDate: "", totalItems: 0, notes: "" });
  const [dnItems, setDnItems] = useState<{ description: string; quantity: string; unit: string; productId?: number; itemType?: "product" | "material" | "manual" }[]>([]);
  const { data: materialsData } = trpc.storage.materialList.useQuery({});
  const [reportPeriod, setReportPeriod] = useState({ startDate: "", endDate: "" });
  const [emailSinceDays, setEmailSinceDays] = useState(7);

  // Products & services for invoicing
  const { data: productsForInvoice } = trpc.accounting.productListForInvoice.useQuery();
  const { data: servicesForInvoice } = trpc.accounting.serviceListForInvoice.useQuery();
  const { data: finishedGoods } = trpc.accounting.finishedGoodsList.useQuery();
  // Агрегирана залиха по производ за пикерот во испратницата (id = productId, во името стои расположивата количина)
  const fgAggregated = (() => {
    if (!finishedGoods) return [];
    const byProduct = new Map<number, { id: number; code: string; name: string; unit: string; qty: number }>();
    for (const f of finishedGoods as any[]) {
      if (!f.productId) continue;
      const ex = byProduct.get(f.productId);
      const q = parseFloat(String(f.quantity || "0"));
      if (ex) ex.qty += q;
      else byProduct.set(f.productId, { id: f.productId, code: f.productCode ?? "", name: f.productName ?? f.notes ?? `Производ #${f.productId}`, unit: f.unit ?? "ком", qty: q });
    }
    return Array.from(byProduct.values())
      .filter(p => p.qty > 0)
      .map(p => ({ id: p.id, code: p.code, cleanName: p.name, name: `${p.name} (залиха: ${p.qty.toFixed(3).replace(/\.?0+$/, "")} ${p.unit})`, unit: p.unit, lastPurchasePrice: p.qty }));
  })();
  const { data: nextInvoiceNum, refetch: refetchNextNum } = trpc.accounting.nextInvoiceNumber.useQuery();

  const [reportData, setReportData] = useState<any>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const handleGenerateReport = async () => {
    if (!reportPeriod.startDate || !reportPeriod.endDate) {
      toast.error("Изберете ги двете датуми");
      return;
    }
    setReportLoading(true);
    setReportData(null);
    try {
      const res = await fetch("/api/trpc/accounting.accountantReport?input=" + encodeURIComponent(JSON.stringify({ json: { startDate: reportPeriod.startDate, endDate: reportPeriod.endDate } })));
      const json = await res.json();
      if (json.result?.data?.json) {
        setReportData(json.result.data.json);
        toast.success("Извештајот е генериран");
      } else if (json.error) {
        toast.error(json.error.message || "Грешка при генерирање");
      } else {
        toast.error("Нема податоци за избраниот период");
      }
    } catch (e: any) {
      toast.error(e.message || "Грешка при генерирање");
    } finally {
      setReportLoading(false);
    }
  };

  const { data: customers } = trpc.customers.customerList.useQuery({});
  const { data: suppliers } = trpc.procurement.supplierList.useQuery({});

  const createOut = trpc.accounting.invoiceCreate.useMutation({
    onSuccess: () => { utils.accounting.invoiceList.invalidate(); setOutDialog(false); setOutForm({ invoiceNumber: "", customerId: "", issueDate: "", dueDate: "", subtotal: "0", vatRate: "18", vatAmount: "0", totalAmount: "0", currency: "MKD", notes: "", invoiceType: "standard" }); setOutItems([]); },
    onError: (e) => alert(e.message),
  });
  const createInc = trpc.accounting.incomingInvoiceCreate.useMutation({
    onSuccess: () => { utils.accounting.incomingInvoiceList.invalidate(); setIncDialog(false); setIncForm({ supplierInvoiceNumber: "", supplierId: "", receivedDate: "", issueDate: "", dueDate: "", subtotal: "0", vatRate: "18", vatAmount: "0", totalAmount: "0", currency: "MKD", notes: "", pdfBase64: "" }); setIncItems([]); },
  });
  const createRec = trpc.accounting.receiptCreate.useMutation({
    onSuccess: () => { utils.accounting.receiptList.invalidate(); setRecDialog(false); setRecForm({ receiptNumber: "", supplierId: "", receiptDate: "", totalAmount: "0", notes: "" }); },
  });
  const createDN = trpc.accounting.deliveryNoteCreate.useMutation({
    onSuccess: () => { utils.accounting.deliveryNoteList.invalidate(); utils.accounting.finishedGoodsList.invalidate(); setDnDialog(false); setDnForm({ dnNumber: "", customerId: "", issueDate: "", deliveryDate: "", totalItems: 0, notes: "" }); setDnItems([]); },
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

  useEffect(() => {
    if (outDialog && nextInvoiceNum && !outForm.invoiceNumber) {
      setOutForm(prev => ({ ...prev, invoiceNumber: nextInvoiceNum }));
    }
  }, [outDialog, nextInvoiceNum]);

  useEffect(() => {
    if (recDialog && nextReceiptNum && !recForm.receiptNumber) {
      setRecForm(prev => ({ ...prev, receiptNumber: nextReceiptNum }));
    }
  }, [recDialog, nextReceiptNum]);

  useEffect(() => {
    if (dnDialog && nextDeliveryNoteNum && !dnForm.dnNumber) {
      setDnForm(prev => ({ ...prev, dnNumber: nextDeliveryNoteNum }));
    }
  }, [dnDialog, nextDeliveryNoteNum]);

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
            <Dialog open={outDialog} onOpenChange={(open) => {
              setOutDialog(open);
              if (open) {
                refetchNextNum();
                setTimeout(() => {
                  if (nextInvoiceNum) {
                    setOutForm(prev => ({ ...prev, invoiceNumber: nextInvoiceNum }));
                  }
                }, 100);
              } else {
                setOutItems([]);
              }
            }}>
              <DialogTrigger asChild><Button className="bg-amber-500 hover:bg-amber-600 text-white"><Plus className="h-4 w-4 mr-2" />Нова фактура</Button></DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Нова излезна фактура</DialogTitle></DialogHeader>
                <form onSubmit={(e) => {
                e.preventDefault();
                // Calculate totals from items
                const subtotal = outItems.reduce((s, i) => s + parseFloat(i.totalPrice || "0"), 0);
                const vatAmount = outItems.reduce((s, i) => s + (parseFloat(i.totalPrice || "0") * parseFloat(i.vatRate) / 100), 0);
                const totalAmount = subtotal + vatAmount;
                createOut.mutate({
                  ...outForm,
                  customerId: parseInt(outForm.customerId),
                  issueDate: outForm.issueDate,
                  dueDate: outForm.dueDate || undefined,
                  subtotal: subtotal.toFixed(2),
                  vatAmount: vatAmount.toFixed(2),
                  totalAmount: totalAmount.toFixed(2),
                  items: outItems,
                } as any);
              }} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Број *</Label><Input value={outForm.invoiceNumber} onChange={(e) => setOutForm({ ...outForm, invoiceNumber: e.target.value })} required /></div>
                    <div className="space-y-2"><Label>Клиент *</Label><Select value={outForm.customerId} onValueChange={(v) => setOutForm({ ...outForm, customerId: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{customers?.map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}</SelectContent></Select></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Датум на издавање *</Label><Input type="date" value={outForm.issueDate} onChange={(e) => setOutForm({ ...outForm, issueDate: e.target.value })} required /></div>
                    <div className="space-y-2"><Label>Датум на плаќање</Label><Input type="date" value={outForm.dueDate} onChange={(e) => setOutForm({ ...outForm, dueDate: e.target.value })} /></div>
                  </div>
                  {/* Invoice Items - Products/Services */}
                  <div className="border rounded-lg p-3 space-y-3">
                    <Label className="font-medium">Ставки на фактура</Label>

                    {/* Add Item Form */}
                    <InvoiceItemForm
                      products={productsForInvoice}
                      services={servicesForInvoice}
                      finishedGoods={finishedGoods}
                      onAdd={(item) => {
                        setOutItems([...outItems, item]);
                      }}
                    />

                    {/* Items List */}
                    {outItems.length > 0 && (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Тип</TableHead>
                            <TableHead className="text-xs">Опис</TableHead>
                            <TableHead className="text-xs">Кол</TableHead>
                            <TableHead className="text-xs">Цена</TableHead>
                            <TableHead className="text-xs">Вкупно</TableHead>
                            <TableHead className="w-8"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {outItems.map((item, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="text-xs">
                                {item.itemType === "product" ? <Badge className="bg-blue-100 text-blue-700 text-xs">Производ</Badge> :
                                 item.itemType === "service" ? <Badge className="bg-purple-100 text-purple-700 text-xs">Услуга</Badge> :
                                 <Badge className="bg-gray-100 text-gray-700 text-xs">Рачно</Badge>}
                              </TableCell>
                              <TableCell className="text-xs">{item.description}</TableCell>
                              <TableCell className="text-xs">{item.quantity} {item.unit}</TableCell>
                              <TableCell className="text-xs">{item.unitPrice}</TableCell>
                              <TableCell className="text-xs font-medium">{item.totalPrice}</TableCell>
                              <TableCell>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500" onClick={() => setOutItems(outItems.filter((_, i) => i !== idx))}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}

                    {/* Totals */}
                    {outItems.length > 0 && (
                      <div className="border-t pt-2 space-y-1 text-sm">
                        <div className="flex justify-between"><span className="text-gray-500">Износ без ДДВ:</span><span className="font-medium">{outItems.reduce((s, i) => s + parseFloat(i.totalPrice || "0"), 0).toFixed(2)} ден.</span></div>
                        <div className="flex justify-between"><span className="text-gray-500">ДДВ (18%):</span><span className="font-medium">{outItems.reduce((s, i) => s + (parseFloat(i.totalPrice || "0") * parseFloat(i.vatRate) / 100), 0).toFixed(2)} ден.</span></div>
                        <div className="flex justify-between text-base font-bold"><span>Вкупно:</span><span>{outItems.reduce((s, i) => s + (parseFloat(i.totalPrice || "0") * (1 + parseFloat(i.vatRate) / 100)), 0).toFixed(2)} ден.</span></div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2"><Label>Белешки</Label><Textarea value={outForm.notes} onChange={(e) => setOutForm({ ...outForm, notes: e.target.value })} /></div>
                  <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600" disabled={createOut.isPending || outItems.length === 0}>{createOut.isPending ? "Зачувување..." : outItems.length === 0 ? "Додадете ставки" : "Креирај фактура"}</Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
          {tab === "incoming" && (
            <Dialog open={incDialog} onOpenChange={(open) => {
              setIncDialog(open);
              if (!open) {
                setIncItems([]);
                setIncForm({ supplierInvoiceNumber: "", supplierId: "", receivedDate: "", issueDate: "", dueDate: "", subtotal: "0", vatRate: "18", vatAmount: "0", totalAmount: "0", currency: "MKD", notes: "", pdfBase64: "" });
              }
            }}>
              <DialogTrigger asChild><Button className="bg-amber-500 hover:bg-amber-600 text-white"><Plus className="h-4 w-4 mr-2" />Нова влезна фактура</Button></DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Нова влезна фактура</DialogTitle></DialogHeader>
                <form onSubmit={(e) => {
                  e.preventDefault();
                  const subtotal = incItems.reduce((s, i) => s + parseFloat(i.totalPrice || "0"), 0);
                  const vatAmount = incItems.reduce((s, i) => s + (parseFloat(i.totalPrice || "0") * parseFloat(i.vatRate) / 100), 0);
                  createInc.mutate({
                    ...incForm,
                    supplierId: parseInt(incForm.supplierId),
                    receivedDate: incForm.receivedDate,
                    issueDate: incForm.issueDate || undefined,
                    dueDate: incForm.dueDate || undefined,
                    subtotal: subtotal.toFixed(2),
                    vatAmount: vatAmount.toFixed(2),
                    totalAmount: (subtotal + vatAmount).toFixed(2),
                    items: incItems,
                    fileUrl: incForm.pdfBase64 || undefined,
                  } as any);
                }} className="space-y-4">

                  {/* PDF Upload - Original Invoice */}
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:border-emerald-500 transition-colors cursor-pointer"
                    onClick={() => fileRef.current?.click()}>
                    <Upload className="h-6 w-6 text-gray-400 mx-auto mb-1" />
                    <p className="text-xs font-medium text-gray-600">
                      {incForm.pdfBase64 ? "PDF е прикачен ✓" : "Кликнете за прикачување на оригинална фактура (PDF)"}
                    </p>
                    <input type="file" ref={fileRef} accept=".pdf" className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          const base64 = (ev.target?.result as string)?.split(",")[1] || "";
                          setIncForm({ ...incForm, pdfBase64: base64 });
                        };
                        reader.readAsDataURL(file);
                      }} />
                  </div>

                  {/* Quick Supplier Selection */}
                  <div className="space-y-2">
                    <Label className="text-xs text-gray-500">Најчести добавувачи:</Label>
                    <div className="flex flex-wrap gap-2">
                      {suppliers?.slice(0, 8).map(s => (
                        <Button key={s.id} type="button" size="sm" variant={incForm.supplierId === s.id.toString() ? "default" : "outline"}
                          className="text-xs h-7"
                          onClick={() => setIncForm({ ...incForm, supplierId: s.id.toString() })}>
                          <Building2 className="h-3 w-3 mr-1" />{s.name}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1"><Label>Број од добавувач *</Label><Input value={incForm.supplierInvoiceNumber} onChange={(e) => setIncForm({ ...incForm, supplierInvoiceNumber: e.target.value })} required placeholder="на пр. 1-A-4840" /></div>
                    <div className="space-y-1"><Label>Добавувач *</Label><Select value={incForm.supplierId} onValueChange={(v) => setIncForm({ ...incForm, supplierId: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{suppliers?.map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}</SelectContent></Select></div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1"><Label>Датум на прием *</Label><Input type="date" value={incForm.receivedDate} onChange={(e) => setIncForm({ ...incForm, receivedDate: e.target.value })} required /></div>
                    <div className="space-y-1"><Label>Датум на фактура</Label><Input type="date" value={incForm.issueDate} onChange={(e) => setIncForm({ ...incForm, issueDate: e.target.value })} /></div>
                    <div className="space-y-1"><Label>Рок на плаќање</Label><Input type="date" value={incForm.dueDate} onChange={(e) => setIncForm({ ...incForm, dueDate: e.target.value })} /></div>
                  </div>

                  {/* Invoice Items */}
                  <div className="border rounded-lg p-3 space-y-2">
                    <Label className="font-medium text-sm">Ставки</Label>
                    <div className="grid grid-cols-5 gap-2">
                      <Input className="col-span-2 text-xs" placeholder="Опис на артикл" value={incItemForm.description} onChange={e => setIncItemForm({ ...incItemForm, description: e.target.value })} />
                      <Input className="text-xs" type="number" placeholder="Кол" value={incItemForm.quantity} onChange={e => setIncItemForm({ ...incItemForm, quantity: e.target.value })} />
                      <Input className="text-xs" placeholder="Цена" value={incItemForm.unitPrice} onChange={e => setIncItemForm({ ...incItemForm, unitPrice: e.target.value })} />
                      <Button type="button" size="sm" variant="outline" onClick={() => {
                        if (!incItemForm.description || !incItemForm.unitPrice) return;
                        const qty = parseFloat(incItemForm.quantity || "0");
                        const price = parseFloat(incItemForm.unitPrice || "0");
                        setIncItems([...incItems, {
                          description: incItemForm.description,
                          quantity: incItemForm.quantity,
                          unit: incItemForm.quantity.includes(".") && parseFloat(incItemForm.quantity) > 10 ? "кг" : "ком",
                          unitPrice: incItemForm.unitPrice,
                          totalPrice: (qty * price).toFixed(2),
                          vatRate: incItemForm.vatRate,
                          notes: "",
                        }]);
                        setIncItemForm({ description: "", quantity: "1", unit: "кг", unitPrice: "", vatRate: "18" });
                      }}>Додади</Button>
                    </div>
                    {incItems.length > 0 && (
                      <Table>
                        <TableHeader><TableRow><TableHead className="text-xs">Артикл</TableHead><TableHead className="text-xs">Кол</TableHead><TableHead className="text-xs">Цена</TableHead><TableHead className="text-xs">Вкупно</TableHead><TableHead className="w-8"></TableHead></TableRow></TableHeader>
                        <TableBody>
                          {incItems.map((it, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="text-xs">{it.description}</TableCell>
                              <TableCell className="text-xs">{it.quantity} {it.unit}</TableCell>
                              <TableCell className="text-xs">{it.unitPrice}</TableCell>
                              <TableCell className="text-xs font-medium">{it.totalPrice}</TableCell>
                              <TableCell><Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-red-500" onClick={() => setIncItems(incItems.filter((_, i) => i !== idx))}><Trash2 className="h-3 w-3" /></Button></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>

                  {/* Totals */}
                  {incItems.length > 0 && (
                    <div className="bg-gray-50 p-3 rounded-lg space-y-1 text-sm">
                      <div className="flex justify-between"><span className="text-gray-500">Износ без ДДВ:</span><span className="font-medium">{incItems.reduce((s, i) => s + parseFloat(i.totalPrice || "0"), 0).toFixed(2)} ден.</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">ДДВ (18%):</span><span className="font-medium">{incItems.reduce((s, i) => s + (parseFloat(i.totalPrice || "0") * 0.18), 0).toFixed(2)} ден.</span></div>
                      <div className="flex justify-between text-base font-bold"><span>Вкупно за наплата:</span><span>{incItems.reduce((s, i) => s + (parseFloat(i.totalPrice || "0") * 1.18), 0).toFixed(2)} ден.</span></div>
                    </div>
                  )}

                  <div className="space-y-1"><Label>Белешки</Label><Textarea value={incForm.notes} onChange={(e) => setIncForm({ ...incForm, notes: e.target.value })} /></div>
                  <Button type="submit" className="w-full bg-amber-500 hover:bg-amber-600" disabled={createInc.isPending || !incForm.supplierId}>{createInc.isPending ? "Зачувување..." : "Зачувај влезна фактура"}</Button>
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
                <form onSubmit={(e) => { e.preventDefault(); createDN.mutate({ ...dnForm, customerId: parseInt(dnForm.customerId), issueDate: dnForm.issueDate, deliveryDate: dnForm.deliveryDate || undefined, items: dnItems } as any); }} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Број *</Label><Input value={dnForm.dnNumber} onChange={(e) => setDnForm({ ...dnForm, dnNumber: e.target.value })} required /></div>
                    <div className="space-y-2"><Label>Клиент *</Label><Select value={dnForm.customerId} onValueChange={(v) => setDnForm({ ...dnForm, customerId: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{customers?.map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}</SelectContent></Select></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Датум на издавање *</Label><Input type="date" value={dnForm.issueDate} onChange={(e) => setDnForm({ ...dnForm, issueDate: e.target.value })} required /></div>
                    <div className="space-y-2"><Label>Датум на испорака</Label><Input type="date" value={dnForm.deliveryDate} onChange={(e) => setDnForm({ ...dnForm, deliveryDate: e.target.value })} /></div>
                  </div>
                  <div className="border rounded-lg p-3 space-y-2 bg-gray-50">
                    <p className="text-xs font-semibold">Ставки за испорака</p>
                    <div className="grid grid-cols-2 gap-2">
                      <MaterialPicker tile={{ icon: "🔩", label: "Материјал од магацин" }} title="Избери материјал" materials={materialsData as any} value={null}
                        onSelect={(mm: any) => setDnItems([...dnItems, { description: mm.name, quantity: "1", unit: mm.unit ?? "pcs", itemType: "material" }])} />
                      <MaterialPicker tile={{ icon: "📦", label: "Готов производ" }} title="Избери готов производ" value={null}
                        materials={fgAggregated as any}
                        onSelect={(f: any) => setDnItems([...dnItems, { description: f.cleanName ?? f.name, quantity: "1", unit: f.unit ?? "ком", productId: f.id, itemType: "product" }])} />
                    </div>
                    {dnItems.map((it, i) => (
                      <div key={i} className="grid grid-cols-[1fr_5rem_3rem_2rem] gap-2 items-center bg-white border rounded px-2 py-1">
                        <span className="text-xs truncate">{it.description}</span>
                        <Input className="h-7 text-xs" type="number" step="0.001" value={it.quantity} onChange={e => setDnItems(dnItems.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} />
                        <span className="text-xs text-gray-500">{it.unit}</span>
                        <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500" onClick={() => setDnItems(dnItems.filter((_, j) => j !== i))}>×</Button>
                      </div>
                    ))}
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
                <Button
                  variant="default"
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                  disabled={!reportPeriod.startDate || !reportPeriod.endDate || reportLoading}
                  onClick={handleGenerateReport}
                >
                  {reportLoading ? "Се генерира..." : <><Calculator className="h-4 w-4 mr-2" />Генерирај извештај</>}
                </Button>
                {reportData && <Button variant="outline" onClick={() => printAccountantReport(reportData, reportPeriod, companySettings)}>Печати извештај / PDF</Button>}
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
                      <span className="font-bold text-lg">{reportData.vatRecapitulation.vatBalance} ден.</span>
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
          
          { key: "delivery", label: "Испратници", icon: Truck },
          { key: "einvoice", label: "УЈП е-фактури", icon: FileText },
          { key: "email", label: "Е-маил фактури", icon: Upload },
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
                  <TableHead>Износ</TableHead><TableHead>PDF</TableHead><TableHead>Прием</TableHead><TableHead>Акции</TableHead>
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
                      <TableCell>
                        {inv.fileUrl ? (
                          <Button size="sm" variant="outline" className="text-emerald-600 h-7 text-xs" onClick={() => {
                            const byteCharacters = atob(inv.fileUrl!);
                            const byteNumbers = new Array(byteCharacters.length).fill(0).map((_, i) => byteCharacters.charCodeAt(i));
                            const byteArray = new Uint8Array(byteNumbers);
                            const blob = new Blob([byteArray], { type: "application/pdf" });
                            const url = URL.createObjectURL(blob);
                            window.open(url, "_blank");
                          }}>
                            <FileText className="h-3 w-3 mr-1" /> Оригинал
                          </Button>
                        ) : (
                          <span className="text-gray-400 text-xs">-</span>
                        )}
                      </TableCell>
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
                      <TableCell><div className="flex gap-1"><Button size="sm" variant="outline" onClick={async () => { const full = await utils.accounting.deliveryNoteById.fetch({ id: dn.id }); printDeliveryNote(full, companySettings); }}><Download className="h-3.5 w-3.5 mr-1" />Печати</Button><Button size="sm" variant="ghost" className="text-red-500" onClick={() => { if (confirm("Дали сте сигурни?")) delDN.mutate({ id: dn.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button></div></TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ===== UJP E-INVOICES ===== */}
      {tab === "einvoice" && <UJPEFakturaTab />}

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
                <Button size="sm" variant="outline" onClick={() => printInvoice(outDetail, companySettings)}><Download className="h-3.5 w-3.5 mr-1" />Печати / PDF</Button>
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
              {/* PDF Preview */}
              {incDetail.fileUrl && (
                <div className="border rounded p-2">
                  <p className="text-xs text-gray-500 mb-1">Оригинална фактура (PDF):</p>
                  <Button size="sm" variant="outline" className="text-emerald-600 text-xs" onClick={() => {
                    const byteCharacters = atob(incDetail.fileUrl!);
                    const byteNumbers = new Array(byteCharacters.length).fill(0).map((_, i) => byteCharacters.charCodeAt(i));
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: "application/pdf" });
                    const url = URL.createObjectURL(blob);
                    window.open(url, "_blank");
                  }}>
                    <FileText className="h-3 w-3 mr-1" /> Отвори PDF
                  </Button>
                </div>
              )}
              {/* Items */}
              {incDetail.items && incDetail.items.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Ставки:</p>
                  <Table>
                    <TableHeader><TableRow><TableHead className="text-xs">Артикл</TableHead><TableHead className="text-xs">Кол</TableHead><TableHead className="text-xs">Цена</TableHead><TableHead className="text-xs">Вкупно</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {incDetail.items.map((it: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell className="text-xs">{it.description}</TableCell>
                          <TableCell className="text-xs">{it.quantity} {it.unit}</TableCell>
                          <TableCell className="text-xs">{it.unitPrice}</TableCell>
                          <TableCell className="text-xs font-medium">{it.totalPrice}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===== INVOICE ITEM FORM COMPONENT =====
function InvoiceItemForm({
  products,
  services,
  finishedGoods,
  onAdd,
}: {
  products?: Array<{ id: number; name: string; code: string; unit: string; price: string | null; category: string }>;
  services?: Array<{ id: number; name: string; code: string; unit: string; price: string | null; type: string }>;
  finishedGoods?: Array<{ id: number; productId: number; quantity: string | null; unitCost: string | null }>;
  onAdd: (item: any) => void;
}) {
  const [itemType, setItemType] = useState<"product" | "service" | "manual">("manual");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("ком");
  const [unitPrice, setUnitPrice] = useState("");
  const [vatRate, setVatRate] = useState("18");

  const getStockForProduct = (productId: number) => {
    if (!finishedGoods) return 0;
    return finishedGoods
      .filter(fg => fg.productId === productId)
      .reduce((sum, fg) => sum + parseFloat(String(fg.quantity || "0")), 0);
  };

  const handleAdd = () => {
    let finalDescription = description;
    let finalUnitPrice = unitPrice;
    let finalUnit = unit;
    let productId: number | undefined;
    let serviceId: number | undefined;

    if (itemType === "product" && selectedProductId) {
      const product = products?.find(p => p.id.toString() === selectedProductId);
      if (!product) return;
      productId = product.id;
      finalDescription = product.name;
      finalUnit = product.unit || "ком";
      if (!unitPrice) finalUnitPrice = product.price || "0";

      // Check stock
      const stock = getStockForProduct(product.id);
      if (stock < parseFloat(quantity || "0")) {
        alert(`Нема доволно залиха! На залиха: ${stock.toFixed(2)}, побарано: ${parseFloat(quantity || "0").toFixed(2)}`);
        return;
      }
    } else if (itemType === "service" && selectedServiceId) {
      const service = services?.find(s => s.id.toString() === selectedServiceId);
      if (!service) return;
      serviceId = service.id;
      finalDescription = service.name;
      finalUnit = service.unit || "час";
      if (!unitPrice) finalUnitPrice = service.price || "0";
    }

    const qty = parseFloat(quantity || "0");
    const price = parseFloat(finalUnitPrice || "0");
    const total = qty * price;

    onAdd({
      description: finalDescription,
      quantity: quantity,
      unit: finalUnit,
      unitPrice: finalUnitPrice || "0",
      discount: "0",
      totalPrice: total.toFixed(2),
      vatRate: vatRate,
      notes: "",
      productId,
      serviceId,
      itemType,
    });

    // Reset form
    setSelectedProductId("");
    setSelectedServiceId("");
    setDescription("");
    setQuantity("1");
    setUnitPrice("");
  };

  return (
    <div className="space-y-2">
      {/* Item Type Selector */}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={itemType === "product" ? "default" : "outline"}
          onClick={() => setItemType("product")}
          className={itemType === "product" ? "bg-blue-500" : ""}
        >
          Производ (склад)
        </Button>
        <Button
          type="button"
          size="sm"
          variant={itemType === "service" ? "default" : "outline"}
          onClick={() => setItemType("service")}
          className={itemType === "service" ? "bg-purple-500" : ""}
        >
          Услуга
        </Button>
        <Button
          type="button"
          size="sm"
          variant={itemType === "manual" ? "default" : "outline"}
          onClick={() => setItemType("manual")}
          className={itemType === "manual" ? "bg-gray-500" : ""}
        >
          Рачен опис
        </Button>
      </div>

      {/* Product Selector */}
      {itemType === "product" && (
        <div className="space-y-2">
          <Select value={selectedProductId} onValueChange={(v) => {
            setSelectedProductId(v);
            const product = products?.find(p => p.id.toString() === v);
            if (product) {
              setDescription(product.name);
              setUnit(product.unit || "ком");
              setUnitPrice(product.price || "");
            }
          }}>
            <SelectTrigger><SelectValue placeholder="Избери производ..." /></SelectTrigger>
            <SelectContent>
              {products?.map(p => {
                const stock = getStockForProduct(p.id);
                return (
                  <SelectItem key={p.id} value={p.id.toString()}>
                    {p.name} ({p.code}) - {stock.toFixed(2)} {p.unit} на залиха
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {selectedProductId && (
            <p className="text-xs text-blue-600">
              На залиха: {getStockForProduct(parseInt(selectedProductId)).toFixed(2)} {unit}
            </p>
          )}
        </div>
      )}

      {/* Service Selector */}
      {itemType === "service" && (
        <div className="space-y-2">
          <Select value={selectedServiceId} onValueChange={(v) => {
            setSelectedServiceId(v);
            const service = services?.find(s => s.id.toString() === v);
            if (service) {
              setDescription(service.name);
              setUnit(service.unit || "час");
              setUnitPrice(service.price || "");
            }
          }}>
            <SelectTrigger><SelectValue placeholder="Избери услуга..." /></SelectTrigger>
            <SelectContent>
              {services?.map(s => (
                <SelectItem key={s.id} value={s.id.toString()}>
                  {s.name} ({s.code}) - {s.price ?? "?"} ден./{s.unit}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Manual Description */}
      {itemType === "manual" && (
        <Input placeholder="Опис на ставка" value={description} onChange={e => setDescription(e.target.value)} />
      )}

      {/* Quantity & Price */}
      <div className="grid grid-cols-4 gap-2">
        <Input type="number" placeholder="Количина" value={quantity} onChange={e => setQuantity(e.target.value)} />
        <Input placeholder="Единица" value={unit} onChange={e => setUnit(e.target.value)} />
        <Input type="number" placeholder="Цена" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} />
        <Select value={vatRate} onValueChange={setVatRate}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="18">18% ДДВ</SelectItem>
            <SelectItem value="5">5% ДДВ</SelectItem>
            <SelectItem value="0">0% ДДВ</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button type="button" size="sm" variant="outline" onClick={handleAdd} disabled={!description || !quantity || !unitPrice}>
        <Plus className="h-3 w-3 mr-1" /> Додади ставка
      </Button>
    </div>
  );
}

// ===== UJP E-FAKTURA TAB COMPONENT =====
function UJPEFakturaTab() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [sendDialog, setSendDialog] = useState(false);
  const [statusDialog, setStatusDialog] = useState(false);
  const [xmlDialog, setXmlDialog] = useState(false);
  const [selInvoiceId, setSelInvoiceId] = useState<number | null>(null);
  const [euidCheck, setEuidCheck] = useState("");
  const [xmlContent, setXmlContent] = useState("");
  const [selectedCertId, setSelectedCertId] = useState<string>("");

  // Company lookup
  const [edbSearch, setEdbSearch] = useState("");
  const { data: companyData } = trpc.accounting.ujpCompanyLookup.useQuery(
    { edb: edbSearch },
    { enabled: edbSearch.length >= 5 }
  );

  // Invoice list for UJP
  const { data: ujpInvoices } = trpc.accounting.ujpInvoiceList.useQuery({ search: search || undefined });

  // Active certificates for signing
  const { data: certificates } = trpc.accounting.certificateList.useQuery();

  // Email invoices
  const { data: emailConfig } = trpc.email.hasConfig.useQuery();
  const [emailForm, setEmailForm] = useState({ host: "", port: "993", username: "", password: "" });
  const saveEmailCfg = trpc.email.saveConfig.useMutation({ onSuccess: () => { toast.success("Е-маил конфигурацијата е зачувана"); utils.email.hasConfig.invalidate(); } });
  const { data: emailInvoicesList, refetch: refetchEmail } = trpc.email.list.useQuery();
  const fetchEmailsMutation = trpc.email.fetchEmails.useMutation({
    onSuccess: (data) => {
      refetchEmail();
      alert(data.message);
    },
    onError: (e) => alert(e.message),
  });
  const matchSupplierMutation = trpc.email.matchSupplier.useMutation({
    onSuccess: () => refetchEmail(),
  });
  const approveEmailMutation = trpc.email.approve.useMutation({
    onSuccess: () => refetchEmail(),
  });
  const rejectEmailMutation = trpc.email.reject.useMutation({
    onSuccess: () => refetchEmail(),
  });
  const deleteEmailMutation = trpc.email.delete.useMutation({
    onSuccess: () => refetchEmail(),
  });

  // Send form
  const [sendForm, setSendForm] = useState({
    sellerEdb: "", sellerName: "", sellerAddress: "", sellerCity: "", sellerVatNumber: "",
    buyerEdb: "", buyerName: "", buyerAddress: "", buyerCity: "", buyerVatNumber: "",
  });

  // Status check
  const { data: statusData, refetch: refetchStatus } = trpc.accounting.ujpCheckStatus.useQuery(
    { euid: euidCheck },
    { enabled: false }
  );

  const sendMutation = trpc.accounting.ujpSendInvoice.useMutation({
    onSuccess: () => {
      utils.accounting.ujpInvoiceList.invalidate();
      setSendDialog(false);
    },
  });

  const xmlMutation = trpc.accounting.ujpGenerateXml.useQuery(
    { invoiceId: selInvoiceId! },
    { enabled: false }
  );

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selInvoiceId) return;
    const payload: any = {
      invoiceId: selInvoiceId,
      ...sendForm,
    };
    if (selectedCertId && selectedCertId !== "test") {
      payload.certId = parseInt(selectedCertId);
    }
    sendMutation.mutate(payload);
  };

  const handleGenerateXml = async (invoiceId: number) => {
    setSelInvoiceId(invoiceId);
    const result = await xmlMutation.refetch();
    if (result.data) {
      setXmlContent(result.data);
      setXmlDialog(true);
    }
  };

  const handleDownloadXml = () => {
    const blob = new Blob([xmlContent], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `UJP_Faktura_${selInvoiceId}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Info Card */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Radio className="h-5 w-5 text-blue-600" />
            <h3 className="text-lg font-semibold">УЈП е-Фактура Интеграција</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="bg-blue-50 p-3 rounded-lg">
              <h4 className="font-semibold text-blue-800 mb-1">API Ендпоинт</h4>
              <p className="text-blue-700 text-xs">efakturatest.ujp.gov.mk</p>
              <p className="text-blue-600 text-xs mt-1">/JSONReceiver/sales-invoices/send</p>
            </div>
            <div className="bg-emerald-50 p-3 rounded-lg">
              <h4 className="font-semibold text-emerald-800 mb-1">Формат</h4>
              <p className="text-emerald-700 text-xs">JSON со JWS потпис</p>
              <p className="text-emerald-600 text-xs mt-1">UBL 2.1 Invoice (ISO 20022)</p>
            </div>
            <div className="bg-amber-50 p-3 rounded-lg">
              <h4 className="font-semibold text-amber-800 mb-1">Статуси</h4>
              <p className="text-amber-700 text-xs">00=Нацрт, 01=Поднесена</p>
              <p className="text-amber-600 text-xs">03=Прифатена, 05=Одбиена, 07=Анулирана</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Company Lookup */}
      <Card>
        <CardContent className="p-6">
          <h4 className="font-semibold mb-3 flex items-center gap-2"><SearchIcon className="h-4 w-4" />Пребарување компанија по ЕДБ</h4>
          <div className="flex gap-3">
            <Input placeholder="Внеси ЕДБ (на пр. 1234567890123)" value={edbSearch} onChange={e => setEdbSearch(e.target.value)} className="max-w-sm" />
          </div>
          {companyData && (
            <div className="mt-3 p-3 bg-gray-50 rounded-lg text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-gray-500">Назив:</span> <b>{companyData.name}</b></div>
                <div><span className="text-gray-500">ЕДБ:</span> {companyData.edb}</div>
                <div><span className="text-gray-500">Адреса:</span> {companyData.address}</div>
                <div><span className="text-gray-500">Град:</span> {companyData.city}</div>
                <div><span className="text-gray-500">ДДВ:</span> {companyData.vatRegistered ? "Регистриран" : "Нерегистриран"}</div>
              </div>
            </div>
          )}
          {companyData === null && edbSearch.length >= 5 && (
            <p className="mt-2 text-sm text-red-500">Компанијата не е пронајдена</p>
          )}
        </CardContent>
      </Card>

      {/* Invoices Ready for UJP */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input placeholder="Пребарувај фактури..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Број</TableHead><TableHead>Клиент</TableHead><TableHead>Износ</TableHead>
                <TableHead>УЈП ID</TableHead><TableHead>Акции</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!ujpInvoices?.length ? <TableRow><TableCell colSpan={5} className="text-center py-8 text-gray-400">Нема фактури</TableCell></TableRow> :
                ujpInvoices.map(inv => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-sm font-medium">{inv.invoiceNumber}</TableCell>
                    <TableCell>{inv.customerName} {inv.customerCompany ? `(${inv.customerCompany})` : ""}</TableCell>
                    <TableCell className="font-medium">{inv.totalAmount} {inv.currency}</TableCell>
                    <TableCell>{inv.eInvoiceId ? <Badge className="bg-emerald-100 text-emerald-700">{inv.eInvoiceId.substring(0, 8)}...</Badge> : <Badge className="bg-gray-100 text-gray-500">Неиспратена</Badge>}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {!inv.eInvoiceId && (
                          <Button size="sm" variant="outline" className="text-blue-600" onClick={() => { setSelInvoiceId(inv.id); setSendDialog(true); }}>
                            <Send className="h-3.5 w-3.5 mr-1" />Испрати до УЈП
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => handleGenerateXml(inv.id)}>
                          <FileText className="h-3.5 w-3.5 mr-1" />XML
                        </Button>
                        {inv.eInvoiceId && (
                          <Button size="sm" variant="outline" className="text-emerald-600" onClick={() => { setEuidCheck(inv.eInvoiceId!); setStatusDialog(true); }}>
                            <RefreshCw className="h-3.5 w-3.5 mr-1" />Статус
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Send Dialog */}
      <Dialog open={sendDialog} onOpenChange={setSendDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Испрати фактура до УЈП</DialogTitle></DialogHeader>
          <form onSubmit={handleSend} className="space-y-3">
            <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-700 mb-2">
              <b>Продавач (Вашата фирма):</b>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>ЕДБ *</Label><Input value={sendForm.sellerEdb} onChange={e => setSendForm({ ...sendForm, sellerEdb: e.target.value })} required placeholder="MK1234567890123" /></div>
              <div className="space-y-2"><Label>Назив *</Label><Input value={sendForm.sellerName} onChange={e => setSendForm({ ...sendForm, sellerName: e.target.value })} required /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Адреса</Label><Input value={sendForm.sellerAddress} onChange={e => setSendForm({ ...sendForm, sellerAddress: e.target.value })} /></div>
              <div className="space-y-2"><Label>Град</Label><Input value={sendForm.sellerCity} onChange={e => setSendForm({ ...sendForm, sellerCity: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>ДДВ број</Label><Input value={sendForm.sellerVatNumber} onChange={e => setSendForm({ ...sendForm, sellerVatNumber: e.target.value })} /></div>

            <div className="bg-amber-50 p-3 rounded-lg text-sm text-amber-700 mb-2 mt-4">
              <b>Купувач (Клиент):</b>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>ЕДБ *</Label><Input value={sendForm.buyerEdb} onChange={e => setSendForm({ ...sendForm, buyerEdb: e.target.value })} required /></div>
              <div className="space-y-2"><Label>Назив *</Label><Input value={sendForm.buyerName} onChange={e => setSendForm({ ...sendForm, buyerName: e.target.value })} required /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Адреса</Label><Input value={sendForm.buyerAddress} onChange={e => setSendForm({ ...sendForm, buyerAddress: e.target.value })} /></div>
              <div className="space-y-2"><Label>Град</Label><Input value={sendForm.buyerCity} onChange={e => setSendForm({ ...sendForm, buyerCity: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>ДДВ број</Label><Input value={sendForm.buyerVatNumber} onChange={e => setSendForm({ ...sendForm, buyerVatNumber: e.target.value })} /></div>

            {/* Certificate Selection */}
            <div className="space-y-2 border-t pt-3">
              <Label className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-amber-600" />
                Дигитален сертификат за потпис *
              </Label>
              <Select value={selectedCertId} onValueChange={setSelectedCertId}>
                <SelectTrigger>
                  <SelectValue placeholder="Избери сертификат..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="test">
                    🧪 Тест режим (без правна важност)
                  </SelectItem>
                  {certificates?.map(cert => (
                    <SelectItem key={cert.id} value={cert.id.toString()}>
                      🔐 {cert.name} ({cert.issuer}) - до {cert.validTo ? new Date(cert.validTo).toLocaleDateString("mk-MK") : "?"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {certificates && certificates.length === 0 && (
                <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
                  Нема зачувани сертификати. За да испраќате фактури со правна важност,
                  додадете квалификуван дигитален сертификат во Подесувања → Сертификати.
                </p>
              )}
            </div>

            <Button type="submit" className="w-full bg-blue-500 hover:bg-blue-600" disabled={sendMutation.isPending}>
              {sendMutation.isPending ? "Испраќање..." : selectedCertId && selectedCertId !== "test" ? "Испрати до УЈП (Потпишано)" : "Испрати до УЈП (Тест режим)"}
            </Button>
            {sendMutation.data && (
              <div className={`p-3 rounded-lg text-sm ${sendMutation.data.status === 200 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                <b>{sendMutation.data.status === 200 ? "Успешно!" : "Грешка:"}</b> {sendMutation.data.message}
                {sendMutation.data.euid && <div className="mt-1">EUID: {sendMutation.data.euid}</div>}
                {sendMutation.data.qr_link && <div className="mt-1"><a href={sendMutation.data.qr_link} target="_blank" rel="noopener noreferrer" className="underline">QR Линк</a></div>}
                {selectedCertId === "test" && sendMutation.data.status === 200 && (
                  <div className="mt-2 text-amber-600 text-xs">
                    ⚠️ Ова е тест режим - фактурата нема правна важност. За реално испраќање, користете квалификуван сертификат.
                  </div>
                )}
              </div>
            )}
          </form>
        </DialogContent>
      </Dialog>

      {/* Status Dialog */}
      <Dialog open={statusDialog} onOpenChange={setStatusDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Проверка статус на УЈП фактура</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input value={euidCheck} onChange={e => setEuidCheck(e.target.value)} placeholder="Внеси EUID" />
              <Button variant="outline" onClick={() => refetchStatus()}><RefreshCw className="h-4 w-4" /></Button>
            </div>
            {statusData && (
              <div className="bg-gray-50 p-4 rounded-lg text-sm space-y-2">
                <div><span className="text-gray-500">EUID:</span> {statusData.euid}</div>
                <div><span className="text-gray-500">Број:</span> {statusData.invoiceNumber}</div>
                <div><span className="text-gray-500">Статус:</span> <Badge className={
                  statusData.status === "03" ? "bg-emerald-100 text-emerald-700" :
                  statusData.status === "05" ? "bg-red-100 text-red-700" :
                  statusData.status === "01" ? "bg-blue-100 text-blue-700" :
                  "bg-gray-100 text-gray-700"
                }>{statusData.statusLabel}</Badge></div>
                <div><span className="text-gray-500">Време:</span> {statusData.timestamp}</div>
                {statusData.rejectionReason && <div className="text-red-600"><span className="text-gray-500">Причина:</span> {statusData.rejectionReason}</div>}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ===== EMAIL INVOICES ===== */}
      {tab === "email" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Upload className="h-5 w-5 text-emerald-700" />
                    Е-маил фактури
                  </CardTitle>
                  <p className="text-sm text-gray-500 mt-1">
                    Автоматско примање на влезни фактури од е-маил
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={emailSinceDays.toString()} onValueChange={(v) => setEmailSinceDays(parseInt(v))}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 ден</SelectItem>
                      <SelectItem value="3">3 дена</SelectItem>
                      <SelectItem value="7">7 дена</SelectItem>
                      <SelectItem value="14">14 дена</SelectItem>
                      <SelectItem value="30">30 дена</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => fetchEmailsMutation.mutate({ sinceDays: emailSinceDays })}
                    disabled={fetchEmailsMutation.isPending}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {fetchEmailsMutation.isPending ? "Се проверува..." : <><RefreshCw className="h-4 w-4 mr-1" />Провери е-маил</>}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!emailConfig?.configured && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 space-y-3">
                  <p className="text-sm text-amber-800"><b>Конфигурирај е-маил</b> (IMAP) за автоматско примање на фактури од добавувачи:</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="IMAP сервер (пр. imap.gmail.com)" value={emailForm.host} onChange={e => setEmailForm({...emailForm, host: e.target.value})} />
                    <Input placeholder="Порта (993)" value={emailForm.port} onChange={e => setEmailForm({...emailForm, port: e.target.value})} />
                    <Input placeholder="Е-маил адреса" value={emailForm.username} onChange={e => setEmailForm({...emailForm, username: e.target.value})} />
                    <Input type="password" placeholder="Лозинка / App password" value={emailForm.password} onChange={e => setEmailForm({...emailForm, password: e.target.value})} />
                  </div>
                  <Button size="sm" className="bg-amber-500 hover:bg-amber-600" disabled={!emailForm.host || !emailForm.username || !emailForm.password || saveEmailCfg.isPending}
                    onClick={() => saveEmailCfg.mutate({ host: emailForm.host, port: Number(emailForm.port) || 993, secure: true, username: emailForm.username, password: emailForm.password })}>
                    Зачувај конфигурација
                  </Button>
                </div>
              )}
              {emailConfig?.configured && (
                <p className="text-xs text-emerald-600 mb-4">
                  Поврзано со: {emailConfig.username}
                </p>
              )}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Наслов</TableHead>
                    <TableHead className="text-xs">Испраќач</TableHead>
                    <TableHead className="text-xs">PDF</TableHead>
                    <TableHead className="text-xs">Добавувач</TableHead>
                    <TableHead className="text-xs">Статус</TableHead>
                    <TableHead className="text-xs">Датум</TableHead>
                    <TableHead className="text-xs text-right">Акции</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!emailInvoicesList?.length ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-gray-500 py-8">
                        Нема примени е-маил фактури. Кликнете "Провери е-маил" за да ги повлечете.
                      </TableCell>
                    </TableRow>
                  ) : (
                    emailInvoicesList.map((ei) => (
                      <TableRow key={ei.id}>
                        <TableCell className="text-xs max-w-[200px] truncate" title={ei.subject || ""}>{ei.subject || "-"}</TableCell>
                        <TableCell className="text-xs">{ei.senderName || ei.senderEmail || "-"}</TableCell>
                        <TableCell className="text-xs">
                          {ei.pdfFilename ? (
                            <Badge className="bg-red-100 text-red-700 text-xs">
                              <FileText className="h-3 w-3 mr-1" />PDF
                            </Badge>
                          ) : "-"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {ei.matchedSupplierId ? (
                            <span className="text-emerald-700 font-medium">{ei.parsedSupplierName}</span>
                          ) : ei.status === "new" ? (
                            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => matchSupplierMutation.mutate({ id: ei.id })}>
                              <Search className="h-3 w-3 mr-1" />Match
                            </Button>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge className={
                            ei.status === "imported" ? "bg-emerald-100 text-emerald-700 text-xs" :
                            ei.status === "reviewed" ? "bg-blue-100 text-blue-700 text-xs" :
                            ei.status === "parsed" ? "bg-yellow-100 text-yellow-700 text-xs" :
                            ei.status === "rejected" ? "bg-red-100 text-red-700 text-xs" :
                            "bg-gray-100 text-gray-700 text-xs"
                          }>
                            {ei.status === "new" ? "Нова" :
                             ei.status === "parsed" ? "Парсирана" :
                             ei.status === "reviewed" ? "Прегледана" :
                             ei.status === "imported" ? "Увезена" :
                             "Одбиена"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{ei.receivedAt ? new Date(ei.receivedAt).toLocaleDateString("mk-MK") : "-"}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {ei.pdfBase64 && (
                              <Button size="sm" variant="outline" className="h-6 text-xs text-emerald-600" onClick={() => {
                                const byteCharacters = atob(ei.pdfBase64!);
                                const byteNumbers = new Array(byteCharacters.length).fill(0).map((_, i) => byteCharacters.charCodeAt(i));
                                const byteArray = new Uint8Array(byteNumbers);
                                const blob = new Blob([byteArray], { type: "application/pdf" });
                                const url = URL.createObjectURL(blob);
                                window.open(url, "_blank");
                              }}>
                                <Eye className="h-3 w-3" />
                              </Button>
                            )}
                            {ei.status === "new" || ei.status === "parsed" ? (
                              <Button size="sm" variant="outline" className="h-6 text-xs text-amber-600" onClick={() => {
                                if (ei.matchedSupplierId) {
                                  if (confirm("Креирај влезна фактура од оваа email фактура?")) {
                                    approveEmailMutation.mutate({
                                      id: ei.id,
                                      supplierId: ei.matchedSupplierId!,
                                      supplierInvoiceNumber: ei.parsedInvoiceNumber || "",
                                      totalAmount: ei.parsedTotalAmount || "",
                                    });
                                  }
                                } else {
                                  alert("Прво извршете Match за да се пронајде добавувачот.");
                                }
                              }}>
                                <CheckCircle className="h-3 w-3 mr-1" />Увези
                              </Button>
                            ) : null}
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500" onClick={() => { if (confirm("Дали сте сигурни?")) deleteEmailMutation.mutate({ id: ei.id }); }}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* XML Dialog */}
      <Dialog open={xmlDialog} onOpenChange={setXmlDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>УЈП XML Фактура</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Textarea value={xmlContent} readOnly className="font-mono text-xs h-96" />
            <Button onClick={handleDownloadXml} className="w-full bg-amber-500 hover:bg-amber-600">
              <Download className="h-4 w-4 mr-2" />Превземи XML
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
