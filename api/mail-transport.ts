// Праќање е-пошта: еден интерфејс, повеќе провајдери.
//  • SMTP — Подесувања → Фирма (предност) или env SMTP_HOST/PORT/USER/PASS/FROM (+ SMTP_SECURE).
//    Amazon SES работи преку неговиот SMTP интерфејс (SMTP_HOST=email-smtp.<регион>.amazonaws.com).
//  • Brevo — MAIL_PROVIDER=brevo + BREVO_API_KEY
//  • Mailgun — MAIL_PROVIDER=mailgun + MAILGUN_API_KEY + MAILGUN_DOMAIN (+ MAILGUN_REGION=eu)
// Нов провајдер = нова функција што враќа Mailer.
import nodemailer from "nodemailer";
import { getPool } from "./queries/connection";

export type OutMail = {
  from?: string;
  to: string | string[];
  cc?: string | string[];
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: { filename: string; content: Buffer | string; contentType?: string }[];
};
export type MailProvider = "smtp" | "brevo" | "mailgun" | "test";
export type Mailer = { provider: MailProvider; source: "settings" | "env" | "test"; from: string; send(m: OutMail): Promise<{ messageId: string | null }> };
export type SmtpConfig = { host: string; port: number; secure: boolean; user: string; pass: string; from: string; source: "settings" | "env" };

export const MAIL_MISSING =
  "Не е поставена е-пошта за праќање. Внеси SMTP во Подесувања → Фирма или постави env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM (или MAIL_PROVIDER=brevo/mailgun).";

/** SMTP од env. null ако не е поставено. */
export function smtpFromEnv(env: Record<string, string | undefined>): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(env.SMTP_PORT) || 587;
  const user = env.SMTP_USER?.trim() ?? "";
  const sec = (env.SMTP_SECURE ?? "").toLowerCase();
  return { host, port, user, pass: env.SMTP_PASS ?? "", secure: sec ? sec === "true" || sec === "1" : port === 465, from: env.SMTP_FROM?.trim() || env.MAIL_FROM?.trim() || user, source: "env" };
}

export async function smtpConfig(env: Record<string, string | undefined> = process.env): Promise<SmtpConfig | null> {
  const s = env.DATABASE_URL ? (await Promise.resolve().then(() => getPool().query(`SELECT * FROM company_settings LIMIT 1`)).catch(() => ({ rows: [] as any[] }))).rows[0] : null;
  if (s?.smtp_host && s?.smtp_user && s?.smtp_password) {
    const port = Number(s.smtp_port) || 587;
    return { host: s.smtp_host, port, secure: Number(s.smtp_secure) === 1 || port === 465, user: s.smtp_user, pass: s.smtp_password, from: s.smtp_from || s.smtp_user, source: "settings" };
  }
  return smtpFromEnv(env);
}

const list = (v?: string | string[]) => (Array.isArray(v) ? v : v ? v.split(",") : []).map((s) => s.trim()).filter(Boolean);
/** „Име <a@b.mk>“ → { name, email } */
export function parseAddress(s: string): { name?: string; email: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s);
  return m ? { name: m[1].trim() || undefined, email: m[2].trim() } : { email: s.trim() };
}
const b64 = (c: Buffer | string) => (Buffer.isBuffer(c) ? c.toString("base64") : Buffer.from(c).toString("base64"));

function smtpMailer(c: SmtpConfig): Mailer {
  const t = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: c.user ? { user: c.user, pass: c.pass } : undefined });
  return {
    provider: "smtp", source: c.source, from: c.from,
    async send(m) {
      const info = await t.sendMail({ from: m.from ?? c.from, to: list(m.to).join(", "), cc: list(m.cc).join(", ") || undefined, replyTo: m.replyTo,
        subject: m.subject, text: m.text, html: m.html, headers: m.headers, attachments: m.attachments });
      return { messageId: (info as any)?.messageId ?? null };
    },
  };
}

function brevoMailer(apiKey: string, from: string): Mailer {
  return {
    provider: "brevo", source: "env", from,
    async send(m) {
      const sender = parseAddress(m.from ?? from);
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender, to: list(m.to).map((e) => parseAddress(e)), cc: list(m.cc).length ? list(m.cc).map((e) => parseAddress(e)) : undefined,
          replyTo: m.replyTo ? parseAddress(m.replyTo) : undefined, subject: m.subject, htmlContent: m.html, textContent: m.text, headers: m.headers,
          attachment: m.attachments?.map((a) => ({ name: a.filename, content: b64(a.content) })),
        }),
      });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Brevo ${res.status}: ${j?.message ?? res.statusText}`);
      return { messageId: j?.messageId ?? null };
    },
  };
}

function mailgunMailer(apiKey: string, domain: string, region: string, from: string): Mailer {
  const base = region.toLowerCase() === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
  return {
    provider: "mailgun", source: "env", from,
    async send(m) {
      const fd = new FormData();
      fd.append("from", m.from ?? from);
      for (const t of list(m.to)) fd.append("to", t);
      for (const t of list(m.cc)) fd.append("cc", t);
      if (m.replyTo) fd.append("h:Reply-To", m.replyTo);
      fd.append("subject", m.subject);
      if (m.text) fd.append("text", m.text);
      if (m.html) fd.append("html", m.html);
      for (const [k, v] of Object.entries(m.headers ?? {})) fd.append(`h:${k}`, v);
      for (const a of m.attachments ?? []) fd.append("attachment", new Blob([Buffer.isBuffer(a.content) ? new Uint8Array(a.content) : a.content], { type: a.contentType ?? "application/octet-stream" }), a.filename);
      const res = await fetch(`${base}/v3/${domain}/messages`, { method: "POST", headers: { authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}` }, body: fd });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Mailgun ${res.status}: ${j?.message ?? res.statusText}`);
      return { messageId: j?.id ?? null };
    },
  };
}

// само за тестови
let testMailer: Mailer | null = null;
export function __setTestMailer(m: Mailer | null) { testMailer = m; }

/** Активниот провајдер или null ако ништо не е поставено. */
export async function getMailer(env: Record<string, string | undefined> = process.env): Promise<Mailer | null> {
  if (testMailer) return testMailer;
  const provider = (env.MAIL_PROVIDER ?? "smtp").toLowerCase();
  const smtp = await smtpConfig(env);
  const from = env.MAIL_FROM?.trim() || env.SMTP_FROM?.trim() || smtp?.from || "";
  if (provider === "brevo" && env.BREVO_API_KEY && from) return brevoMailer(env.BREVO_API_KEY, from);
  if (provider === "mailgun" && env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN && from) return mailgunMailer(env.MAILGUN_API_KEY, env.MAILGUN_DOMAIN, env.MAILGUN_REGION ?? "us", from);
  return smtp ? smtpMailer(smtp) : null;
}

export async function mailerStatus() {
  const m = await getMailer();
  return { configured: !!m, provider: m?.provider ?? null, source: m?.source ?? null, from: m?.from || null };
}
