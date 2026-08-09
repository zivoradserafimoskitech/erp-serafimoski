import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  bankStatements, bankTransactions, invoices, incomingInvoices,
  customers, suppliers,
} from "@db/schema";
import { detectAndParse, dedupeKey, type ParsedTx } from "./bank-parsers";
import { logAudit } from "./audit-helper";

/** Извлекува броеви на фактури од целта на дознаката */
export function extractInvoiceRefs(text: string): string[] {
  const t = String(text ?? "");
  const found = new Set<string>();

  // „по ф-ра 8-2026“, „уплата по фактура број 1-А-2099“, „по проф-ра 13-26“
  const patterns = [
    /(?:ф-?ра|фактура|проф-?ра|фактури)\s*(?:број|бр\.?)?\s*([0-9A-Za-zА-Яа-яЀ-ӿ\-\/]+(?:\s*,\s*[0-9A-Za-zА-Яа-яЀ-ӿ\-\/]+)*)/gi,
    /(?:f-?ra|faktura|prof-?ra)\s*(?:broj|br\.?)?\s*([0-9A-Za-z\-\/]+(?:\s*,\s*[0-9A-Za-z\-\/]+)*)/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      for (const piece of m[1].split(/\s*,\s*/)) {
        const v = piece.trim();
        if (v && v.length >= 2 && /\d/.test(v)) found.add(v);
      }
    }
  }
  return Array.from(found);
}

/** Нормализира број на документ за споредба: тргни се што не е буква/цифра */
const norm = (s: string) => String(s ?? "").toUpperCase().replace(/[^0-9A-ZА-ЯЀ-ӿ]/g, "");

export const bankRouter = createRouter({
  // ═══════════ УВОЗ ═══════════
  bankImport: publicQuery
    .input(
      z.object({
        files: z.array(z.object({ name: z.string(), text: z.string() })).min(1),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      let statementsAdded = 0, txAdded = 0, txSkipped = 0;
      const warnings: string[] = [];
      const formats = new Set<string>();

      // 1) Прво заглавијата, за да можат ставките да се закачат на нив
      type StRow = { id: number; date: string; account: string };
      const stIndex: StRow[] = [];

      const existingSt = await db.select().from(bankStatements);
      for (const s of existingSt as any[]) {
        stIndex.push({ id: s.id, date: String(s.statementDate), account: s.accountNumber });
      }

      const parsedAll = input.files.map((f) => ({ f, r: detectAndParse(f.name, f.text) }));
      for (const { r } of parsedAll) {
        formats.add(r.format);
        warnings.push(...r.warnings);
      }

      // Заглавија
      for (const { f, r } of parsedAll) {
        for (const st of r.statements) {
          if (!st.accountNumber || !st.statementDate) continue;
          const dup = stIndex.find(
            (x) => x.account === st.accountNumber && x.date === st.statementDate
          );
          if (dup) continue;
          const res = await db.insert(bankStatements).values({
            accountNumber: st.accountNumber,
            statementNo: st.statementNo,
            statementDate: st.statementDate,
            prevBalance: String(st.prevBalance),
            debitTotal: String(st.debitTotal),
            creditTotal: String(st.creditTotal),
            newBalance: String(st.newBalance),
            currency: st.currency,
            sourceFormat: r.format,
            fileName: f.name.slice(0, 255),
          } as any).returning();
          const id = res[0]?.id;
          if (id) {
            stIndex.push({ id, date: st.statementDate, account: st.accountNumber });
            statementsAdded++;
          }
        }
      }

      // 2) Ставките — од изводите и од „ставки“ датотеката
      const allTx: { accountNumber: string; tx: ParsedTx }[] = [];
      for (const { r } of parsedAll) {
        for (const st of r.statements) {
          for (const tx of st.transactions) allTx.push({ accountNumber: st.accountNumber, tx });
        }
        for (const tx of r.looseTransactions) {
          const acc = stIndex[0]?.account ?? "";
          allTx.push({ accountNumber: acc, tx });
        }
      }

      const existingKeys = new Set(
        ((await db.select({ k: bankTransactions.dedupeKey }).from(bankTransactions)) as any[])
          .map((x) => x.k)
          .filter(Boolean)
      );

      for (const { accountNumber, tx } of allTx) {
        const key = dedupeKey(accountNumber, tx);
        if (existingKeys.has(key)) { txSkipped++; continue; }
        existingKeys.add(key);

        const st = stIndex.find((x) => x.date === tx.txDate && (!accountNumber || x.account === accountNumber));

        await db.insert(bankTransactions).values({
          statementId: st?.id ?? null,
          accountNumber: accountNumber || st?.account || null,
          txDate: tx.txDate,
          direction: tx.direction,
          amount: String(tx.amount),
          provision: String(tx.provision),
          counterpartyName: tx.counterpartyName.slice(0, 255),
          counterpartyAccount: tx.counterpartyAccount.slice(0, 40),
          purpose: tx.purpose,
          code: tx.code.slice(0, 10),
          refPbo: tx.refPbo.slice(0, 60),
          refPbz: tx.refPbz.slice(0, 60),
          bankRef: tx.bankRef.slice(0, 60),
          dedupeKey: key,
          matchStatus: "unmatched",
        } as any);
        txAdded++;
      }

      await logAudit({
        action: "CREATE", entityType: "bank_import",
        description: `Увоз извод: ${statementsAdded} изводи, ${txAdded} ставки (${Array.from(formats).join(", ")})`,
      }).catch(() => {});

      return {
        success: true,
        statementsAdded, txAdded, txSkipped,
        formats: Array.from(formats),
        warnings: Array.from(new Set(warnings)),
      };
    }),

  // ═══════════ ПРЕГЛЕД ═══════════
  bankTxList: publicQuery
    .input(
      z.object({
        status: z.enum(["all", "unmatched", "matched", "ignored"]).optional(),
        direction: z.enum(["all", "in", "out"]).optional(),
        search: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db.select().from(bankTransactions).orderBy(desc(bankTransactions.txDate), desc(bankTransactions.id));
      let out = rows as any[];

      const st = input?.status ?? "unmatched";
      if (st !== "all") out = out.filter((r) => r.matchStatus === st);
      if (input?.direction && input.direction !== "all") out = out.filter((r) => r.direction === input.direction);
      if (input?.from) out = out.filter((r) => String(r.txDate) >= input.from!);
      if (input?.to) out = out.filter((r) => String(r.txDate) <= input.to!);
      if (input?.search) {
        const s = input.search.toLowerCase();
        out = out.filter((r) =>
          (r.counterpartyName ?? "").toLowerCase().includes(s) ||
          (r.purpose ?? "").toLowerCase().includes(s) ||
          (r.counterpartyAccount ?? "").includes(s) ||
          (r.matchedRef ?? "").toLowerCase().includes(s)
        );
      }
      return out;
    }),

  bankStats: publicQuery.query(async () => {
    const db = getDb();
    const rows = (await db.select().from(bankTransactions)) as any[];
    const sts = (await db.select().from(bankStatements)) as any[];
    const unmatched = rows.filter((r) => r.matchStatus === "unmatched");
    return {
      statements: sts.length,
      transactions: rows.length,
      unmatched: unmatched.length,
      matched: rows.filter((r) => r.matchStatus === "matched").length,
      unmatchedIn: unmatched.filter((r) => r.direction === "in").reduce((a, r) => a + Number(r.amount), 0),
      unmatchedOut: unmatched.filter((r) => r.direction === "out").reduce((a, r) => a + Number(r.amount), 0),
      lastBalance: sts.length
        ? Number(sts.slice().sort((a, b) => String(a.statementDate) < String(b.statementDate) ? 1 : -1)[0].newBalance)
        : 0,
      lastDate: sts.length
        ? sts.slice().sort((a, b) => String(a.statementDate) < String(b.statementDate) ? 1 : -1)[0].statementDate
        : null,
    };
  }),

  bankStatementList: publicQuery.query(async () => {
    const db = getDb();
    return await db.select().from(bankStatements).orderBy(desc(bankStatements.statementDate));
  }),

  // ═══════════ ПРЕДЛОГ ЗА ПОВРЗУВАЊЕ ═══════════
  bankSuggest: publicQuery
    .input(z.object({ txId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const t: any = (await db.select().from(bankTransactions).where(eq(bankTransactions.id, input.txId)))[0];
      if (!t) return { candidates: [] };

      const refs = extractInvoiceRefs(t.purpose ?? "").map(norm);
      const amount = Number(t.amount);
      const isIn = t.direction === "in";

      const cands: any[] = [];

      if (isIn) {
        const invs = (await db.select().from(invoices)) as any[];
        const custs = (await db.select().from(customers)) as any[];
        const cmap = new Map(custs.map((c) => [c.id, c]));
        for (const inv of invs) {
          if (inv.status === "paid") continue;
          const total = Number(inv.totalAmount);
          let score = 0;
          const reasons: string[] = [];
          if (refs.some((r) => norm(inv.invoiceNumber).includes(r) || r.includes(norm(inv.invoiceNumber)))) {
            score += 60; reasons.push("бројот на фактурата е во целта на дознаката");
          }
          if (Math.abs(total - amount) < 0.01) { score += 30; reasons.push("износот се совпаѓа точно"); }
          else if (Math.abs(total - amount) / Math.max(total, 1) < 0.02) { score += 10; reasons.push("износот е близок"); }
          const c = cmap.get(inv.customerId);
          if (c && t.counterpartyName && norm(c.name).slice(0, 10) && norm(t.counterpartyName).includes(norm(c.name).slice(0, 10))) {
            score += 25; reasons.push("името на клиентот се совпаѓа");
          }
          if (score >= 30) {
            cands.push({
              type: "invoice", id: inv.id, ref: inv.invoiceNumber,
              partnerName: c?.name ?? "", amount: total, date: inv.issueDate,
              status: inv.status, score, reasons,
            });
          }
        }
      } else {
        const invs = (await db.select().from(incomingInvoices)) as any[];
        const sups = (await db.select().from(suppliers)) as any[];
        const smap = new Map(sups.map((s) => [s.id, s]));
        for (const inv of invs) {
          if (inv.status === "paid") continue;
          const total = Number(inv.totalAmount);
          let score = 0;
          const reasons: string[] = [];
          if (refs.some((r) => norm(inv.supplierInvoiceNumber).includes(r) || r.includes(norm(inv.supplierInvoiceNumber)))) {
            score += 60; reasons.push("бројот на фактурата е во целта на дознаката");
          }
          if (Math.abs(total - amount) < 0.01) { score += 30; reasons.push("износот се совпаѓа точно"); }
          else if (Math.abs(total - amount) / Math.max(total, 1) < 0.02) { score += 10; reasons.push("износот е близок"); }
          const s = smap.get(inv.supplierId);
          if (s && t.counterpartyName && norm(s.name).slice(0, 10) && norm(t.counterpartyName).includes(norm(s.name).slice(0, 10))) {
            score += 25; reasons.push("името на добавувачот се совпаѓа");
          }
          if (score >= 30) {
            cands.push({
              type: "incoming_invoice", id: inv.id, ref: inv.supplierInvoiceNumber,
              partnerName: s?.name ?? "", amount: total, date: inv.issueDate ?? inv.receivedDate,
              status: inv.status, score, reasons,
            });
          }
        }
      }

      cands.sort((a, b) => b.score - a.score);
      return { candidates: cands.slice(0, 8), refs: extractInvoiceRefs(t.purpose ?? "") };
    }),

  // ═══════════ ПОВРЗУВАЊЕ ═══════════
  bankMatch: publicQuery
    .input(z.object({
      txId: z.number(),
      type: z.enum(["invoice", "incoming_invoice"]),
      targetId: z.number(),
      markPaid: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      let ref = "";
      if (input.type === "invoice") {
        const inv: any = (await db.select().from(invoices).where(eq(invoices.id, input.targetId)))[0];
        ref = inv?.invoiceNumber ?? "";
        if (input.markPaid && inv) {
          await db.update(invoices).set({ status: "paid", updatedAt: new Date() } as any).where(eq(invoices.id, input.targetId));
        }
      } else {
        const inv: any = (await db.select().from(incomingInvoices).where(eq(incomingInvoices.id, input.targetId)))[0];
        ref = inv?.supplierInvoiceNumber ?? "";
        if (input.markPaid && inv) {
          await db.update(incomingInvoices).set({ status: "paid", updatedAt: new Date() } as any).where(eq(incomingInvoices.id, input.targetId));
        }
      }
      await db.update(bankTransactions).set({
        matchStatus: "matched", matchedType: input.type,
        matchedId: input.targetId, matchedRef: ref, updatedAt: new Date(),
      } as any).where(eq(bankTransactions.id, input.txId));
      return { success: true, ref };
    }),

  bankUnmatch: publicQuery
    .input(z.object({ txId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(bankTransactions).set({
        matchStatus: "unmatched", matchedType: null, matchedId: null,
        matchedRef: null, updatedAt: new Date(),
      } as any).where(eq(bankTransactions.id, input.txId));
      return { success: true };
    }),

  bankIgnore: publicQuery
    .input(z.object({ txId: z.number(), note: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(bankTransactions).set({
        matchStatus: "ignored", note: input.note ?? null, updatedAt: new Date(),
      } as any).where(eq(bankTransactions.id, input.txId));
      return { success: true };
    }),

  /** Автоматско поврзување на сите каде предлогот е убедлив */
  bankAutoMatch: publicQuery
    .input(z.object({ minScore: z.number().default(85) }).optional())
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const minScore = input?.minScore ?? 85;
      const rows = (await db.select().from(bankTransactions).where(eq(bankTransactions.matchStatus, "unmatched"))) as any[];
      const caller = bankRouter.createCaller(ctx as any);
      let matched = 0;
      for (const t of rows) {
        const s = await caller.bankSuggest({ txId: t.id });
        const best = s.candidates?.[0];
        if (best && best.score >= minScore) {
          await caller.bankMatch({ txId: t.id, type: best.type, targetId: best.id, markPaid: true });
          matched++;
        }
      }
      return { success: true, matched, checked: rows.length };
    }),
});
