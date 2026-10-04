// Непрекината нумерација на излезни фактури и книжни одобренија (законска обврска):
// следниот број е секогаш најголемиот постоечки + 1, без бројач што може да „прескокне“.
import { TRPCError } from "@trpc/server";
import { getPool } from "./queries/connection";

export type SeqKind = "invoice" | "creditNote";
const RX: Record<SeqKind, { type: string; sql: (y: number) => string; parse: RegExp; fmt: (n: number, y: number) => string; label: string }> = {
  invoice: { type: "standard", sql: (y) => `^[0-9]+/${y}$`, parse: /^0*(\d+)\/(\d{4})$/, fmt: (n, y) => `${String(n).padStart(3, "0")}/${y}`, label: "фактура" },
  creditNote: { type: "credit_note", sql: (y) => `^КН-[0-9]+/${y}$`, parse: /^КН-0*(\d+)\/(\d{4})$/, fmt: (n, y) => `КН-${String(n).padStart(3, "0")}/${y}`, label: "книжно одобрување" },
};

export async function nextSequential(kind: SeqKind, year: number): Promise<string> {
  const r = RX[kind];
  const rows = (await getPool().query(`SELECT invoice_number FROM invoices WHERE invoice_type = $1 AND invoice_number ~ $2`, [r.type, r.sql(year)])).rows;
  const max = rows.reduce((m: number, x: any) => Math.max(m, Number(String(x.invoice_number).match(r.parse)?.[1] ?? 0)), 0);
  return r.fmt(max + 1, year);
}

/** Бројот мора да е точно следниот по ред за годината на датумот на издавање. */
export async function assertSequential(kind: SeqKind, number: string, issueDate: string) {
  const r = RX[kind];
  const year = Number(String(issueDate).slice(0, 4));
  const expected = await nextSequential(kind, year);
  const m = number.trim().match(r.parse);
  const ok = m && Number(m[2]) === year && r.fmt(Number(m[1]), year) === expected;
  if (!ok) throw new TRPCError({ code: "BAD_REQUEST", message: `Следниот број за ${r.label} во ${year} е ${expected} — броевите мора да одат по ред, без празнини` });
  return expected;
}

/** Дали бројот е последен во низата (само тогаш нацрт смее да се избрише без да остави празнина). */
export async function isLastInSequence(kind: SeqKind, number: string): Promise<boolean> {
  const r = RX[kind];
  const m = number.match(r.parse);
  if (!m) return true; // број надвор од низата (стар формат) — не влијае на низата
  const next = await nextSequential(kind, Number(m[2]));
  return r.fmt(Number(m[1]) + 1, Number(m[2])) === next;
}
