// Праќање документи (понуда, фактура, про-фактура) по е-пошта преку SMTP на фирмата.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import nodemailer from "nodemailer";
import { createRouter, publicQuery } from "./middleware";
import { getPool } from "./queries/connection";
import { logAudit } from "./audit-helper";

export async function mailTransport() {
  const s = (await getPool().query(`SELECT * FROM company_settings LIMIT 1`)).rows[0];
  if (!s?.smtp_host || !s?.smtp_user || !s?.smtp_password) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Не е поставена е-пошта за праќање. Внеси SMTP во Подесувања → Фирма." });
  }
  const port = Number(s.smtp_port) || 587;
  const t = nodemailer.createTransport({
    host: s.smtp_host, port, secure: Number(s.smtp_secure) === 1 || port === 465,
    auth: { user: s.smtp_user, pass: s.smtp_password },
  });
  return { t, from: s.smtp_from || s.smtp_user, company: s.name as string };
}

export const mailRouter = createRouter({
  mailStatus: publicQuery.query(async () => {
    const s = (await getPool().query(`SELECT smtp_host, smtp_user, smtp_password, smtp_from FROM company_settings LIMIT 1`)).rows[0];
    return { configured: !!(s?.smtp_host && s?.smtp_user && s?.smtp_password), from: s?.smtp_from || s?.smtp_user || null };
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
      docType: z.enum(["quotation", "invoice", "purchase_order", "quality"]),
      docId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const { t, from } = await mailTransport();
      try {
        await t.sendMail({
          from, to: input.to.join(", "), cc: input.cc?.length ? input.cc.join(", ") : undefined,
          subject: input.subject, text: input.body,
          attachments: [{ filename: input.filename.replace(/[^\w\-.а-шА-Ш ]+/g, "_"), content: Buffer.from(input.pdfBase64, "base64"), contentType: "application/pdf" }],
        });
      } catch (e: any) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: `Пораката не е пратена: ${e?.message ?? e}` });
      }
      await logAudit({ action: "EMAIL", entityType: input.docType, entityId: input.docId, description: `Пратено на ${input.to.join(", ")}: ${input.subject}` }).catch(() => {});
      return { success: true };
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
