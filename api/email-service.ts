// ===== Е-маил сервис за примање на влезни фактури =====
// IMAP поврзување, влечење на PDF фактури, парсирање

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Imap = require("imap");
const { simpleParser } = require("mailparser");
import { getDb } from "./queries/connection";
import { companySettings, emailInvoices, suppliers } from "@db/schema";
import { desc, eq, like, or } from "drizzle-orm";

export interface EmailConfig {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  username: string;
  password: string;
}

export interface FetchedInvoice {
  subject: string;
  senderEmail: string;
  senderName: string;
  receivedAt: Date;
  pdfBase64: string;
  pdfFilename: string;
  rawText: string;
}

/**
 * Ги враќа email подесувањата од базата
 */
export async function getEmailConfig(): Promise<EmailConfig | null> {
  const db = getDb();
  const rows = await db.select().from(companySettings);
  if (!rows[0]) return null;
  const s = rows[0];
  if (!s.emailImapHost || !s.emailUsername || !s.emailPassword) return null;
  return {
    imapHost: s.emailImapHost,
    imapPort: s.emailImapPort ?? 993,
    imapSecure: (s.emailImapSecure ?? 1) !== 0,
    username: s.emailUsername,
    password: s.emailPassword,
  };
}

/**
 * Поврзување на IMAP и влечење на непрочитани пораки со PDF
 */
export async function fetchInvoicesFromEmail(
  config: EmailConfig,
  sinceDays: number = 7
): Promise<FetchedInvoice[]> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      host: config.imapHost,
      port: config.imapPort,
      tls: config.imapSecure,
      user: config.username,
      password: config.password,
      connTimeout: 30000,
      authTimeout: 30000,
    });

    const invoices: FetchedInvoice[] = [];

    imap.once("ready", () => {
      imap.openBox("INBOX", false, (err: any, box: any) => {
        if (err) {
          imap.end();
          reject(new Error(`Грешка при отворање на inbox: ${err.message}`));
          return;
        }

        // Барај непрочитани пораки од последните N дена со PDF
        const since = new Date();
        since.setDate(since.getDate() - sinceDays);
        const searchCriteria = [["UNSEEN"], ["SINCE", since.toISOString().split("T")[0]]];

        imap.search(searchCriteria, (err: any, results: number[]) => {
          if (err) {
            imap.end();
            reject(new Error(`Грешка при пребарување: ${err.message}`));
            return;
          }

          if (!results || results.length === 0) {
            imap.end();
            resolve([]);
            return;
          }

          const fetch = imap.fetch(results, { bodies: "", markSeen: false });

          fetch.on("message", (msg: any, seqno: number) => {
            let bodyBuffer = Buffer.alloc(0);

            msg.on("body", (stream: any) => {
              stream.on("data", (chunk: Buffer) => {
                bodyBuffer = Buffer.concat([bodyBuffer, chunk]);
              });
            });

            msg.once("end", async () => {
              try {
                const parsed = await simpleParser(bodyBuffer);
                const attachments = parsed.attachments || [];

                for (const att of attachments) {
                  const filename = att.filename || "";
                  if (filename.toLowerCase().endsWith(".pdf")) {
                    const pdfBase64 = att.content.toString("base64");
                    invoices.push({
                      subject: parsed.subject || "",
                      senderEmail: parsed.from?.value?.[0]?.address || "",
                      senderName: parsed.from?.value?.[0]?.name || "",
                      receivedAt: parsed.date || new Date(),
                      pdfBase64,
                      pdfFilename: filename,
                      rawText: parsed.text || "",
                    });
                  }
                }
              } catch (e: any) {
                console.warn(`Грешка при парсирање на порака ${seqno}:`, e.message);
              }
            });
          });

          fetch.once("error", (err: any) => {
            imap.end();
            reject(new Error(`Грешка при fetch: ${err.message}`));
          });

          fetch.once("end", () => {
            imap.end();
            resolve(invoices);
          });
        });
      });
    });

    imap.once("error", (err: any) => {
      reject(new Error(`IMAP грешка: ${err.message}`));
    });

    imap.connect();
  });
}

/**
 * Ги влечи веќе зачувани email фактури од базата
 */
export async function getStoredEmailInvoices() {
  const db = getDb();
  return db.select().from(emailInvoices).orderBy(desc(emailInvoices.createdAt));
}

/**
 * Зачувува нова email фактура во базата
 */
export async function storeEmailInvoice(invoice: FetchedInvoice) {
  const db = getDb();
  const result = await db.insert(emailInvoices).values({
    subject: invoice.subject,
    senderEmail: invoice.senderEmail,
    senderName: invoice.senderName,
    receivedAt: invoice.receivedAt,
    pdfBase64: invoice.pdfBase64,
    pdfFilename: invoice.pdfFilename,
    rawText: invoice.rawText,
    status: "new",
  } as any);
  return Number(result[0].insertId);
}

/**
 * Ажурира статус на email фактура
 */
export async function updateEmailInvoiceStatus(
  id: number,
  status: string,
  data?: { parsedSupplierName?: string; parsedInvoiceNumber?: string; parsedTotalAmount?: string; matchedSupplierId?: number }
) {
  const db = getDb();
  const update: any = { status };
  if (data?.parsedSupplierName) update.parsedSupplierName = data.parsedSupplierName;
  if (data?.parsedInvoiceNumber) update.parsedInvoiceNumber = data.parsedInvoiceNumber;
  if (data?.parsedTotalAmount) update.parsedTotalAmount = data.parsedTotalAmount;
  if (data?.matchedSupplierId) update.matchedSupplierId = data.matchedSupplierId;
  await db.update(emailInvoices).set(update).where(eq(emailInvoices.id, id));
}


/**
 * Проба да го најде добавувачот по име или е-маил
 */
export async function matchSupplier(
  senderEmail: string,
  senderName: string
): Promise<{ id: number; name: string } | null> {
  const db = getDb();

  // Пробај по име
  if (senderName) {
    const byName = await db
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(like(suppliers.name, `%${senderName}%`))
      .limit(1);
    if (byName[0]) return byName[0];
  }

  // Пробај по е-маил
  if (senderEmail) {
    const byEmail = await db
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(or(
        like(suppliers.email, `%${senderEmail}%`),
        like(suppliers.contactPerson, `%${senderEmail}%`)
      ))
      .limit(1);
    if (byEmail[0]) return byEmail[0];
  }

  return null;
}
