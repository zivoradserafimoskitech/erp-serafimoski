import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { Search, FileText, Download, Radio, RefreshCw, Send, SearchIcon } from "lucide-react";

// е-Фактура (УЈП): сертификати и праќање
export default function UJPEFakturaTab() {
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
            <div className="bg-primary/10 p-3 rounded-lg">
              <h4 className="font-semibold text-foreground/80 mb-1">Статуси</h4>
              <p className="text-primary text-xs">00=Нацрт, 01=Поднесена</p>
              <p className="text-primary text-xs">03=Прифатена, 05=Одбиена, 07=Анулирана</p>
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
                ujpInvoices.map((inv: any) => (
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

            <div className="bg-primary/10 p-3 rounded-lg text-sm text-primary mb-2 mt-4">
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
                <FileText className="h-4 w-4 text-primary" />
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
                      🔐 {cert.name} ({cert.issuer}) - до {cert.validTo ? formatDate(cert.validTo) : "?"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {certificates && certificates.length === 0 && (
                <p className="text-xs text-primary bg-primary/10 p-2 rounded">
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
                  <div className="mt-2 text-primary text-xs">
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

      {/* XML Dialog */}
      <Dialog open={xmlDialog} onOpenChange={setXmlDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>УЈП XML Фактура</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Textarea value={xmlContent} readOnly className="font-mono text-xs h-96" />
            <Button onClick={handleDownloadXml} className="w-full">
              <Download className="h-4 w-4 mr-2" />Превземи XML
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===== EMAIL INVOICES TAB (издвоено од UJPEFakturaTab каде беше недостапно) =====
