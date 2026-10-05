import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { toast } from "sonner";
import { Factory, Building2, CalendarCheck, Scale, Trash2, Calculator } from "lucide-react";

const den = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (iso?: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "—");
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Крај на период: залихи на производи, амортизација, затворање на година, почетни салда. */
export default function PeriodEndTab() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const prevMonthEnd = (() => { const n = new Date(); return ymd(new Date(n.getFullYear(), n.getMonth(), 0)); })();
  const [date, setDate] = useState(prevMonthEnd);
  const { data: calc, refetch, isFetching } = trpc.finance.inventoryValuationCalc.useQuery({ date });
  const { data: vals } = trpc.finance.inventoryValuationList.useQuery();
  const { data: years } = trpc.finance.yearCloseList.useQuery();
  const { data: me } = trpc.appUsers.appUsersMe.useQuery();
  const [wip, setWip] = useState(""); const [fg, setFg] = useState(""); const [note, setNote] = useState("");
  useEffect(() => { if (calc) { setWip(String(calc.wip)); setFg(String(calc.fg)); } }, [calc?.wip, calc?.fg]); // eslint-disable-line react-hooks/exhaustive-deps
  const inv = () => { utils.finance.invalidate(); };
  const save = trpc.finance.inventoryValuationSave.useMutation({ onSuccess: () => { toast.success("Залихите се зачувани и книжени"); setNote(""); inv(); }, onError: (e) => toast.error(e.message) });
  const remove = trpc.finance.inventoryValuationRemove.useMutation({ onSuccess: () => { toast.success("Избришано"); inv(); }, onError: (e) => toast.error(e.message) });
  const close = trpc.finance.yearClose.useMutation({ onSuccess: () => { toast.success("Годината е затворена"); inv(); }, onError: (e) => toast.error(e.message) });
  const reopen = trpc.finance.yearReopen.useMutation({ onSuccess: () => { toast.success("Годината е повторно отворена"); inv(); }, onError: (e) => toast.error(e.message) });
  const prev = calc?.previous;
  const dW = (parseFloat(wip) || 0) - (prev?.wip ?? 0), dF = (parseFloat(fg) || 0) - (prev?.fg ?? 0);

  return (
    <div className="space-y-4">
      {/* Залихи на производи */}
      <Card><CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Factory className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <p className="font-semibold">Залихи на недовршено производство и готови производи</p>
            <p className="text-sm text-gray-600">Материјалот и работата одат во трошок кога се трошат. На крајот на месецот, вредноста на сè што уште е во производство или на залиха како готов производ се враќа како залиха — инаку добивката е потценета. Се книжи само промената од претходната пресметка: 600/630 наспроти 490.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label className="text-xs">На датум</Label><DateInput className="h-9 w-44" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <Button size="sm" variant="outline" className="h-9" onClick={() => refetch()} disabled={isFetching}><Calculator className="h-4 w-4 mr-1.5" />Пресметај</Button>
        </div>
        {calc && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg border p-3 space-y-1">
              <Label className="text-xs">Недовршено производство (ден)</Label>
              <Input type="number" value={wip} onChange={(e) => setWip(e.target.value)} />
              <p className="text-[11px] text-gray-500">Предлог {den(calc.wip)} — издаден материјал + завршени операции на отворените налози ({calc.wipRows.length})</p>
              {calc.wipRows.slice(0, 6).map(r => <p key={r.id} className="text-[11px] text-gray-600">{r.number}: мат. {den(r.material)} + опер. {den(r.operations)}</p>)}
            </div>
            <div className="rounded-lg border p-3 space-y-1">
              <Label className="text-xs">Готови производи (ден)</Label>
              <Input type="number" value={fg} onChange={(e) => setFg(e.target.value)} />
              <p className="text-[11px] text-gray-500">Предлог {den(calc.fg)} — готови производи на залиха по цена на чинење ({calc.fgRows.length})</p>
              {calc.fgRows.slice(0, 6).map(r => <p key={r.productId} className="text-[11px] text-gray-600">{r.name}: {r.quantity} × = {den(r.value)}</p>)}
            </div>
          </div>
        )}
        {calc && (
          <div className="flex flex-wrap items-center gap-2">
            <Input className="h-9 flex-1 min-w-[12rem]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Белешка (на пр. попис на 30.09)" />
            <span className="text-xs text-gray-600">{prev ? `Претходно (${fmtD(prev.date)}): ${den(prev.wip)} / ${den(prev.fg)} · ` : ""}се книжи промена {den(dW + dF)}</span>
            <Button className="h-9" disabled={save.isPending} onClick={() => save.mutate({ date, wip: parseFloat(wip) || 0, fg: parseFloat(fg) || 0, note: note || undefined })}>Зачувај и книжи</Button>
          </div>
        )}
        {!!vals?.length && (
          <div className="border-t pt-2 text-sm space-y-1">
            {vals.map((v, i) => (
              <div key={v.id} className="flex items-center gap-3">
                <span className="w-24 text-gray-500">{fmtD(v.date)}</span>
                <span className="flex-1">недовршено {den(v.wip)} · готови {den(v.fg)}{v.note ? <span className="text-gray-400"> · {v.note}</span> : null}</span>
                {i === 0 && <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-gray-400 hover:text-red-500" onClick={() => { if (confirm("Да се избрише последната пресметка?")) remove.mutate({ id: v.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>}
              </div>
            ))}
          </div>
        )}
      </CardContent></Card>

      {/* Амортизација */}
      <Card><CardContent className="p-4 flex items-start gap-3">
        <Building2 className="h-5 w-5 text-primary mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold">Амортизација — месечно</p>
          <p className="text-sm text-gray-600">Од 2026 годишната амортизација се книжи по 1/12 на крајот на секој месец (до тековниот), за месечната добивка да е точна. Пресметката и книжењето за годината се во Основни средства.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => navigate("/sredstva")}>Основни средства</Button>
      </CardContent></Card>

      {/* Затворање на година */}
      <Card><CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Scale className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <p className="font-semibold">Затворање на година</p>
            <p className="text-sm text-gray-600">Приходите (класа 7) и расходите (класа 4) се затвораат на 31.12 на конто {years?.resultAccount ?? "800"} (добивка или загуба). Ако подоцна се смени нешто во годината, затворањето се пресметува само. Се прави откако годината е завршена; повторно отворање — само администратор.</p>
          </div>
        </div>
        <div className="text-sm">
          {(years?.years ?? []).map(y => (
            <div key={y.year} className="flex flex-wrap items-center gap-3 border-t py-2">
              <span className="w-12 font-semibold">{y.year}</span>
              <span className="flex-1 text-gray-600">приходи {den(y.revenue)} · расходи {den(y.expense)} · <b className={y.result >= 0 ? "text-emerald-700" : "text-red-600"}>{y.result >= 0 ? "добивка" : "загуба"} {den(Math.abs(y.result))}</b></span>
              {y.closed ? (
                <>
                  <span className="text-xs text-emerald-700 flex items-center gap-1"><CalendarCheck className="h-3.5 w-3.5" />затворена{y.closedBy ? ` · ${y.closedBy}` : ""}</span>
                  {(!me || me.role === "admin") && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => { if (confirm(`Да се отвори повторно ${y.year}?`)) reopen.mutate({ year: y.year }); }}>Отвори</Button>}
                </>
              ) : (
                <Button size="sm" variant="outline" disabled={y.year >= new Date().getFullYear() || close.isPending}
                  title={y.year >= new Date().getFullYear() ? "Годината уште не е завршена" : undefined}
                  onClick={() => { if (confirm(`Да се затвори ${y.year}? Приходите и расходите одат на резултат.`)) close.mutate({ year: y.year }); }}>Затвори ја годината</Button>
              )}
            </div>
          ))}
        </div>
      </CardContent></Card>

      {/* Почетни салда */}
      <Card><CardContent className="p-4 flex items-start gap-3">
        <CalendarCheck className="h-5 w-5 text-primary mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold">Почетни салда</p>
          <p className="text-sm text-gray-600">Ако почнувате да водите книги во програмата среде година (или со состојба од претходна програма), внесете ги салдата од бруто билансот како еден налог со датум 01.01 (или денот кога почнувате): банка, благајна, купувачи и добавувачи по партнер, залихи, капитал. Најлесно е со терк „Почетна состојба“ — направете го еднаш во табот Терк. Салдата меѓу годините програмата ги пренесува сама.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => navigate("/finansii?tab=terk")}>Терк</Button>
      </CardContent></Card>
    </div>
  );
}
