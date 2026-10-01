import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { isStaleChunkError, reloadForNewVersion } from "@/lib/stale-chunk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Mail, Paperclip, Loader2 } from "lucide-react";
import { htmlToPdfBase64, type DocLang } from "@/lib/print-documents";

export interface SendEmailProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  docType: "quotation" | "invoice" | "purchase_order";
  docId: number;
  docNumber: string;
  defaultTo?: string | null;
  companyName?: string | null;
  /** Го гради HTML-от на документот на избраниот јазик */
  buildHtml: (lang: DocLang) => string;
  defaultLang?: DocLang;
  /** По успешно праќање (на пр. нарачката станува „Испратена“) */
  onSent?: () => void;
}

const TEXT = {
  mk: {
    quotation: (n: string, c: string) => ({ subject: `Понуда ${n} — ${c}`, body: `Почитувани,\n\nВо прилог ви ја праќаме понудата ${n}.\nЗа прашања стоиме на располагање.\n\nСо почит,\n${c}` }),
    invoice: (n: string, c: string) => ({ subject: `Фактура ${n} — ${c}`, body: `Почитувани,\n\nВо прилог ви ја праќаме фактурата ${n}.\n\nСо почит,\n${c}` }),
    purchase_order: (n: string, c: string) => ({ subject: `Набавна нарачка ${n} — ${c}`, body: `Почитувани,\n\nВо прилог ви ја праќаме набавната нарачка ${n}.\nВе молиме потврдете ја нарачката и рокот за испорака, и наведете го бројот на нарачката на фактурата.\n\nСо почит,\n${c}` }),
  },
  en: {
    quotation: (n: string, c: string) => ({ subject: `Quotation ${n} — ${c}`, body: `Dear Sir or Madam,\n\nPlease find attached our quotation ${n}.\nWe remain at your disposal for any questions.\n\nKind regards,\n${c}` }),
    invoice: (n: string, c: string) => ({ subject: `Invoice ${n} — ${c}`, body: `Dear Sir or Madam,\n\nPlease find attached invoice ${n}.\n\nKind regards,\n${c}` }),
    purchase_order: (n: string, c: string) => ({ subject: `Purchase order ${n} — ${c}`, body: `Dear Sir or Madam,\n\nPlease find attached our purchase order ${n}.\nKindly confirm the order and the delivery date, and quote the order number on your invoice.\n\nKind regards,\n${c}` }),
  },
};
const latin = (s: string) => s.replace(/ПФ/g, "PF").replace(/ПО/g, "PO").replace(/КН/g, "CN").replace(/НН/g, "PO");

export default function SendEmailDialog(p: SendEmailProps) {
  const { data: status } = trpc.mail.mailStatus.useQuery(undefined, { enabled: p.open });
  const [lang, setLang] = useState<DocLang>(p.defaultLang ?? "mk");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const send = trpc.mail.sendDocument.useMutation();

  useEffect(() => {
    if (!p.open) return;
    const l = p.defaultLang ?? "mk";
    setLang(l);
    setTo(p.defaultTo ?? "");
    setCc("");
    const num = l === "en" ? latin(p.docNumber) : p.docNumber;
    const t = TEXT[l][p.docType](num, p.companyName ?? "");
    setSubject(t.subject); setBody(t.body);
  }, [p.open]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchLang = (l: DocLang) => {
    setLang(l);
    const num = l === "en" ? latin(p.docNumber) : p.docNumber;
    const t = TEXT[l][p.docType](num, p.companyName ?? "");
    setSubject(t.subject); setBody(t.body);
  };
  const emails = (s: string) => s.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
  const valid = (s: string) => emails(s).every(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  const kind = { quotation: ["Ponuda", "Quotation"], invoice: ["Faktura", "Invoice"], purchase_order: ["Narachka", "PurchaseOrder"] }[p.docType];
  const filename = `${lang === "en" ? kind[1] : kind[0]}-${latin(p.docNumber).replace(/[^\w-]+/g, "-")}.pdf`;

  const onSend = async () => {
    setBusy(true);
    try {
      const pdfBase64 = await htmlToPdfBase64(p.buildHtml(lang));
      await send.mutateAsync({ to: emails(to), cc: cc ? emails(cc) : undefined, subject, body, filename, pdfBase64, docType: p.docType, docId: p.docId });
      toast.success(`Пратено на ${emails(to).join(", ")}`);
      p.onSent?.();
      p.onOpenChange(false);
    } catch (e: any) {
      if (isStaleChunkError(e) && reloadForNewVersion()) { toast.info("Има нова верзија — страницата се освежува, потоа прати повторно"); return; }
      toast.error(e?.message ?? "Пораката не е пратена");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Mail className="h-5 w-5 text-amber-600" />Прати по е-пошта</DialogTitle></DialogHeader>
        {status && !status.configured ? (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
            Е-поштата за праќање не е поставена. Внеси ги SMTP податоците во <b>Подесувања → Фирма → Праќање е-пошта</b>.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-1">
              <Button size="sm" variant={lang === "mk" ? "default" : "outline"} onClick={() => switchLang("mk")}>Македонски</Button>
              <Button size="sm" variant={lang === "en" ? "default" : "outline"} onClick={() => switchLang("en")}>English</Button>
            </div>
            <div className="space-y-1"><Label className="text-xs">До</Label><Input value={to} onChange={(e) => setTo(e.target.value)} placeholder={p.docType === "purchase_order" ? "dobavuvac@firma.com" : "klient@firma.com"} /></div>
            <div className="space-y-1"><Label className="text-xs">Копија (CC)</Label><Input value={cc} onChange={(e) => setCc(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Наслов</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Порака</Label><Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></div>
            <p className="text-xs text-gray-500 flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" />{filename}{status?.from ? ` · од ${status.from}` : ""}</p>
            <Button className="w-full bg-amber-500 hover:bg-amber-600" disabled={busy || !to || !valid(to) || (!!cc && !valid(cc)) || !subject} onClick={onSend}>
              {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Се праќа...</> : "Прати"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
