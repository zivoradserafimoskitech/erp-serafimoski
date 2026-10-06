import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { isStaleChunkError, reloadForNewVersion } from "@/lib/stale-chunk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Mail, Paperclip, Loader2, UserRound, Star } from "lucide-react";
import { htmlToPdfBase64, type DocLang } from "@/lib/print-documents";

export interface SendEmailProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  docType: "quotation" | "invoice" | "purchase_order" | "quality" | "ios" | "compensation";
  docId: number;
  docNumber: string;
  defaultTo?: string | null;
  companyName?: string | null;
  /** Го гради HTML-от на документот на избраниот јазик */
  buildHtml: (lang: DocLang) => string;
  defaultLang?: DocLang;
  /** По успешно праќање (на пр. нарачката станува „Испратена“) */
  onSent?: () => void;
  /** Фирма — нуди избор на контакт лица од CRM како примачи */
  customerId?: number | null;
}

const TEXT = {
  mk: {
    quotation: (n: string, c: string) => ({ subject: `Понуда ${n} — ${c}`, body: `Почитувани,\n\nВо прилог ви ја праќаме понудата ${n}.\nЗа прашања стоиме на располагање.\n\nСо почит,\n${c}` }),
    invoice: (n: string, c: string) => ({ subject: `Фактура ${n} — ${c}`, body: `Почитувани,\n\nВо прилог ви ја праќаме фактурата ${n}.\n\nСо почит,\n${c}` }),
    quality: (n: string, c: string) => ({ subject: `Рекламација / неусогласеност ${n} — ${c}`, body: `Почитувани,\n\nВо прилог ви праќаме запис за неусогласеност ${n} со опис на проблемот.\nВе молиме за ваш одговор и предлог за решение.\n\nСо почит,\n${c}` }),
    purchase_order: (n: string, c: string) => ({ subject: `Набавна нарачка ${n} — ${c}`, body: `Почитувани,\n\nВо прилог ви ја праќаме набавната нарачка ${n}.\nВе молиме потврдете ја нарачката и рокот за испорака, и наведете го бројот на нарачката на фактурата.\n\nСо почит,\n${c}` }),
    ios: (n: string, c: string) => ({ subject: `ИОС — извод на отворени ставки ${n} — ${c}`, body: `Почитувани,\n\nВо прилог ви праќаме извод на отворени ставки (ИОС) ${n}.\nВе молиме проверете ја состојбата и вратете го потпишан и заверен во рок од 8 дена — со „Потврдуваме“ или со образложение ако се разликува.\n\nСо почит,\n${c}` }),
    compensation: (n: string, c: string) => ({ subject: `Изјава за компензација ${n} — ${c}`, body: `Почитувани,\n\nВо прилог ви праќаме изјава за компензација ${n}.\nВе молиме потпишете ја, заверете ја и вратете ни примерок.\n\nСо почит,\n${c}` }),
  },
  en: {
    quotation: (n: string, c: string) => ({ subject: `Quotation ${n} — ${c}`, body: `Dear Sir or Madam,\n\nPlease find attached our quotation ${n}.\nWe remain at your disposal for any questions.\n\nKind regards,\n${c}` }),
    invoice: (n: string, c: string) => ({ subject: `Invoice ${n} — ${c}`, body: `Dear Sir or Madam,\n\nPlease find attached invoice ${n}.\n\nKind regards,\n${c}` }),
    quality: (n: string, c: string) => ({ subject: `Non-conformance ${n} — ${c}`, body: `Dear Sir or Madam,\n\nPlease find attached non-conformance report ${n}.\nWe kindly ask for your reply and proposed solution.\n\nKind regards,\n${c}` }),
    purchase_order: (n: string, c: string) => ({ subject: `Purchase order ${n} — ${c}`, body: `Dear Sir or Madam,\n\nPlease find attached our purchase order ${n}.\nKindly confirm the order and the delivery date, and quote the order number on your invoice.\n\nKind regards,\n${c}` }),
    ios: (n: string, c: string) => ({ subject: `Statement of open items ${n} — ${c}`, body: `Dear Sir or Madam,\n\nPlease find attached the statement of open items ${n}.\nKindly check the balance and return it signed within 8 days, confirming it or stating the differences.\n\nKind regards,\n${c}` }),
    compensation: (n: string, c: string) => ({ subject: `Offset agreement ${n} — ${c}`, body: `Dear Sir or Madam,\n\nPlease find attached offset (compensation) agreement ${n}.\nKindly sign it and return a copy.\n\nKind regards,\n${c}` }),
  },
};
const latin = (s: string) => s.replace(/КОМП/g, "KOMP").replace(/ИОС/g, "IOS").replace(/ПФ/g, "PF").replace(/ПО/g, "PO").replace(/КН/g, "CN").replace(/НН/g, "PO").replace(/НУ/g, "NC");

export default function SendEmailDialog(p: SendEmailProps) {
  const { data: status } = trpc.mail.mailStatus.useQuery(undefined, { enabled: p.open });
  const [lang, setLang] = useState<DocLang>(p.defaultLang ?? "mk");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(false);
  const send = trpc.mail.sendDocument.useMutation();
  const utils = trpc.useUtils();
  const { data: contacts } = trpc.crm.contactList.useQuery({ customerId: p.customerId ?? 0 }, { enabled: p.open && !!p.customerId });
  const withEmail = (contacts ?? []).filter((c: any) => c.email);

  useEffect(() => {
    if (!p.open) return;
    const l = p.defaultLang ?? "mk";
    setLang(l);
    setTo(p.defaultTo ?? "");
    setPicked(false);
    setCc("");
    const num = l === "en" ? latin(p.docNumber) : p.docNumber;
    const t = TEXT[l][p.docType](num, p.companyName ?? "");
    setSubject(t.subject); setBody(t.body);
  }, [p.open]); // eslint-disable-line react-hooks/exhaustive-deps

  // кога ќе стигнат контактите: ако нема адреса, предложи го главниот контакт
  useEffect(() => {
    if (!p.open || picked || to.trim() || !withEmail.length) return;
    const primary = withEmail.find((c: any) => c.isPrimary) ?? withEmail[0];
    setTo(primary.email); setPicked(true);
  }, [p.open, withEmail.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleContact = (email: string) => {
    setPicked(true);
    const list = emails(to);
    const has = list.some((e) => e.toLowerCase() === email.toLowerCase());
    setTo((has ? list.filter((e) => e.toLowerCase() !== email.toLowerCase()) : [...list, email]).join(", "));
  };

  const switchLang = (l: DocLang) => {
    setLang(l);
    const num = l === "en" ? latin(p.docNumber) : p.docNumber;
    const t = TEXT[l][p.docType](num, p.companyName ?? "");
    setSubject(t.subject); setBody(t.body);
  };
  const emails = (s: string) => s.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
  const valid = (s: string) => emails(s).every(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  const kind = { quotation: ["Ponuda", "Quotation"], invoice: ["Faktura", "Invoice"], purchase_order: ["Narachka", "PurchaseOrder"], quality: ["Reklamacija", "NonConformance"], ios: ["IOS", "OpenItems"], compensation: ["Kompenzacija", "Offset"] }[p.docType];
  const filename = `${lang === "en" ? kind[1] : kind[0]}-${latin(p.docNumber).replace(/[^\w-]+/g, "-")}.pdf`;

  const onSend = async () => {
    setBusy(true);
    try {
      const pdfBase64 = await htmlToPdfBase64(p.buildHtml(lang));
      const r: any = await send.mutateAsync({ to: emails(to), cc: cc ? emails(cc) : undefined, subject, body, filename, pdfBase64, docType: p.docType, docId: p.docId });
      toast.success(`Пратено на ${emails(to).join(", ")}${r?.crm ? " · запишано во CRM, понудата е „Пратена“" : ""}`);
      if (p.docType === "quotation") { utils.crm.invalidate(); utils.quotation.invalidate(); }
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
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Mail className="h-5 w-5 text-primary" />{p.docType === "quotation" ? "Прати понуда по мејл" : "Прати по е-пошта"}</DialogTitle></DialogHeader>
        {status && !status.configured ? (
          <div className="text-sm text-foreground/80 bg-primary/10 border border-primary/20 rounded-lg p-3 space-y-1.5">
            <p><b>Е-поштата за праќање не е поставена</b> — пораката не може да се прати.</p>
            <p>Внеси ги SMTP податоците во <b>Подесувања → Фирма → Праќање е-пошта</b>, или администраторот нека ги постави env променливите на серверот:</p>
            <code className="block text-xs bg-card border border-border rounded px-2 py-1">SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM</code>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-1">
              <Button size="sm" variant={lang === "mk" ? "default" : "outline"} onClick={() => switchLang("mk")}>Македонски</Button>
              <Button size="sm" variant={lang === "en" ? "default" : "outline"} onClick={() => switchLang("en")}>English</Button>
            </div>
            {withEmail.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Контакт лица</Label>
                <div className="flex flex-wrap gap-1.5">
                  {withEmail.map((c: any) => {
                    const on = emails(to).some((e) => e.toLowerCase() === String(c.email).toLowerCase());
                    return (
                      <button key={c.id} type="button" onClick={() => toggleContact(c.email)}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground/80 hover:bg-muted"}`}
                        title={c.email}>
                        {c.isPrimary ? <Star className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}{c.name}{c.position ? ` · ${c.position}` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="space-y-1"><Label className="text-xs">До</Label><Input value={to} onChange={(e) => setTo(e.target.value)} placeholder={p.docType === "purchase_order" ? "dobavuvac@firma.com" : "klient@firma.com"} /></div>
            <div className="space-y-1"><Label className="text-xs">Копија (CC)</Label><Input value={cc} onChange={(e) => setCc(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Наслов</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Порака</Label><Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></div>
            <p className="text-xs text-gray-500 flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" />{filename}{status?.from ? ` · од ${status.from}` : ""}</p>
            {p.docType === "quotation" && <p className="text-[11px] text-muted-foreground">Пораката се запишува како активност на фирмата/контактот/зделката, а понудата се означува „Пратена“.</p>}
            <Button className="w-full" disabled={busy || !to || !valid(to) || (!!cc && !valid(cc)) || !subject} onClick={onSend}>
              {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Се праќа...</> : "Прати"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
