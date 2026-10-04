import { buildXlsx, saveBlob, type Sheet, type Cell } from "@/lib/xlsx";
import { accountantReportHtml, htmlToPdfBlob, invoiceHtml } from "@/lib/print-documents";

const SOURCE: Record<string, string> = {
  invoice: "Излезна фактура", incoming_invoice: "Влезна фактура", bank_alloc: "Банка", cash: "Благајна", payroll: "Плати",
  depreciation: "Амортизација", depreciation_m: "Амортизација", advance_settle: "Аванс", manual: "Рачен налог", stock_move: "Залиха",
  bank_other: "Банка", bank_fee: "Провизија", year_close: "Затворање година", inventory_value: "Залихи на производи", compensation: "Компензација",
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
  vat04?: (i: { from: string; to: string }) => Promise<any>;
  statements?: (i: { date: string; from: string }) => Promise<any>;
};

export const packName = (from: string, to: string) => `smetkovodstvo_${from}_${to}`;

/** Сè што му треба на сметководството за периодот, во еден Excel со листови — симнување. */
export async function exportAccountantXlsx(report: any, from: string, to: string, company: string | undefined, f: Fetchers) {
  saveBlob(await buildAccountantXlsx(report, from, to, company, f), `${packName(from, to)}.xlsx`);
}

/** Извештајот како PDF (истата содржина како печатењето). */
export async function buildAccountantPdf(report: any, from: string, to: string, settings: any): Promise<Blob> {
  return htmlToPdfBlob(accountantReportHtml(report, { startDate: from, endDate: to }, settings));
}

export async function buildAccountantXlsx(report: any, from: string, to: string, company: string | undefined, f: Fetchers): Promise<Blob> {
  // Налозите се земаат по 500 додека не се земат сите
  const journal: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await f.journalList({ from, to, limit: 500, offset });
    journal.push(...page.entries);
    if (journal.length >= page.total || !page.entries.length) break;
  }
  const [vat, tb, v04, fs] = await Promise.all([f.vatBooks({ from, to }), f.trialBalance({ from, to }),
    f.vat04 ? f.vat04({ from, to }) : null, f.statements ? f.statements({ date: to, from: `${to.slice(0, 4)}-01-01` }) : null]);
  const period = `Период: ${fmtD(from)} – ${fmtD(to)}`;
  const head = (t: string) => [`${company ? company + " — " : ""}${t}`, period];

  const book = (rows: any[]): Cell[][] => rows.map((r, i) => [i + 1, r.number, r.date, r.partner ?? "", r.taxId || "", r.country || "", r.currency,
    r.vatRate, n(r.baseMkd), n(r.vatMkd), n(r.totalMkd), [r.creditNote ? "книжно одобрување" : "", r.reverseCharge ? "обратно оданочување" : "", r.customsDeclaration ? `ЕЦД ${r.customsDeclaration}` : ""].filter(Boolean).join(" · ")]);
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
      ...((vat.warnings ?? []).length ? [[null, null, null, null], ["ЗА ПРОВЕРКА ПРЕД ПРИЈАВАТА", null, null, null], ...(vat.warnings as string[]).map((w: string) => [w, null, null, null] as Cell[])] : []),
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
  if (v04) {
    const rows: Cell[][] = v04.lines.map((l: any) => [v04.codes?.[l.key] ?? "", l.label, l.base, l.vat]);
    sheets.splice(3, 0, { name: "ДДВ-04", title: head("ДДВ-04 — износи по полиња"), header: ["Поле", "Опис", "Основица (ден)", "ДДВ (ден)"], rows,
      boldRows: v04.lines.map((l: any, i: number) => (l.side === "total" ? i : -1)).filter((i: number) => i >= 0), widths: [8, 80, 18, 18] });
  }
  if (fs) {
    const st = (rows: any[]): Cell[][] => rows.map((r) => [fs.codes?.[r.key] ?? "", r.label, r.amount]);
    const bsRows: Cell[][] = [], bsBold: number[] = [];
    for (const [title, secs, total] of [["Актива", fs.balanceSheet.assets, fs.balanceSheet.totalAssets], ["Пасива", fs.balanceSheet.liabilities, fs.balanceSheet.totalLiabilities]] as const) {
      for (const sec of secs as any[]) { bsBold.push(bsRows.length); bsRows.push(["", sec.label, Math.round(sec.rows.reduce((a: number, r: any) => a + r.amount, 0) * 100) / 100]); bsRows.push(...st(sec.rows)); }
      bsBold.push(bsRows.length); bsRows.push(["", `Вкупно ${title.toLowerCase()}`, total as number]);
    }
    const is = fs.incomeStatement;
    const isRows: Cell[][] = [["", "Приходи", is.totalRevenue], ...st(is.revenue), ["", "Расходи", is.totalExpense], ...st(is.expense),
      ["", "Резултат пред оданочување", is.beforeTax], ...st([is.tax]), ["", "Нето резултат", is.net]];
    const isBold = [0, is.revenue.length + 1, is.revenue.length + is.expense.length + 2, isRows.length - 1];
    const asOf = [`${company ? company + " — " : ""}Биланс на состојба`, `на ${fmtD(to)} (работна верзија од главната книга)`];
    sheets.push({ name: "Биланс на состојба", title: asOf, header: ["АОП", "Позиција", "Износ (ден)"], rows: bsRows, boldRows: bsBold, widths: [8, 70, 18] });
    sheets.push({ name: "Биланс на успех", title: [`${company ? company + " — " : ""}Биланс на успех`, `${fmtD(fs.from)} – ${fmtD(to)} (работна верзија од главната книга)`],
      header: ["АОП", "Позиција", "Износ (ден)"], rows: isRows, boldRows: isBold, widths: [8, 70, 18] });
  }
  return buildXlsx(sheets);
}

// ── ZIP со документите ──
type DocFetchers = {
  invoiceById: (i: { id: number }) => Promise<any>;
  incomingInvoiceById: (i: { id: number }) => Promise<any>;
  receiptById: (i: { id: number }) => Promise<any>;
};
// скенот е зачуван како base64 — од првите бајти се знае дали е PDF или слика
const sniff = (b64: string): { ext: string; type: string } =>
  b64.startsWith("JVBER") ? { ext: "pdf", type: "application/pdf" }
  : b64.startsWith("/9j/") ? { ext: "jpg", type: "image/jpeg" }
  : b64.startsWith("iVBOR") ? { ext: "png", type: "image/png" }
  : b64.startsWith("UEsDB") ? { ext: "zip", type: "application/zip" }
  : { ext: "pdf", type: "application/pdf" };
const stripDataUrl = (v: string) => v.replace(/^data:[^;]+;base64,/, "");
const safe = (s: any) => String(s ?? "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "без-број";

/**
 * Еден ZIP за сметководителот: извештај (PDF + Excel), излезните фактури како PDF,
 * оригиналните скенови од влезните фактури и приемниците, и листа што недостасува.
 */
export async function buildDocumentsZip(report: any, from: string, to: string, settings: any, f: DocFetchers,
  extras: { xlsx?: Blob; pdf?: Blob }, onProgress?: (done: number, total: number, what: string) => void): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const base = packName(from, to);
  if (extras.pdf) zip.file(`${base}.pdf`, extras.pdf);
  if (extras.xlsx) zip.file(`${base}.xlsx`, extras.xlsx);
  const out: any[] = report.outgoing?.items ?? [];
  const inc: any[] = report.incoming?.items ?? [];
  const rcs: any[] = (report.receiptsList ?? []).filter((r: any) => r.hasFile);
  const total = out.length + inc.filter((i: any) => i.hasFile).length + rcs.length;
  let done = 0;
  const tick = (what: string) => onProgress?.(++done, total, what);
  const missing: string[] = [];

  for (const i of out) {
    try {
      const full = await f.invoiceById({ id: Number(i.id) });
      const pdf = await htmlToPdfBlob(invoiceHtml(full, settings));
      zip.file(`Излезни фактури/${safe(d(i.issueDate))} ${safe(i.invoiceNumber)} ${safe(i.customerName)}.pdf`, pdf);
    } catch (e: any) { missing.push(`Излезна фактура ${i.invoiceNumber}: не можеше да се направи PDF (${e?.message ?? e})`); }
    tick(`фактура ${i.invoiceNumber}`);
  }
  for (const i of inc) {
    const name = `${safe(d(i.issueDate ?? i.receivedDate))} ${safe(i.supplierInvoiceNumber)} ${safe(i.supplierName)}`;
    if (!i.hasFile) { missing.push(`Влезна фактура ${i.supplierInvoiceNumber} (${i.supplierName ?? ""}) — нема прикачен скен`); continue; }
    try {
      const full = await f.incomingInvoiceById({ id: Number(i.id) });
      const b64 = stripDataUrl(String(full?.fileUrl ?? ""));
      if (!b64) throw new Error("празен скен");
      zip.file(`Влезни фактури/${name}.${sniff(b64).ext}`, b64, { base64: true });
    } catch (e: any) { missing.push(`Влезна фактура ${i.supplierInvoiceNumber}: скенот не се отвора (${e?.message ?? e})`); }
    tick(`влезна ${i.supplierInvoiceNumber}`);
  }
  for (const r of rcs) {
    try {
      const full = await f.receiptById({ id: Number(r.id) });
      const b64 = stripDataUrl(String(full?.fileUrl ?? ""));
      if (b64) zip.file(`Приемници/${safe(d(r.receiptDate ?? r.createdAt))} ${safe(r.receiptNumber)}.${sniff(b64).ext}`, b64, { base64: true });
    } catch { /* приемницата е во извештајот; скенот е дополнителен */ }
    tick(`приемница ${r.receiptNumber}`);
  }

  const lines = [
    `Документи за сметководство — ${settings?.name ?? ""}`,
    `Период: ${from.split("-").reverse().join(".")} – ${to.split("-").reverse().join(".")}`,
    "",
    `${base}.pdf   — извештај за печатење и архива (КИФ, КУФ, ДДВ по стапки, приемници, налози)`,
    `${base}.xlsx  — истите податоци во Excel, со налози за книжење и бруто биланс`,
    `Излезни фактури/  — ${out.length} фактури како PDF`,
    `Влезни фактури/   — ${inc.filter((i: any) => i.hasFile).length} од ${inc.length} оригинални скенови`,
    ...(rcs.length ? [`Приемници/        — ${rcs.length} скенови`] : []),
    "",
    missing.length ? "НЕДОСТАСУВА:" : "Сите документи се вклучени.",
    ...missing.map(m => " - " + m),
  ];
  zip.file("ПРОЧИТАЈ.txt", "\ufeff" + lines.join("\r\n"));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
