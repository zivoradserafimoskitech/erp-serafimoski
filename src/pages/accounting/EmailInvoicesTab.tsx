import { openStoredFile } from "@/lib/stored-file";
import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import { Search, Trash2, Eye, FileText, RefreshCw, Upload, CheckCircle } from "lucide-react";

// Фактури пристигнати по е-пошта
export default function EmailInvoicesTab() {
  const utils = trpc.useUtils();
  const [emailSinceDays, setEmailSinceDays] = useState(7);
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
  const deleteEmailMutation = trpc.email.delete.useMutation({
    onSuccess: () => refetchEmail(),
  });

  return (
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
                    emailInvoicesList.map((ei: any) => (
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
                        <TableCell className="text-xs">{formatDate(ei.receivedAt)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {ei.hasPdf && (
                              <Button size="sm" variant="outline" className="h-6 text-xs text-emerald-600" onClick={() => openStoredFile(utils.accounting.documentFile.fetch, "email_invoice", ei.id).catch((e) => toast.error(e.message))}>
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
  );
}
