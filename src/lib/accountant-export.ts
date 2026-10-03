import { downloadXlsx, type Sheet, type Cell } from "@/lib/xlsx";

const SOURCE: Record<string, string> = {
  invoice: "Излезна фактура", incoming_invoice: "Влезна фактура", bank_alloc: "Банка", cash: "Благајна", payroll: "Плати",
  depreciation: "Амортизација", advance_settle: "Аванс", manual: "Рачен налог", stock_move: "Залиха",
};
const VAT_KEY: Record<string, string> = { "0-export": "0% извоз / странство", "0-exempt": "0% ослободено" };
const STATUS: Record<string, string> = {
  pending: "Чека", in_progress: "Во тек", on_hold: "Паузиран", completed: "Завршен", cancelled: "Откажан",
  draft: "Нацрт", confirmed: "Потврдена", issued: "Издаден", delivered: "Испорачано", sent: "Испратено", paid: "Платено", partial: "Делумно платено", overdue: "Задоцнето",
};
const n = (v: any) => { const x = typeof v === "number" ? v : parseFloat(String(v ?? "")); return Number.isFinite(x) ? Math.round(x * 100) / 100 : null; };
const d = (v: any): Cell => { if (!v) return null; const s = typeof v === "string" ? v : new Date(v).toISOString(); return s.slice(0, 10); };
const sum = (rows: Cell[][], col: number) => Math.round(rows.reduce((a, r) => a + (typeof r[col] === "number" ? (r[col] as number) : 0), 0) * 100) / 100;
const fmtD = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

type Fetchers = {
  vatBooks: (i: { from: string; to: string }) => Promise<any>;
  trialBalance: (i: { from: string; to: string }) => Promise<any>;
  journalList: (i: { from: string; to: string; limit: number; offset: number }) => Promise<any>;
};

/** Сè што му треба на сметководството за периодот, во еден Excel со листови. */
export async function exportAccountantXlsx(report: any, from: string, to: string, company: string | undefined, f: Fetchers) {
  // Налозите се земаат по 500 додека не се земат сите
  const journal: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await f.journalList({ from, to, limit: 500, offset });
    journal.push(...page.entries);
    if (journal.length >= page.total || !page.entries.length) break;
  }
  const [vat, tb] = await Promise.all([f.vatBooks({ from, to }), f.trialBalance({ from, to })]);
  const period = `Период: ${fmtD(from)} – ${fmtD(to)}`;
  const head = (t: string) => [`${company ? company + " — " : ""}${t}`, period];

  const book = (rows: any[]): Cell[][] => rows.map((r, i) => [i + 1, r.number, r.date, r.partner ?? "", r.taxId || "", r.country || "", r.currency,
    r.vatRate, n(r.baseMkd), n(r.vatMkd), n(r.totalMkd), r.creditNote ? "книжно одобрување" : ""]);
  const bookHead = ["Р.бр.", "Број", "Датум", "Партнер", "ЕДБ", "Држава", "Валута", "Стапка ДДВ %", "Основица (ден)", "ДДВ (ден)", "Вкупно (ден)", "Забелешка"];
  const kif = book(vat.outgoing), kuf = book(vat.incoming);
  const bookTotal = (rows: Cell[][]): Cell[] => ["Вкупно", `${rows.length} документи`, null, null, null, null, null, null, sum(rows, 8), sum(rows, 9), sum(rows, 10), null];

  const jRows: Cell[][] = [];
  for (const e of [...journal].sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number)))
    for (const l of e.lines) jRows.push([e.number, e.date, SOURCE[e.sourceType] ?? e.sourceType, e.description, l.account, l.accountName ?? "", n(l.debit) || null, n(l.credit) || null]);

  const tbRows: Cell[][] = (tb.accounts ?? []).map((a: any) => [a.code, a.name, n(a.opening), n(a.debit), n(a.credit), n(a.closing)]);

  const rc: Cell[][] = (report.receiptsList ?? []).map((r: any) => [r.receiptNumber, d(r.receiptDate ?? r.createdAt), r.supplierName ?? "", r.supplierDocNumber ?? "", STATUS[r.status] ?? r.status, n(r.totalAmount)]);
  const dn: Cell[][] = (report.deliveryNotesList ?? []).map((x: any) => [x.dnNumber, d(x.issueDate ?? x.createdAt), x.customerName ?? "", STATUS[x.status] ?? x.status]);
  const wo: Cell[][] = (report.workOrders ?? []).map((w: any) => [w.woNumber, d(w.createdAt), w.description ?? "", STATUS[w.status] ?? w.status, n(w.costAmount)]);
  const req: Cell[][] = (report.requisitions ?? []).map((r: any) => [r.workOrderNumber, d(r.date), r.materialName, n(r.quantity), r.unit ?? "", n(r.unitCost), n(r.totalCost)]);

  const vatLines = (groups: any[]) => groups.map((g: any) => [VAT_KEY[g.key] ?? `${g.key}%`, n(g.base), n(g.vat), g.count] as Cell[]);
  const s = vat.summary;
  const ovRows: Cell[][] = [
      ["ИЗЛЕЗНИ ФАКТУРИ (КИФ)", null, null, null], ...vatLines(s.output),
      ["Вкупно излезни", sum(kif, 8), sum(kif, 9), kif.length],
      [null, null, null, null],
      ["ВЛЕЗНИ ФАКТУРИ (КУФ)", null, null, null], ...vatLines(s.input),
      ["Вкупно влезни", sum(kuf, 8), sum(kuf, 9), kuf.length],
      [null, null, null, null],
      [s.payable >= 0 ? "ДДВ за плаќање" : "ДДВ за поврат", null, n(Math.abs(s.payable)), null],
      [null, null, null, null],
      ["Налози за книжење", null, null, journal.length],
      ["Приемници (набавка на стока)", sum(rc, 5), null, rc.length],
      ["Испратници", null, null, dn.length],
      ["Работни налози", sum(wo, 4), null, wo.length],
      ["Потрошен материјал (требовања)", sum(req, 6), null, req.length],
      ...(vat.missingRates?.length ? [[null, null, null, null], [`Внимание: нема курс за ${vat.missingRates.join(", ")} — износите не се во збирот`, null, null, null]] as Cell[][] : []),
  ];
  // поднаслови и збирни редови се задебелени
  const boldRows = ovRows.map((r, i) => /^(ИЗЛЕЗНИ|ВЛЕЗНИ|Вкупно|ДДВ за)/.test(String(r[0] ?? "")) ? i : -1).filter(i => i >= 0);
  const overview: Sheet = { name: "Преглед", title: head("Извештај за сметководител"), header: ["Ставка", "Основица (ден)", "ДДВ (ден)", "Број"], rows: ovRows, boldRows, widths: [48, 18, 16, 10] };

  const sheets: Sheet[] = [
    overview,
    { name: "КИФ излезни", title: head("Книга на излезни фактури"), header: bookHead, rows: kif, total: bookTotal(kif) },
    { name: "КУФ влезни", title: head("Книга на влезни фактури"), header: bookHead, rows: kuf, total: bookTotal(kuf) },
    { name: "Налози за книжење", title: head("Налози за книжење"), header: ["Налог", "Датум", "Вид", "Опис", "Конто", "Назив на конто", "Должи", "Побарува"],
      rows: jRows, total: ["Вкупно", null, null, `${journal.length} налози`, null, null, sum(jRows, 6), sum(jRows, 7)] },
    { name: "Бруто биланс", title: head("Бруто биланс"), header: ["Конто", "Назив", "Почетно салдо", "Должи", "Побарува", "Салдо"],
      rows: tbRows, total: ["Вкупно", null, sum(tbRows, 2), sum(tbRows, 3), sum(tbRows, 4), sum(tbRows, 5)] },
    { name: "Приемници", title: head("Приемници"), header: ["Број", "Датум", "Добавувач", "Документ од добавувач", "Статус", "Износ (ден)"],
      rows: rc, total: ["Вкупно", null, null, null, null, sum(rc, 5)] },
    { name: "Испратници", title: head("Испратници"), header: ["Број", "Датум", "Купувач", "Статус"], rows: dn },
    { name: "Работни налози", title: head("Работни налози"), header: ["Број", "Датум", "Опис", "Статус", "Трошок (ден)"],
      rows: wo, total: ["Вкупно", null, null, null, sum(wo, 4)] },
    { name: "Требовања", title: head("Потрошен материјал по налози"), header: ["Работен налог", "Датум", "Материјал", "Количина", "Единица", "Цена (ден)", "Вкупно (ден)"],
      rows: req, total: ["Вкупно", null, null, null, null, null, sum(req, 6)] },
  ];
  await downloadXlsx(`smetkovodstvo_${from}_${to}.xlsx`, sheets);
}
