import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import SearchPick from "@/components/SearchPick";
import SendEmailDialog from "@/components/SendEmailDialog";
import { toast } from "sonner";
import { downloadXlsx, saveBlob } from "@/lib/xlsx";
import { simpleReportHtml, printHtml, htmlToPdfBlob, type ReportRow } from "@/lib/print-documents";
import { Banknote, FileCheck2, Repeat2, Download, FileText, Printer, Mail, Trash2, AlertTriangle, CheckCircle2, XCircle, Scale } from "lucide-react";

const fmt = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (d?: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "—");
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const r2 = (n: number) => Math.round(n * 100) / 100;
const okAcc = (s: string) => /^\d{15}$/.test(s.replace(/[\s-]/g, ""));

/** Порамнување со партнерите: налози за плаќање, ИОС, компензации. */
export default function SettleTab() {
  const [view, setView] = useState<"pay" | "ios" | "comp">("pay");
  const { data: settings } = trpc.settings.settingsGet.useQuery(undefined, { staleTime: 300_000 });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-lg border bg-white p-0.5 w-fit">
        <Button size="sm" variant={view === "pay" ? "default" : "ghost"} className="h-8" onClick={() => setView("pay")}><Banknote className="h-4 w-4 mr-1.5" />Налози за плаќање</Button>
        <Button size="sm" variant={view === "ios" ? "default" : "ghost"} className="h-8" onClick={() => setView("ios")}><FileCheck2 className="h-4 w-4 mr-1.5" />ИОС — усогласување</Button>
        <Button size="sm" variant={view === "comp" ? "default" : "ghost"} className="h-8" onClick={() => setView("comp")}><Repeat2 className="h-4 w-4 mr-1.5" />Компензации</Button>
      </div>
      {view === "pay" && <PaymentOrders settings={settings} />}
      {view === "ios" && <Ios settings={settings} />}
      {view === "comp" && <Compensations settings={settings} />}
    </div>
  );
}

// ───────────────────────── НАЛОЗИ ЗА ПЛАЌАЊЕ ─────────────────────────
type Draft = { on: boolean; amount: string; account: string; purpose: string; reference: string; code: string };

function batchRows(company: any, b: any) {
  return b.items.map((i: any, k: number) => [k + 1, company.name, company.account, i.payee, i.account, i.amount, i.paymentCode ?? "", i.purpose, i.reference ?? "", b.payDate]);
}
const BATCH_HEAD = ["Р.бр.", "Налогодавач", "Сметка на налогодавач", "Примач", "Сметка на примач", "Износ (ден)", "Шифра на плаќање", "Цел на дознака", "Повикување на број", "Датум на валута"];

function PaymentOrders({ settings }: { settings: any }) {
  const utils = trpc.useUtils();
  const [dueBy, setDueBy] = useState(addDays(7));
  const [payDate, setPayDate] = useState(ymd(new Date()));
  const { data } = trpc.settle.paymentOrderCandidates.useQuery({ dueBy });
  const { data: hist } = trpc.settle.paymentOrderList.useQuery();
  const [draft, setDraft] = useState<Record<number, Draft>>({});
  useEffect(() => {
    if (!data) return;
    setDraft((old) => Object.fromEntries(data.domestic.map((r) => [r.id, old[r.id] ?? {
      on: !r.inBatch && r.accountOk, amount: String(r.open), account: r.account, purpose: `Плаќање по фактура ${r.number}`.slice(0, 140), reference: r.number.slice(0, 40), code: "",
    }])));
  }, [data]);
  const create = trpc.settle.paymentOrderCreate.useMutation({
    onSuccess: async (r, v) => {
      toast.success(`Направени ${r.count} налози (${fmt(r.total)} ден)`);
      setDraft((d) => { const n = { ...d }; for (const it of v.items) if (n[it.incomingInvoiceId]) n[it.incomingInvoiceId] = { ...n[it.incomingInvoiceId], on: false }; return n; });
      await utils.settle.invalidate();
      const list = await utils.settle.paymentOrderList.fetch();
      const b = list.batches.find((x) => x.id === r.batchId);
      if (b) void exportBatch(list.company, b, "xlsx");
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.settle.paymentOrderRemove.useMutation({ onSuccess: () => { toast.success("Тргнато"); utils.settle.invalidate(); }, onError: (e) => toast.error(e.message) });
  const rows = data?.domestic ?? [];
  const chosen = rows.filter((r) => draft[r.id]?.on);
  const total = r2(chosen.reduce((s, r) => s + (parseFloat(draft[r.id].amount) || 0), 0));
  const badAcc = chosen.filter((r) => !okAcc(draft[r.id].account));
  const set = (id: number, p: Partial<Draft>) => setDraft((d) => ({ ...d, [id]: { ...d[id], ...p } }));
  const companyAccOk = okAcc(String(settings?.bank_account ?? settings?.bankAccount ?? ""));

  const exportBatch = async (company: any, b: any, kind: "xlsx" | "csv" | "pdf") => {
    const name = `nalozi-za-plakanje-${b.payDate}-${b.id}`;
    const rows = batchRows(company, b);
    if (kind === "xlsx") return downloadXlsx(`${name}.xlsx`, [{ name: "Налози ПП30", title: [`${company.name} — налози за плаќање`, `Датум на валута ${fmtD(b.payDate)} · ${b.count} налози · ${fmt(b.total)} ден`], header: BATCH_HEAD, rows, total: ["Вкупно", null, null, null, null, b.total, null, null, null, null] }]);
    if (kind === "csv") {
      const esc = (v: any) => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const csv = "﻿" + [BATCH_HEAD, ...rows.map((r: any[]) => r.map((v, i) => (i === 5 ? Number(v).toFixed(2) : i === 9 ? fmtD(String(v)) : v)))].map((r) => r.map(esc).join(";")).join("\r\n");
      return saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${name}.csv`);
    }
    const html = simpleReportHtml({
      title: "Налози за плаќање (ПП30)", subtitle: `датум на валута ${fmtD(b.payDate)} · од сметка ${company.account || "—"}${company.bankName ? " · " + company.bankName : ""}`, settings,
      head: ["#", "Примач", "Сметка на примач", "Цел на дознака", "Повик. на број", "Износ (ден)"], numCols: [5], landscape: true,
      rows: [...b.items.map((i: any, k: number) => ({ cells: [String(k + 1), i.payee, i.account, i.purpose, i.reference ?? "", i.amount] })), { cells: ["", "Вкупно", "", "", "", b.total], bold: true }],
      signatures: ["Подготвил", "Одобрил"],
    });
    try { saveBlob(await htmlToPdfBlob(html), `${name}.pdf`); } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label className="text-xs text-gray-500">Фактури што доспеваат до</Label><DateInput className="h-9 w-40" value={dueBy} onChange={(e) => setDueBy(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs text-gray-500">Датум на плаќање (валута)</Label><DateInput className="h-9 w-40" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></div>
          <span className="flex-1" />
          <span className="text-sm text-gray-600">Избрани {chosen.length} · <b>{fmt(total)} ден</b></span>
          <Button className="h-9" disabled={!chosen.length || badAcc.length > 0 || create.isPending}
            onClick={() => create.mutate({ payDate, items: chosen.map((r) => ({ incomingInvoiceId: r.id, amount: parseFloat(draft[r.id].amount) || 0, payeeAccount: draft[r.id].account, purpose: draft[r.id].purpose, reference: draft[r.id].reference || undefined, paymentCode: draft[r.id].code || undefined })) })}>
            Направи налози
          </Button>
        </div>
        {!companyAccOk && <p className="text-xs text-primary flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Внеси ја жиро-сметката на фирмата во Подесувања → Фирма (оди во секој налог како сметка на налогодавач).</p>}
        {badAcc.length > 0 && <p className="text-xs text-red-600">Жиро-сметка недостасува или не е точна (15 цифри) за: {badAcc.map((r) => r.supplier).join(", ")}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b">
              <th className="w-8" /><th className="text-left font-medium py-2">Добавувач / фактура</th><th className="text-left font-medium">Доспева</th>
              <th className="text-right font-medium">Останува</th><th className="text-right font-medium w-32">Износ</th><th className="text-left font-medium pl-3 w-48">Жиро-сметка на примач</th>
              <th className="text-left font-medium pl-3">Цел на дознака</th><th className="text-left font-medium pl-2 w-20">Шифра</th>
            </tr></thead>
            <tbody>
              {!rows.length ? <tr><td colSpan={8} className="py-8 text-center text-gray-400">Нема неплатени влезни фактури во денари што доспеваат до {fmtD(dueBy)}</td></tr> : rows.map((r) => {
                const d = draft[r.id]; if (!d) return null;
                return (
                  <tr key={r.id} className={`border-b border-gray-100 ${d.on ? "bg-primary/10" : ""}`}>
                    <td className="py-1.5"><input type="checkbox" checked={d.on} onChange={(e) => set(r.id, { on: e.target.checked })} /></td>
                    <td><div className="font-medium">{r.supplier}</div><div className="text-xs text-gray-500 font-mono">{r.number}{r.inBatch ? <span className="ml-1.5 font-sans text-primary">· веќе во налог од {fmtD(r.inBatch.date)}</span> : null}</div></td>
                    <td className={`text-xs whitespace-nowrap ${r.overdue ? "text-red-600 font-medium" : "text-gray-600"}`}>{fmtD(r.dueDate)}{r.overdue ? " · доцни" : ""}</td>
                    <td className="text-right tabular-nums">{fmt(r.open)}</td>
                    <td className="pl-2"><Input className="h-8 text-right" value={d.amount} onChange={(e) => set(r.id, { amount: e.target.value })} /></td>
                    <td className="pl-3"><Input className={`h-8 font-mono text-xs ${d.account && !okAcc(d.account) ? "border-red-400" : ""}`} value={d.account} placeholder="15 цифри" onChange={(e) => set(r.id, { account: e.target.value })} /></td>
                    <td className="pl-3"><Input className="h-8 text-xs" value={d.purpose} maxLength={140} onChange={(e) => set(r.id, { purpose: e.target.value })} /></td>
                    <td className="pl-2"><Input className="h-8 text-xs" value={d.code} maxLength={10} onChange={(e) => set(r.id, { code: e.target.value })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!!data?.foreign.length && <p className="text-xs text-gray-500">Девизни фактури ({data.foreign.length}: {data.foreign.slice(0, 4).map((f) => `${f.supplier} ${fmt(f.open)} ${f.currency}`).join(", ")}{data.foreign.length > 4 ? "..." : ""}) се плаќаат со девизен налог во банката.</p>}
        <p className="text-xs text-gray-500">Списокот се симнува како Excel/CSV со полињата од налогот ПП30 (за внес или увоз во е-банкарството) и PDF за потпис. Жиро-сметката на добавувачот се памти; ако ја нема, се зема од последното плаќање во изводите. Плаќањето се затвора само кога ќе стигне изводот.</p>
      </CardContent></Card>

      {!!hist?.batches.length && (
        <Card><CardContent className="p-4 space-y-2 text-sm">
          <p className="font-semibold">Направени налози</p>
          {hist.batches.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-2 border-t pt-2">
              <span className="w-24 text-gray-600">{fmtD(b.payDate)}</span>
              <span className="flex-1">{b.count} налози · <b>{fmt(b.total)} ден</b> <span className="text-xs text-gray-400">· {b.items.slice(0, 3).map((i) => i.payee).join(", ")}{b.items.length > 3 ? "..." : ""}{b.createdBy ? ` · ${b.createdBy}` : ""}</span></span>
              <Button size="sm" variant="outline" className="h-7" onClick={() => exportBatch(hist.company, b, "xlsx")}><Download className="h-3.5 w-3.5 mr-1" />Excel</Button>
              <Button size="sm" variant="outline" className="h-7" onClick={() => exportBatch(hist.company, b, "csv")}>CSV</Button>
              <Button size="sm" variant="outline" className="h-7" onClick={() => exportBatch(hist.company, b, "pdf")}><FileText className="h-3.5 w-3.5 mr-1" />PDF</Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-gray-400 hover:text-red-600" title="Тргни (ако не е пратено во банка)" onClick={() => { if (confirm("Да се тргне овој список? (само ако не е пратен во банка)")) remove.mutate({ id: b.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
        </CardContent></Card>
      )}
    </div>
  );
}

// ───────────────────────── ИОС ─────────────────────────
const IOS_STATUS: Record<string, { label: string; cls: string }> = {
  sent: { label: "пратен, чека одговор", cls: "bg-primary/10 text-foreground/80" },
  confirmed: { label: "потврден", cls: "bg-emerald-50 text-emerald-700" },
  disputed: { label: "оспорен", cls: "bg-red-50 text-red-700" },
};

function iosHtml(d: any, partnerType: string, settings: any) {
  const ours = partnerType === "customer";
  const bal = d.balance;
  const who = bal >= 0 ? (ours ? "вашиот долг кон нас" : "нашиот долг кон вас") : (ours ? "нашиот долг кон вас (преплата)" : "вашиот долг кон нас (преплата)");
  const rows: ReportRow[] = d.items.map((i: any) => ({ cells: [i.number, fmtD(i.date), fmtD(i.dueDate), i.currency === "MKD" ? "" : `${fmt(i.open)} ${i.currency}`, i.total, i.paid, i.openMkd] }));
  if (Math.abs(d.manual) >= 0.01) rows.push({ cells: ["Почетна состојба / други книжења", "", "", "", null, null, d.manual] });
  rows.push({ cells: ["Салдо", "", "", "", null, null, bal], bold: true });
  return simpleReportHtml({
    title: "Извод на отворени ставки (ИОС)", subtitle: `на ден ${fmtD(d.asOf)} · ${d.partner.name}${d.partner.edb ? " · ЕДБ " + d.partner.edb : ""}`, settings,
    head: ["Документ", "Датум", "Доспева", "Отворено во валута", "Износ", "Платено", "Отворено (ден)"], numCols: [4, 5, 6],
    rows,
    notes: [
      `Според нашата евиденција, на ден ${fmtD(d.asOf)} ${who} изнесува ${fmt(Math.abs(bal))} денари.`,
      ours ? "Ве молиме проверете ја состојбата и вратете го изводот потпишан и заверен во рок од 8 дена. Доколку не одговорите, ќе сметаме дека состојбата е усогласена." : "Ве молиме проверете ја состојбата и потврдете ја во рок од 8 дена.",
      " ",
      "ВРАЌА ПАРТНЕРОТ:   [  ] Потврдуваме ја состојбата        [  ] Оспоруваме — наша состојба: ______________________ ден",
      "Причина за разликата: ____________________________________________________________________________",
    ],
    signatures: [`За ${settings?.name ?? "нас"}`, `За ${d.partner.name}`],
  });
}

function Ios({ settings }: { settings: any }) {
  const utils = trpc.useUtils();
  const { data: partners } = trpc.settle.iosPartners.useQuery();
  const [sel, setSel] = useState<{ partnerType: "customer" | "supplier"; partnerId: number } | null>(null);
  const [asOf, setAsOf] = useState(ymd(new Date()));
  const { data: d } = trpc.settle.iosData.useQuery({ partnerType: sel?.partnerType ?? "customer", partnerId: sel?.partnerId ?? 0, asOf }, { enabled: !!sel });
  const [mail, setMail] = useState(false);
  const record = trpc.settle.iosRecord.useMutation({ onSuccess: () => utils.settle.invalidate() });
  const answer = trpc.settle.iosAnswer.useMutation({ onSuccess: () => { toast.success("Запишано"); utils.settle.invalidate(); }, onError: (e) => toast.error(e.message) });
  const num = d ? `${d.partner.name.slice(0, 20)} ${fmtD(d.asOf)}` : "";
  const pdf = async () => { if (!d || !sel) return; try { saveBlob(await htmlToPdfBlob(iosHtml(d, sel.partnerType, settings)), `IOS-${d.asOf}-${d.partner.name.replace(/[^\wа-шА-Ш]+/g, "-")}.pdf`); } catch (e: any) { toast.error(e.message); } };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[22rem_1fr] gap-4">
      <Card><CardContent className="p-0 max-h-[70vh] overflow-y-auto">
        <p className="px-3 py-2 text-xs text-gray-500 border-b">Партнери со отворено салдо. На крајот на годината (31.12) ИОС се праќа на сите.</p>
        {!partners?.length ? <p className="py-8 text-center text-sm text-gray-400">Нема отворени салда</p> : partners.map((p) => {
          const on = sel?.partnerType === p.partnerType && sel.partnerId === p.partnerId;
          return (
            <button key={`${p.partnerType}:${p.partnerId}`} onClick={() => setSel({ partnerType: p.partnerType, partnerId: p.partnerId })}
              className={`w-full text-left px-3 py-2 border-b text-sm hover:bg-accent/50 ${on ? "bg-primary/10" : ""}`}>
              <div className="flex justify-between gap-2"><span className="font-medium truncate">{p.name}</span><span className="tabular-nums">{fmt(p.balance)}</span></div>
              <div className="text-[11px] text-gray-500">{p.partnerType === "customer" ? "купувач — ни должи" : "добавувач — му должиме"}{p.lastIos ? <span className={`ml-1.5 rounded px-1 ${IOS_STATUS[p.lastIos.status]?.cls}`}>ИОС {fmtD(p.lastIos.asOf)}: {IOS_STATUS[p.lastIos.status]?.label}</span> : null}</div>
            </button>
          );
        })}
      </CardContent></Card>

      {!sel ? <p className="text-sm text-gray-400 py-10 text-center">Избери партнер</p> : !d ? null : (
        <Card><CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="font-semibold">{d.partner.name}</p>
              <p className="text-xs text-gray-500">{d.partner.address}{d.partner.edb ? ` · ЕДБ ${d.partner.edb}` : ""}{d.partner.email ? ` · ${d.partner.email}` : ""}</p>
            </div>
            <div className="flex flex-wrap items-end gap-1.5">
              <div className="space-y-1"><Label className="text-xs text-gray-500">На ден</Label><DateInput className="h-9 w-40" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
              <Button size="sm" variant="ghost" className="h-9" onClick={() => setAsOf(`${new Date().getFullYear() - 1}-12-31`)}>31.12.{new Date().getFullYear() - 1}</Button>
              <Button size="sm" variant="outline" className="h-9" onClick={pdf}><FileText className="h-3.5 w-3.5 mr-1" />PDF</Button>
              <Button size="sm" variant="outline" className="h-9" onClick={() => printHtml(iosHtml(d, sel.partnerType, settings))}><Printer className="h-3.5 w-3.5" /></Button>
              <Button size="sm" className="h-9" onClick={() => setMail(true)}><Mail className="h-3.5 w-3.5 mr-1" />Прати</Button>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b"><th className="text-left font-medium py-1.5">Документ</th><th className="text-left font-medium">Датум</th><th className="text-left font-medium">Доспева</th><th className="text-right font-medium">Износ</th><th className="text-right font-medium">Платено</th><th className="text-right font-medium">Отворено (ден)</th></tr></thead>
            <tbody>
              {d.items.map((i, k) => (
                <tr key={k} className="border-b border-gray-100">
                  <td className="py-1.5 font-mono text-xs">{i.number}</td><td>{fmtD(i.date)}</td><td className="text-gray-500">{fmtD(i.dueDate)}</td>
                  <td className="text-right tabular-nums">{fmt(i.total)}{i.currency !== "MKD" ? ` ${i.currency}` : ""}</td><td className="text-right tabular-nums text-gray-500">{fmt(i.paid)}</td><td className="text-right tabular-nums font-medium">{fmt(i.openMkd)}</td>
                </tr>
              ))}
              {Math.abs(d.manual) >= 0.01 && <tr className="border-b border-gray-100"><td colSpan={5} className="py-1.5 text-gray-600">Почетна состојба / рачни налози</td><td className="text-right tabular-nums">{fmt(d.manual)}</td></tr>}
              <tr className="font-semibold bg-gray-50"><td colSpan={5} className="py-1.5">Салдо на {fmtD(d.asOf)}</td><td className="text-right tabular-nums">{fmt(d.balance)}</td></tr>
            </tbody>
          </table>
          {!!d.log.length && (
            <div className="border-t pt-2 space-y-1.5 text-sm">
              <p className="text-xs font-semibold text-gray-500">Пратени ИОС</p>
              {d.log.map((l) => (
                <div key={l.id} className="flex flex-wrap items-center gap-2">
                  <span className="w-24 text-gray-600">{fmtD(l.asOf)}</span>
                  <span className="tabular-nums w-28 text-right">{fmt(l.balance)}</span>
                  <span className={`text-[11px] rounded px-1.5 py-0.5 ${IOS_STATUS[l.status]?.cls}`}>{IOS_STATUS[l.status]?.label}</span>
                  <span className="flex-1 text-xs text-gray-500 truncate">{l.note ?? l.sentTo ?? ""}</span>
                  {l.status === "sent" && <>
                    <Button size="sm" variant="ghost" className="h-7 text-emerald-700" onClick={() => answer.mutate({ id: l.id, status: "confirmed" })}><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Потврден</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-red-600" onClick={() => { const n = prompt("Што оспорува партнерот (нивна состојба, кои документи)?"); if (n) answer.mutate({ id: l.id, status: "disputed", note: n }); }}><XCircle className="h-3.5 w-3.5 mr-1" />Оспорен</Button>
                  </>}
                </div>
              ))}
            </div>
          )}
          <Button size="sm" variant="ghost" className="text-xs text-gray-500" onClick={() => record.mutate({ partnerType: sel.partnerType, partnerId: sel.partnerId, asOf: d.asOf, balance: d.balance, sentTo: "предадено рачно / по пошта" })}>Запиши дека е предаден рачно</Button>
          <SendEmailDialog open={mail} onOpenChange={setMail} docType="ios" docId={sel.partnerId} docNumber={num} defaultTo={d.partner.email} companyName={settings?.name}
            buildHtml={() => iosHtml(d, sel.partnerType, settings)} onSent={() => record.mutate({ partnerType: sel.partnerType, partnerId: sel.partnerId, asOf: d.asOf, balance: d.balance, sentTo: d.partner.email || "е-пошта" })} />
        </CardContent></Card>
      )}
    </div>
  );
}

// ───────────────────────── КОМПЕНЗАЦИИ ─────────────────────────
function compHtml(c: any, settings: any) {
  const recv = c.items.filter((i: any) => i.docType === "invoice"), pay = c.items.filter((i: any) => i.docType === "incoming_invoice");
  const rows: ReportRow[] = [
    { cells: [`Побарувања на ${settings?.name ?? "нас"} од ${c.customer.name}`, "", null], bold: true },
    ...recv.map((i: any) => ({ cells: [`  фактура ${i.number}`, fmtD(i.date), i.amount] as (string | number | null)[], indent: 1 })),
    { cells: [`Обврски на ${settings?.name ?? "нас"} кон ${c.supplier.name}`, "", null], bold: true },
    ...pay.map((i: any) => ({ cells: [`  фактура ${i.number}`, fmtD(i.date), i.amount] as (string | number | null)[], indent: 1 })),
    { cells: ["Износ на компензацијата", "", c.amount], bold: true },
  ];
  return simpleReportHtml({
    title: `Изјава за компензација ${c.number}`, subtitle: `од ${fmtD(c.date)}`, settings,
    head: ["Документ", "Датум", "Износ (ден)"], numCols: [2], rows,
    notes: [
      `Договорните страни ${settings?.name ?? ""} (ЕДБ ${settings?.edb ?? "—"}) и ${c.customer.name}${c.customer.edb ? ` (ЕДБ ${c.customer.edb})` : ""} се согласуваат меѓусебните побарувања и обврски наведени погоре да се пребијат (компензираат) до износ од ${fmt(c.amount)} денари.`,
      "Со потпишувањето, побарувањата и обврските се намалуваат за наведените износи на денот на компензацијата.",
      ...(c.note ? [`Забелешка: ${c.note}`] : []),
    ],
    signatures: [`За ${settings?.name ?? ""}`, `За ${c.customer.name}`],
  });
}

function Compensations({ settings }: { settings: any }) {
  const utils = trpc.useUtils();
  const { data: customers } = trpc.customers.customerList.useQuery();
  const { data: suppliers } = trpc.procurement.supplierList.useQuery();
  const { data: list } = trpc.settle.compensationList.useQuery();
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [date, setDate] = useState(ymd(new Date()));
  const [note, setNote] = useState("");
  const [amt, setAmt] = useState<Record<string, string>>({});
  const [mailFor, setMailFor] = useState<any | null>(null);
  const { data: cand } = trpc.settle.compensationCandidates.useQuery({ customerId: customerId ?? 0, supplierId }, { enabled: !!customerId });
  useEffect(() => { setSupplierId(null); setAmt({}); }, [customerId]);
  useEffect(() => { if (cand && !supplierId && cand.suggestions.length === 1) setSupplierId(cand.suggestions[0].id); }, [cand?.suggestions]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = trpc.settle.compensationCreate.useMutation({ onSuccess: (r) => { toast.success(`Компензација ${r.number}`); setAmt({}); setNote(""); utils.invalidate(); }, onError: (e) => toast.error(e.message) });
  const cancel = trpc.settle.compensationCancel.useMutation({ onSuccess: () => { toast.success("Поништена"); utils.invalidate(); }, onError: (e) => toast.error(e.message) });
  const custItems = useMemo(() => (customers ?? []).map((c: any) => ({ id: c.id as number, label: c.company || c.name, sub: c.edb || c.taxNumber || null })), [customers]);
  const supItems = useMemo(() => (suppliers ?? []).map((s: any) => ({ id: s.id as number, label: s.name, sub: s.edb || null })), [suppliers]);
  const key = (t: string, id: number) => `${t}:${id}`;
  const sumOf = (t: string) => r2(Object.entries(amt).filter(([k]) => k.startsWith(t + ":")).reduce((s, [, v]) => s + (parseFloat(v) || 0), 0));
  const sR = sumOf("invoice"), sP = sumOf("incoming_invoice");
  /** Пополни ги двете страни до помалиот збир, од најстарите фактури. */
  const equalize = () => {
    if (!cand) return;
    const r = cand.receivables.filter((x) => x.usable), p = cand.payables.filter((x) => x.usable);
    let left = Math.min(r.reduce((s, x) => s + x.open, 0), p.reduce((s, x) => s + x.open, 0));
    const fill = (docs: typeof r, t: string, out: Record<string, string>) => { let l = left; for (const d of [...docs].sort((a, b) => a.date.localeCompare(b.date))) { const v = r2(Math.min(d.open, l)); if (v > 0) out[key(t, d.id)] = String(v); l = r2(l - v); } };
    const out: Record<string, string> = {}; fill(r, "invoice", out); fill(p, "incoming_invoice", out); left = 0; setAmt(out);
  };
  const items = Object.entries(amt).map(([k, v]) => ({ docType: k.split(":")[0] as "invoice" | "incoming_invoice", docId: Number(k.split(":")[1]), amount: parseFloat(v) || 0 })).filter((i) => i.amount > 0);

  const side = (title: string, docs: any[] | undefined, t: string) => (
    <div className="rounded-lg border p-3 space-y-1">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</p>
      {!docs?.length ? <p className="text-sm text-gray-400 py-2">Нема отворени фактури</p> : docs.map((d) => (
        <div key={d.id} className={`flex items-center gap-2 text-sm ${d.usable ? "" : "opacity-50"}`}>
          <input type="checkbox" disabled={!d.usable} checked={!!amt[key(t, d.id)]} onChange={(e) => setAmt((a) => { const n = { ...a }; if (e.target.checked) n[key(t, d.id)] = String(d.open); else delete n[key(t, d.id)]; return n; })} />
          <span className="font-mono text-xs w-28 truncate">{d.number}</span><span className="text-xs text-gray-500 w-20">{fmtD(d.date)}</span>
          <span className="flex-1 text-right tabular-nums text-gray-600">{fmt(d.open)}{d.currency !== "MKD" ? ` ${d.currency}` : ""}</span>
          <Input className="h-7 w-28 text-right" disabled={!d.usable} value={amt[key(t, d.id)] ?? ""} onChange={(e) => setAmt((a) => ({ ...a, [key(t, d.id)]: e.target.value }))} />
        </div>
      ))}
      <p className="text-right text-sm font-semibold pt-1">{fmt(t === "invoice" ? sR : sP)} ден</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4 space-y-3">
        <p className="text-sm text-gray-600">Кога иста фирма ни е и купувач и добавувач: нејзиниот долг кон нас се пребива со нашиот кон неа. Се книжи Д добавувачи / П купувачи, а фактурите се затвораат за износот. Само во денари.</p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <div className="space-y-1"><Label className="text-xs text-gray-500">Купувач (ни должи)</Label><SearchPick items={custItems} value={customerId} onChange={setCustomerId} placeholder="Избери купувач" /></div>
          <div className="space-y-1"><Label className="text-xs text-gray-500">Истата фирма како добавувач (ѝ должиме)</Label><SearchPick items={supItems} value={supplierId} onChange={setSupplierId} placeholder="Избери добавувач" /></div>
          <div className="space-y-1"><Label className="text-xs text-gray-500">Датум</Label><DateInput className="h-9 w-40" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        {cand && cand.suggestions.length > 0 && !supplierId && <p className="text-xs text-primary">Можеби: {cand.suggestions.map((s) => <button key={s.id} className="underline mr-2" onClick={() => setSupplierId(s.id)}>{s.name}{s.sameEdb ? " (ист ЕДБ)" : ""}</button>)}</p>}
        {customerId && !supplierId && cand && !cand.suggestions.length && <p className="text-xs text-gray-500">Оваа фирма не е најдена меѓу добавувачите (по ЕДБ или име) — избери ја рачно. Купувачот има {cand.receivables.length} отворени фактури.</p>}
        {customerId && supplierId && cand && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {side("Наши побарувања (излезни фактури)", cand.receivables, "invoice")}
              {side("Наши обврски (влезни фактури)", cand.payables, "incoming_invoice")}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={equalize}><Scale className="h-3.5 w-3.5 mr-1.5" />Изедначи автоматски</Button>
              <Input className="h-9 flex-1 min-w-[12rem]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Забелешка (не е задолжително)" />
              <span className={`text-sm ${Math.abs(sR - sP) < 0.005 && sR > 0 ? "text-emerald-700" : "text-primary"}`}>{Math.abs(sR - sP) < 0.005 && sR > 0 ? `Изедначено: ${fmt(sR)} ден` : `Разлика ${fmt(Math.abs(sR - sP))} ден — двете страни мора да се еднакви`}</span>
              <Button className="h-9" disabled={create.isPending || sR <= 0 || Math.abs(sR - sP) >= 0.005}
                onClick={() => create.mutate({ date, customerId, supplierId, items, note: note || undefined })}>Направи компензација</Button>
            </div>
          </>
        )}
      </CardContent></Card>

      {!!list?.length && (
        <Card><CardContent className="p-4 space-y-2 text-sm">
          <p className="font-semibold">Компензации</p>
          {list.map((c) => (
            <div key={c.id} className={`flex flex-wrap items-center gap-2 border-t pt-2 ${c.status !== "active" ? "opacity-50" : ""}`}>
              <span className="font-mono text-xs w-28">{c.number}</span><span className="w-24 text-gray-600">{fmtD(c.date)}</span>
              <span className="flex-1">{c.customer.name}{c.supplier.name && c.supplier.name !== c.customer.name ? ` / ${c.supplier.name}` : ""} · <b>{fmt(c.amount)} ден</b> <span className="text-xs text-gray-400">· {c.items.length} фактури{c.status !== "active" ? " · поништена" : ""}</span></span>
              <Button size="sm" variant="outline" className="h-7" onClick={async () => { try { saveBlob(await htmlToPdfBlob(compHtml(c, settings)), `${c.number.replace(/[^\wа-шА-Ш]+/g, "-")}.pdf`); } catch (e: any) { toast.error(e.message); } }}><FileText className="h-3.5 w-3.5 mr-1" />PDF</Button>
              <Button size="sm" variant="outline" className="h-7" onClick={() => printHtml(compHtml(c, settings))}><Printer className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="outline" className="h-7" onClick={() => setMailFor(c)}><Mail className="h-3.5 w-3.5" /></Button>
              {c.status === "active" && <Button size="sm" variant="ghost" className="h-7 text-red-600" onClick={() => { if (confirm(`Да се поништи ${c.number}? Фактурите повторно ќе се отворени.`)) cancel.mutate({ id: c.id }); }}>Поништи</Button>}
            </div>
          ))}
        </CardContent></Card>
      )}
      {mailFor && <SendEmailDialog open onOpenChange={(o) => !o && setMailFor(null)} docType="compensation" docId={mailFor.id} docNumber={mailFor.number}
        defaultTo={(customers ?? []).find((x: any) => x.id === mailFor.customer.id)?.email ?? null} companyName={settings?.name} buildHtml={() => compHtml(mailFor, settings)} />}
    </div>
  );
}
