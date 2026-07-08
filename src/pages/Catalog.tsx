import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Cog, Users, Percent, Layers, Calculator, Zap, Wrench, Fuel, Clock, ArrowRight } from "lucide-react";

const machineTypes: Record<string, string> = { laser: "Ласер", plasma: "Плазма", bending: "Апкант", welding: "Заварување", painting: "Фарбање", grinding: "Брусење", drilling: "Бушило", cnc: "ЦНЦ", other: "Друго" };
const rateTypes: Record<string, string> = { pct_of_labor: "% од труд", per_hour: "по час", per_m2: "по m2", fixed: "фиксен" };

export default function CatalogPage() {
  const utils = trpc.useUtils();
  const { data: machinesData } = trpc.catalog.machineList.useQuery();
  const { data: laborData } = trpc.catalog.laborRateList.useQuery();
  const { data: overheadData } = trpc.catalog.overheadList.useQuery();
  const { data: productsData } = trpc.quotation.productList.useQuery();
  const { data: materialsData } = trpc.storage.materialList.useQuery();
  const { data: servicesData } = trpc.quotation.serviceList.useQuery();

  const [activeProduct, setActiveProduct] = useState<number | null>(null);
  const { data: bomData } = trpc.catalog.bomList.useQuery({ productId: activeProduct! }, { enabled: !!activeProduct });

  // Machine form
  const [machForm, setMachForm] = useState({ name: "", code: "", type: "laser" as string, costPerHour: "0", costPerMeter: "0", annualAmortization: "0", annualElectricity: "0", annualGas: "0", annualService: "0", annualHours: "2000" });
  const machCreate = trpc.catalog.machineCreate.useMutation({ onSuccess: () => { utils.catalog.machineList.invalidate(); setMachForm({ name: "", code: "", type: "laser", costPerHour: "0", costPerMeter: "0", annualAmortization: "0", annualElectricity: "0", annualGas: "0", annualService: "0", annualHours: "2000" }); } });
  const machDelete = trpc.catalog.machineDelete.useMutation({ onSuccess: () => utils.catalog.machineList.invalidate() });

  // Machine hour calculator
  const [calcMachineId, setCalcMachineId] = useState<string>("");
  const [calcForm, setCalcForm] = useState({
    annualAmortization: "",
    annualElectricity: "",
    annualGas: "",
    annualService: "",
    annualOther: "",
    annualHours: "2000",
  });
  const [calcResult, setCalcResult] = useState<any>(null);
  const machineCalcMutation = trpc.catalog.machineCalculate.useMutation({
    onSuccess: (data) => {
      setCalcResult(data);
      utils.catalog.machineList.invalidate();
      toast.success(`Машински час пресметан: ${data.costPerHour} ден/час`);
    },
    onError: (e) => toast.error(e.message),
  });

  // Labor form
  const [laborForm, setLaborForm] = useState({ role: "", roleCode: "", costPerHour: "", grossSalary: "0", contributionsPct: "32", description: "" });
  const laborCreate = trpc.catalog.laborRateCreate.useMutation({ onSuccess: () => { utils.catalog.laborRateList.invalidate(); setLaborForm({ role: "", roleCode: "", costPerHour: "", grossSalary: "0", contributionsPct: "32", description: "" }); } });
  const laborDelete = trpc.catalog.laborRateDelete.useMutation({ onSuccess: () => utils.catalog.laborRateList.invalidate() });

  // Overhead form
  const [ohForm, setOhForm] = useState({ name: "", rateType: "pct_of_labor" as string, rateValue: "", annualAmount: "0", description: "" });
  const ohCreate = trpc.catalog.overheadCreate.useMutation({ onSuccess: () => { utils.catalog.overheadList.invalidate(); setOhForm({ name: "", rateType: "pct_of_labor", rateValue: "", annualAmount: "0", description: "" }); } });
  const ohDelete = trpc.catalog.overheadDelete.useMutation({ onSuccess: () => utils.catalog.overheadList.invalidate() });

  // BOM form
  const [bomForm, setBomForm] = useState({ kind: "material" as string, refId: "", perUnit: "", wastePct: "0", scale: "area" as string, notes: "", sortOrder: 0 });
  const bomCreate = trpc.catalog.bomCreate.useMutation({ onSuccess: () => utils.catalog.bomList.invalidate() });
  const bomDelete = trpc.catalog.bomDelete.useMutation({ onSuccess: () => utils.catalog.bomList.invalidate() });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Каталог</h1>
      <Tabs defaultValue="machines">
        <TabsList className="bg-emerald-50">
          <TabsTrigger value="machines"><Cog className="h-4 w-4 mr-1" /> Машини</TabsTrigger>
          <TabsTrigger value="labor"><Users className="h-4 w-4 mr-1" /> Труд</TabsTrigger>
          <TabsTrigger value="overhead"><Percent className="h-4 w-4 mr-1" /> Режија</TabsTrigger>
          <TabsTrigger value="bom"><Layers className="h-4 w-4 mr-1" /> Нормативи (BOM)</TabsTrigger>
        </TabsList>

        <TabsContent value="machines" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Машини</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-6 gap-2 text-xs">
                <Input placeholder="Назив" value={machForm.name} onChange={e => setMachForm({ ...machForm, name: e.target.value })} />
                <Input placeholder="Код" value={machForm.code} onChange={e => setMachForm({ ...machForm, code: e.target.value })} />
                <Select value={machForm.type} onValueChange={v => setMachForm({ ...machForm, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(machineTypes).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
                <Input placeholder="Цена/час" value={machForm.costPerHour} onChange={e => setMachForm({ ...machForm, costPerHour: e.target.value })} />
                <Input placeholder="Цена/метар" value={machForm.costPerMeter} onChange={e => setMachForm({ ...machForm, costPerMeter: e.target.value })} />
                <Button variant="outline" onClick={() => machCreate.mutate(machForm as any)}>Додади</Button>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>Код</TableHead><TableHead>Назив</TableHead><TableHead>Тип</TableHead><TableHead>Цена/час</TableHead><TableHead>Амортизација</TableHead><TableHead className="w-20"></TableHead></TableRow></TableHeader>
                <TableBody>
                  {machinesData?.map(m => (
                    <TableRow key={m.id}><TableCell className="font-medium">{m.code}</TableCell><TableCell>{m.name}</TableCell><TableCell>{machineTypes[m.type]}</TableCell>
                      <TableCell>{m.costPerHour} ден.</TableCell><TableCell>{m.annualAmortization} ден/год</TableCell>
                      <TableCell><Button size="sm" variant="ghost" className="text-red-600" onClick={() => machDelete.mutate({ id: m.id })}>Избриши</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Machine Hour Calculator */}
              <div className="border rounded-lg p-4 space-y-4 mt-4 bg-slate-50">
                <h4 className="font-medium flex items-center gap-2">
                  <Calculator className="h-4 w-4 text-emerald-700" />
                  Калкулатор за машински час
                </h4>
                <p className="text-xs text-gray-500">
                  (амортизација + струја + гас + сервис + други) / работни часови = ден/час
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Машина *</Label>
                    <Select value={calcMachineId} onValueChange={(v) => {
                      setCalcMachineId(v);
                      const m = machinesData?.find(x => x.id.toString() === v);
                      if (m) {
                        setCalcForm({
                          annualAmortization: m.annualAmortization ?? "",
                          annualElectricity: m.annualElectricity ?? "",
                          annualGas: m.annualGas ?? "",
                          annualService: m.annualService ?? "",
                          annualOther: "",
                          annualHours: m.annualHours ?? "2000",
                        });
                      }
                    }}>
                      <SelectTrigger><SelectValue placeholder="Избери машина..." /></SelectTrigger>
                      <SelectContent>{machinesData?.map(m => <SelectItem key={m.id} value={m.id.toString()}>{m.name} ({m.code})</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs flex items-center gap-1"><Zap className="h-3 w-3" />Годишна амортизација (ден.)</Label>
                    <Input type="number" className="text-xs" value={calcForm.annualAmortization} onChange={e => setCalcForm({ ...calcForm, annualAmortization: e.target.value })} placeholder="напр. 1200000" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs flex items-center gap-1"><Zap className="h-3 w-3 text-yellow-500" />Струја (ден/год)</Label>
                    <Input type="number" className="text-xs" value={calcForm.annualElectricity} onChange={e => setCalcForm({ ...calcForm, annualElectricity: e.target.value })} placeholder="300000" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs flex items-center gap-1"><Fuel className="h-3 w-3 text-orange-500" />Гас (ден/год)</Label>
                    <Input type="number" className="text-xs" value={calcForm.annualGas} onChange={e => setCalcForm({ ...calcForm, annualGas: e.target.value })} placeholder="200000" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs flex items-center gap-1"><Wrench className="h-3 w-3 text-blue-500" />Сервис (ден/год)</Label>
                    <Input type="number" className="text-xs" value={calcForm.annualService} onChange={e => setCalcForm({ ...calcForm, annualService: e.target.value })} placeholder="150000" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Други трошоци (ден/год)</Label>
                    <Input type="number" className="text-xs" value={calcForm.annualOther} onChange={e => setCalcForm({ ...calcForm, annualOther: e.target.value })} placeholder="50000" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs flex items-center gap-1"><Clock className="h-3 w-3" />Работни часови годишно *</Label>
                    <Input type="number" className="text-xs" value={calcForm.annualHours} onChange={e => setCalcForm({ ...calcForm, annualHours: e.target.value })} placeholder="2000" />
                  </div>
                </div>

                <Button
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                  disabled={!calcMachineId || machineCalcMutation.isPending}
                  onClick={() => machineCalcMutation.mutate({
                    id: parseInt(calcMachineId),
                    ...calcForm,
                  })}
                >
                  {machineCalcMutation.isPending ? "Се пресметува..." : <><Calculator className="h-4 w-4 mr-2" />Пресметај машински час</>}
                </Button>

                {calcResult && (
                  <div className="bg-white rounded-lg p-3 space-y-2 border">
                    <h5 className="text-sm font-medium">Резултат</h5>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex justify-between"><span className="text-gray-500">Амортизација:</span><span>{parseFloat(calcResult.breakdown.amortization).toFixed(0)} ден.</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Струја:</span><span>{parseFloat(calcResult.breakdown.electricity).toFixed(0)} ден.</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Гас:</span><span>{parseFloat(calcResult.breakdown.gas).toFixed(0)} ден.</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Сервис:</span><span>{parseFloat(calcResult.breakdown.service).toFixed(0)} ден.</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Други:</span><span>{parseFloat(calcResult.breakdown.other).toFixed(0)} ден.</span></div>
                      <div className="flex justify-between font-medium border-t pt-1"><span className="text-gray-700">Вкупни трошоци:</span><span>{parseFloat(calcResult.totalCosts).toFixed(0)} ден.</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Работни часови:</span><span>{calcResult.hours} ч/год</span></div>
                      <div className="flex justify-between text-base font-bold text-emerald-700 border-t pt-1">
                        <span>Машински час:</span>
                        <span>{calcResult.costPerHour} ден/час</span>
                      </div>
                    </div>
                    <p className="text-xs text-emerald-600 bg-emerald-50 p-2 rounded">
                      Цената е зачувана во машината. Се користи за пресметка на цена на чинење на производите.
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="labor" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Тарифи на труд</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-5 gap-2 text-xs">
                <Input placeholder="Улога" value={laborForm.role} onChange={e => setLaborForm({ ...laborForm, role: e.target.value })} />
                <Input placeholder="Код" value={laborForm.roleCode} onChange={e => setLaborForm({ ...laborForm, roleCode: e.target.value })} />
                <Input placeholder="Цена/час" value={laborForm.costPerHour} onChange={e => setLaborForm({ ...laborForm, costPerHour: e.target.value })} />
                <Input placeholder="Бруто плата" value={laborForm.grossSalary} onChange={e => setLaborForm({ ...laborForm, grossSalary: e.target.value })} />
                <Button variant="outline" onClick={() => laborCreate.mutate(laborForm as any)}>Додади</Button>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>Улога</TableHead><TableHead>Код</TableHead><TableHead>Цена/час</TableHead><TableHead>Бруто плата</TableHead><TableHead>Придонеси %</TableHead><TableHead className="w-20"></TableHead></TableRow></TableHeader>
                <TableBody>
                  {laborData?.map(l => (
                    <TableRow key={l.id}><TableCell className="font-medium">{l.role}</TableCell><TableCell>{l.roleCode}</TableCell><TableCell>{l.costPerHour} ден.</TableCell>
                      <TableCell>{l.grossSalary} ден.</TableCell><TableCell>{l.contributionsPct}%</TableCell>
                      <TableCell><Button size="sm" variant="ghost" className="text-red-600" onClick={() => laborDelete.mutate({ id: l.id })}>Избриши</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="overhead" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Производствена режија</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-5 gap-2 text-xs">
                <Input placeholder="Назив" value={ohForm.name} onChange={e => setOhForm({ ...ohForm, name: e.target.value })} />
                <Select value={ohForm.rateType} onValueChange={v => setOhForm({ ...ohForm, rateType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(rateTypes).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
                <Input placeholder="Вредност" value={ohForm.rateValue} onChange={e => setOhForm({ ...ohForm, rateValue: e.target.value })} />
                <Input placeholder="Годишен износ" value={ohForm.annualAmount} onChange={e => setOhForm({ ...ohForm, annualAmount: e.target.value })} />
                <Button variant="outline" onClick={() => ohCreate.mutate(ohForm as any)}>Додади</Button>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>Назив</TableHead><TableHead>Тип</TableHead><TableHead>Вредност</TableHead><TableHead>Годишно</TableHead><TableHead className="w-20"></TableHead></TableRow></TableHeader>
                <TableBody>
                  {overheadData?.map(o => (
                    <TableRow key={o.id}><TableCell className="font-medium">{o.name}</TableCell><TableCell>{rateTypes[o.rateType]}</TableCell>
                      <TableCell>{o.rateValue}</TableCell><TableCell>{o.annualAmount} ден.</TableCell>
                      <TableCell><Button size="sm" variant="ghost" className="text-red-600" onClick={() => ohDelete.mutate({ id: o.id })}>Избриши</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bom" className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle>Производ</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <Select value={activeProduct?.toString() ?? ""} onValueChange={v => setActiveProduct(parseInt(v))}>
                  <SelectTrigger><SelectValue placeholder="Избери производ" /></SelectTrigger>
                  <SelectContent>{productsData?.map(p => <SelectItem key={p.id} value={p.id.toString()}>{p.name} ({p.code})</SelectItem>)}</SelectContent>
                </Select>
                {activeProduct && (
                  <div className="space-y-2 pt-2">
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={bomForm.kind} onValueChange={v => setBomForm({ ...bomForm, kind: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="material">Материјал</SelectItem><SelectItem value="service">Услуга</SelectItem></SelectContent>
                      </Select>
                      <Select value={bomForm.refId} onValueChange={v => setBomForm({ ...bomForm, refId: v })}>
                        <SelectTrigger><SelectValue placeholder={bomForm.kind === "material" ? "Материјал" : "Услуга"} /></SelectTrigger>
                        <SelectContent>
                          {bomForm.kind === "material"
                            ? materialsData?.map(m => <SelectItem key={m.id} value={m.id.toString()}>{m.name}</SelectItem>)
                            : servicesData?.map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <Input placeholder="По единица" value={bomForm.perUnit} onChange={e => setBomForm({ ...bomForm, perUnit: e.target.value })} />
                      <Input placeholder="Отпад %" value={bomForm.wastePct} onChange={e => setBomForm({ ...bomForm, wastePct: e.target.value })} />
                      <Select value={bomForm.scale} onValueChange={v => setBomForm({ ...bomForm, scale: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="area">По m2</SelectItem><SelectItem value="perimeter">По периметар</SelectItem>
                          <SelectItem value="length">По должина</SelectItem><SelectItem value="fixed">Фиксно</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => bomCreate.mutate({ ...bomForm, productId: activeProduct, refId: parseInt(bomForm.refId), sortOrder: bomForm.sortOrder } as any)}>Додади во норматив</Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Норматив за производот</CardTitle></CardHeader>
              <CardContent>
                {bomData && bomData.length > 0 ? (
                  <Table>
                    <TableHeader><TableRow><TableHead>Тип</TableHead><TableHead>Ставка</TableHead><TableHead>По ед.</TableHead><TableHead>Отпад</TableHead><TableHead>Скала</TableHead><TableHead className="w-20"></TableHead></TableRow></TableHeader>
                    <TableBody>
                      {bomData.map((c: any) => (
                        <TableRow key={c.id}>
                          <TableCell><Badge className={c.kind === "material" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"}>{c.kind === "material" ? "Мат" : "Усл"}</Badge></TableCell>
                          <TableCell className="text-xs">{c.refName}</TableCell><TableCell>{c.perUnit}</TableCell><TableCell>{c.wastePct}%</TableCell>
                          <TableCell className="text-xs">{c.scale === "area" ? "m2" : c.scale === "perimeter" ? "перим." : c.scale === "length" ? "долж." : "фикс"}</TableCell>
                          <TableCell><Button size="sm" variant="ghost" className="text-red-600" onClick={() => bomDelete.mutate({ id: c.id })}>Избриши</Button></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : <p className="text-gray-500 text-sm text-center py-4">{activeProduct ? "Нема компоненти" : "Избери производ"}</p>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
