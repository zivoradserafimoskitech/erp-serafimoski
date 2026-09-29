import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Users, Banknote, Plus, Pencil, Calculator, CheckCircle2, Undo2, Download } from "lucide-react";

const fmt = (n: number) => n.toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thisMonth = () => new Date().toISOString().slice(0, 7);
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };

function EmployeesTab() {
  const utils = trpc.useUtils();
  const [showAll, setShowAll] = useState(false);
  const { data } = trpc.hr.employeesList.useQuery({ includeInactive: showAll, period: thisMonth() });
  const empty = { id: 0, fullName: "", position: "", scanName: "", grossSalary: "", hourlyCost: "", startDate: "", bankAccount: "", notes: "", isActive: "active" };
  const [f, setF] = useState<typeof empty | null>(null);
  const save = trpc.hr.employeeUpsert.useMutation({ onSuccess: () => { toast.success("Зачувано"); setF(null); utils.hr.employeesList.invalidate(); }, onError: (e) => toast.error(e.message) });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Прикажи и неактивни</label>
        <Button className="bg-amber-500 hover:bg-amber-600" onClick={() => setF(empty)}><Plus className="h-4 w-4 mr-1.5" />Нов вработен</Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Име и презиме</TableHead><TableHead>Работно место</TableHead><TableHead>Име за скенирање</TableHead>
            <TableHead className="text-right">Бруто плата</TableHead><TableHead className="text-right">Цена/час</TableHead><TableHead className="text-right">Часови овој месец</TableHead><TableHead className="w-10" />
          </TableRow></TableHeader>
          <TableBody>
            {!data?.length ? <TableRow><TableCell colSpan={7} className="text-center py-10 text-gray-400">Нема внесени вработени</TableCell></TableRow>
              : data.map(e => (
                <TableRow key={e.id} className={e.isActive !== "active" ? "opacity-50" : ""}>
                  <TableCell className="font-medium">{e.fullName}{e.isActive !== "active" && <Badge className="ml-2 bg-gray-100 text-gray-500">неактивен</Badge>}</TableCell>
                  <TableCell className="text-gray-600">{e.position}</TableCell>
                  <TableCell className="text-gray-500 text-sm">{e.scanName || <span className="text-gray-300">{e.fullName}</span>}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(e.grossSalary)}</TableCell>
                  <TableCell className="text-right tabular-nums text-gray-500">{e.hourlyCost ? fmt(e.hourlyCost) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.hoursThisPeriod ? `${e.hoursThisPeriod} ч` : "—"}</TableCell>
                  <TableCell><Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setF({ ...empty, ...e, grossSalary: String(e.grossSalary), hourlyCost: String(e.hourlyCost || ""), position: e.position ?? "", scanName: e.scanName ?? "", startDate: e.startDate ?? "", bankAccount: e.bankAccount ?? "", notes: e.notes ?? "" })}><Pencil className="h-3.5 w-3.5" /></Button></TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent></Card>
      <p className="text-xs text-gray-400">Часовите се од скенирањето на налозите на подот. „Име за скенирање“ е името што работникот го внесува при скенирање (ако е различно од целото име).</p>

      <Dialog open={!!f} onOpenChange={(o) => !o && setF(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{f?.id ? "Измени вработен" : "Нов вработен"}</DialogTitle></DialogHeader>
          {f && (
            <div className="space-y-3">
              <div className="space-y-1"><Label className="text-xs">Име и презиме *</Label><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Работно место</Label><Input value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} placeholder="на пр. Заварувач" /></div>
                <div className="space-y-1"><Label className="text-xs">Име за скенирање</Label><Input value={f.scanName} onChange={(e) => setF({ ...f, scanName: e.target.value })} placeholder="на пр. Марко" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Бруто плата (ден) *</Label><Input type="number" value={f.grossSalary} onChange={(e) => setF({ ...f, grossSalary: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Цена на час за налози (ден)</Label><Input type="number" value={f.hourlyCost} onChange={(e) => setF({ ...f, hourlyCost: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Почеток на работа</Label><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Трансакциска сметка</Label><Input value={f.bankAccount} onChange={(e) => setF({ ...f, bankAccount: e.target.value })} /></div>
              </div>
              {!!f.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive === "active"} onChange={(e) => setF({ ...f, isActive: e.target.checked ? "active" : "inactive" })} />Активен</label>}
              <Button className="w-full bg-amber-500 hover:bg-amber-600" disabled={f.fullName.length < 3 || !(parseFloat(f.grossSalary) >= 0) || save.isPending}
                onClick={() => save.mutate({ id: f.id || undefined, fullName: f.fullName, position: f.position || undefined, scanName: f.scanName || undefined,
                  grossSalary: parseFloat(f.grossSalary) || 0, hourlyCost: parseFloat(f.hourlyCost) || 0, startDate: f.startDate || undefined,
                  bankAccount: f.bankAccount || undefined, isActive: f.isActive as any })}>Зачувај</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PayrollTab() {
  const utils = trpc.useUtils();
  const [period, setPeriod] = useState(prevMonth());
  const { data: run } = trpc.hr.payrollGet.useQuery({ period });
  const { data: defaults } = trpc.hr.payrollDefaults.useQuery();
  const [params, setParams] = useState({ contributionRate: "28", incomeTaxRate: "10", personalExemption: "" });
  useEffect(() => {
    const p = run?.params ?? defaults;
    if (p) setParams({ contributionRate: String(p.contributionRate), incomeTaxRate: String(p.incomeTaxRate), personalExemption: String(p.personalExemption) });
  }, [run?.id, defaults]);
  const calc = trpc.hr.payrollCalculate.useMutation({ onSuccess: () => { toast.success("Пресметано"); utils.hr.payrollGet.invalidate(); }, onError: (e) => toast.error(e.message) });
  const post = trpc.hr.payrollPost.useMutation({ onSuccess: (_, v) => { toast.success(v.post ? "Книжено во главната книга" : "Книжењето е откажано"); utils.hr.payrollGet.invalidate(); }, onError: (e) => toast.error(e.message) });
  const tot = (run?.lines ?? []).reduce((t, l) => ({ gross: t.gross + l.gross, contributions: t.contributions + l.contributions, incomeTax: t.incomeTax + l.incomeTax, net: t.net + l.net }), { gross: 0, contributions: 0, incomeTax: 0, net: 0 });
  const posted = run?.status === "posted";
  const exportCsv = () => {
    const rows = [["Вработен", "Трансакциска сметка", "Бруто", "Придонеси", "Даночна основа", "Данок", "Нето", "Часови"],
      ...(run?.lines ?? []).map(l => [l.name, l.bankAccount ?? "", l.gross.toFixed(2), l.contributions.toFixed(2), l.taxBase.toFixed(2), l.incomeTax.toFixed(2), l.net.toFixed(2), l.hours])];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = `plati-${period}.csv`; a.click();
  };
  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><Label className="text-xs text-gray-500">Месец</Label><Input type="month" className="w-44" value={period} onChange={(e) => setPeriod(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs text-gray-500">Придонеси %</Label><Input type="number" className="w-24" value={params.contributionRate} disabled={posted} onChange={(e) => setParams({ ...params, contributionRate: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs text-gray-500">Персонален данок %</Label><Input type="number" className="w-24" value={params.incomeTaxRate} disabled={posted} onChange={(e) => setParams({ ...params, incomeTaxRate: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs text-gray-500">Лично ослободување (ден)</Label><Input type="number" className="w-32" value={params.personalExemption} disabled={posted} onChange={(e) => setParams({ ...params, personalExemption: e.target.value })} /></div>
          <Button className="bg-amber-500 hover:bg-amber-600" disabled={posted || calc.isPending}
            onClick={() => calc.mutate({ period, params: { contributionRate: parseFloat(params.contributionRate) || 0, incomeTaxRate: parseFloat(params.incomeTaxRate) || 0, personalExemption: parseFloat(params.personalExemption) || 0 } })}>
            <Calculator className="h-4 w-4 mr-1.5" />{run ? "Пресметај повторно" : "Пресметај"}
          </Button>
        </div>
        <p className="text-xs text-gray-400 mt-2">Стапките и личното ослободување се менуваат со закон — провери ги со сметководителот пред книжење.</p>
      </CardContent></Card>

      {!run ? <p className="text-sm text-gray-400 py-8 text-center">Нема пресметка за {period}. Кликни „Пресметај“.</p> : (<>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[{ l: "Бруто", v: tot.gross }, { l: "Придонеси", v: tot.contributions }, { l: "Персонален данок", v: tot.incomeTax }, { l: "Нето за исплата", v: tot.net }].map(k => (
            <Card key={k.l}><CardContent className="p-4"><p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">{k.l}</p><p className="text-2xl font-bold tabular-nums">{fmt(k.v)}</p></CardContent></Card>
          ))}
        </div>
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Вработен</TableHead><TableHead className="text-right">Часови</TableHead><TableHead className="text-right">Бруто</TableHead><TableHead className="text-right">Придонеси</TableHead>
              <TableHead className="text-right">Даночна основа</TableHead><TableHead className="text-right">Данок</TableHead><TableHead className="text-right">Нето</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {run.lines.map(l => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.name}<div className="text-xs text-gray-400">{l.position}</div></TableCell>
                  <TableCell className="text-right tabular-nums text-gray-500">{l.hours || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(l.gross)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(l.contributions)}</TableCell>
                  <TableCell className="text-right tabular-nums text-gray-500">{fmt(l.taxBase)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(l.incomeTax)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{fmt(l.net)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge className={posted ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}>{posted ? "Книжено во главната книга" : "Нацрт — не е книжено"}</Badge>
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-1.5" />Листа за банка (CSV)</Button>
            {posted
              ? <Button variant="outline" onClick={() => post.mutate({ period, post: false })}><Undo2 className="h-4 w-4 mr-1.5" />Откажи книжење</Button>
              : <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => post.mutate({ period, post: true })}><CheckCircle2 className="h-4 w-4 mr-1.5" />Потврди и книжи</Button>}
          </div>
        </div>
      </>)}
    </div>
  );
}

export default function Employees() {
  const { data: me, isLoading } = trpc.appUsers.appUsersMe.useQuery();
  if (isLoading) return null;
  if (me && me.role !== "admin") {
    return (
      <div className="py-20 text-center">
        <Users className="h-10 w-10 text-gray-300 mx-auto mb-3" />
        <p className="font-medium text-gray-700">Платите ги гледа само администраторот</p>
        <p className="text-sm text-gray-400 mt-1">Побарај пристап од администраторот ако ти треба.</p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">Вработени и плати</h2>
        <p className="text-gray-500 mt-1">Регистар на вработени, часови од подот и месечна пресметка на плата</p>
      </div>
      <Tabs defaultValue="employees">
        <TabsList className="bg-amber-50">
          <TabsTrigger value="employees"><Users className="h-4 w-4 mr-1.5" />Вработени</TabsTrigger>
          <TabsTrigger value="payroll"><Banknote className="h-4 w-4 mr-1.5" />Плати</TabsTrigger>
        </TabsList>
        <TabsContent value="employees" className="mt-4"><EmployeesTab /></TabsContent>
        <TabsContent value="payroll" className="mt-4"><PayrollTab /></TabsContent>
      </Tabs>
    </div>
  );
}
