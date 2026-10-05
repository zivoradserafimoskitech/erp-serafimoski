import { useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Download, ShieldCheck, Mail, Upload, AlertTriangle, CheckCircle2, History, RotateCcw } from "lucide-react";
import { authHeaders } from "@/lib/auth";
import { saveBlob } from "@/lib/xlsx";

const mb = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0)} MB`);
const fmtAt = (v: any) => formatDateTime(v);
const KIND: Record<string, string> = {
  download: "преземен", email: "пратен по е-пошта", check: "проверка на враќање", restore: "ВРАТЕН од копија",
  "email-too-big": "преголем за е-пошта", error: "грешка",
};
type Check = { ok: boolean; createdAt: string; tables: number; rows: number; problems: string[]; error?: string };

/** Бекап: преземање, автоматско праќање по е-пошта секој ден, проверка и враќање од датотека. */
export default function BackupTab() {
  const utils = trpc.useUtils();
  const { data } = trpc.backup.backupStatus.useQuery();
  const [enabled, setEnabled] = useState(false);
  const [email, setEmail] = useState("");
  const [hour, setHour] = useState(22);
  useEffect(() => { if (data) { setEnabled(data.settings.enabled); setEmail(data.settings.email); setHour(data.settings.hour); } }, [data?.settings.enabled, data?.settings.email, data?.settings.hour]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = trpc.backup.backupSettingsSave.useMutation({ onSuccess: () => { toast.success("Зачувано"); utils.backup.invalidate(); }, onError: (e) => toast.error(e.message) });
  const sendNow = trpc.backup.backupSendNow.useMutation({
    onSuccess: (r) => { r.sent ? toast.success(`Пратен (${mb(r.bytes)})`) : toast.warning("Преголем за е-пошта — преземи го рачно"); utils.backup.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const [busy, setBusy] = useState<"" | "download" | "check" | "restore">("");
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const download = async () => {
    setBusy("download");
    try {
      const res = await fetch("/api/admin/backup", { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Грешка ${res.status}`);
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "erp-bekap.json.gz";
      saveBlob(await res.blob(), name);
      toast.success("Бекапот е преземен — чувај го и надвор од компјутерот (диск, облак)");
      utils.backup.invalidate();
    } catch (e: any) { toast.error(e.message); }
    setBusy("");
  };
  const post = async (path: string, f: File) => {
    const res = await fetch(path, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/octet-stream" }, body: f });
    return res.json();
  };
  const runCheck = async (f: File) => {
    setBusy("check"); setCheck(null);
    try { setCheck(await post("/api/admin/backup/check", f)); utils.backup.invalidate(); }
    catch (e: any) { toast.error(e.message); }
    setBusy("");
  };
  const restore = async () => {
    if (!file || !check?.ok) return;
    const typed = prompt(`ВНИМАНИЕ: сите сегашни податоци ќе се заменат со копијата од ${fmtAt(check.createdAt)}.\nСè што е внесено после тоа ќе се изгуби. Прво преземи свеж бекап!\n\nЗа да продолжиш, напиши ВРАТИ:`);
    if (typed !== "ВРАТИ") return;
    setBusy("restore");
    try {
      const r = await post(`/api/admin/backup/restore?confirm=${encodeURIComponent("ВРАТИ")}`, file);
      if (!r.ok) throw new Error(r.error ?? "Враќањето не успеа — ништо не е сменето");
      alert(`Вратено: ${r.tables} табели, ${r.rows} записи. Сите се одјавуваат — најави се повторно.`);
      window.localStorage.removeItem("appKey");
      window.location.reload();
    } catch (e: any) { toast.error(e.message); }
    setBusy("");
  };

  const stale = data && (data.daysSince == null || data.daysSince > 7);
  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${stale ? "bg-warning/15 text-primary" : "bg-emerald-100 text-emerald-700"}`}>
            {stale ? <AlertTriangle className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
          </div>
          <div className="flex-1">
            <p className="font-semibold">
              {data?.lastSaved ? `Последен бекап: ${fmtAt(data.lastSaved.at)} (${KIND[data.lastSaved.kind]})` : "Уште нема направено бекап"}
            </p>
            <p className="text-sm text-gray-600">
              Целосна копија на сите податоци (фактури, налози, залиха, прилози...) во една датотека. Чувај ја надвор од серверот —
              ако нешто се случи со базата, од неа се враќа сè. Базата сега има околу {data ? mb(data.dbBytes) : "…"} (копијата е компресирана, обично многу помала).
            </p>
          </div>
          <Button onClick={download} disabled={!!busy}>
            <Download className="h-4 w-4 mr-1.5" />{busy === "download" ? "Се прави..." : "Преземи бекап"}
          </Button>
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-4 space-y-3">
        <p className="font-semibold flex items-center gap-2"><Mail className="h-4 w-4 text-primary" />Автоматски секој ден по е-пошта</p>
        <p className="text-sm text-gray-600">Секоја вечер серверот прави копија и ја праќа како прилог (до {data ? mb(data.maxMailBytes) : "20 MB"}). Ако е поголема, стигнува потсетник да се преземе рачно. Најдобро е посебна адреса (на пр. Gmail само за бекап).</p>
        {data && !data.mailConfigured && <p className="text-xs text-primary">Прво внеси SMTP во Подесувања → Фирма.</p>}
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex items-center gap-2 text-sm h-9"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Вклучено</label>
          <div className="space-y-1 flex-1 min-w-[14rem]"><Label className="text-xs">Е-пошта</Label><Input className="h-9" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="bekap@..." /></div>
          <div className="space-y-1"><Label className="text-xs">Од час</Label><Input className="h-9 w-20" type="number" min={0} max={23} value={hour} onChange={(e) => setHour(Math.max(0, Math.min(23, Number(e.target.value) || 0)))} /></div>
          <Button variant="outline" className="h-9" disabled={save.isPending} onClick={() => save.mutate({ enabled, email: email.trim(), hour })}>Зачувај</Button>
          <Button variant="outline" className="h-9" disabled={sendNow.isPending || !data?.mailConfigured || !data?.settings.email} onClick={() => sendNow.mutate()}>{sendNow.isPending ? "Се праќа..." : "Прати сега"}</Button>
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-4 space-y-3">
        <p className="font-semibold flex items-center gap-2"><RotateCcw className="h-4 w-4 text-primary" />Провери / врати од датотека</p>
        <p className="text-sm text-gray-600">„Провери“ ја враќа копијата во привремен простор и брои дали е сè на место — сегашните податоци не се допираат. Препорачливо е еднаш месечно, за да знаеш дека бекапот навистина работи. „Врати“ ги заменува сите сегашни податоци со копијата.</p>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".gz,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setCheck(null); if (f) void runCheck(f); e.target.value = ""; }} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={!!busy}><Upload className="h-4 w-4 mr-1.5" />{busy === "check" ? "Се проверува..." : "Избери датотека и провери"}</Button>
          {file && <span className="text-xs text-gray-500">{file.name} · {mb(file.size)}</span>}
        </div>
        {check && (check.error ? (
          <p className="text-sm text-red-600">{check.error}</p>
        ) : (
          <div className={`rounded-lg border px-3 py-2 text-sm ${check.ok ? "border-emerald-200 bg-emerald-50" : "border-primary/20 bg-primary/10"}`}>
            <p className="font-medium flex items-center gap-1.5">
              {check.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-primary" />}
              Копија од {fmtAt(check.createdAt)}: {check.tables} табели, {check.rows.toLocaleString("mk-MK")} записи {check.ok ? "— се враќа без проблем" : "— има проблеми"}
            </p>
            {check.problems.slice(0, 10).map((p, i) => <p key={i} className="text-xs text-foreground/80 ml-6">{p}</p>)}
            {check.ok && (
              <Button size="sm" variant="ghost" className="mt-1 text-red-600" disabled={!!busy} onClick={restore}>
                {busy === "restore" ? "Се враќа..." : "Врати ги сите податоци од оваа копија"}
              </Button>
            )}
          </div>
        ))}
      </CardContent></Card>

      {!!data?.history.length && (
        <Card><CardContent className="p-4 space-y-1 text-sm">
          <p className="font-semibold flex items-center gap-2 mb-1"><History className="h-4 w-4 text-gray-500" />Историја</p>
          {data.history.slice(0, 12).map((h, i) => (
            <p key={i} className="text-xs text-gray-600">{fmtAt(h.at)} · {KIND[h.kind] ?? h.kind}{h.rows ? ` · ${h.tables} табели, ${h.rows.toLocaleString("mk-MK")} записи` : ""}{h.bytes ? ` · ${mb(h.bytes)}` : ""}{h.note ? ` · ${h.note}` : ""}</p>
          ))}
        </CardContent></Card>
      )}
    </div>
  );
}
