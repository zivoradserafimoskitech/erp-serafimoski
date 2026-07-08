import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Building2, Ruler, ArrowRightLeft, Save, Shield, Upload, KeyRound } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export default function SettingsPage() {
  const utils = trpc.useUtils();
  const { data: settings } = trpc.settings.settingsGet.useQuery();
  const { data: unitsData } = trpc.settings.unitList.useQuery();
  const { data: conversionsData } = trpc.settings.conversionList.useQuery();

  const [form, setForm] = useState({
    name: settings?.name ?? "", address: settings?.address ?? "", edb: settings?.edb ?? "", embs: settings?.embs ?? "",
    bankName: settings?.bankName ?? "", bankAccount: settings?.bankAccount ?? "", phone: settings?.phone ?? "",
    email: settings?.email ?? "", defaultVatRate: settings?.defaultVatRate ?? "18",
    valuationMethod: settings?.valuationMethod ?? "weighted_average", currency: settings?.currency ?? "MKD",
  });

  const [unitForm, setUnitForm] = useState({ code: "", name: "", nameMk: "", category: "weight" as string });
  const [convForm, setConvForm] = useState({ fromUnitId: "", toUnitId: "", factor: "", materialType: "", description: "" });

  // Certificate form
  const [certForm, setCertForm] = useState({
    name: "",
    certType: "qualified" as "qualified" | "advanced" | "test",
    certificatePem: "",
    privateKeyPem: "",
    issuer: "",
    serialNumber: "",
    validFrom: "",
    validTo: "",
    edb: "",
  });

  const upsertMutation = trpc.settings.settingsUpsert.useMutation({
    onSuccess: () => { utils.settings.settingsGet.invalidate(); toast.success("Подесувањата се зачувани"); },
  });
  const unitCreate = trpc.settings.unitCreate.useMutation({ onSuccess: () => { utils.settings.unitList.invalidate(); setUnitForm({ code: "", name: "", nameMk: "", category: "weight" }); } });
  const unitDelete = trpc.settings.unitDelete.useMutation({ onSuccess: () => utils.settings.unitList.invalidate() });
  const convCreate = trpc.settings.conversionCreate.useMutation({ onSuccess: () => { utils.settings.conversionList.invalidate(); setConvForm({ fromUnitId: "", toUnitId: "", factor: "", materialType: "", description: "" }); } });
  const convDelete = trpc.settings.conversionDelete.useMutation({ onSuccess: () => utils.settings.conversionList.invalidate() });

  // Certificate queries
  const { data: certificatesData } = trpc.accounting.certificateList.useQuery();
  const certStoreMutation = trpc.accounting.certificateStore.useMutation({
    onSuccess: () => {
      utils.accounting.certificateList.invalidate();
      toast.success("Сертификатот е зачуван");
      setCertForm({ name: "", certType: "qualified", certificatePem: "", privateKeyPem: "", issuer: "", serialNumber: "", validFrom: "", validTo: "", edb: "" });
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = () => upsertMutation.mutate(form);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Подесувања</h1>
      <Tabs defaultValue="company">
        <TabsList className="bg-emerald-50">
          <TabsTrigger value="company"><Building2 className="h-4 w-4 mr-1" /> Фирма</TabsTrigger>
          <TabsTrigger value="units"><Ruler className="h-4 w-4 mr-1" /> Единици</TabsTrigger>
          <TabsTrigger value="conversions"><ArrowRightLeft className="h-4 w-4 mr-1" /> Конверзии</TabsTrigger>
          <TabsTrigger value="certificates"><Shield className="h-4 w-4 mr-1" /> Сертификати</TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Податоци за фирмата</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Назив *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                <div className="space-y-1"><Label>ЕДБ *</Label><Input value={form.edb} onChange={e => setForm({ ...form, edb: e.target.value })} /></div>
              </div>
              <div className="space-y-1"><Label>Адреса</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1"><Label>ЕМБС</Label><Input value={form.embs} onChange={e => setForm({ ...form, embs: e.target.value })} /></div>
                <div className="space-y-1"><Label>Банка</Label><Input value={form.bankName} onChange={e => setForm({ ...form, bankName: e.target.value })} /></div>
                <div className="space-y-1"><Label>Жиро сметка</Label><Input value={form.bankAccount} onChange={e => setForm({ ...form, bankAccount: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Телефон</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                <div className="space-y-1"><Label>Е-маил</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1"><Label>ДДВ %</Label><Input value={form.defaultVatRate} onChange={e => setForm({ ...form, defaultVatRate: e.target.value })} /></div>
                <div className="space-y-1"><Label>Валута</Label><Input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} /></div>
                <div className="space-y-1"><Label>Вреднување</Label>
                  <Select value={form.valuationMethod} onValueChange={v => setForm({ ...form, valuationMethod: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weighted_average">Просечна пондерирана</SelectItem>
                      <SelectItem value="fifo">FIFO</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={handleSave} disabled={upsertMutation.isPending} className="bg-emerald-700 hover:bg-emerald-800"><Save className="h-4 w-4 mr-1" /> Зачувај</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="units" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Единици мерка</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-4 gap-2">
                <Input placeholder="Код" value={unitForm.code} onChange={e => setUnitForm({ ...unitForm, code: e.target.value })} />
                <Input placeholder="Назив" value={unitForm.name} onChange={e => setUnitForm({ ...unitForm, name: e.target.value })} />
                <Select value={unitForm.category} onValueChange={v => setUnitForm({ ...unitForm, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weight">Тежина</SelectItem><SelectItem value="length">Должина</SelectItem>
                    <SelectItem value="area">Површина</SelectItem><SelectItem value="volume">Волумен</SelectItem>
                    <SelectItem value="piece">Парче</SelectItem><SelectItem value="time">Време</SelectItem>
                    <SelectItem value="other">Друго</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={() => unitCreate.mutate(unitForm)}>Додади</Button>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>Код</TableHead><TableHead>Назив</TableHead><TableHead>Категорија</TableHead><TableHead className="w-20"></TableHead></TableRow></TableHeader>
                <TableBody>
                  {unitsData?.map(u => (
                    <TableRow key={u.id}><TableCell className="font-medium">{u.code}</TableCell><TableCell>{u.name}</TableCell><TableCell>{u.category}</TableCell>
                      <TableCell><Button size="sm" variant="ghost" className="text-red-600" onClick={() => unitDelete.mutate({ id: u.id })}>Избриши</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conversions" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Фактори на конверзија</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-5 gap-2">
                <Select value={convForm.fromUnitId} onValueChange={v => setConvForm({ ...convForm, fromUnitId: v })}>
                  <SelectTrigger><SelectValue placeholder="Од" /></SelectTrigger>
                  <SelectContent>{unitsData?.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.code}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={convForm.toUnitId} onValueChange={v => setConvForm({ ...convForm, toUnitId: v })}>
                  <SelectTrigger><SelectValue placeholder="Во" /></SelectTrigger>
                  <SelectContent>{unitsData?.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.code}</SelectItem>)}</SelectContent>
                </Select>
                <Input placeholder="Фактор" value={convForm.factor} onChange={e => setConvForm({ ...convForm, factor: e.target.value })} />
                <Input placeholder="Тип материјал" value={convForm.materialType} onChange={e => setConvForm({ ...convForm, materialType: e.target.value })} />
                <Button variant="outline" onClick={() => convCreate.mutate({ ...convForm, fromUnitId: parseInt(convForm.fromUnitId), toUnitId: parseInt(convForm.toUnitId), factor: convForm.factor })}>Додади</Button>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>Од</TableHead><TableHead>Во</TableHead><TableHead>Фактор</TableHead><TableHead>Материјал</TableHead><TableHead className="w-20"></TableHead></TableRow></TableHeader>
                <TableBody>
                  {conversionsData?.map(c => {
                    const fromU = unitsData?.find(u => u.id === c.fromUnitId);
                    const toU = unitsData?.find(u => u.id === c.toUnitId);
                    return <TableRow key={c.id}><TableCell>{fromU?.code ?? c.fromUnitId}</TableCell><TableCell>{toU?.code ?? c.toUnitId}</TableCell><TableCell>{c.factor}</TableCell><TableCell>{c.materialType ?? "-"}</TableCell>
                      <TableCell><Button size="sm" variant="ghost" className="text-red-600" onClick={() => convDelete.mutate({ id: c.id })}>Избриши</Button></TableCell>
                    </TableRow>;
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="certificates" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-emerald-700" />
                Дигитални сертификати за УЈП е-Фактура
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-700">
                <b>Информација:</b> За испраќање на фактури до УЈП со правна важност,
                потребен е квалификуван дигитален сертификат издаден од акредитиран давател
                (Семос, Кибермет, КЕП итн.). Сертификатот и приватниот клуч се чуваат енкриптирани.
              </div>

              {/* Certificate Form */}
              <div className="border rounded-lg p-4 space-y-3">
                <h4 className="font-medium text-sm flex items-center gap-2">
                  <KeyRound className="h-4 w-4" />
                  Додади нов сертификат
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Име *</Label>
                    <Input value={certForm.name} onChange={e => setCertForm({ ...certForm, name: e.target.value })} placeholder="на пр. Сертификат 2025" />
                  </div>
                  <div className="space-y-1">
                    <Label>Тип *</Label>
                    <Select value={certForm.certType} onValueChange={v => setCertForm({ ...certForm, certType: v as any })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="qualified">Квалификуван (QES)</SelectItem>
                        <SelectItem value="advanced">Напреден (AdES)</SelectItem>
                        <SelectItem value="test">Тест</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Издавач</Label>
                    <Input value={certForm.issuer} onChange={e => setCertForm({ ...certForm, issuer: e.target.value })} placeholder="на пр. Семос" />
                  </div>
                  <div className="space-y-1">
                    <Label>Сериски број</Label>
                    <Input value={certForm.serialNumber} onChange={e => setCertForm({ ...certForm, serialNumber: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label>Важи од</Label>
                    <Input type="date" value={certForm.validFrom} onChange={e => setCertForm({ ...certForm, validFrom: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>Важи до</Label>
                    <Input type="date" value={certForm.validTo} onChange={e => setCertForm({ ...certForm, validTo: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>ЕДБ</Label>
                    <Input value={certForm.edb} onChange={e => setCertForm({ ...certForm, edb: e.target.value })} placeholder="MK1234567890123" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="flex items-center gap-2">
                    <Upload className="h-3 w-3" />
                    Сертификат (PEM формат) *
                  </Label>
                  <Textarea
                    value={certForm.certificatePem}
                    onChange={e => setCertForm({ ...certForm, certificatePem: e.target.value })}
                    placeholder="-----BEGIN CERTIFICATE-----\nMIIF...\n-----END CERTIFICATE-----"
                    rows={4}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="flex items-center gap-2">
                    <KeyRound className="h-3 w-3" />
                    Приватен клуч (PEM формат, опционално)
                  </Label>
                  <Textarea
                    value={certForm.privateKeyPem}
                    onChange={e => setCertForm({ ...certForm, privateKeyPem: e.target.value })}
                    placeholder="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----"
                    rows={4}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-gray-500">Приватниот клуч се чува енкриптиран со AES-256. Без него, потпишувањето нема да функционира.</p>
                </div>
                <Button
                  onClick={() => certStoreMutation.mutate(certForm)}
                  disabled={certStoreMutation.isPending || !certForm.name || !certForm.certificatePem}
                  className="bg-emerald-700 hover:bg-emerald-800"
                >
                  <Save className="h-4 w-4 mr-1" />
                  {certStoreMutation.isPending ? "Зачувување..." : "Зачувај сертификат"}
                </Button>
              </div>

              {/* Certificate List */}
              <div className="space-y-2">
                <h4 className="font-medium text-sm">Зачувани сертификати</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Име</TableHead>
                      <TableHead>Тип</TableHead>
                      <TableHead>Издавач</TableHead>
                      <TableHead>Важи до</TableHead>
                      <TableHead>ЕДБ</TableHead>
                      <TableHead>Статус</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!certificatesData?.length ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-gray-500 py-6">
                          Нема зачувани сертификати
                        </TableCell>
                      </TableRow>
                    ) : (
                      certificatesData.map(cert => (
                        <TableRow key={cert.id}>
                          <TableCell className="font-medium">{cert.name}</TableCell>
                          <TableCell>
                            {cert.certType === "qualified" ? (
                              <Badge className="bg-emerald-100 text-emerald-700">Квалификуван</Badge>
                            ) : cert.certType === "advanced" ? (
                              <Badge className="bg-blue-100 text-blue-700">Напреден</Badge>
                            ) : (
                              <Badge className="bg-gray-100 text-gray-700">Тест</Badge>
                            )}
                          </TableCell>
                          <TableCell>{cert.issuer ?? "-"}</TableCell>
                          <TableCell>{cert.validTo ? new Date(cert.validTo).toLocaleDateString("mk-MK") : "-"}</TableCell>
                          <TableCell className="font-mono text-xs">{cert.edb ?? "-"}</TableCell>
                          <TableCell>
                            {cert.isActive === "active" ? (
                              <Badge className="bg-emerald-100 text-emerald-700">Активен</Badge>
                            ) : cert.isActive === "expired" ? (
                              <Badge className="bg-red-100 text-red-700">Истечен</Badge>
                            ) : (
                              <Badge className="bg-gray-100 text-gray-700">Неактивен</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
