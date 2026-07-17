// ===== Email Invoice Router =====
// Ендпоинти за примање на влезни фактури по е-маил

import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { emailInvoices } from "@db/schema";
import {
  getEmailConfig,
  fetchInvoicesFromEmail,
  storeEmailInvoice,
  matchSupplier,
  updateEmailInvoiceStatus,
} from "./email-service";

export const emailRouter = createRouter({
  // Провери дали има конфигурација
  saveConfig: publicQuery
    .input(z.object({
      host: z.string().min(1),
      port: z.number().default(993),
      secure: z.boolean().default(true),
      username: z.string().min(1),
      password: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { companySettings } = await import("@db/schema");
      const existing = await db.select().from(companySettings);
      const vals = {
        emailImapHost: input.host, emailImapPort: input.port,
        emailImapSecure: input.secure ? 1 : 0,
        emailUsername: input.username, emailPassword: input.password,
      };
      if (existing[0]) {
        const { eq } = await import("drizzle-orm");
        await db.update(companySettings).set(vals).where(eq(companySettings.id, existing[0].id));
      } else {
        await db.insert(companySettings).values({ name: "Serafimoski Tech DOOEL", ...vals });
      }
      return { success: true };
    }),

  hasConfig: publicQuery.query(async () => {
    const config = await getEmailConfig();
    return {
      configured: !!config,
      username: config?.username ?? null,
    };
  }),

  // Донеси фактури од е-маил
  fetchEmails: publicQuery
    .input(z.object({
      sinceDays: z.number().min(1).max(30).default(7),
    }).optional())
    .mutation(async ({ input }) => {
      const config = await getEmailConfig();
      if (!config) {
        return {
          success: false,
          message: "Нема конфигурирано е-маил. Одете во Подесувања -> Фирма и внесете IMAP податоци.",
          invoices: [],
        };
      }

      try {
        const fetched = await fetchInvoicesFromEmail(config, input?.sinceDays ?? 7);

        if (fetched.length === 0) {
          return {
            success: true,
            message: "Нема нови фактури во е-маилот.",
            invoices: [],
          };
        }

        // Зачувај ги во базата
        const storedIds: number[] = [];
        for (const inv of fetched) {
          const db = getDb();
          // Провери дали веќе постои (според pdf_filename + sender + subject)
          const existing = await db
            .select({ id: emailInvoices.id })
            .from(emailInvoices)
            .where(
              inv.pdfFilename
                ? eq(emailInvoices.pdfFilename, inv.pdfFilename)
                : eq(emailInvoices.subject, inv.subject)
            )
            .limit(1);

          if (existing[0]) continue;

          const id = await storeEmailInvoice(inv);
          storedIds.push(id);
        }

        return {
          success: true,
          message: `Пронајдени ${fetched.length} фактури, зачувани ${storedIds.length} нови.`,
          invoices: fetched.map((f, i) => ({
            subject: f.subject,
            sender: f.senderName || f.senderEmail,
            filename: f.pdfFilename,
          })),
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Грешка: ${err.message}`,
          invoices: [],
        };
      }
    }),

  // Листа на примени email фактури
  list: publicQuery
    .input(z.object({
      status: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      let query = db.select().from(emailInvoices).orderBy(desc(emailInvoices.createdAt));
      const result = await query;

      if (input?.status) {
        return result.filter(r => r.status === input.status);
      }
      return result;
    }),

  // Match со добавувач
  matchSupplier: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(emailInvoices)
        .where(eq(emailInvoices.id, input.id));

      if (!rows[0]) return { success: false, message: "Не е пронајдено" };

      const matched = await matchSupplier(
        rows[0].senderEmail || "",
        rows[0].senderName || ""
      );

      if (matched) {
        await updateEmailInvoiceStatus(input.id, "parsed", {
          matchedSupplierId: matched.id,
          parsedSupplierName: matched.name,
        });
        return { success: true, supplierName: matched.name, supplierId: matched.id };
      }

      return { success: false, message: "Не е пронајден добавувач" };
    }),

  // Одобри -> креирај влезна фактура
  approve: publicQuery
    .input(z.object({
      id: z.number(),
      supplierId: z.number(),
      supplierInvoiceNumber: z.string(),
      totalAmount: z.string(),
      issueDate: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await updateEmailInvoiceStatus(input.id, "imported");
      return { success: true };
    }),

  // Одбиј
  reject: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await updateEmailInvoiceStatus(input.id, "rejected");
      return { success: true };
    }),

  // Избриши
  delete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(emailInvoices).where(eq(emailInvoices.id, input.id));
      return { success: true };
    }),
});
