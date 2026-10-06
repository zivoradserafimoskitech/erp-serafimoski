// Форма „Побарај понуда“ за serafimoski.tech (React 18/19, без дополнителни библиотеки).
// Копирај ги LeadForm.tsx и attribution.ts во проектот на веб-страницата.
// Во main.tsx додади: import { captureAttribution } from "./attribution"; captureAttribution();
import { useMemo, useRef, useState } from "react";
import { getAttribution } from "./attribution";

/** Адреса на ERP-то (Railway). Замени ја со вистинскиот домен. */
const ENDPOINT = "https://web-production-dceb8.up.railway.app/api/public/lead";
const MAX_FILES = 5;
const MAX_FILE_MB = 10;
const ACCEPT = ".pdf,.dxf,.dwg,.step,.stp,.igs,.iges,.png,.jpg,.jpeg";

const PRODUCTS = ["Ласерско сечење", "Виткање", "Заварени конструкции", "Огради и порти", "Метални полици", "Друго"];

type State = { kind: "idle" } | { kind: "sending" } | { kind: "ok" } | { kind: "error"; message: string };

export default function LeadForm({ lang = "mk", products = PRODUCTS }: { lang?: "mk" | "en"; products?: string[] }) {
  const started = useMemo(() => Date.now(), []);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [files, setFiles] = useState<File[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const t = lang === "en" ? EN : MK;

  function pickFiles(list: FileList | null) {
    const arr = Array.from(list ?? []);
    const tooBig = arr.find((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (tooBig) { setState({ kind: "error", message: `${tooBig.name}: ${t.tooBig}` }); return; }
    setFiles(arr.slice(0, MAX_FILES));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === "sending") return;
    setState({ kind: "sending" });
    const fd = new FormData(e.currentTarget);
    fd.delete("files");
    for (const f of files) fd.append("files", f);
    const a = getAttribution();
    for (const [k, v] of Object.entries(a)) if (k !== "at" && v) fd.set(k, String(v));
    fd.set("_ts", String(started));
    fd.set("lang", lang);
    try {
      const res = await fetch(ENDPOINT, { method: "POST", body: fd, headers: { Accept: "application/json" } });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || (res.status === 429 ? t.tooMany : t.failed));
      setState({ kind: "ok" });
      formRef.current?.reset(); setFiles([]);
      // конверзија за Google Ads / Meta (ако се вчитани gtag / fbq)
      (window as any).gtag?.("event", "generate_lead", { form: "quote" });
      (window as any).fbq?.("track", "Lead");
    } catch (err: any) {
      setState({ kind: "error", message: err?.message || t.failed });
    }
  }

  if (state.kind === "ok") return <div role="status" style={box}><h3 style={{ margin: "0 0 8px" }}>{t.thanks}</h3><p style={{ margin: 0 }}>{t.thanksText}</p></div>;

  return (
    <form ref={formRef} onSubmit={submit} style={{ display: "grid", gap: 12, maxWidth: 640 }} noValidate={false}>
      {/* honeypot — скриено за луѓе, ботовите го пополнуваат */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label>Website <input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <div style={row}>
        <Field label={t.name} required><input name="name" required minLength={2} maxLength={160} autoComplete="name" style={input} /></Field>
        <Field label={t.company}><input name="company" maxLength={255} autoComplete="organization" style={input} /></Field>
      </div>
      <div style={row}>
        <Field label={t.email} required><input name="email" type="email" required maxLength={320} autoComplete="email" style={input} /></Field>
        <Field label={t.phone}><input name="phone" type="tel" maxLength={60} autoComplete="tel" style={input} /></Field>
      </div>
      <div style={row}>
        <Field label={t.product}>
          <select name="product_type" style={input} defaultValue="">
            <option value="">—</option>
            {products.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label={t.quantity}><input name="quantity" maxLength={60} placeholder={t.quantityPh} style={input} /></Field>
      </div>
      <Field label={t.message}><textarea name="message" rows={5} maxLength={5000} style={input} /></Field>
      <Field label={`${t.files} (PDF, DXF, DWG, STEP — ${t.max} ${MAX_FILES} × ${MAX_FILE_MB} MB)`}>
        <input name="files" type="file" multiple accept={ACCEPT} onChange={(e) => pickFiles(e.target.files)} />
      </Field>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14 }}>
        <input type="checkbox" name="marketing_consent" value="on" style={{ marginTop: 3 }} />
        <span>{t.consent}</span>
      </label>
      <p style={{ fontSize: 12, opacity: 0.7, margin: 0 }}>{t.privacy}</p>
      {state.kind === "error" && <div role="alert" style={{ color: "#b91c1c" }}>{state.message}</div>}
      <button type="submit" disabled={state.kind === "sending"} style={button}>{state.kind === "sending" ? t.sending : t.submit}</button>
    </form>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label style={{ display: "grid", gap: 4, fontSize: 14, flex: 1, minWidth: 220 }}><span>{label}{required && <span style={{ color: "#b91c1c" }}> *</span>}</span>{children}</label>;
}

const row: React.CSSProperties = { display: "flex", gap: 12, flexWrap: "wrap" };
const input: React.CSSProperties = { padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 8, font: "inherit", width: "100%", boxSizing: "border-box" };
const button: React.CSSProperties = { padding: "12px 18px", border: 0, borderRadius: 8, background: "#0f172a", color: "#fff", font: "inherit", fontWeight: 600, cursor: "pointer" };
const box: React.CSSProperties = { padding: 20, border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 12 };

const MK = {
  name: "Име и презиме", company: "Фирма", email: "Е-пошта", phone: "Телефон", product: "Производ / услуга", quantity: "Количина", quantityPh: "пр. 200 парчиња",
  message: "Порака", files: "Цртежи / прилози", max: "најмногу", consent: "Сакам да добивам понуди и новости по е-пошта (може да се откажам во секое време).",
  privacy: "Податоците ги користиме само за одговор на ова барање.", submit: "Побарај понуда", sending: "Се испраќа…",
  thanks: "Благодариме!", thanksText: "Барањето е примено. Ќе ви одговориме со понуда наскоро.", failed: "Барањето не е испратено. Обидете се повторно или пишете ни на е-пошта.",
  tooMany: "Премногу обиди. Обидете се за неколку минути.", tooBig: `датотеката е поголема од ${MAX_FILE_MB} MB`,
};
const EN: typeof MK = {
  name: "Full name", company: "Company", email: "Email", phone: "Phone", product: "Product / service", quantity: "Quantity", quantityPh: "e.g. 200 pcs",
  message: "Message", files: "Drawings / attachments", max: "max", consent: "I want to receive offers and news by email (unsubscribe any time).",
  privacy: "We only use your data to reply to this request.", submit: "Request a quote", sending: "Sending…",
  thanks: "Thank you!", thanksText: "Your request was received. We will reply with a quote shortly.", failed: "Could not send. Please try again or email us.",
  tooMany: "Too many attempts. Please try again in a few minutes.", tooBig: `file is larger than ${MAX_FILE_MB} MB`,
};
