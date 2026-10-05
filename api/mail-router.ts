// Праќање документи (понуда, фактура, про-фактура) по е-пошта преку SMTP на фирмата.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import nodemailer from "nodemailer";
import { createRouter, publicQuery } from "./middleware";
import { getPool } from "./queries/connection";
import { logAudit } from "./audit-helper";
import { buildEmailLog, smtpFromEnv, type SmtpConfig } from "@contracts/crm-automation";

/** SMTP: прво од Подесувања → Фирма, па од env (SMTP_HOST/PORT/USER/PASS/FROM). */
export async function smtpConfig(): Promise<SmtpConfig | null> {
  const s = (await getPool().query(`SELECT * FROM company_settings LIMIT 1`)).rows[0];
  if (s?.smtp_host && s?.smtp_user && s?.smtp_password) {
    const port = Number(s.smtp_port) || 587;
    return { host: s.smtp_host, port, secure: Number(s.smtp_secure) === 1 || port === 465, user: s.smtp_user, pass: s.smtp_password,
      from: s.smtp_from || s.smtp_user, source: "settings" };
  }
  return smtpFromEnv(process.env);
}

export const SMTP_MISSING = "Не е поставена е-пошта за праќање. Внеси SMTP во Подесувања → Фирма или постави ги env променливите SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.";

// само за тестови: лажен транспорт (на пр. nodemailer jsonTransport)
let testTransport: { t: any; from: string } | null = null;
export function __setTestMailTransport(x: { t: any; from: string } | null) { testTransport = x; }

export async function mailTransport() {
  const company = ((await getPool().query(`SELECT name FROM company_settings LIMIT 1`)).rows[0]?.name ?? "") as string;
  if (testTransport) return { ...testTransport, company };
  const c = await smtpConfig();
  if (!c) throw new TRPCError({ code: "PRECONDITION_FAILED", message: SMTP_MISSING });
  const t = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: c.user ? { user: c.user, pass: c.pass } : undefined });
  return { t, from: c.from, company };
}

/**
 * По праќање понуда: лог во crm_email_log, активност „е-пошта“ на фирма/контакт/зделка,
 * понудата → „пратена“ (sent_at), зделката → фаза „Понуда пратена“.
 */
export async function logQuotationEmail(i: { quotationId: number; to: string[]; cc?: string[]; subject: string; body: string; attachment: string | null; sentBy: string | null; messageId?: string | null }) {
  const pool = getPool();
  const qt = (await pool.query(`SELECT id, customer_id, opportunity_id, status FROM quotations WHERE id = $1`, [i.quotationId])).rows[0];
  if (!qt) return null;
  const customerId = qt.customer_id == null ? null : Number(qt.customer_id);
  const contacts = customerId
    ? (await pool.query(`SELECT id, email FROM crm_contacts WHERE customer_id = $1`, [customerId])).rows.map((r: any) => ({ id: Number(r.id), email: r.email }))
    : [];
  const opportunityId = qt.opportunity_id == null ? null : Number(qt.opportunity_id);
  const { log, activities } = buildEmailLog({ to: i.to, cc: i.cc, subject: i.subject, body: i.body, attachment: i.attachment, customerId, opportunityId, quotationId: i.quotationId, contacts, sentBy: i.sentBy });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ins = await client.query(`INSERT INTO crm_email_log (direction, customer_id, contact_id, opportunity_id, quotation_id, to_addr, cc_addr, subject, body, attachment, message_id, sent_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [log.direction, log.customerId, log.contactId, log.opportunityId, log.quotationId, log.toAddr, log.ccAddr, log.subject, log.body, log.attachment, i.messageId ?? null, log.sentBy]);
    for (const a of activities) {
      await client.query(`INSERT INTO crm_activities (customer_id, contact_id, opportunity_id, quotation_id, kind, subject, notes, done_at, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7, now(), $8)`, [a.customerId, a.contactId, a.opportunityId, a.quotationId, a.kind, a.subject, a.notes, a.createdBy]);
    }
    await client.query(`UPDATE quotations SET sent_at = now(), status = CASE WHEN status IN ('draft','pending') THEN 'sent' ELSE status END WHERE id = $1`, [i.quotationId]);
    if (opportunityId) {
      await client.query(`UPDATE crm_opportunities SET stage = 'quoted', probability = GREATEST(probability, 60), quotation_id = COALESCE(quotation_id, $2), updated_at = now()
        WHERE id = $1 AND stage IN ('new','contacted','quoting')`, [opportunityId, i.quotationId]);
    }
    await client.query("COMMIT");
    return { logId: Number(ins.rows[0].id), activities: activities.length };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export const mailRouter = createRouter({
  mailStatus: publicQuery.query(async () => {
    const c = await smtpConfig();
    return { configured: !!c || !!testTransport, from: c?.from || null, source: c?.source ?? null };
  }),

  mailTest: publicQuery
    .input(z.object({ to: z.string().email() }))
    .mutation(async ({ input }) => {
      const { t, from, company } = await mailTransport();
      try {
        await t.sendMail({ from, to: input.to, subject: `Тест порака — ${company}`, text: "Праќањето е-пошта од ERP работи." });
      } catch (e: any) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: `SMTP грешка: ${e?.message ?? e}` });
      }
      return { success: true };
    }),

  sendDocument: publicQuery
    .input(z.object({
      to: z.array(z.string().email()).min(1).max(10),
      cc: z.array(z.string().email()).max(10).optional(),
      subject: z.string().min(1).max(300),
      body: z.string().max(20000),
      filename: z.string().min(1).max(120),
      pdfBase64: z.string().min(100).max(15_000_000),
      docType: z.enum(["quotation", "invoice", "purchase_order", "quality", "ios", "compensation"]),
      docId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { t, from } = await mailTransport();
      const filename = input.filename.replace(/[^\w\-.а-шА-Ш ]+/g, "_");
      let info: any;
      try {
        info = await t.sendMail({
          from, to: input.to.join(", "), cc: input.cc?.length ? input.cc.join(", ") : undefined,
          subject: input.subject, text: input.body,
          attachments: [{ filename, content: Buffer.from(input.pdfBase64, "base64"), contentType: "application/pdf" }],
        });
      } catch (e: any) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: `Пораката не е пратена: ${e?.message ?? e}` });
      }
      await logAudit({ action: "EMAIL", entityType: input.docType, entityId: input.docId, description: `Пратено на ${input.to.join(", ")}: ${input.subject}` }).catch(() => {});
      let crm: { logId: number; activities: number } | null = null;
      if (input.docType === "quotation") {
        // пораката е веќе пратена — грешка во логирањето не смее да врати „не е пратено“
        crm = await logQuotationEmail({ quotationId: input.docId, to: input.to, cc: input.cc, subject: input.subject, body: input.body, attachment: filename,
          sentBy: (ctx as any)?.actor?.name ?? null, messageId: info?.messageId ?? null }).catch((e) => { console.error("[CRM] email log:", e?.message ?? e); return null; });
      }
      return { success: true, crm };
    }),

  // Пакет за сметководство: Excel + PDF (+ ZIP со документи) во една порака
  sendAccountantPack: publicQuery
    .input(z.object({
      to: z.array(z.string().email()).min(1).max(10),
      cc: z.array(z.string().email()).max(10).optional(),
      subject: z.string().min(1).max(300),
      body: z.string().max(20000),
      period: z.object({ from: z.string(), to: z.string() }),
      attachments: z.array(z.object({
        filename: z.string().min(1).max(160),
        base64: z.string().min(10),
        contentType: z.enum([
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/zip",
        ]),
      })).min(1).max(3),
    }))
    .mutation(async ({ input }) => {
      // повеќето сервери за е-пошта примаат до ~25 MB; base64 е ~4/3 од големината
      const bytes = input.attachments.reduce((a, x) => a + Math.floor(x.base64.length * 3 / 4), 0);
      if (bytes > 20 * 1024 * 1024) {
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: `Прилозите се ${(bytes / 1048576).toFixed(1)} MB — повеќе од 20 MB. Прати без ZIP со документите, а ZIP-от симни го и прати го одделно.` });
      }
      const { t, from } = await mailTransport();
      try {
        await t.sendMail({
          from, to: input.to.join(", "), cc: input.cc?.length ? input.cc.join(", ") : undefined,
          subject: input.subject, text: input.body,
          attachments: input.attachments.map(a => ({ filename: a.filename.replace(/[^\w\-.а-шА-Ш ]+/g, "_"), content: Buffer.from(a.base64, "base64"), contentType: a.contentType })),
        });
      } catch (e: any) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: `Пораката не е пратена: ${e?.message ?? e}` });
      }
      await logAudit({ action: "EMAIL", entityType: "accountant_pack", entityId: 0,
        description: `Пакет за сметководство ${input.period.from} – ${input.period.to} пратен на ${input.to.join(", ")} (${input.attachments.map(a => a.filename).join(", ")})` }).catch(() => {});
      return { success: true, bytes };
    }),
});
