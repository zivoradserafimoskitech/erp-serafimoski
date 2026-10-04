import { useState, useRef, useCallback, useEffect } from "react";
import { DateInput } from "@/components/ui/date-input";
import { useSearchParams, useNavigate } from "react-router";
import { formatDate } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { printReceipt } from "@/lib/print-documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MaterialPicker } from "@/components/MaterialPicker";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus, Search, CheckCircle, ClipboardCheck, Upload, FileText, X, Eye, Trash2, AlertCircle, AlertTriangle, ShieldAlert, Pencil, Printer } from "lucide-react";

const statuses: Record<string, string> = { draft: "Нацрт", confirmed: "Потврдена", cancelled: "Откажана" };
const statusColors: Record<string, string> = { draft: "bg-gray-100 text-gray-800", confirmed: "bg-emerald-100 text-emerald-800", cancelled: "bg-red-100 text-red-800" };
const parsedStatuses: Record<string, string> = { parsed: "Парсиран", verified: "Верифициран", imported: "Увезен" };
const itemStatuses: Record<string, string> = { pending: "На чекање", confirmed: "Потврдена", rejected: "Одбиена" };
const itemStatusColors: Record<string, string> = { pending: "bg-yellow-100 text-yellow-800", confirmed: "bg-emerald-100 text-emerald-800", rejected: "bg-red-100 text-red-800" };

interface ParsedItem {
  id: number;
  rawDescription: string;
  matchedMaterialId: number | null;
  matchedMaterialName: string | null;
  matchConfidence: string;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  totalPrice: string | null;
  vatRate: string | null;
  isConfirmed: "pending" | "confirmed" | "rejected";
}

export default function Receipts() {
  const [search, setSearch] = useState("");
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  useEffect(() => {
    const qq = params.get("q");
    if (qq) { setSearch(qq); params.delete("q"); setParams(params, { replace: true }); }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: nextReceiptNum } = trpc.settings.nextDocNumber.useQuery({ kind: "receipt" }, { enabled: dialogOpen });
  const [parsedDialogOpen, setParsedDialogOpen] = useState(false);
  const [selectedParsedId, setSelectedParsedId] = useState<number | null>(null);
  const [uploadTab, setUploadTab] = useState("manual");
  const [isUploading, setIsUploading] = useState(false);
  const [isParsingText, setIsParsingText] = useState(false);
  const [ocrText, setOcrText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    receiptNumber: "",
    supplierId: "",
    poId: "",
    warehouseId: "",
    receiptDate: new Date().toISOString().split("T")[0],
    supplierDocNumber: "",
    transportCost: "0",
    customsCost: "0",
    otherCost: "0",
    notes: "",
  });
  const [items, setItems] = useState<Array<{
    materialId: string;
    quantity: string;
    unit: string;
    unitPrice: string;
    totalPrice: string;
    notes: string;
    heatNumber?: string;
    certNumber?: string;
    certStandard?: string;
    certUrl?: string;
  }>>([]);
  const [itemForm, setItemForm] = useState({
    materialId: "", quantity: "", unitPrice: "", notes: "",
    heatNumber: "", certNumber: "", certStandard: "", certUrl: "",
  });
  const [showCertFields, setShowCertFields] = useState(false);

  const utils = trpc.useUtils();
  const { data: receiptsData } = trpc.accounting.receiptList.useQuery({ status: statusFilter === "all" ? undefined : statusFilter, search: search || undefined });
  const { data: suppliersData } = trpc.procurement.supplierList.useQuery();
  const { data: poListData } = trpc.procurement.poList.useQuery({});
  const openPos = (poListData ?? []).filter((p: any) => ["draft", "sent", "confirmed", "partial"].includes(p.status));
  // Приемница по набавна нарачка: добавувач + ставки со количината што уште не е примена и цената од нарачката
  const loadPo = async (poId: string) => {
    if (!poId) { setForm(f => ({ ...f, poId: "" })); return; }
    const po: any = await utils.procurement.poById.fetch({ id: Number(poId) });
    if (!po) return;
    const rest = (po.items ?? []).map((it: any) => ({ it, open: Math.max(0, Number(it.quantity) - Number(it.receivedQuantity ?? 0)) })).filter((x: any) => x.open > 0.0005);
    setForm(f => ({ ...f, poId, supplierId: String(po.supplierId), notes: f.notes || `По нарачка ${po.poNumber}` }));
    setItems(rest.map(({ it, open }: any) => ({
      materialId: String(it.materialId), quantity: String(open), unit: it.materialUnit ?? "kg",
      unitPrice: String(Number(it.unitPrice)), totalPrice: (open * Number(it.unitPrice)).toFixed(2), notes: it.description ?? "",
    })));
    toast.success(rest.length ? `Внесени ${rest.length} ставки од ${po.poNumber} — поправи ги количините ако стигнало помалку` : `${po.poNumber} е веќе целосно примена`);
  };
  useEffect(() => {
    const po = params.get("po");
    if (po) { params.delete("po"); setParams(params, { replace: true }); setDialogOpen(true); loadPo(po); }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const setItemQty = (idx: number, q: string) => setItems(list => list.map((x, i) => i === idx ? { ...x, quantity: q, totalPrice: ((parseFloat(q) || 0) * (parseFloat(x.unitPrice) || 0)).toFixed(2) } : x));
  const { data: materialsData } = trpc.storage.materialList.useQuery();
  const { data: warehousesData } = trpc.warehouse.warehouseList.useQuery();
  const { data: parsedDocsData } = trpc.ocr.parsedDocumentList.useQuery({ documentType: "receipt" });
  const { data: selectedParsedDoc } = trpc.ocr.parsedDocumentById.useQuery(
    { id: selectedParsedId! },
    { enabled: !!selectedParsedId }
  );
  const { data: matchMaterialsData } = trpc.ocr.materialListForMatching.useQuery();

  const createMutation = trpc.accounting.receiptCreate.useMutation({
    onSuccess: () => {
      utils.accounting.receiptList.invalidate();
      setDialogOpen(false);
      resetForm();
    },
  });

  // Приемници во нацрт: залихата уште не е зголемена (порано „Потврди“ не ја зголемуваше)
  const { data: draftReceipts } = trpc.accounting.receiptList.useQuery({ status: "draft" });
  const [bulkBusy, setBulkBusy] = useState(false);
  const confirmAllDrafts = async () => {
    const list = draftReceipts ?? [];
    if (!list.length || !confirm(`Да се потврдат сите ${list.length} приемници во нацрт? Залихата ќе се зголеми за нивните ставки.`)) return;
    setBulkBusy(true);
    let ok = 0; const failed: string[] = [];
    for (const r of list as any[]) {
      try { await processMutation.mutateAsync({ receiptId: r.id, warehouseId: r.warehouseId, items: [] } as any); ok++; }
      catch (e: any) { failed.push(`${r.receiptNumber}: ${e?.message ?? e}`); }
    }
    setBulkBusy(false);
    utils.accounting.receiptList.invalidate();
    if (ok) toast.success(`Потврдени ${ok} приемници — залихата е зголемена`);
    if (failed.length) toast.error(`Не се потврдени ${failed.length}`, { description: failed.join(" · ").slice(0, 400) });
  };
  const processMutation = trpc.storage.processReceipt.useMutation({
    onSuccess: () => {
      utils.accounting.receiptList.invalidate();
      utils.storage.materialList.invalidate();
      utils.storage.storageStats.invalidate();
      toast.success("Приемницата е потврдена и залихата е ажурирана");
    },
    onError: (e) => toast.error(e.message),
  });

  const parsePdfMutation = trpc.ocr.parsePdf.useMutation({
    onSuccess: (data) => {
      setIsUploading(false);
      if (data.success && data.parsedId) {
        toast.success(data.message);
        setSelectedParsedId(data.parsedId);
        setParsedDialogOpen(true);
        utils.ocr.parsedDocumentList.invalidate();
      } else {
        toast.error(data.message ?? "Грешка при парсирање");
      }
    },
    onError: (e) => {
      setIsUploading(false);
      toast.error(e.message);
    },
  });

  const parseTextMutation = trpc.ocr.parseText.useMutation({
    onSuccess: (data) => {
      setIsParsingText(false);
      if (data.success && data.parsedId) {
        toast.success(data.message);
        setSelectedParsedId(data.parsedId);
        setParsedDialogOpen(true);
        setOcrText("");
        utils.ocr.parsedDocumentList.invalidate();
      } else {
        toast.error(data.message ?? "Грешка при парсирање");
      }
    },
    onError: (e) => {
      setIsParsingText(false);
      toast.error(e.message);
    },
  });

  const updateItemMutation = trpc.ocr.updateParsedItem.useMutation({
    onSuccess: () => {
      utils.ocr.parsedDocumentById.invalidate({ id: selectedParsedId! });
    },
  });

  const deleteParsedMutation = trpc.ocr.deleteParsedDocument.useMutation({
    onSuccess: () => {
      utils.ocr.parsedDocumentList.invalidate();
      toast.success("Документот е избришан");
    },
  });

  const resetForm = () => {
    setForm({
      receiptNumber: "",
      supplierId: "",
      poId: "",
      warehouseId: "",
      receiptDate: new Date().toISOString().split("T")[0],
      supplierDocNumber: "",
      transportCost: "0",
      customsCost: "0",
      otherCost: "0",
      notes: "",
    });
    setItems([]);
  };

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf" && !file.type.startsWith("image/")) {
      toast.error("Само PDF и слики се поддржани");
      return;
    }

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = (event.target?.result as string)?.split(",")[1];
      if (base64) {
        parsePdfMutation.mutate({
          base64Data: base64,
          fileName: file.name,
          documentType: "receipt",
        });
      }
    };
    reader.readAsDataURL(file);
  }, [parsePdfMutation]);

  const handleTextParse = () => {
    if (!ocrText.trim()) {
      toast.error("Внесете текст за парсирање");
      return;
    }
    setIsParsingText(true);
    parseTextMutation.mutate({
      text: ocrText,
      fileName: "ocr_text.txt",
      documentType: "receipt",
    });
  };

  const addItem = () => {
    if (!itemForm.materialId || !itemForm.quantity || !itemForm.unitPrice) return;
    const mat = materialsData?.find((m: any) => m.id.toString() === itemForm.materialId);
    const qty = parseFloat(itemForm.quantity);
    const price = parseFloat(itemForm.unitPrice);
    setItems([...items, {
      materialId: itemForm.materialId,
      quantity: itemForm.quantity,
      unit: mat?.unit ?? "kg",
      unitPrice: itemForm.unitPrice,
      totalPrice: (qty * price).toFixed(2),
      notes: itemForm.notes,
      heatNumber: itemForm.heatNumber || undefined,
      certNumber: itemForm.certNumber || undefined,
      certStandard: itemForm.certStandard || undefined,
      certUrl: itemForm.certUrl || undefined,
    }]);
    setItemForm({
      materialId: "", quantity: "", unitPrice: "", notes: "",
      // Шаржата обично е иста за целата испорака — ја задржувам
      heatNumber: itemForm.heatNumber, certNumber: itemForm.certNumber,
      certStandard: itemForm.certStandard, certUrl: itemForm.certUrl,
    });
  };

  const removeItem = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx));
  };

  // ── Измена на приемница во нацрт ──
  const [editingId, setEditingId] = useState<number | null>(null);
  const { data: companySettings } = trpc.settings.settingsGet.useQuery();
  const editMutation = trpc.accounting.receiptEdit.useMutation({
    onSuccess: () => { toast.success("Приемницата е изменета"); utils.accounting.receiptList.invalidate(); setDialogOpen(false); setEditingId(null); resetForm(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteReceipt = trpc.accounting.receiptDelete.useMutation({
    onSuccess: () => { toast.success("Приемницата е избришана"); utils.accounting.receiptList.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const openEdit = async (r: any) => {
    const full: any = await utils.accounting.receiptById.fetch({ id: r.id });
    if (!full) return;
    setForm({
      receiptNumber: full.receiptNumber ?? "", supplierId: full.supplierId ? String(full.supplierId) : "", poId: full.poId ? String(full.poId) : "",
      warehouseId: full.warehouseId ? String(full.warehouseId) : "", receiptDate: String(full.receiptDate ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10),
      supplierDocNumber: full.supplierDocNumber ?? "", transportCost: String(full.transportCost ?? "0"), customsCost: String(full.customsCost ?? "0"),
      otherCost: String(full.otherCost ?? "0"), notes: full.notes ?? "",
    });
    setItems((full.items ?? []).map((i: any) => ({
      materialId: String(i.materialId), quantity: String(Number(i.quantity)), unit: i.unit ?? i.unitLabel ?? "kg", unitPrice: String(Number(i.unitPrice)),
      totalPrice: String(Number(i.totalPrice)), notes: i.notes ?? "", heatNumber: i.heatNumber ?? undefined, certNumber: i.certNumber ?? undefined,
      certStandard: i.certStandard ?? undefined, certUrl: i.certUrl ?? undefined,
    })));
    setEditingId(r.id);
    setDialogOpen(true);
  };
  const openPrint = async (r: any) => {
    const full: any = await utils.accounting.receiptById.fetch({ id: r.id });
    if (full) printReceipt({ ...full, items: (full.items ?? []).map((i: any) => ({ ...i, materialName: i.materialName })) }, companySettings);
  };

  const handleCreate = () => {
    if (!form.receiptNumber || !form.warehouseId) { toast.error("Пополнете ги задолжителните полиња"); return; }
    if (editingId) {
      editMutation.mutate({
        id: editingId, receiptNumber: form.receiptNumber, supplierId: form.supplierId ? parseInt(form.supplierId) : null, poId: form.poId ? parseInt(form.poId) : null,
        warehouseId: parseInt(form.warehouseId), receiptDate: form.receiptDate, supplierDocNumber: form.supplierDocNumber || undefined,
        transportCost: form.transportCost || "0", customsCost: form.customsCost || "0", otherCost: form.otherCost || "0", notes: form.notes || undefined,
        items: items.map(i => ({ materialId: parseInt(i.materialId), quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice, totalPrice: i.totalPrice,
          notes: i.notes || undefined, heatNumber: i.heatNumber, certNumber: i.certNumber, certStandard: i.certStandard, certUrl: i.certUrl })),
      });
      return;
    }
    createMutation.mutate({
      ...form,
      supplierId: form.supplierId ? parseInt(form.supplierId) : undefined,
      poId: form.poId ? parseInt(form.poId) : undefined,
      warehouseId: parseInt(form.warehouseId),
      items: items.map(i => ({
        materialId: parseInt(i.materialId),
        quantity: i.quantity,
        unit: i.unit,
        unitPrice: i.unitPrice,
        totalPrice: i.totalPrice,
        notes: i.notes,
        heatNumber: i.heatNumber,
        certNumber: i.certNumber,
        certStandard: i.certStandard,
        certUrl: i.certUrl,
      })),
    });
  };

  const handleConfirm = async (receipt: any) => {
    const full: any = await utils.accounting.receiptById.fetch({ id: receipt.id });
    if (!full?.items?.length) { toast.error("Приемницата нема ставки — додади материјали, па потврди"); openEdit(receipt); return; }
    if (!receipt.warehouseId) { toast.error("Нема избран магацин"); return; }
    const itemsToProcess = receipt.items?.map((i: any) => ({
      materialId: i.materialId,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      totalPrice: i.totalPrice,
      landedCostAlloc: i.landedCostAlloc ?? "0",
      heatNumber: i.heatNumber ?? undefined,
      certNumber: i.certNumber ?? undefined,
      certStandard: i.certStandard ?? undefined,
      certUrl: i.certUrl ?? undefined,
      supplierId: receipt.supplierId ?? undefined,
    })) ?? [];
    processMutation.mutate({
      receiptId: receipt.id,
      warehouseId: receipt.warehouseId,
      items: itemsToProcess,
      transportCost: receipt.transportCost ?? "0",
      customsCost: receipt.customsCost ?? "0",
      otherCost: receipt.otherCost ?? "0",
    });
  };

  const loadParsedIntoReceipt = (parsedDoc: any) => {
    const confirmedItems = parsedDoc.items?.filter((it: ParsedItem) => it.isConfirmed === "confirmed" || it.matchConfidence && parseFloat(String(it.matchConfidence)) > 60);

    if (!confirmedItems || confirmedItems.length === 0) {
      toast.error("Нема потврдени ставки за увоз");
      return;
    }

    // Set supplier if matched
    if (parsedDoc.supplierName && suppliersData) {
      const matchedSupplier = suppliersData.find((s: any) =>
        parsedDoc.supplierName && s.name.toLowerCase().includes(parsedDoc.supplierName.toLowerCase())
      );
      if (matchedSupplier) {
        setForm(prev => ({ ...prev, supplierId: matchedSupplier.id.toString() }));
      }
    }

    // Set document number
    if (parsedDoc.invoiceNumber) {
      setForm(prev => ({ ...prev, supplierDocNumber: parsedDoc.invoiceNumber }));
    }

    // Convert parsed items to receipt items
    const newItems = confirmedItems.map((it: ParsedItem) => ({
      materialId: it.matchedMaterialId?.toString() ?? "",
      quantity: it.quantity ?? "1",
      unit: it.unit ?? "kg",
      unitPrice: it.unitPrice ?? "0",
      totalPrice: it.totalPrice ?? (it.unitPrice && it.quantity ? (parseFloat(it.unitPrice) * parseFloat(it.quantity)).toFixed(2) : "0"),
      notes: it.rawDescription.substring(0, 100),
    })).filter((it: any) => it.materialId);

    setItems(prev => [...prev, ...newItems]);
    setParsedDialogOpen(false);
    setDialogOpen(true);
    toast.success(`Увезени ${newItems.length} ставки од парсираниот документ`);
  };

  const handleConfirmParsedItem = (item: ParsedItem, materialId?: number) => {
    updateItemMutation.mutate({
      id: item.id,
      matchedMaterialId: materialId ?? item.matchedMaterialId,
      isConfirmed: "confirmed",
    });
  };

  const handleRejectParsedItem = (itemId: number) => {
    updateItemMutation.mutate({ id: itemId, isConfirmed: "rejected" });
  };

  useEffect(() => {
    if (dialogOpen && !editingId && nextReceiptNum && !form.receiptNumber) {
      setForm(prev => ({ ...prev, receiptNumber: nextReceiptNum }));
    }
  }, [dialogOpen, nextReceiptNum]);

  return (
    <div className="space-y-4">
      <Tabs value={uploadTab} onValueChange={setUploadTab}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Приемници</h1>
          <div className="flex items-center gap-2">
            <TabsList>
              <TabsTrigger value="manual">Рачно</TabsTrigger>
              <TabsTrigger value="upload">Учитување PDF/OCR</TabsTrigger>
            </TabsList>
          </div>
        </div>

        {/* UPLOAD TAB */}
        <TabsContent value="upload" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Upload className="h-5 w-5 text-emerald-700" />
                Автоматско читање на приемница
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-emerald-500 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-10 w-10 text-gray-400 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-700">Кликнете за прикачување на PDF приемница</p>
                <p className="text-xs text-gray-500 mt-1">PDF документ со текст (не скенирана слика)</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,image/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>

              {isUploading && (
        <div className="text-center py-4">
                  <p className="text-sm text-gray-600">Се обработува PDF документот...</p>
                </div>
              )}

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-gray-500">или внесете текст рачно (OCR резултат)</span>
                </div>
              </div>

              <div className="space-y-2">
                <Textarea
                  placeholder="Залепете го текстот од OCR тука... (на пр. 'Валцана плоча 2mm - 50 kg x 85.00 = 4250.00')"
                  value={ocrText}
                  onChange={e => setOcrText(e.target.value)}
                  rows={5}
                />
                <Button
                  onClick={handleTextParse}
                  disabled={isParsingText || !ocrText.trim()}
                  className="bg-emerald-700 hover:bg-emerald-800"
                >
                  {isParsingText ? "Се парсира..." : "Парсирај текст"}
                </Button>
              </div>

              {/* Parsed Documents List */}
              {parsedDocsData && parsedDocsData.length > 0 && (
                <div className="mt-6">
                  <h4 className="font-medium text-sm mb-3">Парсирани документи</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Датотека</TableHead>
                        <TableHead className="text-xs">Добавувач</TableHead>
                        <TableHead className="text-xs">Број</TableHead>
                        <TableHead className="text-xs">Износ</TableHead>
                        <TableHead className="text-xs">Статус</TableHead>
                        <TableHead className="text-xs text-right">Акции</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedDocsData.map((doc: any) => (
                        <TableRow key={doc.id}>
                          <TableCell className="text-xs font-medium">{doc.originalFileName}</TableCell>
                          <TableCell className="text-xs">{doc.supplierName ?? "-"}</TableCell>
                          <TableCell className="text-xs">{doc.invoiceNumber ?? "-"}</TableCell>
                          <TableCell className="text-xs">{doc.totalAmount ? `${parseFloat(String(doc.totalAmount)).toFixed(2)} ${doc.currency}` : "-"}</TableCell>
                          <TableCell>
                            <Badge className="text-xs bg-blue-100 text-blue-800">
                              {parsedStatuses[doc.status]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => { setSelectedParsedId(doc.id); setParsedDialogOpen(true); }}
                              >
                                <Eye className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-red-600"
                                onClick={() => {
                                  if (confirm("Дали сте сигурни дека сакате да го избришете документот?")) {
                                    deleteParsedMutation.mutate({ id: doc.id });
                                  }
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* MANUAL TAB - Receipts List */}
        <TabsContent value="manual" className="space-y-4">
          <div className="flex items-center justify-between">
            <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o && editingId) { setEditingId(null); resetForm(); } }}>
              <DialogTrigger asChild>
                <Button className="bg-emerald-700 hover:bg-emerald-800" onClick={() => { if (editingId) { setEditingId(null); resetForm(); } }}><Plus className="h-4 w-4 mr-1" /> Нова приемница</Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>{editingId ? `Измени приемница ${form.receiptNumber}` : "Нова приемница"}</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 space-y-1.5">
                    <Label className="text-emerald-900">По набавна нарачка <span className="font-normal text-emerald-700/70">(незадолжително)</span></Label>
                    <Select value={form.poId || "none"} onValueChange={v => { if (v === "none") { setForm({ ...form, poId: "" }); } else loadPo(v); }}>
                      <SelectTrigger className="bg-white w-full"><SelectValue placeholder="Без нарачка" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none"><span className="text-gray-500">Без нарачка — рачно внесување</span></SelectItem>
                        {openPos.map((p: any) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            <span className="font-mono text-xs font-semibold">{p.poNumber}</span>
                            <span className="text-gray-600"> · {p.supplierName}</span>
                            <span className="text-gray-400"> · {Number(p.totalAmount).toLocaleString("mk-MK")} ден.{p.status === "partial" ? " · делумно примена" : ""}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-emerald-800/80">{form.poId ? "Ставките се од нарачката (преостаната количина). При потврдување, примената количина се запишува на нарачката." : openPos.length ? `${openPos.length} отворени нарачки — избери за ставките да се пополнат сами` : "Нема отворени набавни нарачки"}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1"><Label>Број *</Label><Input value={form.receiptNumber} onChange={e => setForm({ ...form, receiptNumber: e.target.value })} placeholder="ПР-001/2025" /></div>
                    <div className="space-y-1"><Label>Датум *</Label><DateInput value={form.receiptDate} onChange={e => setForm({ ...form, receiptDate: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1"><Label>Магацин *</Label>
                      <Select value={form.warehouseId} onValueChange={v => setForm({ ...form, warehouseId: v })}>
                        <SelectTrigger><SelectValue placeholder="Избери магацин" /></SelectTrigger>
                        <SelectContent>{warehousesData?.map((w: any) => <SelectItem key={w.id} value={w.id.toString()}>{w.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1"><Label>Добавувач</Label>
                      <Select value={form.supplierId} onValueChange={v => setForm({ ...form, supplierId: v })}>
                        <SelectTrigger><SelectValue placeholder="Избери добавувач" /></SelectTrigger>
                        <SelectContent>{suppliersData?.map((s: any) => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1"><Label>Број на документ од добавувач</Label><Input value={form.supplierDocNumber} onChange={e => setForm({ ...form, supplierDocNumber: e.target.value })} /></div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1"><Label>Транспорт</Label><Input type="number" value={form.transportCost} onChange={e => setForm({ ...form, transportCost: e.target.value })} /></div>
                    <div className="space-y-1"><Label>Царина</Label><Input type="number" value={form.customsCost} onChange={e => setForm({ ...form, customsCost: e.target.value })} /></div>
                    <div className="space-y-1"><Label>Други трошоци</Label><Input type="number" value={form.otherCost} onChange={e => setForm({ ...form, otherCost: e.target.value })} /></div>
                  </div>

                  <div className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium text-sm">Ставки {items.length > 0 && <span className="text-xs text-gray-500">({items.length})</span>}</h4>
                      {items.length > 0 && (
                        <Button size="sm" variant="ghost" className="text-red-600 h-6 text-xs" onClick={() => setItems([])}>
                          <Trash2 className="h-3 w-3 mr-1" /> Исчисти
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_6rem_7rem_auto] gap-2 items-end">
                      <div className="space-y-1 min-w-0">
                        <Label className="text-[11px] text-gray-500">Материјал</Label>
                        <MaterialPicker materials={materialsData as any} value={itemForm.materialId}
                          onSelect={(m) => setItemForm({ ...itemForm, materialId: String(m.id), unitPrice: itemForm.unitPrice && itemForm.unitPrice !== "0" ? itemForm.unitPrice : String(m.lastPurchasePrice ?? m.avgCost ?? "") })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-gray-500">Количина</Label>
                        <Input type="number" step="0.001" className="text-xs" value={itemForm.quantity} onChange={e => setItemForm({ ...itemForm, quantity: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-gray-500">Цена (ден.)</Label>
                        <Input type="number" step="0.01" className="text-xs" value={itemForm.unitPrice} onChange={e => setItemForm({ ...itemForm, unitPrice: e.target.value })} />
                      </div>
                      <Button type="button" variant="outline" size="sm" className="h-9" onClick={addItem}>+ Додади</Button>
                    </div>

                    <button type="button" onClick={() => setShowCertFields(!showCertFields)}
                      className="text-[11px] text-blue-600 hover:text-blue-800 underline">
                      {showCertFields ? "Скрий ги полињата за атест" : "Шаржа / атест (за носечки конструкции)"}
                    </button>

                    {showCertFields && (
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 p-2.5 rounded-lg bg-blue-50/60 border border-blue-100">
                        <div className="space-y-1">
                          <Label className="text-[11px] text-gray-500">Шаржа (heat no.)</Label>
                          <Input className="text-xs h-8" placeholder="на пр. 512884"
                            value={itemForm.heatNumber}
                            onChange={e => setItemForm({ ...itemForm, heatNumber: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-gray-500">Број на атест</Label>
                          <Input className="text-xs h-8" placeholder="на пр. 3.1/2026-441"
                            value={itemForm.certNumber}
                            onChange={e => setItemForm({ ...itemForm, certNumber: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-gray-500">Квалитет / стандард</Label>
                          <Input className="text-xs h-8" placeholder="S235JR EN 10025"
                            value={itemForm.certStandard}
                            onChange={e => setItemForm({ ...itemForm, certStandard: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-gray-500">Линк до PDF</Label>
                          <Input className="text-xs h-8" placeholder="https://…"
                            value={itemForm.certUrl}
                            onChange={e => setItemForm({ ...itemForm, certUrl: e.target.value })} />
                        </div>
                        <p className="md:col-span-4 text-[10px] text-gray-500">
                          Останува пополнето за следната ставка — обично целата испорака е од иста шаржа.
                        </p>
                      </div>
                    )}
                    {items.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="hidden md:grid md:grid-cols-[1fr_7rem_6rem_6.5rem_2rem] gap-2 px-2 text-[11px] uppercase tracking-wide text-gray-400">
                          <span>Материјал</span><span>Кол.</span><span>Цена</span><span className="text-right">Вкупно</span><span></span>
                        </div>
                        {items.map((it, idx) => {
                          const m = materialsData?.find((x: any) => x.id.toString() === it.materialId);
                          return (
                            <div key={idx} className="grid grid-cols-[1fr_7rem_6rem_6.5rem_2rem] gap-2 items-center bg-white border rounded-md px-2 py-1.5">
                              <span className="text-xs truncate">
                                <span className="font-mono text-[10px] text-gray-400 mr-1">{m?.code}</span>{m?.name}
                                {it.heatNumber && (
                                  <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-mono">
                                    ш. {it.heatNumber}
                                  </span>
                                )}
                              </span>
                              <span className="flex items-center gap-1"><Input type="number" step="0.001" min="0" className="h-7 text-xs px-1.5 text-right" value={it.quantity} onChange={e => setItemQty(idx, e.target.value)} /><span className="text-[10px] text-gray-400">{it.unit}</span></span>
                              <span className="text-xs">{Number(it.unitPrice).toLocaleString("mk-MK")}</span>
                              <span className="text-xs font-medium text-right whitespace-nowrap">{Number(it.totalPrice).toLocaleString("mk-MK")}</span>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500" onClick={() => removeItem(idx)}>
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1"><Label>Белешки</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
                  <Button onClick={handleCreate} disabled={createMutation.isPending || editMutation.isPending} className="w-full bg-emerald-700 hover:bg-emerald-800">
                    {createMutation.isPending || editMutation.isPending ? "Зачувување..." : editingId ? "Зачувај измени" : "Креирај приемница"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {(draftReceipts?.length ?? 0) > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
              <div className="flex-1 min-w-[220px] text-sm text-amber-900">
                <b>{draftReceipts!.length} {draftReceipts!.length === 1 ? "приемница е" : "приемници се"} во нацрт</b> — залихата за нив уште не е зголемена:{" "}
                <span className="font-mono text-xs">{draftReceipts!.slice(0, 6).map((r: any) => r.receiptNumber).join(", ")}{draftReceipts!.length > 6 ? "…" : ""}</span>
              </div>
              <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" disabled={bulkBusy} onClick={confirmAllDrafts}>
                {bulkBusy ? "Се потврдува..." : "Потврди ги сите"}
              </Button>
            </div>
          )}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" /><Input className="pl-9" placeholder="Пребарај приемници..." value={search} onChange={e => setSearch(e.target.value)} /></div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Сите статуси</SelectItem>
                    <SelectItem value="draft">Нацрт</SelectItem>
                    <SelectItem value="confirmed">Потврдена</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Број</TableHead><TableHead>Добавувач</TableHead><TableHead>Магацин</TableHead><TableHead>Датум</TableHead><TableHead className="text-right">Износ</TableHead><TableHead>Трошоци</TableHead><TableHead>Статус</TableHead><TableHead className="text-right">Акции</TableHead></TableRow></TableHeader>
                <TableBody>
                  {receiptsData?.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium"><button className="hover:underline text-left" onClick={() => r.status === "draft" ? openEdit(r) : openPrint(r)}>{r.receiptNumber}</button></TableCell>
                      <TableCell>{r.supplierName ?? "-"}</TableCell>
                      <TableCell>
                        {warehousesData?.find((w: any) => w.id === r.warehouseId)?.name ?? "—"}
                        {r.poId && <div className="text-[11px] text-emerald-700">по {poListData?.find((p: any) => p.id === r.poId)?.poNumber ?? "нарачка"}</div>}
                      </TableCell>
                      <TableCell>{formatDate(r.receiptDate)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{Number(r.totalAmount ?? 0).toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ден.</TableCell>
                      <TableCell className="text-xs">
                        {(parseFloat(r.transportCost ?? "0") + parseFloat(r.customsCost ?? "0") + parseFloat(r.otherCost ?? "0")).toFixed(2)} ден.
                      </TableCell>
                      <TableCell><Badge className={statusColors[r.status]}>{statuses[r.status]}</Badge></TableCell>
                      <TableCell className="text-right">
                        {r.supplierId && (
                          <Button size="sm" variant="ghost" className="text-red-600 mr-1" title="Рекламација до добавувачот (неусогласеност)"
                            onClick={() => navigate(`/kvalitet?new=1&kind=supplier&supplier=${r.supplierId}&title=${encodeURIComponent(`Приемница ${r.receiptNumber}: `)}`)}>
                            <ShieldAlert className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {r.status === "draft" && (<>
                          <Button size="sm" variant="ghost" className="mr-1" title="Измени" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button size="sm" variant="ghost" className="text-red-500 mr-1" title="Избриши" onClick={() => { if (confirm(`Да се избрише приемницата ${r.receiptNumber}?`)) deleteReceipt.mutate({ id: r.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </>)}
                        {r.status !== "draft" && (
                          <Button size="sm" variant="ghost" className="mr-1" title="Печати" onClick={() => openPrint(r)}><Printer className="h-3.5 w-3.5" /></Button>
                        )}
                        {r.status === "draft" && (
                          <Button size="sm" variant="outline" className="text-emerald-700" onClick={() => handleConfirm(r)} disabled={processMutation.isPending}>
                            <CheckCircle className="h-3 w-3 mr-1" /> Потврди
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!receiptsData || receiptsData.length === 0) && <TableRow><TableCell colSpan={7} className="text-center text-gray-500 py-8">Нема приемници</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Parsed Document Dialog */}
      <Dialog open={parsedDialogOpen} onOpenChange={setParsedDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-emerald-700" />
              Парсиран документ
            </DialogTitle>
          </DialogHeader>

          {selectedParsedDoc && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><span className="text-gray-500">Добавувач:</span> {selectedParsedDoc.supplierName ?? "-"}</div>
                <div><span className="text-gray-500">Број:</span> {selectedParsedDoc.invoiceNumber ?? "-"}</div>
                <div><span className="text-gray-500">Вкупно:</span> {selectedParsedDoc.totalAmount ? `${parseFloat(String(selectedParsedDoc.totalAmount)).toFixed(2)} ${selectedParsedDoc.currency ?? "MKD"}` : "-"}</div>
              </div>

              {selectedParsedDoc.items && selectedParsedDoc.items.length > 0 ? (
                <div className="space-y-2">
                  <h4 className="font-medium text-sm">Препознати ставки ({selectedParsedDoc.items.length})</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs w-8">#</TableHead>
                        <TableHead className="text-xs">Оригинален опис</TableHead>
                        <TableHead className="text-xs">Поклопен материјал</TableHead>
                        <TableHead className="text-xs text-center">Сигурност</TableHead>
                        <TableHead className="text-xs">Кол.</TableHead>
                        <TableHead className="text-xs">Цена</TableHead>
                        <TableHead className="text-xs">Статус</TableHead>
                        <TableHead className="text-xs text-right">Акции</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedParsedDoc.items.map((item: ParsedItem, idx: number) => (
                        <TableRow key={item.id}>
                          <TableCell className="text-xs">{idx + 1}</TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate" title={item.rawDescription}>{item.rawDescription}</TableCell>
                          <TableCell className="text-xs">
                            {item.matchedMaterialId ? (
                              <div>
                                <span className="font-medium text-emerald-700">{item.matchedMaterialName}</span>
                                <div className="text-xs text-gray-500">
                                  <Select
                                    value={item.matchedMaterialId?.toString() ?? ""}
                                    onValueChange={(v) => handleConfirmParsedItem(item, parseInt(v))}
                                  >
                                    <SelectTrigger className="h-6 text-xs mt-1"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {matchMaterialsData?.map((m: any) => (
                                        <SelectItem key={m.id} value={m.id.toString()}>{m.name} ({m.code})</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                            ) : (
                              <div>
                                <span className="text-gray-400">Нема поклопување</span>
                                <Select
                                  value={item.matchedMaterialId?.toString() ?? ""}
                                  onValueChange={(v) => handleConfirmParsedItem(item, parseInt(v))}
                                >
                                  <SelectTrigger className="h-6 text-xs mt-1"><SelectValue placeholder="Избери материјал" /></SelectTrigger>
                                  <SelectContent>
                                    {matchMaterialsData?.map((m: any) => (
                                      <SelectItem key={m.id} value={m.id.toString()}>{m.name} ({m.code})</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-center">
                            {item.matchConfidence ? (
                              <Badge className={parseFloat(String(item.matchConfidence)) > 70 ? "bg-emerald-100 text-emerald-800" : parseFloat(String(item.matchConfidence)) > 40 ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800"}>
                                {Math.round(parseFloat(String(item.matchConfidence)))}%
                              </Badge>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">{item.quantity ?? "-"} {item.unit ?? ""}</TableCell>
                          <TableCell className="text-xs">{item.unitPrice ?? "-"}</TableCell>
                          <TableCell>
                            <Badge className={itemStatusColors[item.isConfirmed] + " text-xs"}>
                              {itemStatuses[item.isConfirmed]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {item.isConfirmed !== "confirmed" && (
                                <Button size="sm" variant="outline" className="h-6 text-xs text-emerald-700" onClick={() => handleConfirmParsedItem(item)}>
                                  <CheckCircle className="h-3 w-3 mr-1" /> Потврди
                                </Button>
                              )}
                              {item.isConfirmed !== "rejected" && (
                                <Button size="sm" variant="outline" className="h-6 text-xs text-red-600" onClick={() => handleRejectParsedItem(item.id)}>
                                  <X className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <AlertCircle className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                  <p>Нема препознати ставки</p>
                  <p className="text-xs mt-1">Проверете дали PDF-от содржи текст или внесете текст рачно</p>
                </div>
              )}

              {/* Raw text preview */}
              {selectedParsedDoc.rawText && (
                <div className="space-y-1">
                  <Label className="text-xs">Извлечен текст:</Label>
                  <Textarea
                    value={selectedParsedDoc.rawText}
                    readOnly
                    rows={6}
                    className="text-xs font-mono bg-gray-50"
                  />
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  className="flex-1 bg-emerald-700 hover:bg-emerald-800"
                  onClick={() => loadParsedIntoReceipt(selectedParsedDoc)}
                  disabled={!selectedParsedDoc.items?.some((it: ParsedItem) => it.isConfirmed === "confirmed" || (it.matchConfidence && parseFloat(String(it.matchConfidence)) > 60))}
                >
                  <ClipboardCheck className="h-4 w-4 mr-2" />
                  Увези потврдени ставки во приемница
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
