import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { FileSpreadsheet, FileDown, FolderArchive, Send, Printer, Loader2, Mail } from "lucide-react";
import { saveBlob } from "@/lib/xlsx";
import { blobToBase64, printAccountantReport } from "@/lib/print-documents";

const fmt = (iso: string) => iso.split("-").reverse().join(".");
const MB = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

/** Копчињата за пакетот до сметководството: Excel, PDF, ZIP со документите, праќање по е-пошта, печатење. */
export default function AccountantPackActions({ report, from, to }: { report: any; from: string; to: string }) {
  const utils = trpc.useUtils();
  const { data: settings } = trpc.settings.settingsGet.useQuery();
  const { data: mail } = trpc.mail.mailStatus.useQuery();
  const [busy, setBusy] = useState<null | "xlsx" | "pdf" | "zip" | "send">(null);
  const [progress, setProgress] = useState("");
  const [sendOpen, setSendOpen] = useState(false);

  const fetchers = {
    vatBooks: (i: { from: string; to: string }) => utils.finance.vatBooks.fetch(i),
    trialBalance: (i: { from: string; to: string }) => utils.finance.trialBalance.fetch(i),
    vat04: (i: { from: string; to: string }) => utils.finance.vat04.fetch(i),
    statements: (i: { date: string; from: string }) => utils.finance.financialStatements.fetch(i),
    journalList: (i: { from: string; to: string; limit: number; offset: number }) => utils.finance.journalList.fetch(i),
  };
  const docFetchers = {
    invoiceById: (i: { id: number }) => utils.accounting.invoiceById.fetch(i),
    incomingInvoiceById: (i: { id: number }) => utils.accounting.incomingInvoiceById.fetch(i),
    receiptById: (i: { id: number }) => utils.accounting.receiptById.fetch(i),
  };
  const lib = () => import("@/lib/accountant-export");
  const xlsx = async () => (await lib()).buildAccountantXlsx(report, from, to, settings?.name, fetchers);
  const pdf = async () => (await lib()).buildAccountantPdf(report, from, to, settings);
  const zip = async (parts: { xlsx?: Blob; pdf?: Blob } = {}) => (await lib()).buildDocumentsZip(report, from, to, settings, docFetchers, parts,
    (d, t, w) => setProgress(`${d}/${t} · ${w}`));

  const run = async (kind: "xlsx" | "pdf" | "zip", job: () => Promise<void>) => {
    setBusy(kind); setProgress("");
    try { await job(); }
    catch (e: any) { toast.error(`Не успеа: ${e?.message ?? e}`); }
    finally { setBusy(null); setProgress(""); }
  };
  const name = (ext: string) => `smetkovodstvo_${from}_${to}.${ext}`;

  return (
    <>
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-2">
          <Button disabled={!!busy} onClick={() => setSendOpen(true)}>
            <Send className="h-4 w-4 mr-2" />Прати до сметководител</Button>
          <Button variant="outline" className="border-emerald-300 text-emerald-800 hover:bg-emerald-50" disabled={!!busy}
            onClick={() => run("xlsx", async () => { saveBlob(await xlsx(), name("xlsx")); toast.success("Excel е симнат"); })}>
            {busy === "xlsx" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />}Excel</Button>
          <Button variant="outline" className="border-red-200 text-red-800 hover:bg-red-50" disabled={!!busy}
            onClick={() => run("pdf", async () => { saveBlob(await pdf(), name("pdf")); toast.success("PDF е симнат"); })}>
            {busy === "pdf" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}PDF</Button>
          <Button variant="outline" disabled={!!busy} title="Извештај + сите излезни фактури како PDF + скенови од влезните фактури"
            onClick={() => run("zip", async () => {
              const [x, p] = await Promise.all([xlsx(), pdf()]);
              const z = await zip({ xlsx: x, pdf: p });
              saveBlob(z, name("zip")); toast.success(`ZIP со документите е симнат (${MB(z.size)})`);
            })}>
            {busy === "zip" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FolderArchive className="h-4 w-4 mr-2" />}Документи (ZIP)</Button>
          <Button variant="ghost" disabled={!!busy} onClick={() => printAccountantReport(report, { startDate: from, endDate: to }, settings)}>
            <Printer className="h-4 w-4 mr-2" />Печати</Button>
        </div>
        {progress && <p className="text-xs text-gray-500">Се подготвува: {progress}</p>}
      </div>
      <SendDialog open={sendOpen} onOpenChange={setSendOpen} from={from} to={to} report={report} settings={settings} mailReady={!!mail?.configured}
        build={{ xlsx, pdf, zip }} />
    </>
  );
}

function SendDialog({ open, onOpenChange, from, to, report, settings, mailReady, build }: {
  open: boolean; onOpenChange: (o: boolean) => void; from: string; to: string; report: any; settings: any; mailReady: boolean;
  build: { xlsx: () => Promise<Blob>; pdf: () => Promise<Blob>; zip: (p?: { xlsx?: Blob; pdf?: Blob }) => Promise<Blob> };
}) {
  const utils = trpc.useUtils();
  const company = settings?.name ?? "";
  const [toAddr, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [withZip, setWithZip] = useState(true);
  const [step, setStep] = useState("");
  const send = trpc.mail.sendAccountantPack.useMutation();
  const saveEmail = trpc.settings.accountantEmailSet.useMutation();

  useEffect(() => {
    if (!open) return;
    const vat = Number(report?.vatRecapitulation?.vatBalance ?? 0);
    setTo(settings?.accountantEmail ?? "");
    setSubject(`Документи за сметководство ${fmt(from)} – ${fmt(to)} — ${company}`);
    setBody([
      "Почитувани,",
      "",
      `Во прилог се документите за периодот ${fmt(from)} – ${fmt(to)}:`,
      "- извештај (PDF) со КИФ, КУФ и ДДВ по стапки",
      "- истите податоци во Excel, со налози за книжење и бруто биланс",
      ...(withZip ? ["- ZIP со излезните фактури и скеновите од влезните фактури"] : []),
      "",
      `Излезни фактури: ${report?.outgoing?.count ?? 0}, влезни фактури: ${report?.incoming?.count ?? 0}.`,
      `${vat >= 0 ? "ДДВ за плаќање" : "ДДВ за поврат"}: ${Math.abs(vat).toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ден.`,
      "",
      "Поздрав,",
      company,
    ].join("\n"));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const emails = (v: string) => v.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
  const valid = (v: string) => emails(v).every(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  const blocker = !mailReady ? "Не е поставена е-пошта за праќање — Подесувања → Фирма → Е-пошта (SMTP)"
    : !emails(toAddr).length ? "Внеси е-пошта на сметководителот"
    : !valid(toAddr) || (cc && !valid(cc)) ? "Провери ги адресите" : null;

  const go = async () => {
    try {
      setStep("Се прави Excel и PDF...");
      const [x, p] = await Promise.all([build.xlsx(), build.pdf()]);
      type Att = { filename: string; base64: string; contentType: "application/pdf" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/zip" };
      const atts: Att[] = [
        { filename: `smetkovodstvo_${from}_${to}.pdf`, base64: await blobToBase64(p), contentType: "application/pdf" },
        { filename: `smetkovodstvo_${from}_${to}.xlsx`, base64: await blobToBase64(x), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      ];
      if (withZip) {
        setStep("Се собираат документите во ZIP...");
        // извештајот е веќе во прилог, па ZIP-от ги носи само документите; преголем ZIP не се праќа
        const z = await build.zip();
        if (z.size > 15 * 1048576) toast.warning(`ZIP-от е ${MB(z.size)} — преголем за е-пошта. Се праќаат само Excel и PDF; ZIP-от симни го со „Документи (ZIP)“.`);
        else atts.push({ filename: `dokumenti_${from}_${to}.zip`, base64: await blobToBase64(z), contentType: "application/zip" });
      }
      setStep("Се праќа...");
      await send.mutateAsync({ to: emails(toAddr), cc: cc ? emails(cc) : undefined, subject, body, period: { from, to }, attachments: atts });
      // адресата се памти за следниот пат
      const first = emails(toAddr)[0];
      if (first && first !== settings?.accountantEmail) saveEmail.mutateAsync({ email: first }).then(() => utils.settings.settingsGet.invalidate()).catch(() => {});
      toast.success(`Пратено до ${emails(toAddr).join(", ")}`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally { setStep(""); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !step && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl">
        <DialogTitle className="flex items-center gap-2"><Mail className="h-5 w-5 text-primary" />Прати до сметководител</DialogTitle>
        <DialogDescription>Период {fmt(from)} – {fmt(to)}. Во прилог: PDF и Excel{withZip ? ", и ZIP со фактурите" : ""}.</DialogDescription>
        <div className="space-y-3">
          <div className="space-y-1"><Label>До</Label>
            <Input value={toAddr} onChange={(e) => setTo(e.target.value)} placeholder="smetkovoditel@primer.mk" />
            {!settings?.accountantEmail && <p className="text-[11px] text-gray-500">Адресата ќе се запомни за следниот пат.</p>}</div>
          <div className="space-y-1"><Label>Копија (cc)</Label><Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="не е задолжително" /></div>
          <div className="space-y-1"><Label>Наслов</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className="space-y-1"><Label>Порака</Label><Textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} className="text-sm" /></div>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={withZip} onChange={(e) => setWithZip(e.target.checked)} className="mt-1 h-4 w-4 accent-primary" />
            <span>Приложи ги и фактурите (ZIP)<span className="block text-xs text-gray-500">излезните како PDF и скеновите од влезните — {(report?.outgoing?.count ?? 0) + (report?.incoming?.items ?? []).filter((i: any) => i.hasFile).length} документи</span></span>
          </label>
        </div>
        <div className="flex items-center justify-between gap-3 pt-2">
          <span className={`text-sm ${blocker ? "text-primary" : "text-gray-500"}`}>{step || blocker || ""}</span>
          <div className="flex gap-2">
            <Button variant="outline" disabled={!!step} onClick={() => onOpenChange(false)}>Откажи</Button>
            <Button className="min-w-[110px]" disabled={!!blocker || !!step} onClick={go}>
              {step ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}Прати</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
