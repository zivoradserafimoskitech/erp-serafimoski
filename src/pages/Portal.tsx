import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { FileText, Package, Award, Send, Paperclip, Loader2, CheckCircle2 } from "lucide-react";

const fmt = (n: number, cur = "MKD") => `${n.toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur === "MKD" ? "ден" : cur}`;
const fmtD = (d?: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "—");
const ORDER: Record<string, string> = { pending: "Примена", confirmed: "Потврдена", in_production: "Во производство", ready: "Готова за испорака", delivered: "Испорачана", cancelled: "Откажана" };
const INV: Record<string, string> = { issued: "Издадена", sent: "Издадена", partial: "Делумно платена", paid: "Платена", overdue: "Задоцнета" };

/**
 * Портал за клиенти — без најава, со таен линк што го праќаме на клиентот.
 * Ги гледа само своите нарачки, фактури и сертификати и може да прати барање за понуда со цртеж.
 */
export default function Portal() {
  const { token = "" } = useParams();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"orders" | "invoices" | "certs" | "rfq">("orders");
  const base = `/api/portal/${encodeURIComponent(token)}`;
  useEffect(() => {
    fetch(base).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? "Грешка"); setData(d); }).catch((e) => setErr(e.message));
  }, [base]);

  const openInvoice = async (id: number) => {
    const r = await fetch(`${base}/invoice/${id}`);
    if (!r.ok) return alert("Документот не е достапен");
    const { invoice, settings } = await r.json();
    const { invoiceHtml, htmlToPdfBlob } = await import("@/lib/print-documents");
    const blob = await htmlToPdfBlob(invoiceHtml(invoice, settings));
    window.open(URL.createObjectURL(blob), "_blank");
  };

  if (err) return <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6"><div className="max-w-md text-center"><p className="text-lg font-semibold text-slate-800">Линкот не важи</p><p className="text-sm text-slate-500 mt-2">{err}</p></div></div>;
  if (!data) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-amber-500" /></div>;
  const openTotal = data.invoices.filter((i: any) => i.type === "standard").reduce((s: number, i: any) => s + (i.currency === "MKD" ? i.open : 0), 0);
  const TABS = [
    { k: "orders", l: "Нарачки", i: Package, n: data.orders.length },
    { k: "invoices", l: "Фактури", i: FileText, n: data.invoices.length },
    { k: "certs", l: "Сертификати", i: Award, n: data.certificates.length },
    { k: "rfq", l: "Барање за понуда", i: Send, n: null },
  ] as const;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white">
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-2">
          <div><p className="text-lg font-bold">{data.company.name}</p><p className="text-xs text-slate-400">Портал за {data.customer.name}</p></div>
          <div className="text-xs text-slate-300 text-right">{data.company.phone}{data.company.email ? <><br />{data.company.email}</> : null}</div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        {openTotal > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
            Отворено за плаќање: <b>{fmt(openTotal)}</b>{data.company.bankAccount ? <> · жиро-сметка {data.company.bankAccount}{data.company.bankName ? ` (${data.company.bankName})` : ""}</> : null}
          </div>
        )}
        <div className="flex flex-wrap gap-1 rounded-lg bg-white border p-1 w-fit">
          {TABS.map((t) => { const I = t.i; return (
            <button key={t.k} onClick={() => setTab(t.k)} className={`px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5 ${tab === t.k ? "bg-amber-500 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
              <I className="h-4 w-4" />{t.l}{t.n !== null ? <span className="text-xs opacity-70">{t.n}</span> : null}</button>
          ); })}
        </div>

        {tab === "orders" && (
          <div className="rounded-xl border bg-white divide-y">
            {!data.orders.length ? <p className="p-6 text-center text-sm text-slate-400">Нема нарачки</p> : data.orders.map((o: any) => (
              <div key={o.id} className="px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
                <span className="font-mono font-semibold w-36">{o.number}</span><span className="text-slate-500 w-24">{fmtD(o.created)}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${o.status === "delivered" ? "bg-emerald-100 text-emerald-700" : o.status === "in_production" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-700"}`}>{ORDER[o.status] ?? o.status}</span>
                <span className="flex-1 text-slate-500 text-xs">{o.delivered ? `испорачано ${fmtD(o.delivered)}` : o.deliveryDate ? `рок на испорака ${fmtD(o.deliveryDate)}` : ""}</span>
                <span className="tabular-nums font-medium">{fmt(o.total, o.currency)}</span>
              </div>
            ))}
          </div>
        )}
        {tab === "invoices" && (
          <div className="rounded-xl border bg-white divide-y">
            {!data.invoices.length ? <p className="p-6 text-center text-sm text-slate-400">Нема фактури</p> : data.invoices.map((i: any) => (
              <div key={i.id} className="px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
                <button className="font-mono font-semibold w-36 text-left text-amber-700 hover:underline" onClick={() => openInvoice(i.id)}>{i.number}</button>
                <span className="text-slate-500 w-24">{fmtD(i.date)}</span>
                <span className="text-xs text-slate-500 w-28">{i.type === "proforma" ? "про-фактура" : i.type === "credit_note" ? "книжно одобрување" : `рок ${fmtD(i.dueDate)}`}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${i.status === "paid" ? "bg-emerald-100 text-emerald-700" : i.dueDate && i.dueDate < new Date().toISOString().slice(0, 10) && i.open > 0 ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"}`}>{INV[i.status] ?? i.status}</span>
                <span className="flex-1" />
                <span className="tabular-nums">{fmt(i.total, i.currency)}</span>
                {i.open > 0.005 && i.type === "standard" && <span className="tabular-nums text-xs text-red-600 w-32 text-right">отворено {fmt(i.open, i.currency)}</span>}
              </div>
            ))}
          </div>
        )}
        {tab === "certs" && (
          <div className="rounded-xl border bg-white divide-y">
            {!data.certificates.length ? <p className="p-6 text-center text-sm text-slate-400">Нема сертификати</p> : data.certificates.map((c: any) => (
              <div key={c.id} className="px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium flex-1">{c.material ?? "Материјал"}{c.heat ? <span className="text-xs text-slate-500"> · шаржа {c.heat}</span> : null}{c.standard ? <span className="text-xs text-slate-500"> · {c.standard}</span> : null}</span>
                <span className="text-xs text-slate-500">испратница {c.dn} · {fmtD(c.date)}</span>
                {c.hasFile ? <a className="text-amber-700 hover:underline text-xs" href={`${base}/cert/${c.id}`} target="_blank" rel="noreferrer">сертификат {c.number ?? ""}</a> : <span className="text-xs">{c.number ?? ""}</span>}
              </div>
            ))}
          </div>
        )}
        {tab === "rfq" && <RfqForm base={base} />}
        <p className="text-[11px] text-slate-400 text-center">Овој линк е личен — не го споделувајте. За нов линк или прашања, контактирајте не.</p>
      </main>
    </div>
  );
}

function RfqForm({ base }: { base: string }) {
  const [title, setTitle] = useState(""); const [message, setMessage] = useState(""); const [contact, setContact] = useState("");
  const [files, setFiles] = useState<{ name: string; mime: string; data: string }[]>([]);
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const addFiles = async (list: FileList) => {
    const out = [...files];
    for (const f of Array.from(list).slice(0, 10 - files.length)) {
      if (f.size > 10 * 1024 * 1024) { alert(`${f.name} е поголема од 10 MB`); continue; }
      const data = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); });
      out.push({ name: f.name, mime: f.type || "application/octet-stream", data });
    }
    setFiles(out);
  };
  const send = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${base}/rfq`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, message, contact, files }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Грешка");
      setDone(true);
    } catch (e: any) { alert(e.message); }
    setBusy(false);
  };
  if (done) return <div className="rounded-xl border bg-white p-8 text-center"><CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" /><p className="mt-2 font-semibold">Барањето е примено</p><p className="text-sm text-slate-500">Ќе ве контактираме со понуда.</p></div>;
  return (
    <div className="rounded-xl border bg-white p-4 space-y-3 text-sm">
      <div className="space-y-1"><label className="text-xs text-slate-500">Што ви треба *</label><input className="w-full border rounded-lg px-3 py-2" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="на пр. 200 капаци, лим 2 mm, прашкасто бојосани" /></div>
      <div className="space-y-1"><label className="text-xs text-slate-500">Опис, количини, рок</label><textarea className="w-full border rounded-lg px-3 py-2" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
      <div className="space-y-1"><label className="text-xs text-slate-500">Контакт лице / телефон</label><input className="w-full border rounded-lg px-3 py-2" value={contact} onChange={(e) => setContact(e.target.value)} /></div>
      <input ref={ref} type="file" multiple className="hidden" accept=".dxf,.dwg,.pdf,.step,.stp,.png,.jpg,.jpeg,.zip" onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="border rounded-lg px-3 py-1.5 hover:bg-slate-50 flex items-center gap-1.5" onClick={() => ref.current?.click()}><Paperclip className="h-4 w-4" />Прикачи цртежи (DXF, PDF, STEP...)</button>
        {files.map((f, i) => <span key={i} className="text-xs bg-slate-100 rounded px-2 py-0.5">{f.name} <button onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button></span>)}
      </div>
      <button className="w-full bg-amber-500 hover:bg-amber-600 text-white rounded-lg py-2 font-medium disabled:opacity-50" disabled={title.trim().length < 3 || busy} onClick={send}>{busy ? "Се праќа..." : "Прати барање"}</button>
    </div>
  );
}
