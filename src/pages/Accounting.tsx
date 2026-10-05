import { DateInput } from "@/components/ui/date-input";
import { openStoredFile } from "@/lib/stored-file";
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
import ListLimitNote from "@/components/ListLimitNote";
import { MaterialPicker } from "@/components/MaterialPicker";
import { printInvoice, printDeliveryNote, invoiceHtml } from "@/lib/print-documents";
import SendEmailDialog from "@/components/SendEmailDialog";
import { EXPENSE_CHOICES } from "@contracts/finance";
import IncomingAccountPicker from "@/components/IncomingAccountPicker";
import IncomingAccountReview from "@/components/IncomingAccountReview";
import { useSearchParams, useNavigate } from "react-router";
import { formatDate } from "@/lib/utils";
import AccountantPackActions from "@/components/AccountantPackActions";
import { DnCertificates } from "@/components/DnCertificates";
import InvoiceItemForm from "./accounting/InvoiceItemForm";
import UJPEFakturaTab from "./accounting/UJPEFakturaTab";
import EmailInvoicesTab from "./accounting/EmailInvoicesTab";
import { Search, Plus, Trash2, Eye, FileText, Download, FileUp, Truck, ArrowUpRight, ArrowDownLeft, Calculator, Upload, Building2, ShieldCheck, Undo2, BarChart3 } from "lucide-react";

// ===== STATUS CONFIGS =====
const invStatus: Record<string, { label: string; cls: string }> = {
  draft: { label: "Нацрт", cls: "bg-gray-100 text-gray-700" },
  issued: { label: "Издадена", cls: "bg-blue-100 text-blue-700" },
  sent: { label: "Испратена", cls: "bg-warning/15 text-primary" },
  partial: { label: "Делумно платена", cls: "bg-teal-100 text-teal-700" },
  paid: { label: "Платена", cls: "bg-emerald-100 text-emerald-700" },
  overdue: { label: "Задоцнета", cls: "bg-red-100 text-red-700" },
  cancelled: { label: "Откажана", cls: "bg-gray-100 text-gray-500" },
};
const incStatus: Record<string, { label: string; cls: string }> = {
  received: { label: "Примена", cls: "bg-blue-100 text-blue-700" },
  verified: { label: "Верифицирана", cls: "bg-emerald-100 text-emerald-700" },
  partial: { label: "Делумно платена", cls: "bg-teal-100 text-teal-700" },
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

// Брз избор на период за извештајот (локален датум, не UTC)
const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function periodPreset(kind: "month" | "prev" | "year") {
  const now = new Date();
  if (kind === "prev") return { startDate: ymdLocal(new Date(now.getFullYear(), now.getMonth() - 1, 1)), endDate: ymdLocal(new Date(now.getFullYear(), now.getMonth(), 0)) };
  if (kind === "year") return { startDate: `${now.getFullYear()}-01-01`, endDate: ymdLocal(now) };
  return { startDate: ymdLocal(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: ymdLocal(now) };
}

/** Извоз (0% ДДВ): број и датум на царинската декларација — доказ за ослободувањето од ДДВ. */
function EcdFields({ invoice }: { invoice: any }) {
  const utils = trpc.useUtils();
  const [num, setNum] = useState<string>(invoice.customsDeclaration ?? "");
  const [date, setDate] = useState<string>(invoice.customsDate ? String(invoice.customsDate).slice(0, 10) : "");
  const save = trpc.accounting.invoiceUpdate.useMutation({
    onSuccess: () => { toast.success("ЕЦД е зачуван"); utils.accounting.invoiceById.invalidate(); utils.finance.vatBooks.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const changed = num !== (invoice.customsDeclaration ?? "") || date !== (invoice.customsDate ? String(invoice.customsDate).slice(0, 10) : "");
  return (
    <div className={`rounded-lg border p-3 space-y-2 ${num ? "bg-gray-50" : "border-primary/40 bg-primary/10"}`}>
      <p className="text-xs font-medium">Царинска декларација (ЕЦД) за извоз {num ? "" : "— недостасува; без неа 0% ДДВ нема доказ"}</p>
      <div className="flex flex-wrap gap-2">
        <Input className="h-8 w-48" value={num} onChange={(e) => setNum(e.target.value)} placeholder="Број на ЕЦД" />
        <DateInput className="h-8 w-40" value={date} onChange={(e) => setDate(e.target.value)} />
        <Button size="sm" className="h-8" disabled={!changed || save.isPending} onClick={() => save.mutate({ id: invoice.id, customsDeclaration: num || null, customsDate: date || null })}>Зачувај</Button>
      </div>
    </div>
  );
}

export default function Accounting(props: { embedTab?: string } = {}) {
  const { embedTab } = props;
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(() => embedTab || params.get("tab") || "outgoing");
  useEffect(() => {
    const t0 = embedTab || params.get("tab");
    if (t0 && t0 !== tab) setTab(t0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedTab, params]);
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
  useEffect(() => {
    const id = Number(params.get("open"));
    const inId = Number(params.get("openIn")); // влезна фактура (од главната книга)
    const qq = params.get("q");
    if (id) { setSelId(id); setDetailType("out"); setDetailOpen(true); }
    if (inId) { setTab("incoming"); setSelId(inId); setDetailType("inc"); setDetailOpen(true); }
    if (qq) setSearch(qq);
    if (id || inId || qq) { params.delete("open"); params.delete("openIn"); params.delete("q"); setParams(params, { replace: true }); }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mailOpen, setMailOpen] = useState(false);
  const { data: outDetail } = trpc.accounting.invoiceById.useQuery({ id: selId! }, { enabled: detailType === "out" && !!selId });
  const stornoInv = trpc.accounting.creditNoteCreate.useMutation({
    onSuccess: () => { toast.success("Издадено книжно одобрување"); utils.accounting.invoiceList.invalidate(); setDetailOpen(false); },
    onError: (e) => toast.error(e.message),
  });
  const { data: incDetail } = trpc.accounting.incomingInvoiceById.useQuery({ id: selId! }, { enabled: detailType === "inc" && !!selId });
  const updIncAccount = trpc.accounting.incomingInvoiceUpdate.useMutation({ onSuccess: () => { utils.accounting.incomingInvoiceById.invalidate(); utils.accounting.incomingInvoiceList.invalidate(); toast.success("Контото е сменето — книжењето ќе се ажурира само"); } });

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
  const [incNeedsKind, setIncNeedsKind] = useState(false);
  const [incForm, setIncForm] = useState({ expenseAccount: "", supplierInvoiceNumber: "", supplierId: "", receivedDate: "", issueDate: "", dueDate: "", vatDate: "", reverseCharge: false, subtotal: "0", vatRate: "18", vatAmount: "0", totalAmount: "0", currency: "MKD", notes: "", pdfBase64: "" });
  const [incItems, setIncItems] = useState<Array<{
    description: string; quantity: string; unit: string; unitPrice: string;
    totalPrice: string; vatRate: string; notes: string;
  }>>([]);
  const [incItemForm, setIncItemForm] = useState({ description: "", quantity: "1", unit: "кг", unitPrice: "", vatRate: "18" });
  const [recForm, setRecForm] = useState({ receiptNumber: "", supplierId: "", receiptDate: "", totalAmount: "0", notes: "" });
  const [dnForm, setDnForm] = useState({ dnNumber: "", customerId: "", issueDate: "", deliveryDate: "", totalItems: 0, notes: "" });
  const [certDn, setCertDn] = useState<any>(null);
  const [dnItems, setDnItems] = useState<{ description: string; quantity: string; unit: string; productId?: number; materialId?: number; weightPerUnit?: number; itemType?: "product" | "material" | "manual" }[]>([]);
  const { data: materialsData } = trpc.storage.materialList.useQuery({});
  const [reportPeriod, setReportPeriod] = useState(() => periodPreset("month"));

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
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const handleGenerateReport = async () => {
    if (!reportPeriod.startDate || !reportPeriod.endDate) {
      toast.error("Изберете ги двете датуми");
      return;
    }
    setReportLoading(true);
    setReportData(null);
    setReportError(null);
    try {
      const res = await fetch("/api/trpc/accounting.accountantReport?input=" + encodeURIComponent(JSON.stringify({ json: { startDate: reportPeriod.startDate, endDate: reportPeriod.endDate } })));
      const json = await res.json();
      if (json.result?.data?.json) {
        setReportData(json.result.data.json);
        toast.success("Извештајот е генериран");
      } else if (json.error) {
        const raw = json.error.message || json.error.json?.message || "";
        console.error("accountantReport:", json.error);
        setReportError(raw || "Непозната грешка од серверот");
        toast.error("Извештајот не е генериран — види ја пораката во прозорецот");
      } else {
        setReportError(null);
        toast.error("Нема податоци за избраниот период");
      }
    } catch (e: any) {
      console.error("accountantReport:", e);
      setReportError(e?.message || "Врската со серверот падна");
      toast.error("Извештајот не е генериран");
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
    onSuccess: () => { utils.accounting.incomingInvoiceList.invalidate(); setIncDialog(false); setIncForm({ expenseAccount: "", supplierInvoiceNumber: "", supplierId: "", receivedDate: "", issueDate: "", dueDate: "", vatDate: "", reverseCharge: false, subtotal: "0", vatRate: "18", vatAmount: "0", totalAmount: "0", currency: "MKD", notes: "", pdfBase64: "" }); setIncItems([]); },
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
      {!embedTab && (
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Фактури и документи</h2>
          <p className="text-gray-500 mt-1">Излезни и влезни фактури, испратници и е-фактури · банка, благајна, ДДВ и главна книга се во <button className="text-primary hover:underline" onClick={() => navigate("/finansii")}>Финансии</button></p>
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
              <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Нова фактура</Button></DialogTrigger>
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
                  invoiceNumber: outForm.invoiceNumber || nextInvoiceNum || "",
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
                    <div className="space-y-2"><Label>Број (по ред)</Label><Input value={outForm.invoiceNumber || nextInvoiceNum || ""} readOnly className="bg-gray-50" title="Фактурите се нумерираат по ред, без празнини — бројот го дава програмата" /></div>
                    <div className="space-y-2"><Label>Клиент *</Label><Select value={outForm.customerId} onValueChange={(v) => setOutForm({ ...outForm, customerId: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{customers?.map((c: any) => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}</SelectContent></Select></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Датум на издавање *</Label><DateInput value={outForm.issueDate} onChange={(e) => setOutForm({ ...outForm, issueDate: e.target.value })} required /></div>
                    <div className="space-y-2"><Label>Датум на плаќање</Label><DateInput value={outForm.dueDate} onChange={(e) => setOutForm({ ...outForm, dueDate: e.target.value })} /></div>
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
                  <Button type="submit" className="w-full" disabled={createOut.isPending || outItems.length === 0}>{createOut.isPending ? "Зачувување..." : outItems.length === 0 ? "Додадете ставки" : "Креирај фактура"}</Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
          {tab === "incoming" && (
            <Dialog open={incDialog} onOpenChange={(open) => {
              setIncDialog(open);
              if (!open) {
                setIncItems([]);
                setIncForm({ expenseAccount: "", supplierInvoiceNumber: "", supplierId: "", receivedDate: "", issueDate: "", dueDate: "", vatDate: "", reverseCharge: false, subtotal: "0", vatRate: "18", vatAmount: "0", totalAmount: "0", currency: "MKD", notes: "", pdfBase64: "" });
              }
            }}>
              <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Нова влезна фактура</Button></DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Нова влезна фактура</DialogTitle></DialogHeader>
                <form onSubmit={(e) => {
                  e.preventDefault();
                  if (incNeedsKind) { toast.error("Избери што е купено со оваа фактура"); return; }
                  const subtotal = incItems.reduce((s, i) => s + parseFloat(i.totalPrice || "0"), 0);
                  // обратно оданочување: странскиот добавувач не пресметува ДДВ — го пресметува програмата (18%)
                  const vatAmount = incForm.reverseCharge ? 0 : incItems.reduce((s, i) => s + (parseFloat(i.totalPrice || "0") * parseFloat(i.vatRate) / 100), 0);
                  createInc.mutate({
                    ...incForm,
                    supplierId: parseInt(incForm.supplierId),
                    receivedDate: incForm.receivedDate,
                    issueDate: incForm.issueDate || undefined,
                    dueDate: incForm.dueDate || undefined,
                    vatDate: incForm.vatDate || incForm.receivedDate,
                    reverseCharge: incForm.reverseCharge,
                    ...(incForm.reverseCharge ? { vatRate: "18" } : {}),
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
                      {suppliers?.slice(0, 8).map((s: any) => (
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
                    <div className="space-y-1"><Label>Добавувач *</Label><Select value={incForm.supplierId} onValueChange={(v) => setIncForm({ ...incForm, supplierId: v })}><SelectTrigger className="w-full"><SelectValue placeholder="Избери добавувач" /></SelectTrigger><SelectContent>{suppliers?.map((s: any) => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}</SelectContent></Select></div>
                  </div>
                  <IncomingAccountPicker supplierId={incForm.supplierId ? Number(incForm.supplierId) : undefined} text={[incForm.notes, ...incItems.map((i: any) => i.description)].join(" ")}
                    value={incForm.expenseAccount} onChange={(v) => setIncForm(f => ({ ...f, expenseAccount: v }))} onNeedsAnswer={setIncNeedsKind} />
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1"><Label>Датум на прием *</Label><DateInput value={incForm.receivedDate} onChange={(e) => setIncForm({ ...incForm, receivedDate: e.target.value })} required /></div>
                    <div className="space-y-1"><Label>Датум на фактура</Label><DateInput value={incForm.issueDate} onChange={(e) => setIncForm({ ...incForm, issueDate: e.target.value })} /></div>
                    <div className="space-y-1"><Label>Рок на плаќање</Label><DateInput value={incForm.dueDate} onChange={(e) => setIncForm({ ...incForm, dueDate: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border bg-gray-50/60 p-3">
                    <div className="space-y-1">
                      <Label>ДДВ период</Label>
                      <DateInput value={incForm.vatDate || incForm.receivedDate} onChange={(e) => setIncForm({ ...incForm, vatDate: e.target.value })} />
                      <p className="text-[11px] text-gray-500">Во кој месец влегува во ДДВ пријавата. По правило — кога е примена.</p>
                    </div>
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={incForm.reverseCharge} onChange={(e) => setIncForm({ ...incForm, reverseCharge: e.target.checked })} />
                      <span><b>Услуга од странски добавувач</b> (обратно оданочување)
                        <span className="block text-[11px] text-gray-500">Добавувачот не пресметал ДДВ — програмата пресметува 18% и го книжи и како излезен и како претходен ДДВ. Не важи за увоз на стока (ДДВ се плаќа на царина).</span></span>
                    </label>
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
                  <Button type="submit" className="w-full" disabled={createInc.isPending || !incForm.supplierId}>{createInc.isPending ? "Зачувување..." : "Зачувај влезна фактура"}</Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
          {tab === "receipts" && (
            <Dialog open={recDialog} onOpenChange={setRecDialog}>
              <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Нов приемник</Button></DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Нов приемник</DialogTitle></DialogHeader>
                <form onSubmit={(e) => { e.preventDefault(); createRec.mutate({ ...recForm, supplierId: recForm.supplierId ? parseInt(recForm.supplierId) : undefined, receiptDate: recForm.receiptDate } as any); }} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Број *</Label><Input value={recForm.receiptNumber} onChange={(e) => setRecForm({ ...recForm, receiptNumber: e.target.value })} required /></div>
                    <div className="space-y-2"><Label>Добавувач</Label><Select value={recForm.supplierId} onValueChange={(v) => setRecForm({ ...recForm, supplierId: v })}><SelectTrigger><SelectValue placeholder="Избери" /></SelectTrigger><SelectContent>{suppliers?.map((s: any) => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}</SelectContent></Select></div>
                  </div>
                  <div className="space-y-2"><Label>Датум *</Label><DateInput value={recForm.receiptDate} onChange={(e) => setRecForm({ ...recForm, receiptDate: e.target.value })} required /></div>
                  <Button type="submit" className="w-full" disabled={createRec.isPending}>{createRec.isPending ? "Зачувување..." : "Креирај приемник"}</Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
          {tab === "delivery" && (
            <Dialog open={dnDialog} onOpenChange={setDnDialog}>
              <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Нов испратник</Button></DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Нов испратник</DialogTitle></DialogHeader>
                <form onSubmit={(e) => { e.preventDefault(); createDN.mutate({ ...dnForm, customerId: parseInt(dnForm.customerId), issueDate: dnForm.issueDate, deliveryDate: dnForm.deliveryDate || undefined, items: dnItems.map(it => ({ description: it.description, quantity: it.quantity, unit: it.unit, productId: it.productId, materialId: it.materialId, itemType: it.itemType, weightKg: ((it.weightPerUnit ?? 0) * (Number(it.quantity) || 0)).toFixed(3) })) } as any); }} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Број *</Label><Input value={dnForm.dnNumber} onChange={(e) => setDnForm({ ...dnForm, dnNumber: e.target.value })} required /></div>
                    <div className="space-y-2"><Label>Клиент *</Label><Select value={dnForm.customerId} onValueChange={(v) => setDnForm({ ...dnForm, customerId: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{customers?.map((c: any) => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}</SelectContent></Select></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Датум на издавање *</Label><DateInput value={dnForm.issueDate} onChange={(e) => setDnForm({ ...dnForm, issueDate: e.target.value })} required /></div>
                    <div className="space-y-2"><Label>Датум на испорака</Label><DateInput value={dnForm.deliveryDate} onChange={(e) => setDnForm({ ...dnForm, deliveryDate: e.target.value })} /></div>
                  </div>
                  <div className="border rounded-lg p-3 space-y-2 bg-gray-50">
                    <p className="text-xs font-semibold">Ставки за испорака</p>
                    <div className="grid grid-cols-2 gap-2">
                      <MaterialPicker tile={{ icon: "🔩", label: "Материјал од магацин" }} title="Избери материјал" materials={materialsData as any} value={null}
                        onSelect={(mm: any) => setDnItems([...dnItems, { description: mm.name, quantity: "1", unit: mm.unit ?? "pcs", materialId: mm.id, weightPerUnit: Number(mm.weightPerUnit ?? 0) || 0, itemType: "material" }])} />
                      <MaterialPicker tile={{ icon: "📦", label: "Готов производ" }} title="Избери готов производ" value={null}
                        materials={fgAggregated as any}
                        onSelect={(f: any) => setDnItems([...dnItems, { description: f.cleanName ?? f.name, quantity: "1", unit: f.unit ?? "ком", productId: f.id, itemType: "product" }])} />
                    </div>
                    {dnItems.map((it, i) => (
                      <div key={i} className="grid grid-cols-[1fr_5rem_3rem_2rem] gap-2 items-center bg-white border rounded px-2 py-1">
                        <span className="text-xs truncate">{it.description}</span>
                        <Input className="h-7 text-xs" type="number" step="0.001" value={it.quantity} onChange={e => setDnItems(dnItems.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} />
                        <span className="text-xs text-gray-500">
                          {it.unit}
                          {(it.weightPerUnit ?? 0) > 0 && (
                            <span className="block text-[10px] text-primary leading-none">
                              {((it.weightPerUnit ?? 0) * (Number(it.quantity) || 0)).toFixed(1)} кг
                            </span>
                          )}
                        </span>
                        <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500" onClick={() => setDnItems(dnItems.filter((_, j) => j !== i))}>×</Button>
                      </div>
                    ))}
                    {dnItems.some(it => (it.weightPerUnit ?? 0) > 0) && (
                      <div className="flex justify-between text-xs font-semibold border-t pt-2 mt-1">
                        <span>Вкупна тежина</span>
                        <span className="text-primary">
                          {dnItems.reduce((a, it) => a + (it.weightPerUnit ?? 0) * (Number(it.quantity) || 0), 0).toFixed(2)} кг
                        </span>
                      </div>
                    )}
                  </div>
                  <Button type="submit" className="w-full" disabled={createDN.isPending}>{createDN.isPending ? "Зачувување..." : "Креирај испратник"}</Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
          <Dialog open={reportDialog} onOpenChange={setReportDialog}>
            <Button variant="outline" asChild><a href="/izvestai"><BarChart3 className="h-4 w-4 mr-2" />Сите извештаи</a></Button>
            <DialogTrigger asChild><Button variant="outline"><Calculator className="h-4 w-4 mr-2" />Извештај за сметководител</Button></DialogTrigger>
            <DialogContent className="sm:max-w-5xl max-h-[92vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Извештај за сметководител</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>Од датум</Label><DateInput value={reportPeriod.startDate} onChange={(e) => { setReportPeriod({ ...reportPeriod, startDate: e.target.value }); setReportData(null); }} /></div>
                  <div className="space-y-2"><Label>До датум</Label><DateInput value={reportPeriod.endDate} onChange={(e) => { setReportPeriod({ ...reportPeriod, endDate: e.target.value }); setReportData(null); }} /></div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {([["month", "Овој месец"], ["prev", "Претходен месец"], ["year", "Оваа година"]] as const).map(([k, l]) => (
                    <Button key={k} type="button" size="sm" variant="ghost" className="h-8" onClick={() => { setReportPeriod(periodPreset(k)); setReportData(null); }}>{l}</Button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="default"
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                    disabled={!reportPeriod.startDate || !reportPeriod.endDate || reportLoading}
                    onClick={handleGenerateReport}
                  >
                    {reportLoading ? "Се генерира..." : <><Calculator className="h-4 w-4 mr-2" />Генерирај извештај</>}
                  </Button>

                </div>
                {reportData && <AccountantPackActions report={reportData} from={reportPeriod.startDate} to={reportPeriod.endDate} />}
                {reportError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 space-y-2">
                    <p className="text-sm font-medium text-red-800">Извештајот не е генериран</p>
                    <p className="text-xs text-red-700 font-mono break-words whitespace-pre-wrap">{reportError}</p>
                    {/does not exist|column|relation/i.test(reportError) && (
                      <p className="text-xs text-gray-600">
                        Базата нема некоја колона или табела што апликацијата ја очекува. Отвори
                        <span className="font-mono mx-1">/api/init-db</span>
                        еднаш, па пробај повторно.
                      </p>
                    )}
                  </div>
                )}


                {reportData && (() => {
                  const wo = reportData.workOrders ?? [];
                  const req = reportData.requisitions ?? [];
                  const woCost = wo.reduce((a: number, w: any) => a + (parseFloat(String(w.costAmount ?? "0")) || 0), 0);
                  const mkd = (n: any) => Number(n ?? 0).toLocaleString("mk-MK");
                  const dt = (d: any) => d ? formatDate(d) : "";

                  const Section = ({ title, count, total, headers, rows, color }: any) => (
                    <div className="border rounded-lg overflow-hidden">
                      <div className={`flex items-center justify-between px-4 py-2.5 ${color}`}>
                        <div>
                          <span className="font-semibold text-gray-800">{title}</span>
                          <span className="text-sm text-gray-500 ml-2">{count} · {mkd(total)} ден.</span>
                        </div>
                      </div>
                      <div className="max-h-52 overflow-y-auto">
                        <Table>
                          <TableHeader><TableRow>{headers.map((h: string) => <TableHead key={h} className="text-xs">{h}</TableHead>)}</TableRow></TableHeader>
                          <TableBody>
                            {rows}
                            {count === 0 && <TableRow><TableCell colSpan={headers.length} className="text-center text-sm text-gray-400 py-6">Нема записи во периодот</TableCell></TableRow>}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  );

                  return (
                    <div className="space-y-4">
                      {/* KPI grid */}
                      <div className="grid grid-cols-3 gap-3">
                        <Card className="bg-blue-50"><CardContent className="p-3"><p className="text-xs text-gray-600">Излезни фактури</p><p className="text-lg font-bold text-blue-700">{reportData.outgoing.count} · {mkd(reportData.outgoing.total)}</p></CardContent></Card>
                        <Card className="bg-emerald-50"><CardContent className="p-3"><p className="text-xs text-gray-600">Влезни фактури</p><p className="text-lg font-bold text-emerald-700">{reportData.incoming.count} · {mkd(reportData.incoming.total)}</p></CardContent></Card>
                        <Card className="bg-indigo-50"><CardContent className="p-3"><p className="text-xs text-gray-600">Работни налози</p><p className="text-lg font-bold text-indigo-700">{wo.length} · {mkd(woCost)}</p></CardContent></Card>
                        <Card className="bg-primary/10"><CardContent className="p-3"><p className="text-xs text-gray-600">ДДВ излез</p><p className="text-lg font-bold text-primary">{mkd(reportData.outgoing.totalVat)}</p></CardContent></Card>
                        <Card className="bg-purple-50"><CardContent className="p-3"><p className="text-xs text-gray-600">ДДВ влез</p><p className="text-lg font-bold text-purple-700">{mkd(reportData.incoming.totalVat)}</p></CardContent></Card>
                        <Card className="bg-orange-50"><CardContent className="p-3"><p className="text-xs text-gray-600">Требовања</p><p className="text-lg font-bold text-orange-700">{req.length} · {mkd(reportData.totalRequisitionCost)}</p></CardContent></Card>
                      </div>
                      <div className="bg-gray-100 p-3 rounded-lg text-center">
                        {(() => { const b = Number(reportData.vatRecapitulation.vatBalance); return (<>
                          <span className="text-gray-600">{b > 0 ? "ДДВ за плаќање" : b < 0 ? "ДДВ за поврат" : "ДДВ салдо"}: </span>
                          <span className="font-bold text-lg">{mkd(Math.abs(b))} ден.</span>
                          <span className="text-xs text-gray-500 ml-2">(излезен {mkd(reportData.vatRecapitulation.outgoingVat)} − влезен {mkd(reportData.vatRecapitulation.incomingVat)})</span>
                        </>); })()}
                      </div>

                      {/* Излезни фактури */}
                      <Section title="Излезни фактури" count={reportData.outgoing.count} total={reportData.outgoing.total} color="bg-blue-50/60"
                        headers={["Број", "Клиент", "Датум", "Основица (ден)", "ДДВ (ден)", "Вкупно (ден)"]}
                        rows={reportData.outgoing.items.map((i: any) => (
                          <TableRow key={i.id}><TableCell className="font-mono text-xs">{i.invoiceNumber}</TableCell><TableCell className="text-sm">{i.customerName ?? ""}</TableCell><TableCell className="text-sm">{dt(i.issueDate)}</TableCell><TableCell className="text-sm text-right">{mkd(i.baseMkd)}</TableCell><TableCell className="text-sm text-right">{mkd(i.vatMkd)}</TableCell><TableCell className="text-sm text-right font-medium">{mkd(i.totalMkd)}</TableCell></TableRow>
                        ))}
                      />

                      {/* Влезни фактури */}
                      <Section title="Влезни фактури" count={reportData.incoming.count} total={reportData.incoming.total} color="bg-emerald-50/60"
                        headers={["Број", "Добавувач", "Датум", "Основица (ден)", "ДДВ (ден)", "Вкупно (ден)"]}
                        rows={reportData.incoming.items.map((i: any) => (
                          <TableRow key={i.id}><TableCell className="font-mono text-xs">{i.supplierInvoiceNumber}</TableCell><TableCell className="text-sm">{i.supplierName ?? ""}</TableCell><TableCell className="text-sm">{dt(i.issueDate ?? i.receivedDate)}</TableCell><TableCell className="text-sm text-right">{mkd(i.baseMkd)}</TableCell><TableCell className="text-sm text-right">{mkd(i.vatMkd)}</TableCell><TableCell className="text-sm text-right font-medium">{mkd(i.totalMkd)}</TableCell></TableRow>
                        ))}
                      />

                      {/* Работни налози */}
                      <Section title="Работни налози" count={wo.length} total={woCost} color="bg-indigo-50/60"
                        headers={["Број", "Датум", "Опис", "Статус", "Трошок"]}
                        rows={wo.map((w: any) => (
                          <TableRow key={w.id}><TableCell className="font-mono text-xs">{w.woNumber}</TableCell><TableCell className="text-sm">{dt(w.createdAt)}</TableCell><TableCell className="text-sm">{w.description ?? ""}</TableCell><TableCell className="text-sm">{w.status ?? ""}</TableCell><TableCell className="text-sm text-right font-medium">{mkd(w.costAmount)}</TableCell></TableRow>
                        ))}
                      />

                      {/* Требовања */}
                      <Section title="Требовања (потрошен материјал)" count={req.length} total={reportData.totalRequisitionCost} color="bg-orange-50/60"
                        headers={["Раб. налог", "Материјал", "Количина", "Цена", "Вкупно"]}
                        rows={req.map((r: any, n: number) => (
                          <TableRow key={n}><TableCell className="font-mono text-xs">{r.workOrderNumber}</TableCell><TableCell className="text-sm">{r.materialName}</TableCell><TableCell className="text-sm text-right">{r.quantity} {r.unit}</TableCell><TableCell className="text-sm text-right">{mkd(r.unitCost)}</TableCell><TableCell className="text-sm text-right font-medium">{mkd(r.totalCost)}</TableCell></TableRow>
                        ))}
                      />
                    </div>
                  );
                })()}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      )}
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input placeholder="Пребарувај..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {/* Tabs */}
      {!embedTab && (<>
      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {[
          { key: "outgoing", label: "Излезни фактури", icon: ArrowUpRight },
          { key: "incoming", label: "Влезни фактури", icon: ArrowDownLeft },
          { key: "delivery", label: "Испратници", icon: Truck },
          { key: "einvoice", label: "УЈП е-фактури", icon: FileText },
          { key: "parsed", label: "Влезни од PDF", icon: FileUp },
          { key: "email", label: "Влезни од е-пошта", icon: Upload },
        ].map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-1 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? "border-primary text-primary" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
              <Icon className="h-4 w-4" />{t.label}
            </button>
          );
        })}
      </div>
      </>)}

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
                  outgoing.map((inv: any) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-sm font-medium">{inv.invoiceNumber}</TableCell>
                      <TableCell>{inv.customerName} {inv.customerCompany ? `(${inv.customerCompany})` : ""}</TableCell>
                      <TableCell><Badge className={invStatus[inv.status]?.cls}>{invStatus[inv.status]?.label}</Badge></TableCell>
                      <TableCell>{inv.invoiceType === "standard" ? "Фактура" : inv.invoiceType === "proforma" ? "Про-фактура" : "Книжно одобрување"}</TableCell>
                      <TableCell className="font-medium tabular-nums whitespace-nowrap">{Number(inv.totalAmount).toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {inv.currency === "MKD" ? "ден." : inv.currency}</TableCell>
                      <TableCell className="tabular-nums">{Number(inv.vatAmount).toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-gray-500">{formatDate(inv.issueDate)}</TableCell>
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
              <ListLimitNote count={outgoing?.length} />
          </CardContent>
        </Card>
      )}

      {/* ===== INCOMING INVOICES ===== */}
      {tab === "incoming" && <IncomingAccountReview />}
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
                  incoming.map((inv: any) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-sm font-medium">{inv.supplierInvoiceNumber}</TableCell>
                      <TableCell>{inv.supplierName}</TableCell>
                      <TableCell><Badge className={incStatus[inv.status]?.cls}>{incStatus[inv.status]?.label}</Badge></TableCell>
                      <TableCell className="font-medium">{inv.totalAmount} {inv.currency}</TableCell>
                      <TableCell>
                        {inv.hasFile ? (
                          <Button size="sm" variant="outline" className="text-emerald-600 h-7 text-xs" onClick={() => openStoredFile(utils.accounting.documentFile.fetch, "incoming_invoice", inv.id).catch((e) => toast.error(e.message))}>
                            <FileText className="h-3 w-3 mr-1" /> Оригинал
                          </Button>
                        ) : (
                          <span className="text-gray-400 text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-gray-500">{formatDate(inv.receivedDate)}</TableCell>
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
                  receiptsData.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-sm font-medium">{r.receiptNumber}</TableCell>
                      <TableCell>{r.supplierName || "-"}</TableCell>
                      <TableCell><Badge className={recStatus[r.status]?.cls}>{recStatus[r.status]?.label}</Badge></TableCell>
                      <TableCell className="text-gray-500">{formatDate(r.receiptDate)}</TableCell>
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
                  dnData.map((dn: any) => (
                    <TableRow key={dn.id}>
                      <TableCell className="font-mono text-sm font-medium">{dn.dnNumber}</TableCell>
                      <TableCell>{dn.customerName} {dn.customerCompany ? `(${dn.customerCompany})` : ""}</TableCell>
                      <TableCell><Badge className={dnStatus[dn.status]?.cls}>{dnStatus[dn.status]?.label}</Badge></TableCell>
                      <TableCell className="text-gray-500">{formatDate(dn.issueDate)}</TableCell>
                      <TableCell>{dn.totalItems}</TableCell>
                      <TableCell><div className="flex gap-1"><Button size="sm" variant="outline" onClick={async () => { const full = await utils.accounting.deliveryNoteById.fetch({ id: dn.id }); printDeliveryNote(full, companySettings); }}><Download className="h-3.5 w-3.5 mr-1" />Печати</Button><Button size="sm" variant="outline" title="Вградени материјали / атести" onClick={async () => { const full = await utils.accounting.deliveryNoteById.fetch({ id: dn.id }); setCertDn(full); }}><ShieldCheck className="h-3.5 w-3.5" /></Button><Button size="sm" variant="ghost" className="text-red-500" onClick={() => { if (confirm("Дали сте сигурни?")) delDN.mutate({ id: dn.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button></div></TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ===== UJP E-INVOICES ===== */}
      {tab === "bank" && (
        <Card><CardContent className="py-10 text-center space-y-3">
          <p className="text-gray-600">Банката е преместена во <b>Финансии</b>, заедно со благајната, ДДВ и главната книга.</p>
          <Button onClick={() => navigate("/finansii?tab=bank")}>Отвори Финансии → Банка</Button>
        </CardContent></Card>
      )}

      {tab === "einvoice" && <UJPEFakturaTab />}

      {/* ===== EMAIL INVOICES ===== */}
      {tab === "email" && <EmailInvoicesTab />}

      {/* ===== PDF PARSING ===== */}
      {tab === "parsed" && (
        <div className="space-y-6">
          <Card>
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold mb-4">Вчитај фактура од PDF</h3>
              <p className="text-sm text-gray-600 mb-4">Вчитајте PDF фактура за автоматско препознавање на податоците (број на фактура, износ, добавувач).</p>
              <div className="flex gap-3">
                <input type="file" ref={fileRef} accept=".pdf" className="hidden" onChange={handleFileUpload} />
                <Button onClick={() => fileRef.current?.click()}>
                  <FileUp className="h-4 w-4 mr-2" />Избери PDF
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Фајл</TableHead><TableHead>Добавувач</TableHead><TableHead>Број</TableHead><TableHead className="text-right">Износ</TableHead><TableHead>Датум</TableHead><TableHead>Статус</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {!parsedData?.length ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-gray-400">Нема парсирани фактури</TableCell></TableRow> :
                    parsedData.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell className="max-w-[220px] truncate text-xs">{p.originalFileName}</TableCell>
                        <TableCell>
                          <div className="text-sm">{p.supplierName || <span className="text-gray-300">не е препознаен</span>}</div>
                          {(p as any).supplierTaxId && (
                            <div className="text-[11px] text-gray-400 font-mono">
                              ЕДБ {(p as any).supplierTaxId}
                              {!(p as any).matchedSupplierId && <span className="text-primary"> · нема во системот</span>}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{p.invoiceNumber || <span className="text-gray-300">—</span>}</TableCell>
                        <TableCell className="text-right">
                          <div className="font-medium">{p.totalAmount ? Number(p.totalAmount).toLocaleString("mk-MK", { minimumFractionDigits: 2 }) : "—"}</div>
                          {(p as any).baseAmount && (
                            <div className="text-[11px] text-gray-400">
                              основа {Number((p as any).baseAmount).toLocaleString("mk-MK")}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-gray-500 text-sm">
                          {formatDate(p.issueDate)}
                          {(p as any).dueDate && (
                            <div className="text-[11px] text-gray-400">
                              рок {formatDate((p as any).dueDate)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge className={
                            p.status === "imported" ? "bg-emerald-100 text-emerald-700"
                              : p.status === "verified" ? "bg-blue-100 text-blue-700"
                              : p.status === "needs_review" ? "bg-warning/15 text-foreground/80"
                              : "bg-gray-100 text-gray-700"}>
                            {p.status === "imported" ? "Импортирана"
                              : p.status === "verified" ? "Верифицирана"
                              : p.status === "needs_review" ? "За проверка"
                              : "Прочитана"}
                          </Badge>
                          {typeof (p as any).confidence === "number" && (
                            <div className={`text-[11px] mt-0.5 ${(p as any).confidence >= 80 ? "text-emerald-600" : (p as any).confidence >= 60 ? "text-gray-400" : "text-primary"}`}>
                              сигурност {(p as any).confidence}%
                            </div>
                          )}
                          {(p as any).parseNotes && (
                            <div className="text-[10px] text-primary max-w-[220px] leading-tight mt-0.5">
                              {(p as any).parseNotes}
                            </div>
                          )}
                        </TableCell>
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
                <div><span className="text-gray-500">Тип:</span> {outDetail.invoiceType === "standard" ? "Фактура" : outDetail.invoiceType === "proforma" ? "Про-фактура" : outDetail.invoiceType === "credit_note" ? "Книжно одобрување" : outDetail.invoiceType}</div>
                <div><span className="text-gray-500">Износ:</span> <span className="font-semibold">{outDetail.totalAmount} {outDetail.currency}</span></div>
                <div><span className="text-gray-500">ДДВ:</span> {outDetail.vatAmount} ({outDetail.vatRate}%)</div>
                <div><span className="text-gray-500">Датум:</span> {formatDate(outDetail.issueDate)}</div>
                <div><span className="text-gray-500">Рок:</span> {formatDate(outDetail.dueDate)}</div>
              </div>
              {(outDetail.currency !== "MKD" || Number(outDetail.vatRate) === 0) && outDetail.invoiceType !== "proforma" && (
                <EcdFields key={outDetail.id} invoice={outDetail} />
              )}
              <div className="flex gap-2 pt-2">
                <Button size="sm" variant="outline" onClick={() => generateUJPXml(outDetail)}><FileText className="h-3.5 w-3.5 mr-1" />УЈП XML</Button>
                <Button size="sm" variant="outline" onClick={() => printInvoice(outDetail, companySettings, "mk")}><Download className="h-3.5 w-3.5 mr-1" />PDF МК</Button>
                <Button size="sm" variant="outline" onClick={() => printInvoice(outDetail, companySettings, "en")}><Download className="h-3.5 w-3.5 mr-1" />PDF EN</Button>
                <Button size="sm" variant="outline" onClick={() => setMailOpen(true)}><FileText className="h-3.5 w-3.5 mr-1" />Прати по е-пошта</Button>
                {outDetail.invoiceType === "standard" && !["draft", "cancelled"].includes(outDetail.status) && (
                  <Button size="sm" variant="outline" className="text-violet-700 border-violet-300" disabled={stornoInv.isPending}
                    title="Книжно одобрување на целиот износ, со денешен датум — така се поништува издадена фактура"
                    onClick={async () => {
                      if (!confirm(`Да се издаде книжно одобрување (сторно) на целата фактура ${outDetail.invoiceNumber}?`)) return;
                      const num = await utils.accounting.nextCreditNoteNumber.fetch();
                      const d = new Date(); const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                      stornoInv.mutate({ originalInvoiceId: outDetail.id, creditNoteNumber: num, issueDate: today,
                        subtotal: String(outDetail.subtotal), vatRate: String(outDetail.vatRate ?? "18"), vatAmount: String(outDetail.vatAmount), totalAmount: String(outDetail.totalAmount),
                        notes: `Сторно на фактура ${outDetail.invoiceNumber}` });
                    }}><Undo2 className="h-3.5 w-3.5 mr-1" />Сторно (книжно одобрување)</Button>
                )}
              </div>
              <SendEmailDialog open={mailOpen} onOpenChange={setMailOpen} docType="invoice" docId={outDetail.id} docNumber={outDetail.invoiceNumber}
                defaultTo={outDetail.customer?.email} companyName={companySettings?.name}
                defaultLang={(outDetail as any).language === "en" || outDetail.currency !== "MKD" ? "en" : "mk"}
                buildHtml={(lang) => invoiceHtml(outDetail, companySettings, lang)} />
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
                <div className="col-span-2 flex items-center gap-2"><span className="text-gray-500 shrink-0">Конто:</span>
                  <Select value={(incDetail as any).expenseAccount || "310"} onValueChange={(v) => updIncAccount.mutate({ id: incDetail.id, expenseAccount: v })}>
                    <SelectTrigger className="h-8 w-full max-w-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{EXPENSE_CHOICES.map(c => <SelectItem key={c.code} value={c.code}><span className="font-mono text-xs mr-1.5">{c.code}</span>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><span className="text-gray-500">Прием:</span> {formatDate(incDetail.receivedDate)}</div>
              </div>
              {/* PDF Preview */}
              {incDetail.fileUrl && (
                <div className="border rounded p-2">
                  <p className="text-xs text-gray-500 mb-1">Оригинална фактура (PDF):</p>
                  <Button size="sm" variant="outline" className="text-emerald-600 text-xs" onClick={() => openStoredFile(utils.accounting.documentFile.fetch, "incoming_invoice", incDetail.id).catch((e) => toast.error(e.message))}>
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

      {certDn && (
        <DnCertificates deliveryNote={certDn} settings={companySettings}
          open={!!certDn} onOpenChange={(v) => { if (!v) setCertDn(null); }} />
      )}
    </div>
  );
}

// ===== INVOICE ITEM FORM COMPONENT =====
