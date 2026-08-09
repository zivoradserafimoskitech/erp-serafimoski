import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  bankStatements, bankTransactions, invoices, incomingInvoices,
  customers, suppliers, paymentAllocations,
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


const r2 = (v: number) => Math.round(v * 100) / 100;

/** Колку е платено по еден документ */
async function paidOf(docType: string, docId: number): Promise<number> {
  const db = getDb();
  const rows = (await db.select().from(paymentAllocations)) as any[];
  return r2(rows
    .filter((a) => a.docType === docType && a.docId === docId)
    .reduce((s, a) => s + Number(a.amount), 0));
}

/** Статусот на фактурата се изведува од распределеното, не се поставува рачно */
async function refreshDocStatus(docType: string, docId: number) {
  const db = getDb();
  const paid = await paidOf(docType, docId);
  if (docType === "invoice") {
    const inv: any = (await db.select().from(invoices).where(eq(invoices.id, docId)))[0];
    if (!inv) return;
    const total = Number(inv.totalAmount);
    const status = paid <= 0.005 ? "pending" : paid >= total - 0.005 ? "paid" : "partial";
    await db.update(invoices).set({ status, updatedAt: new Date() } as any).where(eq(invoices.id, docId));
  } else {
    const inv: any = (await db.select().from(incomingInvoices).where(eq(incomingInvoices.id, docId)))[0];
    if (!inv) return;
    const total = Number(inv.totalAmount);
    const status = paid <= 0.005 ? "pending" : paid >= total - 0.005 ? "paid" : "partial";
    await db.update(incomingInvoices).set({ status, updatedAt: new Date() } as any).where(eq(incomingInvoices.id, docId));
  }
}

/** Статусот на банкарската ставка се изведува од распределеното */
async function refreshTxStatus(txId: number) {
  const db = getDb();
  const t: any = (await db.select().from(bankTransactions).where(eq(bankTransactions.id, txId)))[0];
  if (!t) return;
  if (t.matchStatus === "ignored") return;
  const rows = (await db.select().from(paymentAllocations).where(eq(paymentAllocations.txId, txId))) as any[];
  const allocated = r2(rows.reduce((s, a) => s + Number(a.amount), 0));
  const amount = Number(t.amount);
  const status = allocated <= 0.005 ? "unmatched" : allocated >= amount - 0.005 ? "matched" : "partial";
  const ref = rows.map((a) => a.docRef).filter(Boolean).join(", ").slice(0, 120);
  await db.update(bankTransactions).set({
    matchStatus: status,
    matchedRef: ref || null,
    matchedType: rows[0]?.docType ?? null,
    matchedId: rows.length === 1 ? rows[0].docId : null,
    updatedAt: new Date(),
  } as any).where(eq(bankTransactions.id, txId));
}

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
        status: z.enum(["all", "unmatched", "partial", "matched", "ignored", "open"]).optional(),
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

      const st = input?.status ?? "open";
      if (st === "open") out = out.filter((r) => r.matchStatus === "unmatched" || r.matchStatus === "partial");
      else if (st !== "all") out = out.filter((r) => r.matchStatus === st);
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
    const unmatched = rows.filter((r) => r.matchStatus === "unmatched" || r.matchStatus === "partial");
    return {
      statements: sts.length,
      transactions: rows.length,
      unmatched: unmatched.length,
      partial: rows.filter((r) => r.matchStatus === "partial").length,
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

  // ═══════════ РАСПРЕДЕЛБА НА УПЛАТА ═══════════
  /** Отворени ставки (фактури со остаток) за партнерот на дадена трансакција */
  bankOpenDocs: publicQuery
    .input(z.object({ txId: z.number(), search: z.string().optional() }))
    .query(async ({ input }) => {
      const db = getDb();
      const t: any = (await db.select().from(bankTransactions).where(eq(bankTransactions.id, input.txId)))[0];
      if (!t) return { docs: [], allocated: 0, remaining: 0, refs: [] };

      const isIn = t.direction === "in";
      const allocs = (await db.select().from(paymentAllocations)) as any[];
      const paidMap = new Map<string, number>();
      for (const a of allocs) {
        const k = `${a.docType}|${a.docId}`;
        paidMap.set(k, (paidMap.get(k) ?? 0) + Number(a.amount));
      }

      const refs = extractInvoiceRefs(t.purpose ?? "").map(norm);
      const docs: any[] = [];

      if (isIn) {
        const invs = (await db.select().from(invoices)) as any[];
        const custs = (await db.select().from(customers)) as any[];
        const cmap = new Map(custs.map((c) => [c.id, c]));
        for (const inv of invs) {
          const total = Number(inv.totalAmount);
          const paid = paidMap.get(`invoice|${inv.id}`) ?? 0;
          const open = r2(total - paid);
          if (open <= 0.005) continue;
          const c = cmap.get(inv.customerId);
          const inPurpose = refs.some((rf) => norm(inv.invoiceNumber).includes(rf) || rf.includes(norm(inv.invoiceNumber)));
          const nameHit = !!(c && t.counterpartyName && norm(c.name).slice(0, 10) &&
            norm(t.counterpartyName).includes(norm(c.name).slice(0, 10)));
          docs.push({
            docType: "invoice", docId: inv.id, ref: inv.invoiceNumber,
            partnerName: c?.name ?? "", total, paid: r2(paid), open,
            date: inv.issueDate, dueDate: inv.dueDate,
            inPurpose, nameHit,
            score: (inPurpose ? 60 : 0) + (nameHit ? 30 : 0) + (Math.abs(open - Number(t.amount)) < 0.01 ? 20 : 0),
          });
        }
      } else {
        const invs = (await db.select().from(incomingInvoices)) as any[];
        const sups = (await db.select().from(suppliers)) as any[];
        const smap = new Map(sups.map((x) => [x.id, x]));
        for (const inv of invs) {
          const total = Number(inv.totalAmount);
          const paid = paidMap.get(`incoming_invoice|${inv.id}`) ?? 0;
          const open = r2(total - paid);
          if (open <= 0.005) continue;
          const sup = smap.get(inv.supplierId);
          const inPurpose = refs.some((rf) => norm(inv.supplierInvoiceNumber).includes(rf) || rf.includes(norm(inv.supplierInvoiceNumber)));
          const nameHit = !!(sup && t.counterpartyName && norm(sup.name).slice(0, 10) &&
            norm(t.counterpartyName).includes(norm(sup.name).slice(0, 10)));
          docs.push({
            docType: "incoming_invoice", docId: inv.id, ref: inv.supplierInvoiceNumber,
            partnerName: sup?.name ?? "", total, paid: r2(paid), open,
            date: inv.issueDate ?? inv.receivedDate, dueDate: inv.dueDate,
            inPurpose, nameHit,
            score: (inPurpose ? 60 : 0) + (nameHit ? 30 : 0) + (Math.abs(open - Number(t.amount)) < 0.01 ? 20 : 0),
          });
        }
      }

      if (input?.search) {
        const q = input.search.toLowerCase();
        for (let i = docs.length - 1; i >= 0; i--) {
          const d = docs[i];
          if (!(`${d.ref} ${d.partnerName}`.toLowerCase().includes(q))) docs.splice(i, 1);
        }
      }

      // Најрелевантни горе, потоа најстари фактури (природен редослед на плаќање)
      docs.sort((a, b) => b.score - a.score || String(a.date ?? "").localeCompare(String(b.date ?? "")));

      const mine = allocs.filter((a) => a.txId === input.txId);
      const allocated = r2(mine.reduce((x, a) => x + Number(a.amount), 0));
      return {
        docs: docs.slice(0, 60),
        allocated,
        remaining: r2(Number(t.amount) - allocated),
        refs: extractInvoiceRefs(t.purpose ?? ""),
      };
    }),

  bankAllocationsOf: publicQuery
    .input(z.object({ txId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return await db.select().from(paymentAllocations).where(eq(paymentAllocations.txId, input.txId));
    }),

  /** Ја запишува целата распределба за една ставка (ги заменува постојните) */
  bankAllocate: publicQuery
    .input(z.object({
      txId: z.number(),
      lines: z.array(z.object({
        docType: z.enum(["invoice", "incoming_invoice"]),
        docId: z.number(),
        docRef: z.string().optional(),
        amount: z.number(),
      })),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const t: any = (await db.select().from(bankTransactions).where(eq(bankTransactions.id, input.txId)))[0];
      if (!t) throw new Error("Ставката не постои");

      const sum = r2(input.lines.reduce((s, l) => s + l.amount, 0));
      if (sum > Number(t.amount) + 0.005) {
        throw new Error(`Распределено ${sum.toFixed(2)} над износот на уплатата ${Number(t.amount).toFixed(2)}`);
      }

      // Кои документи беа засегнати претходно — и нив треба да им се освежи статусот
      const before = (await db.select().from(paymentAllocations).where(eq(paymentAllocations.txId, input.txId))) as any[];
      await db.delete(paymentAllocations).where(eq(paymentAllocations.txId, input.txId));

      for (const l of input.lines) {
        if (!(l.amount > 0)) continue;
        await db.insert(paymentAllocations).values({
          txId: input.txId, docType: l.docType, docId: l.docId,
          docRef: l.docRef ?? null, amount: String(r2(l.amount)),
        } as any);
      }

      const touched = new Set<string>();
      for (const b of before) touched.add(`${b.docType}|${b.docId}`);
      for (const l of input.lines) touched.add(`${l.docType}|${l.docId}`);
      for (const key of touched) {
        const [dt, di] = key.split("|");
        await refreshDocStatus(dt, Number(di));
      }
      await refreshTxStatus(input.txId);

      await logAudit({
        action: "UPDATE", entityType: "bank_transaction", entityId: input.txId,
        description: `Распределена уплата: ${input.lines.length} документи, ${sum.toFixed(2)} ден`,
      }).catch(() => {});

      return { success: true, allocated: sum, remaining: r2(Number(t.amount) - sum) };
    }),

  bankUnmatch: publicQuery
    .input(z.object({ txId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const before = (await db.select().from(paymentAllocations).where(eq(paymentAllocations.txId, input.txId))) as any[];
      await db.delete(paymentAllocations).where(eq(paymentAllocations.txId, input.txId));
      for (const b of before) await refreshDocStatus(b.docType, b.docId);
      await refreshTxStatus(input.txId);
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

  /** Отворени ставки по партнер — „колку му должиме на МЕТАЛ-НЕТ" */
  openItemsByPartner: publicQuery
    .input(z.object({ side: z.enum(["customers", "suppliers"]).default("suppliers") }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const side = input?.side ?? "suppliers";
      const allocs = (await db.select().from(paymentAllocations)) as any[];
      const paidMap = new Map<string, number>();
      for (const a of allocs) {
        const k = `${a.docType}|${a.docId}`;
        paidMap.set(k, (paidMap.get(k) ?? 0) + Number(a.amount));
      }

      const groups = new Map<string, any>();
      if (side === "suppliers") {
        const invs = (await db.select().from(incomingInvoices)) as any[];
        const sups = (await db.select().from(suppliers)) as any[];
        const smap = new Map(sups.map((x) => [x.id, x.name]));
        for (const inv of invs) {
          const open = r2(Number(inv.totalAmount) - (paidMap.get(`incoming_invoice|${inv.id}`) ?? 0));
          if (open <= 0.005) continue;
          const name = smap.get(inv.supplierId) ?? "—";
          const g = groups.get(name) ?? { partner: name, count: 0, open: 0, oldest: null as string | null, docs: [] as any[] };
          g.count++; g.open = r2(g.open + open);
          const d = String(inv.issueDate ?? inv.receivedDate ?? "");
          if (!g.oldest || d < g.oldest) g.oldest = d;
          g.docs.push({ ref: inv.supplierInvoiceNumber, total: Number(inv.totalAmount), open, date: d, dueDate: inv.dueDate });
          groups.set(name, g);
        }
      } else {
        const invs = (await db.select().from(invoices)) as any[];
        const custs = (await db.select().from(customers)) as any[];
        const cmap = new Map(custs.map((x) => [x.id, x.name]));
        for (const inv of invs) {
          const open = r2(Number(inv.totalAmount) - (paidMap.get(`invoice|${inv.id}`) ?? 0));
          if (open <= 0.005) continue;
          const name = cmap.get(inv.customerId) ?? "—";
          const g = groups.get(name) ?? { partner: name, count: 0, open: 0, oldest: null as string | null, docs: [] as any[] };
          g.count++; g.open = r2(g.open + open);
          const d = String(inv.issueDate ?? "");
          if (!g.oldest || d < g.oldest) g.oldest = d;
          g.docs.push({ ref: inv.invoiceNumber, total: Number(inv.totalAmount), open, date: d, dueDate: inv.dueDate });
          groups.set(name, g);
        }
      }

      const list = Array.from(groups.values()).sort((a, b) => b.open - a.open);
      for (const g of list) g.docs.sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
      return { side, groups: list, total: r2(list.reduce((s, g) => s + g.open, 0)) };
    }),

  /**
   * Автоматска распределба таму каде нема двоумење:
   *  - целта на дознаката именува фактури и нивниот отворен збир е точно колку уплатата
   *  - или една единствена фактура со точно тој отворен износ
   */
  bankAutoMatch: publicQuery
    .input(z.object({ minScore: z.number().default(85) }).optional())
    .mutation(async ({ ctx }) => {
      const db = getDb();
      const rows = (await db.select().from(bankTransactions)) as any[];
      const open = rows.filter((t) => t.matchStatus === "unmatched");
      const caller = bankRouter.createCaller(ctx as any);

      let matched = 0, partial = 0;
      for (const t of open) {
        const { docs } = await caller.bankOpenDocs({ txId: t.id });
        const amount = Number(t.amount);
        if (!docs || docs.length === 0) continue;

        // 1) Фактурите именувани во дознаката
        const named = docs.filter((d: any) => d.inPurpose);
        if (named.length > 0) {
          const sum = r2(named.reduce((x: number, d: any) => x + d.open, 0));
          if (Math.abs(sum - amount) < 0.01) {
            await caller.bankAllocate({
              txId: t.id,
              lines: named.map((d: any) => ({ docType: d.docType, docId: d.docId, docRef: d.ref, amount: d.open })),
            });
            matched++;
            continue;
          }
          // Делумна уплата на една именувана фактура
          if (named.length === 1 && amount < named[0].open) {
            await caller.bankAllocate({
              txId: t.id,
              lines: [{ docType: named[0].docType, docId: named[0].docId, docRef: named[0].ref, amount }],
            });
            partial++;
            continue;
          }
        }

        // 2) Единствена фактура со точно тој отворен износ
        const exact = docs.filter((d: any) => Math.abs(d.open - amount) < 0.01 && d.nameHit);
        if (exact.length === 1) {
          await caller.bankAllocate({
            txId: t.id,
            lines: [{ docType: exact[0].docType, docId: exact[0].docId, docRef: exact[0].ref, amount }],
          });
          matched++;
        }
      }
      return { success: true, matched, partial, checked: open.length };
    }),
});
