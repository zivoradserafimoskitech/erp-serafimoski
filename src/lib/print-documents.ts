// Печатливи документи — A4, кирилица нативно, browser print → PDF
// Заедничка визуелна рамка: фактура, работен налог, испратница

import { parseSchedule, describeInstallment, advancePercent, type Installment } from "@contracts/payment-terms";

type Money = string | number | null | undefined;

const den = (v: Money) => Number(v ?? 0).toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dt = (s: any) => {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return esc(s);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
};

const PRIORITY_MK: Record<string, string> = { low: "Низок", normal: "Нормален", high: "Висок", urgent: "ИТНО" };
const STATUS_MK: Record<string, string> = { pending: "Во чекање", in_progress: "Во тек", on_hold: "Паузиран", completed: "Завршен", cancelled: "Откажан", draft: "Нацрт", issued: "Издадена", delivered: "Испорачана" };
const OP_MK: Record<string, string> = { cutting_laser: "Ласерско сечење", cutting_plasma: "Плазма сечење", bending: "Виткање", welding_mig: "МИГ заварување", welding_tig: "ТИГ заварување", welding_laser: "Ласерско заварување", grinding: "Брусење", drilling: "Дупчење", painting: "Фарбање", assembly: "Монтажа", packing: "Пакување", other: "Друго" };

function shell(title: string, accent: string, body: string) {
  return `<!doctype html>
<html lang="mk"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root { --accent: ${accent}; --dark: #16112b; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; padding: 13mm 12mm; }
  @page { size: A4; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid var(--accent); padding-bottom: 11px; }
  .co { display: flex; gap: 12px; align-items: center; }
  .co img { max-height: 46px; max-width: 280px; object-fit: contain; object-position: left; }
  .co h1 { font-size: 17px; color: var(--accent); letter-spacing: .3px; }
  .co .sub { font-size: 9.5px; color: #555; line-height: 1.55; margin-top: 2px; }
  .doc { text-align: right; }
  .doc h2 { font-size: 20px; letter-spacing: 2px; color: var(--dark); }
  .doc .num { font-size: 16px; font-weight: 700; color: var(--accent); margin-top: 1px; }
  .doc .meta { font-size: 10px; color: #555; margin-top: 5px; line-height: 1.65; }
  .parties { display: flex; gap: 12px; margin: 13px 0; }
  .party { flex: 1; border: 1px solid #e2e2e2; border-left: 3px solid var(--accent); border-radius: 5px; padding: 9px 12px; background: #fcfcfc; }
  .party h3 { font-size: 8.5px; text-transform: uppercase; letter-spacing: 1.2px; color: var(--accent); margin-bottom: 5px; }
  .party .n { font-weight: 700; font-size: 12.5px; margin-bottom: 2px; }
  .party div { line-height: 1.55; }
  .stitle { font-size: 9px; text-transform: uppercase; letter-spacing: 1.2px; color: var(--accent); margin: 13px 0 5px; font-weight: 700; }
  table.t { width: 100%; border-collapse: collapse; }
  table.t th { background: var(--dark); color: #fff; font-size: 9px; text-transform: uppercase; letter-spacing: .4px; padding: 6px 8px; text-align: left; }
  table.t th:first-child { border-radius: 4px 0 0 0; } table.t th:last-child { border-radius: 0 4px 0 0; }
  table.t td { border-bottom: 1px solid #e8e8e8; padding: 6px 8px; }
  table.t tr:nth-child(even) td { background: #fafafa; }
  .c { text-align: center; } .r { text-align: right; white-space: nowrap; }
  .totals { margin-top: 10px; margin-left: auto; width: 64mm; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 9px; }
  .totals .grand { background: var(--dark); color: #fff; font-weight: 700; font-size: 13.5px; border-radius: 5px; margin-top: 4px; padding: 8px 9px; }
  .box { margin-top: 13px; border: 1.5px dashed var(--accent); border-radius: 6px; padding: 9px 12px; font-size: 10.5px; line-height: 1.7; background: #fffdf8; }
  .box b { color: var(--accent); }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 18px; }
  .kv { display: flex; justify-content: space-between; border-bottom: 1px dotted #ddd; padding: 3px 0; }
  .kv span:first-child { color: #666; }
  .kv b { text-align: right; }
  .notes { margin-top: 10px; font-size: 10px; color: #555; line-height: 1.5; }
  .sigs { display: flex; justify-content: space-between; margin-top: 36px; gap: 22px; }
  .sig { flex: 1; text-align: center; font-size: 10px; color: #555; }
  .sig .line { border-top: 1px solid #999; margin-top: 32px; padding-top: 4px; }
  .foot { margin-top: 16px; text-align: center; font-size: 8.5px; color: #aaa; border-top: 1px solid #eee; padding-top: 6px; }
  .badge { display: inline-block; padding: 2px 9px; border-radius: 10px; font-size: 9.5px; font-weight: 700; background: var(--accent); color: #fff; }
  @media print { body { padding: 11mm; } }
</style></head><body>${body}
<script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`;
}

function header(s: any, docTitle: string, docNum: string, metaHtml: string) {
  const logo = "/logo-black.png?v=1";
  return `<div class="head">
    <div class="co">
      <img src="${esc(logo)}" alt="" onerror="this.style.display='none'">
      <div>
        <h1>${esc(s?.name ?? "Serafimoski Tech DOOEL")}</h1>
        <div class="sub">
          ${esc(s?.address ?? "")}<br>
          ЕДБ: ${esc(s?.edb ?? "—")} · ЕМБС: ${esc(s?.embs ?? "—")}${s?.phone ? " · тел: " + esc(s.phone) : ""}<br>
          ${esc(s?.email ?? "")}
        </div>
      </div>
    </div>
    <div class="doc"><h2>${docTitle}</h2><div class="num">${esc(docNum)}</div><div class="meta">${metaHtml}</div></div>
  </div>`;
}

function footer(s: any) {
  return `<div class="foot">${esc(s?.name ?? "Serafimoski Tech DOOEL")} · ${esc(s?.address ?? "")} · ЕДБ ${esc(s?.edb ?? "")} · Генерирано од Metal ERP</div>`;
}

function openPrint(html: string) {
  // Скриен iframe во истата страница — popup blocker-ите не можат да го блокираат
  const old = document.getElementById("__print_frame");
  if (old) old.remove();
  const frame = document.createElement("iframe");
  frame.id = "__print_frame";
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html.replace("window.onload = () => setTimeout(() => window.print(), 300);", ""));
  doc.close();
  const doPrint = () => {
    try { frame.contentWindow!.focus(); frame.contentWindow!.print(); } catch { /* ignore */ }
  };
  if (doc.readyState === "complete") setTimeout(doPrint, 350);
  else frame.onload = () => setTimeout(doPrint, 350);
}

// Заеднички „челичен“ стил за понуда и фактура / про-фактура
const STEEL_CSS = `  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root { --steel: #6188AF; --steel-mid: #4A5568; --steel-line: #D8DCE1; --amber: #3D71B8; --amber-soft: #EEF4FB; --paper: #F5F3EF; }
  html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #232A32; padding: 12mm 13mm; font-variant-numeric: tabular-nums; }
  @page { size: A4; margin: 0; }
  .lbl { font-size: 8px; text-transform: uppercase; letter-spacing: 2px; color: var(--steel-mid); font-weight: 700; }

  /* Заглавие: лого лево, челичен таг со засечен агол десно */
  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  .head img { max-width: 310px; max-height: 52px; object-fit: contain; object-position: left; }
  .head .co-sub { font-size: 9px; color: var(--steel-mid); line-height: 1.6; margin-top: 6px; }
  .tag { background: var(--steel); color: #fff; padding: 13px 18px 12px 22px; min-width: 62mm; clip-path: polygon(0 0, 100% 0, 100% 100%, 14px 100%, 0 calc(100% - 14px)); position: relative; }
  .tag::after { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: #C9DDF2; }
  .tag h2 { font-size: 19px; letter-spacing: 5px; font-weight: 800; }
  .tag .num { font-size: 14px; font-weight: 700; color: #EAF2FA; margin-top: 2px; letter-spacing: 1px; }
  .tag .meta { font-size: 9.5px; color: #DDE9F4; margin-top: 8px; line-height: 1.7; }
  .tag .meta b { color: #fff; font-weight: 600; }

  /* Челична линија со килибарен сегмент */
  .rule { height: 2px; background: var(--steel-line); margin: 12px 0 14px; position: relative; }
  .rule::before { content: ""; position: absolute; left: 0; top: 0; height: 2px; width: 58mm; background: var(--amber); }

  .parties { display: flex; gap: 12px; }
  .party { flex: 1; border: 1px solid var(--steel-line); background: #FDFDFC; padding: 10px 14px; clip-path: polygon(0 0, 100% 0, 100% calc(100% - 11px), calc(100% - 11px) 100%, 0 100%); }
  .party .n { font-weight: 700; font-size: 12.5px; color: var(--steel); margin: 4px 0 2px; }
  .party div { line-height: 1.6; color: #45505B; }

  table.t { width: 100%; border-collapse: collapse; margin-top: 16px; }
  table.t th { font-size: 8px; text-transform: uppercase; letter-spacing: 1.6px; color: var(--steel-mid); text-align: left; padding: 0 9px 6px; border-bottom: 2px solid var(--steel); }
  table.t td { padding: 7px 9px; border-bottom: 1px solid #ECEEF1; }
  table.t tr:last-child td { border-bottom: 2px solid var(--steel-line); }
  .c { text-align: center; } .r { text-align: right; white-space: nowrap; }
  th.c { text-align: center; } th.r { text-align: right; }
  .dim { color: #97A0AA; font-size: 10px; }
  .desc { font-weight: 500; color: var(--steel); }

  /* Вкупно: челична плоча */
  .sum-wrap { display: flex; justify-content: flex-end; margin-top: 12px; }
  .sum { width: 70mm; }
  .sum .row { display: flex; justify-content: space-between; padding: 4px 12px; color: #45505B; }
  .sum .grand { margin-top: 6px; background: var(--steel); color: #fff; font-weight: 800; font-size: 14px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: baseline; clip-path: polygon(0 0, 100% 0, 100% 100%, 12px 100%, 0 calc(100% - 12px)); border-top: 3px solid #C9DDF2; }
  .sum .grand small { font-size: 9px; letter-spacing: 2px; color: #E3EDF7; font-weight: 700; }

  .terms { margin-top: 16px; background: var(--amber-soft); border-left: 3px solid var(--amber); padding: 10px 14px; font-size: 10.5px; line-height: 1.75; }
  .terms .lbl { color: var(--amber); margin-bottom: 3px; display: block; }
  .terms b { color: var(--steel); }
  .notes { margin-top: 10px; font-size: 10px; color: #5A646E; line-height: 1.6; }

  .sigs { display: flex; justify-content: space-between; margin-top: 40px; gap: 26px; }
  .sig { flex: 1; text-align: center; }
  .sig .line { border-top: 1px solid var(--steel-mid); margin-top: 34px; padding-top: 5px; font-size: 9px; text-transform: uppercase; letter-spacing: 2px; color: var(--steel-mid); }

  .foot { margin-top: 18px; background: var(--steel); color: #E3EDF7; font-size: 8.5px; text-align: center; padding: 7px 10px; letter-spacing: .6px; clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%); }
  .foot b { color: #fff; }
  @media print { body { padding: 11mm 12mm; } }

  /* Фактура: дополнителни елементи */
  .party .lbl { display: block; }
  .party .small { font-size: 9.5px; color: #6B7580; }
  table.t td.num-col { font-variant-numeric: tabular-nums; }
  .sum .row.vat { border-bottom: 1px dashed var(--steel-line); padding-bottom: 6px; }
  .words { margin-top: 8px; text-align: right; font-size: 9.5px; color: var(--steel-mid); }
  .pay { margin-top: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid var(--steel-line); }
  .pay .ph { grid-column: 1 / -1; background: var(--amber-soft); border-left: 3px solid var(--amber); padding: 7px 12px; }
  .pay .ph .lbl { color: var(--amber); }
  .pay .cell { padding: 7px 12px; border-top: 1px solid #ECEEF1; }
  .pay .cell:nth-child(even) { border-left: 1px solid #ECEEF1; }
  .pay .cell .k { font-size: 8px; text-transform: uppercase; letter-spacing: 1.4px; color: var(--steel-mid); font-weight: 700; }
  .pay .cell .v { font-size: 11.5px; font-weight: 700; color: #232A32; margin-top: 2px; letter-spacing: .3px; }
  .pay .cell.wide { grid-column: 1 / -1; border-left: 0; }
  .stamp { display: inline-block; margin-top: 6px; border: 1.5px solid #C9DDF2; color: #fff; font-size: 8.5px; letter-spacing: 2px; padding: 2px 8px; font-weight: 700; }
  .terms .kv { display: flex; justify-content: space-between; gap: 16px; border-bottom: 1px dotted #C9D6E4; padding: 2px 0; }
  .terms .kv:last-child { border-bottom: 0; }
  .terms .kv b { white-space: nowrap; }
  .disclaimer { margin-top: 8px; font-size: 9px; color: #8A939C; }
`;

// ══════════════ ЈАЗИК И ВАЛУТА (МК / EN) ══════════════
export type DocLang = "mk" | "en";

const UNIT_LBL: Record<string, { mk: string; en: string }> = {
  pcs: { mk: "ком", en: "pcs" }, ком: { mk: "ком", en: "pcs" }, kom: { mk: "ком", en: "pcs" },
  kg: { mk: "кг", en: "kg" }, кг: { mk: "кг", en: "kg" },
  m: { mk: "м", en: "m" }, м: { mk: "м", en: "m" },
  m2: { mk: "м²", en: "m²" }, м2: { mk: "м²", en: "m²" },
  hour: { mk: "час", en: "h" }, час: { mk: "час", en: "h" },
  job: { mk: "услуга", en: "job" }, m_cut: { mk: "м сеч.", en: "m cut" }, bend: { mk: "свив.", en: "bend" },
  set: { mk: "сет", en: "set" },
};
const unitLbl = (u: any, lang: DocLang) => UNIT_LBL[String(u ?? "")]?.[lang] ?? esc(u ?? "");

/** Износ со ознака на валута: „1.234,00 ден.“ / „1,234.00 EUR“ */
const money = (v: Money, cur: string, lang: DocLang) => {
  const n = Number(v ?? 0).toLocaleString(lang === "en" ? "en-GB" : "mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n} ${curLbl(cur, lang)}`;
};
const num = (v: Money, lang: DocLang) =>
  Number(v ?? 0).toLocaleString(lang === "en" ? "en-GB" : "mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const curLbl = (cur: string, lang: DocLang) => (cur || "MKD") === "MKD" ? (lang === "en" ? "MKD" : "ден.") : esc(cur);

/** Латинизирај ги кирилските префикси на броевите (ПФ-001/2026 → PF-001/2026) */
const docNoEn = (n: any) => String(n ?? "")
  .replace(/ПФ/g, "PF").replace(/ПО/g, "PO").replace(/КН/g, "CN").replace(/НАР/g, "ORD");

/** Табела со рати: „50% авансно — 2.156,20 EUR“ */
function scheduleRows(sch: Installment[], total: Money, cur: string, lang: DocLang) {
  const t = Number(total ?? 0);
  return sch.map((i, idx) => `<div class="kv"><span>${idx + 1}. ${esc(describeInstallment(i, lang))}</span><b>${money(Math.round(t * i.percent) / 100, cur, lang)}</b></div>`).join("");
}

const INV_T = {
  mk: {
    invoice: "ФАКТУРА", proforma: "ПРО-ФАКТУРА", credit: "КНИЖНО ОДОБРУВАЊЕ", no: "бр.",
    issued: "Датум на издавање", due: "Рок за плаќање", currency: "Валута",
    seller: "Издавач", buyer: "Примач", taxId: "ЕДБ", regNo: "ЕМБС", phone: "тел", account: "Ж-ска",
    desc: "Опис", unit: "ЕМ", qty: "Кол.", price: "Цена", discount: "Попуст", total: "Вкупно",
    noItems: "Нема ставки", subtotal: "Основица", vat: "ДДВ", toPay: "ЗА ПЛАЌАЊЕ",
    payInfo: "Податоци за плаќање", giro: "Жиро сметка", ref: "Повикување на број", term: "Рок",
    beneficiary: "Корисник", bank: "Банка", bankAddr: "Адреса на банка", purpose: "Цел на дознака",
    notes: "Забелешка", prepared: "Изготвил", approved: "Одобрил", received: "Примил",
    proformaNote: "Про-фактурата не е даночен документ. Конечна фактура се издава по извршена испорака.",
    schedule: "Услови за плаќање", advanceDue: "Аванс за уплата", advance: "АВАНС",
    generated: "Генерирано од Metal ERP",
  },
  en: {
    invoice: "INVOICE", proforma: "PROFORMA INVOICE", credit: "CREDIT NOTE", no: "No.",
    issued: "Issue date", due: "Payment due", currency: "Currency",
    seller: "Seller", buyer: "Buyer", taxId: "VAT No.", regNo: "Reg. No.", phone: "tel", account: "Account",
    desc: "Description", unit: "Unit", qty: "Qty", price: "Unit price", discount: "Disc.", total: "Amount",
    noItems: "No items", subtotal: "Subtotal", vat: "VAT", toPay: "TOTAL DUE",
    payInfo: "Payment details", giro: "Account No.", ref: "Payment reference", term: "Due",
    beneficiary: "Beneficiary", bank: "Bank", bankAddr: "Bank address", purpose: "Payment reference",
    notes: "Notes", prepared: "Prepared by", approved: "Approved by", received: "Received by",
    proformaNote: "This proforma invoice is not a tax document. The final invoice will be issued upon delivery.",
    schedule: "Payment terms", advanceDue: "Advance due", advance: "ADVANCE",
    generated: "Generated by Metal ERP",
  },
};

// ══════════════ ФАКТУРА / ПРО-ФАКТУРА ══════════════
export function invoiceHtml(inv: any, settings: any, langArg?: DocLang): string {
  const lang: DocLang = langArg ?? (inv?.language === "en" ? "en" : "mk");
  const T = INV_T[lang];
  const type = String(inv?.invoiceType ?? "");
  const isProforma = type.includes("proforma");
  const docTitle = isProforma ? T.proforma : type === "credit_note" ? T.credit : T.invoice;
  const c = inv?.customer ?? {};
  const s = settings ?? {};
  const cur = String(inv?.currency ?? "MKD");
  const foreign = cur !== "MKD";
  const items: any[] = inv?.items ?? [];
  const vatRate = Number(inv?.vatRate ?? s?.defaultVatRate ?? 18);
  const docNo = lang === "en" ? docNoEn(inv?.invoiceNumber) : String(inv?.invoiceNumber ?? "");
  const coName = (lang === "en" && s?.nameEn) || s?.name || "Serafimoski Tech DOOEL";
  const coAddr = (lang === "en" && s?.addressEn) || s?.address || "";
  const bankName = (lang === "en" && s?.bankNameEn) || s?.bankName || "";

  const cl = curLbl(cur, lang);
  const hasDisc = items.some(it => Number(it.discount ?? 0) > 0);
  const rows = items.map((it, i) => `<tr>
      <td class="c dim">${String(i + 1).padStart(2, "0")}</td><td class="desc">${esc(it.description)}</td>
      <td class="c dim">${unitLbl(it.unit, lang)}</td>
      <td class="r">${num(it.quantity, lang)}</td><td class="r">${num(it.unitPrice, lang)}</td>
      ${hasDisc ? `<td class="r dim">${Number(it.discount ?? 0) > 0 ? num(it.discount, lang) + "%" : "—"}</td>` : ""}
      <td class="r"><b>${num(it.totalPrice, lang)}</b></td></tr>`).join("");
  const cols = hasDisc ? 7 : 6;

  // Плаќање: девизно (IBAN/SWIFT) за странска валута или англиски документ, жиро сметка за денари
  const useIban = (foreign || lang === "en") && (s?.iban || s?.swift);
  const cell = (k: string, v: any, wide = false) => `<div class="cell${wide ? " wide" : ""}"><div class="k">${k}</div><div class="v">${esc(v || "—")}</div></div>`;
  const payBox = useIban
    ? `<div class="pay"><div class="ph"><span class="lbl">${T.payInfo}</span></div>
        ${cell(T.beneficiary, coName)}${cell("IBAN", s?.iban)}
        ${cell(T.bank, bankName)}${cell("SWIFT / BIC", s?.swift)}
        ${s?.bankAddress ? cell(T.bankAddr, s.bankAddress, true) : ""}
        ${cell(T.purpose, docNo)}${cell(T.due, dt(inv?.dueDate))}
      </div>`
    : `<div class="pay"><div class="ph"><span class="lbl">${T.payInfo}</span></div>
        ${cell(T.giro, s?.bankAccount)}${cell(T.bank, bankName)}
        ${cell(T.ref, docNo)}${cell(T.due, dt(inv?.dueDate))}
      </div>`;

  const logo = "/logo-black.png?v=1";
  const sch = parseSchedule(inv?.paymentSchedule);
  const advPct = sch ? advancePercent(sch) : 0;
  const statusStamp = isProforma && advPct > 0 ? `${T.advance} ${advPct}%` : "";
  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${docTitle} ${esc(docNo)}</title>
<style>
${STEEL_CSS}</style></head><body>
  <div class="head">
    <div>
      <img src="${esc(logo)}" alt="" onerror="this.style.display='none'">
      <div class="co-sub">
        <b style="color:var(--steel)">${esc(coName)}</b><br>
        ${esc(coAddr)}${coAddr ? "<br>" : ""}
        ${T.taxId}: ${esc(s?.edb ?? "—")} · ${T.regNo}: ${esc(s?.embs ?? "—")}${s?.phone ? ` · ${T.phone}: ` + esc(s.phone) : ""}${s?.email ? "<br>" + esc(s.email) : ""}
      </div>
    </div>
    <div class="tag">
      <h2 style="${docTitle.length > 10 ? "font-size:15px;letter-spacing:3px" : ""}">${docTitle}</h2>
      <div class="num">${T.no} ${esc(docNo)}</div>
      <div class="meta">${T.issued}: <b>${dt(inv?.issueDate)}</b><br>${T.due}: <b>${dt(inv?.dueDate)}</b> · ${T.currency}: <b>${esc(cur)}</b></div>
      ${statusStamp ? `<div class="stamp">${statusStamp}</div>` : ""}
    </div>
  </div>
  <div class="rule"></div>
  <div class="parties">
    <div class="party"><span class="lbl">${T.seller}</span>
      <div class="n">${esc(coName)}</div>
      <div>${esc(coAddr)}</div>
      <div>${T.taxId}: ${esc(s?.edb ?? "—")}${s?.embs ? ` · ${T.regNo}: ${esc(s.embs)}` : ""}</div>
      ${useIban ? `<div class="small">IBAN: ${esc(s?.iban ?? "—")}${s?.swift ? " · SWIFT: " + esc(s.swift) : ""}</div>`
        : `<div class="small">${T.account}: ${esc(s?.bankAccount ?? "—")}${bankName ? " · " + esc(bankName) : ""}</div>`}
    </div>
    <div class="party"><span class="lbl">${T.buyer}</span>
      <div class="n">${esc(c.company || c.name || "—")}</div>
      ${c.company && c.name && c.company !== c.name ? `<div>${esc(c.name)}</div>` : ""}
      <div>${esc([c.address, c.city, c.country].filter(Boolean).join(", "))}</div>
      ${c.edb || c.taxNumber ? `<div>${T.taxId}: ${esc(c.edb || c.taxNumber)}</div>` : ""}
      ${c.phone || c.email ? `<div class="small">${[c.phone ? `${T.phone}: ${esc(c.phone)}` : "", esc(c.email ?? "")].filter(Boolean).join(" · ")}</div>` : ""}
    </div>
  </div>
  <table class="t"><thead><tr>
    <th class="c" style="width:28px">#</th><th>${T.desc}</th><th class="c" style="width:44px">${T.unit}</th>
    <th class="r" style="width:60px">${T.qty}</th><th class="r" style="width:84px">${T.price} (${cl})</th>
    ${hasDisc ? `<th class="r" style="width:50px">${T.discount}</th>` : ""}
    <th class="r" style="width:96px">${T.total} (${cl})</th>
  </tr></thead><tbody>${rows || `<tr><td colspan="${cols}" class="c" style="padding:16px;color:#999">${T.noItems}</td></tr>`}</tbody></table>
  <div class="sum-wrap"><div class="sum">
    <div class="row"><span>${T.subtotal}:</span><b>${money(inv?.subtotal, cur, lang)}</b></div>
    ${vatRate > 0
      ? `<div class="row vat"><span>${T.vat} (${vatRate}%):</span><b>${money(inv?.vatAmount, cur, lang)}</b></div>`
      : `<div class="row vat"><span>${T.vat}:</span><b>${lang === "en" ? "exempt (export)" : "ослободено (извоз)"}</b></div>`}
    <div class="grand"><small>${T.toPay}</small><span>${money(inv?.totalAmount, cur, lang)}</span></div>
    ${isProforma && advPct > 0 && advPct < 100 ? `<div class="row" style="margin-top:6px;color:var(--amber);font-weight:700"><span>${T.advanceDue} (${advPct}%):</span><span>${money(Math.round(Number(inv?.totalAmount ?? 0) * advPct) / 100, cur, lang)}</span></div>` : ""}
  </div></div>
  ${sch ? `<div class="terms"><span class="lbl">${T.schedule}</span>${scheduleRows(sch, inv?.totalAmount, cur, lang)}</div>` : ""}
  ${payBox}
  ${inv?.notes ? `<div class="terms"><span class="lbl">${T.notes}</span>${esc(inv.notes).replace(/\n/g, "<br>")}</div>` : ""}
  ${isProforma ? `<div class="disclaimer">${T.proformaNote}</div>` : ""}
  <div class="sigs"><div class="sig"><div class="line">${T.prepared}</div></div><div class="sig"><div class="line">${T.approved}</div></div><div class="sig"><div class="line">${T.received}</div></div></div>
  <div class="foot"><b>${esc(coName)}</b> · ${esc(coAddr)} · ${T.taxId} ${esc(s?.edb ?? "")} · ${T.generated}</div>
<script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`;
  return html;
}

export function printInvoice(inv: any, settings: any, langArg?: DocLang) {
  openPrint(invoiceHtml(inv, settings, langArg));
}

// ══════════════ РАБОТЕН НАЛОГ ══════════════
export async function printWorkOrder(wo: any, settings: any) {
  const s = settings ?? {};
  const mats: any[] = wo?.materials ?? [];
  const ops: any[] = wo?.operations ?? [];

  // QR кон страницата за скенирање на подот
  let woQr = "";
  if (wo?.id) {
    try {
      const QRCode = (await import("qrcode")).default;
      woQr = await QRCode.toDataURL(`${window.location.origin}/n/${wo.id}`, {
        errorCorrectionLevel: "M", margin: 0, width: 260,
        color: { dark: "#16112b", light: "#ffffff" },
      });
    } catch { /* без QR — налогот сепак се печати */ }
  }
  const ws = wo?.weightSummary ?? null;
  const hasKg = mats.some((m) => Number(m.weightKg ?? 0) > 0);
  const matRows = mats.map((m, i) => `<tr>
    <td class="c">${i + 1}</td><td>${esc(m.materialCode ?? "")}</td><td>${esc(m.materialName ?? "—")}</td>
    <td class="c">${esc(m.materialUnit ?? "")}</td><td class="r">${den(m.quantity)}</td>
    ${hasKg ? `<td class="r">${Number(m.weightKg ?? 0) > 0 ? den(m.weightKg) : "—"}</td>` : ""}
    <td class="c">${m.isActual === "actual" ? "Реално" : "Планирано"}</td></tr>`).join("");

  const opRows = ops.map((o) => `<tr>
    <td class="c">${o.sequence ?? ""}</td><td>${esc(OP_MK[o.operation] ?? o.operation)}</td>
    <td>${esc(o.description ?? "")}</td><td class="c">${o.estimatedTime ? esc(o.estimatedTime) + " мин" : "—"}</td>
    <td>${esc(o.operator ?? "")}</td><td class="c" style="width:52px">☐</td></tr>`).join("");

  const body = `
  ${header(s, "РАБОТЕН НАЛОГ", wo?.woNumber ?? "", `
    Статус: <span class="badge">${esc(STATUS_MK[wo?.status] ?? wo?.status ?? "")}</span><br>
    Приоритет: <b>${esc(PRIORITY_MK[wo?.priority] ?? wo?.priority ?? "—")}</b>`)}
  ${woQr ? `<div style="float:right;text-align:center;margin:0 0 4mm 5mm;padding:2.5mm;border:1.5px solid var(--dark);border-radius:4px">
      <img src="${woQr}" style="width:24mm;height:24mm;display:block">
      <div style="font-size:7px;color:#666;margin-top:1.5mm;letter-spacing:.4px;text-transform:uppercase">Скенирај за работа</div>
      <div style="font-size:8px;font-weight:700;margin-top:.5mm">${esc(wo?.woNumber ?? "")}</div>
    </div>` : ""}
  <div class="stitle">Податоци за налогот</div>
  <div class="grid2">
    <div class="kv"><span>Опис:</span><b>${esc(wo?.description ?? "—")}</b></div>
    <div class="kv"><span>Нарачка:</span><b>${esc(wo?.orderNumber ?? "—")}</b></div>
    <div class="kv"><span>Одговорен:</span><b>${esc(wo?.assignedTo || "—")}</b></div>
    <div class="kv"><span>Планиран почеток:</span><b>${dt(wo?.plannedStart)}</b></div>
    <div class="kv"><span>Планиран крај:</span><b>${dt(wo?.plannedEnd)}</b></div>
    <div class="kv"><span>Реален почеток:</span><b>${dt(wo?.actualStart)}</b></div>
    <div class="kv"><span>Реален крај:</span><b>${dt(wo?.actualEnd)}</b></div>
  </div>
  <div class="stitle">Материјали</div>
  <table class="t"><thead><tr>
    <th class="c" style="width:26px">#</th><th style="width:70px">Код</th><th>Материјал</th>
    <th class="c" style="width:40px">ЕМ</th><th class="r" style="width:70px">Количина</th>
    ${hasKg ? `<th class="r" style="width:64px">Тежина (кг)</th>` : ""}
    <th class="c" style="width:70px">Тип</th>
  </tr></thead><tbody>${matRows || `<tr><td colspan="${hasKg ? 7 : 6}" class="c" style="padding:12px;color:#999">Нема материјали</td></tr>`}</tbody></table>
  ${ws && (ws.plannedKg > 0 || ws.actualKg > 0) ? `<div class="totals" style="width:76mm">
      <div class="row"><span>Планирано</span><b>${den(ws.plannedKg)} кг</b></div>
      <div class="row"><span>Реално потрошено</span><b>${den(ws.actualKg)} кг</b></div>
      <div class="row" style="border-top:1.5px solid var(--dark);font-weight:700;padding-top:5px">
        <span>Разлика</span><span>${ws.diffKg > 0 ? "+" : ""}${den(ws.diffKg)} кг</span></div>
    </div>` : ""}
  <div class="stitle">Операции</div>
  <table class="t"><thead><tr>
    <th class="c" style="width:30px">Ред</th><th style="width:120px">Операција</th><th>Опис</th>
    <th class="c" style="width:70px">Проц. време</th><th style="width:90px">Оператор</th><th class="c">Завршено</th>
  </tr></thead><tbody>${opRows || `<tr><td colspan="6" class="c" style="padding:12px;color:#999">Нема операции</td></tr>`}</tbody></table>
  ${wo?.notes ? `<div class="notes"><b>Забелешка:</b> ${esc(wo.notes)}</div>` : ""}
  <div class="sigs"><div class="sig"><div class="line">Изготвил</div></div><div class="sig"><div class="line">Работник</div></div><div class="sig"><div class="line">Контролирал</div></div></div>
  ${footer(s)}`;
  openPrint(shell(`Работен налог ${wo?.woNumber ?? ""}`, "#3a72b8", body));
}

// ══════════════ ИСПРАТНИЦА ══════════════
export function printDeliveryNote(dn: any, settings: any) {
  const s = settings ?? {};
  const c = dn?.customer ?? {};
  const items: any[] = dn?.items ?? [];
  const totalWeight = items.reduce((a, it) => a + (Number(it.weightKg ?? 0) || 0), 0);
  const hasWeight = totalWeight > 0;
  const rows = items.map((it, i) => `<tr>
    <td class="c">${i + 1}</td><td>${esc(it.description)}</td>
    <td class="c">${esc(it.unit ?? "")}</td><td class="r"><b>${den(it.quantity)}</b></td>
    ${hasWeight ? `<td class="r">${Number(it.weightKg ?? 0) > 0 ? den(it.weightKg) : "—"}</td>` : ""}
    <td>${esc(it.notes ?? "")}</td></tr>`).join("");

  const body = `
  ${header(s, "ИСПРАТНИЦА", dn?.dnNumber ?? "", `
    Датум на издавање: <b>${dt(dn?.issueDate)}</b><br>
    Датум на испорака: <b>${dt(dn?.deliveryDate)}</b><br>
    Статус: <span class="badge">${esc(STATUS_MK[dn?.status] ?? dn?.status ?? "")}</span>`)}
  <div class="parties">
    <div class="party"><h3>Испраќач</h3>
      <div class="n">${esc(s?.name ?? "Serafimoski Tech DOOEL")}</div>
      <div>${esc(s?.address ?? "")}</div>
      <div>ЕДБ: ${esc(s?.edb ?? "—")}</div>
    </div>
    <div class="party"><h3>Примач</h3>
      <div class="n">${esc(c.company || c.name || "—")}</div>
      ${c.company && c.name ? `<div>${esc(c.name)}</div>` : ""}
      <div>${esc([c.address, c.city].filter(Boolean).join(", "))}</div>
      ${c.phone ? `<div>тел: ${esc(c.phone)}</div>` : ""}
    </div>
  </div>
  <table class="t"><thead><tr>
    <th class="c" style="width:26px">#</th><th>Опис на стока</th>
    <th class="c" style="width:44px">ЕМ</th><th class="r" style="width:76px">Количина</th>
    ${hasWeight ? `<th class="r" style="width:72px">Тежина (кг)</th>` : ""}
    <th style="width:120px">Забелешка</th>
  </tr></thead><tbody>${rows || `<tr><td colspan="${hasWeight ? 6 : 5}" class="c" style="padding:14px;color:#999">Нема ставки</td></tr>`}</tbody></table>
  ${hasWeight ? `<div class="totals"><div class="row" style="border-top:2px solid var(--dark);font-weight:700;padding-top:6px">
      <span>Вкупна тежина</span><span>${den(totalWeight)} кг</span></div></div>` : ""}
  <div class="box">Стоката е испорачана комплетна и неоштетена. Примачот со потпис ја потврдува испораката.${dn?.notes ? "<br><b>Забелешка:</b> " + esc(dn.notes) : ""}</div>
  <div class="sigs"><div class="sig"><div class="line">Издал</div></div><div class="sig"><div class="line">Превезол</div></div><div class="sig"><div class="line">Примил (потпис и печат)</div></div></div>
  ${footer(s)}`;
  openPrint(shell(`Испратница ${dn?.dnNumber ?? ""}`, "#3a72b8", body));
}

// ══════════════ ПОНУДА (премиум шаблон — челик + килибар) ══════════════
const QUO_T = {
  mk: { title: "ПОНУДА", date: "Датум", valid: "Важи до", currency: "Валута", offerer: "Понудувач", client: "За клиент",
    taxId: "ЕДБ", regNo: "ЕМБС", phone: "тел", desc: "Опис", unit: "ЕМ", qty: "Кол.", weight: "Тежина (кг)", price: "Цена", total: "Вкупно",
    noItems: "Нема ставки", totalWeight: "Вкупна тежина", subtotal: "Основица", vat: "ДДВ", grand: "ВКУПНО", terms: "Услови",
    delivery: "Рок на испорака", days: "дена", payment: "Плаќање", perKg: "/кг",
    validTxt: (d: string, c: string, vat: boolean) => `Понудата важи до <b>${d}</b>. Цените се изразени во ${c === "MKD" ? "денари" : esc(c)}${vat ? " со пресметан ДДВ во рекапитулацијата" : ""}.`,
    notes: "Забелешка", prepared: "Изготвил", approved: "Одобрил", generated: "Генерирано од Metal ERP" },
  en: { title: "QUOTATION", date: "Date", valid: "Valid until", currency: "Currency", offerer: "Supplier", client: "Customer",
    taxId: "VAT No.", regNo: "Reg. No.", phone: "tel", desc: "Description", unit: "Unit", qty: "Qty", weight: "Weight (kg)", price: "Unit price", total: "Amount",
    noItems: "No items", totalWeight: "Total weight", subtotal: "Subtotal", vat: "VAT", grand: "TOTAL", terms: "Terms",
    delivery: "Delivery time", days: "days", payment: "Payment", perKg: "/kg",
    validTxt: (d: string, c: string, vat: boolean) => `This quotation is valid until <b>${d}</b>. Prices are in ${esc(c)}${vat ? ", VAT shown in the summary" : ""}.`,
    notes: "Notes", prepared: "Prepared by", approved: "Approved by", generated: "Generated by Metal ERP" },
};

export function quotationHtml(q: any, settings: any, lang: DocLang = "mk"): string {
  const T = QUO_T[lang];
  const s = settings ?? {};
  const cur = String(q?.currency ?? "MKD");
  const cl = curLbl(cur, lang);
  const n = (v: Money) => num(v, lang);
  const coName = (lang === "en" && s?.nameEn) || s?.name || "Serafimoski Tech DOOEL";
  const coAddr = (lang === "en" && s?.addressEn) || s?.address || "";
  const quoteNo = lang === "en" ? docNoEn(q?.quoteNumber) : String(q?.quoteNumber ?? "");
  const c = q?.customer ?? {};
  const items: any[] = q?.items ?? [];
  const vatRate = Number(q?.vatRate ?? s?.defaultVatRate ?? 18);
  const logo = "/logo-black.png?v=1";
  const totalKg = items.reduce((a, it) => a + (Number(it.weightKg ?? 0) || 0), 0);
  const hasKg = totalKg > 0;
  const rows = items.map((it, i) => `<tr>
    <td class="c dim">${String(i + 1).padStart(2, "0")}</td><td class="desc">${esc(it.description)}</td><td class="c dim">${unitLbl(it.unit, lang)}</td>
    <td class="r">${n(it.quantity)}</td>
    ${hasKg ? `<td class="r dim">${Number(it.weightKg ?? 0) > 0 ? n(it.weightKg) : "—"}</td>` : ""}
    <td class="r">${n(it.unitPrice)}${
      it.priceMode === "kg" && Number(it.pricePerKg ?? 0) > 0
        ? `<div style="font-size:8px;color:#888;font-weight:400">${n(it.pricePerKg)} ${cl}${T.perKg}</div>`
        : ""
    }</td>
    <td class="r"><b>${n(it.totalPrice)}</b></td></tr>`).join("");

  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${T.title} ${esc(quoteNo)}</title>
<style>
${STEEL_CSS}</style></head><body>
  <div class="head">
    <div>
      <img src="${esc(logo)}" alt="" onerror="this.style.display='none'">
      <div class="co-sub">
        ${esc(coAddr)}${coAddr ? "<br>" : ""}
        ${T.taxId}: ${esc(s?.edb ?? "—")} · ${T.regNo}: ${esc(s?.embs ?? "—")}${s?.phone ? ` · ${T.phone}: ` + esc(s.phone) : ""}${s?.email ? "<br>" + esc(s.email) : ""}
      </div>
    </div>
    <div class="tag">
      <h2>${T.title}</h2>
      <div class="num">${esc(quoteNo)}</div>
      <div class="meta">${T.date}: <b>${dt(q?.createdAt)}</b><br>${T.valid}: <b>${dt(q?.validUntil)}</b> · ${T.currency}: <b>${esc(cur)}</b></div>
    </div>
  </div>
  <div class="rule"></div>
  <div class="parties">
    <div class="party"><span class="lbl">${T.offerer}</span>
      <div class="n">${esc(coName)}</div>
      <div>${esc(coAddr)}</div>
      <div>${T.taxId}: ${esc(s?.edb ?? "—")}</div>
      ${s?.phone ? `<div>${T.phone}: ${esc(s.phone)}</div>` : ""}
    </div>
    <div class="party"><span class="lbl">${T.client}</span>
      <div class="n">${esc(c.company || c.name || "—")}</div>
      ${c.company && c.name ? `<div>${esc(c.name)}</div>` : ""}
      <div>${esc([c.address, c.city, c.country].filter(Boolean).join(", "))}</div>
      ${c.phone ? `<div>${T.phone}: ${esc(c.phone)}</div>` : ""}
    </div>
  </div>
  <table class="t"><thead><tr>
    <th class="c" style="width:28px">#</th><th>${T.desc}</th><th class="c" style="width:44px">${T.unit}</th>
    <th class="r" style="width:62px">${T.qty}</th>
    ${hasKg ? `<th class="r" style="width:62px">${T.weight}</th>` : ""}
    <th class="r" style="width:82px">${T.price} (${cl})</th>
    <th class="r" style="width:92px">${T.total} (${cl})</th>
  </tr></thead><tbody>${rows || `<tr><td colspan="${hasKg ? 7 : 6}" class="c" style="padding:16px;color:#999">${T.noItems}</td></tr>`}</tbody></table>
  <div class="sum-wrap"><div class="sum">
    ${hasKg ? `<div class="row"><span>${T.totalWeight}:</span><b>${n(totalKg)} ${lang === "en" ? "kg" : "кг"}</b></div>` : ""}
    <div class="row"><span>${T.subtotal}:</span><b>${money(q?.subtotal, cur, lang)}</b></div>
    ${vatRate > 0
      ? `<div class="row"><span>${T.vat} (${vatRate}%):</span><b>${money(q?.vatAmount, cur, lang)}</b></div>`
      : `<div class="row"><span>${T.vat}:</span><b>${lang === "en" ? "exempt (export)" : "ослободено (извоз)"}</b></div>`}
    <div class="grand"><small>${T.grand}</small><span>${money(q?.totalAmount, cur, lang)}</span></div>
  </div></div>
  <div class="terms"><span class="lbl">${T.terms}</span>
    ${q?.deliveryDays ? `${T.delivery}: <b>${esc(q.deliveryDays)} ${T.days}</b><br>` : ""}
    ${(() => {
      const qs = parseSchedule(q?.paymentSchedule);
      if (qs) return `${T.payment}:<div style="margin:2px 0 4px">${scheduleRows(qs, q?.totalAmount, cur, lang)}</div>`;
      return q?.paymentTerms ? `${T.payment}: <b>${esc(q.paymentTerms)}</b><br>` : "";
    })()}
    ${T.validTxt(dt(q?.validUntil), cur, !!vatRate)}
  </div>
  ${q?.notes ? `<div class="notes"><b>${T.notes}:</b> ${esc(q.notes)}</div>` : ""}
  <div class="sigs"><div class="sig"><div class="line">${T.prepared}</div></div><div class="sig"><div class="line">${T.approved}</div></div></div>
  <div class="foot"><b>${esc(coName)}</b> · ${esc(coAddr)} · ${T.taxId} ${esc(s?.edb ?? "")} · ${T.generated}</div>
<script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`;
  return html;
}

export function printQuotation(q: any, settings: any, lang: DocLang = "mk") {
  openPrint(quotationHtml(q, settings, lang));
}

// ══════════════ ТРЕБОВАЊЕ (врзано со работен налог) ══════════════
export function printRequisition(wo: any, settings: any) {
  const s = settings ?? {};
  const mats: any[] = wo?.materials ?? [];
  const trbNumber = String(wo?.woNumber ?? "").replace(/^РН/, "ТРБ") || "ТРБ";
  const totalKg = mats.reduce((a, m) => a + (Number(m.weightKg ?? 0) || 0), 0);
  const hasKg = totalKg > 0;
  const rows = mats.map((m, i) => `<tr>
    <td class="c">${i + 1}</td><td>${esc(m.materialCode ?? "")}</td><td>${esc(m.materialName ?? "—")}</td>
    <td class="c">${esc(m.materialUnit ?? "")}</td><td class="r"><b>${den(m.quantity)}</b></td>
    ${hasKg ? `<td class="r">${Number(m.weightKg ?? 0) > 0 ? den(m.weightKg) : "—"}</td>` : ""}
    <td class="c" style="width:70px;border-bottom:1px solid #ccc"></td>
    <td style="width:90px"></td></tr>`).join("");

  const body = `
  ${header(s, "ТРЕБОВАЊЕ", trbNumber, `
    Работен налог: <b>${esc(wo?.woNumber ?? "—")}</b><br>
    Нарачка: <b>${esc(wo?.orderNumber ?? "—")}</b><br>
    Датум: <b>${dt(new Date().toISOString())}</b><br>
    Одговорен: <b>${esc(wo?.assignedTo || "—")}</b>`)}
  <div class="box" style="margin-top:12px">
    <b>Опис на налогот:</b> ${esc(wo?.description ?? "—")}<br>
    Со ова требовање се бара издавање на долунаведените материјали од магацин за потребите на работен налог <b>${esc(wo?.woNumber ?? "")}</b>.
  </div>
  <div class="stitle">Материјали за издавање</div>
  <table class="t"><thead><tr>
    <th class="c" style="width:26px">#</th><th style="width:64px">Код</th><th>Материјал</th>
    <th class="c" style="width:40px">ЕМ</th><th class="r" style="width:72px">Побарано</th>
    ${hasKg ? `<th class="r" style="width:64px">Тежина (кг)</th>` : ""}
    <th class="c" style="width:70px">Издадено</th><th style="width:90px">Забелешка</th>
  </tr></thead><tbody>${rows || `<tr><td colspan="${hasKg ? 8 : 7}" class="c" style="padding:12px;color:#999">Нема материјали на налогот — додај ги прво во деталите</td></tr>`}</tbody></table>
  ${hasKg ? `<div class="totals"><div class="row" style="border-top:2px solid var(--dark);font-weight:700;padding-top:6px">
      <span>Вкупна тежина</span><span>${den(totalKg)} кг</span></div></div>` : ""}
  <div class="sigs"><div class="sig"><div class="line">Побарал</div></div><div class="sig"><div class="line">Одобрил</div></div><div class="sig"><div class="line">Издал (магационер)</div></div><div class="sig"><div class="line">Примил</div></div></div>
  ${footer(s)}`;
  openPrint(shell(`Требовање ${trbNumber}`, "#3a72b8", body));
}

// ══════════════ ПРИЕМНИЦА ══════════════
export function printReceipt(rc: any, settings: any) {
  const s = settings ?? {};
  const sup = rc?.supplier ?? {};
  const items: any[] = rc?.items ?? [];
  const rows = items.map((it: any, i: number) => `<tr>
    <td class="c">${i + 1}</td><td>${esc(it.materialName ?? it.description ?? "—")}</td>
    <td class="c">${esc(it.unit ?? "")}</td><td class="r">${den(it.quantity)}</td>
    <td class="r">${den(it.unitPrice)}</td><td class="r"><b>${den(it.totalPrice)}</b></td></tr>`).join("");
  const body = `
  ${header(s, "ПРИЕМНИЦА", rc?.receiptNumber ?? "", `
    Датум: <b>${dt(rc?.receiptDate ?? rc?.createdAt)}</b><br>
    Документ од добавувач: <b>${esc(rc?.supplierDocNumber || "—")}</b>`)}
  <div class="parties">
    <div class="party"><h3>Примач</h3>
      <div class="n">${esc(s?.name ?? "Serafimoski Tech DOOEL")}</div>
      <div>${esc(s?.address ?? "")}</div><div>ЕДБ: ${esc(s?.edb ?? "—")}</div>
    </div>
    <div class="party"><h3>Добавувач</h3>
      <div class="n">${esc(sup.name ?? rc?.supplierName ?? "—")}</div>
      <div>${esc([sup.address, sup.city].filter(Boolean).join(", "))}</div>
      ${sup.phone ? `<div>тел: ${esc(sup.phone)}</div>` : ""}
    </div>
  </div>
  <table class="t"><thead><tr>
    <th class="c" style="width:26px">#</th><th>Материјал</th><th class="c" style="width:42px">ЕМ</th>
    <th class="r" style="width:70px">Кол.</th><th class="r" style="width:80px">Цена</th><th class="r" style="width:88px">Вкупно</th>
  </tr></thead><tbody>${rows || `<tr><td colspan="6" class="c" style="padding:12px;color:#999">Нема ставки</td></tr>`}</tbody></table>
  <div class="totals"><div class="row grand"><span>ВКУПНО:</span><span>${den(rc?.totalAmount)} ден.</span></div></div>
  <div class="sigs"><div class="sig"><div class="line">Примил (магационер)</div></div><div class="sig"><div class="line">Контролирал</div></div><div class="sig"><div class="line">Испорачал</div></div></div>
  ${footer(s)}`;
  openPrint(shell(`Приемница ${rc?.receiptNumber ?? ""}`, "#3a72b8", body));
}

// ══════════════ ИЗВЕШТАЈ ЗА СМЕТКОВОДИТЕЛ ══════════════
export function printAccountantReport(rep: any, period: { startDate: string; endDate: string }, settings: any) {
  const s = settings ?? {};
  const logo = "/logo-black.png?v=1";
  const outItems: any[] = rep?.outgoing?.items ?? [];
  const incItems: any[] = rep?.incoming?.items ?? [];
  const rcList: any[] = rep?.receiptsList ?? [];
  const dnList: any[] = rep?.deliveryNotesList ?? [];
  const woList: any[] = rep?.workOrders ?? [];
  const vatGroups: Record<string, { base: number; vat: number }> = rep?.outgoing?.vatGroups ?? {};
  const vat = rep?.vatRecapitulation ?? {};
  const vatBalance = Number(vat?.vatBalance ?? 0);
  const woCost = woList.reduce((a, w) => a + (parseFloat(String(w.costAmount ?? "0")) || 0), 0);

  const section = (title: string, heads: string[], rows: string, totalRow = "") => `
    <div class="sec">
      <div class="stitle">${title}</div>
      <table class="t"><thead><tr>${heads.map(h => `<th${h.startsWith(">") ? ' class="r"' : ""}>${h.replace(/^>/, "")}</th>`).join("")}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${heads.length}" class="c empty">Нема записи во периодот</td></tr>`}${totalRow}</tbody></table>
    </div>`;

  const out = outItems.map((i, n) => `<tr><td class="c dim">${String(n + 1).padStart(2, "0")}</td><td class="mono">${esc(i.invoiceNumber)}</td><td>${dt(i.issueDate)}</td><td class="r">${den(i.subtotal)}</td><td class="r">${den(i.vatAmount)}</td><td class="r"><b>${den(i.totalAmount)}</b></td></tr>`).join("");
  const outTotal = outItems.length ? `<tr class="sumrow"><td colspan="3">Вкупно излезни (${outItems.length})</td><td class="r">${den(rep?.outgoing?.totalBase)}</td><td class="r">${den(rep?.outgoing?.totalVat)}</td><td class="r">${den(rep?.outgoing?.total)}</td></tr>` : "";

  const inc = incItems.map((i, n) => `<tr><td class="c dim">${String(n + 1).padStart(2, "0")}</td><td class="mono">${esc(i.supplierInvoiceNumber ?? i.invoiceNumber ?? "")}</td><td>${dt(i.receivedDate)}</td><td class="r">${den(i.subtotal)}</td><td class="r">${den(i.vatAmount)}</td><td class="r"><b>${den(i.totalAmount)}</b></td></tr>`).join("");
  const incTotal = incItems.length ? `<tr class="sumrow"><td colspan="3">Вкупно влезни (${incItems.length})</td><td class="r">${den(rep?.incoming?.totalBase)}</td><td class="r">${den(rep?.incoming?.totalVat)}</td><td class="r">${den(rep?.incoming?.total)}</td></tr>` : "";

  const vatRows = Object.entries(vatGroups).map(([rate, g]) => `<tr><td>ДДВ ${esc(rate)}%</td><td class="r">${den(g.base)}</td><td class="r"><b>${den(g.vat)}</b></td></tr>`).join("");

  const rc = rcList.map((r, n) => `<tr><td class="c dim">${String(n + 1).padStart(2, "0")}</td><td class="mono">${esc(r.receiptNumber)}</td><td>${dt(r.receiptDate ?? r.createdAt)}</td><td class="r"><b>${den(r.totalAmount)}</b></td></tr>`).join("");
  const rcTotal = rcList.length ? `<tr class="sumrow"><td colspan="3">Вкупно приемници (${rcList.length})</td><td class="r">${den(rep?.totalReceipts)}</td></tr>` : "";

  const dnr = dnList.map((x, n) => `<tr><td class="c dim">${String(n + 1).padStart(2, "0")}</td><td class="mono">${esc(x.dnNumber)}</td><td>${dt(x.issueDate)}</td><td>${esc(STATUS_MK[x.status] ?? x.status ?? "")}</td></tr>`).join("");

  const wo = woList.map((w, n) => `<tr><td class="c dim">${String(n + 1).padStart(2, "0")}</td><td class="mono">${esc(w.woNumber)}</td><td>${dt(w.createdAt)}</td><td>${esc(w.description ?? "")}</td><td>${esc(STATUS_MK[w.status] ?? w.status ?? "")}</td><td class="r">${den(w.costAmount)}</td></tr>`).join("");
  const woTotal = woList.length ? `<tr class="sumrow"><td colspan="5">Вкупно налози (${woList.length})</td><td class="r">${den(woCost)}</td></tr>` : "";

  const reqList: any[] = rep?.requisitions ?? [];
  const req = reqList.map((r, n) => `<tr><td class="c dim">${String(n + 1).padStart(2, "0")}</td><td class="mono">${esc(r.workOrderNumber)}</td><td>${esc(r.materialName)}</td><td class="r">${esc(r.quantity)} ${esc(r.unit ?? "")}</td><td class="r">${den(r.unitCost)}</td><td class="r"><b>${den(r.totalCost)}</b></td></tr>`).join("");
  const reqTotal = reqList.length ? `<tr class="sumrow"><td colspan="5">Вкупно требовања (${reqList.length})</td><td class="r">${den(rep?.totalRequisitionCost)}</td></tr>` : "";

  const html = `<!doctype html>
<html lang="mk"><head><meta charset="utf-8"><title>Извештај за сметководител</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root { --steel: #6188AF; --ink: #232A32; --mid: #4A5568; --line: #D8DCE1; --soft: #EEF4FB; }
  html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10.5px; color: var(--ink); padding: 11mm 12mm; font-variant-numeric: tabular-nums; }
  @page { size: A4; margin: 0; }
  .lbl { font-size: 8px; text-transform: uppercase; letter-spacing: 2px; color: var(--mid); font-weight: 700; }
  .mono { font-family: 'Consolas', monospace; font-size: 10px; }

  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  .head img { max-width: 290px; max-height: 48px; object-fit: contain; object-position: left; }
  .head .co-sub { font-size: 9px; color: var(--mid); line-height: 1.6; margin-top: 6px; }
  .tag { background: var(--steel); color: #fff; padding: 12px 18px 11px 22px; min-width: 64mm; clip-path: polygon(0 0, 100% 0, 100% 100%, 14px 100%, 0 calc(100% - 14px)); position: relative; }
  .tag::after { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: #C9DDF2; }
  .tag h2 { font-size: 16px; letter-spacing: 4px; font-weight: 800; }
  .tag .sub { font-size: 9.5px; color: #EAF2FA; margin-top: 2px; }
  .tag .meta { font-size: 9.5px; color: #DDE9F4; margin-top: 7px; }
  .tag .meta b { color: #fff; }
  .rule { height: 2px; background: var(--line); margin: 11px 0 13px; position: relative; }
  .rule::before { content: ""; position: absolute; left: 0; top: 0; height: 2px; width: 58mm; background: var(--steel); }

  /* КПИ картички */
  .kpis { display: flex; gap: 8px; }
  .kpi { flex: 1; border: 1px solid var(--line); padding: 8px 11px; background: #FDFDFC; clip-path: polygon(0 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%); }
  .kpi .v { font-size: 13px; font-weight: 800; color: var(--ink); margin-top: 3px; white-space: nowrap; }
  .kpi .n { font-size: 8.5px; color: var(--mid); margin-top: 1px; }
  .kpi.hl { background: var(--steel); border-color: var(--steel); }
  .kpi.hl .lbl, .kpi.hl .n { color: #DDE9F4; }
  .kpi.hl .v { color: #fff; }

  .sec { margin-top: 14px; break-inside: avoid-page; }
  .stitle { font-size: 9px; text-transform: uppercase; letter-spacing: 2.4px; font-weight: 800; color: var(--steel); border-bottom: 2px solid var(--steel); padding-bottom: 3px; margin-bottom: 2px; }
  table.t { width: 100%; border-collapse: collapse; }
  table.t th { font-size: 8px; text-transform: uppercase; letter-spacing: 1.4px; color: var(--mid); text-align: left; padding: 5px 8px 4px; border-bottom: 1px solid var(--line); }
  table.t td { padding: 4.5px 8px; border-bottom: 1px solid #EEF0F3; }
  .c { text-align: center; } .r { text-align: right; white-space: nowrap; }
  th.r { text-align: right; }
  .dim { color: #97A0AA; font-size: 9px; }
  .empty { padding: 10px; color: #999; }
  tr.sumrow td { background: var(--soft); font-weight: 700; border-bottom: 2px solid var(--steel); border-top: 1px solid var(--line); }

  .vatblock { display: flex; justify-content: flex-end; margin-top: 14px; break-inside: avoid-page; }
  .vatplate { width: 78mm; background: var(--steel); color: #fff; padding: 11px 15px; clip-path: polygon(0 0, 100% 0, 100% 100%, 12px 100%, 0 calc(100% - 12px)); border-top: 3px solid #C9DDF2; }
  .vatplate .row { display: flex; justify-content: space-between; font-size: 10px; color: #DDE9F4; padding: 1.5px 0; }
  .vatplate .row b { color: #fff; }
  .vatplate .grand { display: flex; justify-content: space-between; align-items: baseline; margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.35); font-size: 13.5px; font-weight: 800; }
  .vatplate .grand small { font-size: 8.5px; letter-spacing: 2px; color: #E3EDF7; }

  .sigs { display: flex; justify-content: space-between; margin-top: 34px; gap: 26px; }
  .sig { flex: 1; text-align: center; }
  .sig .line { border-top: 1px solid var(--mid); margin-top: 30px; padding-top: 5px; font-size: 9px; text-transform: uppercase; letter-spacing: 2px; color: var(--mid); }
  .foot { margin-top: 16px; background: var(--steel); color: #E3EDF7; font-size: 8.5px; text-align: center; padding: 6px 10px; letter-spacing: .6px; }
  .foot b { color: #fff; }
  @media print { body { padding: 10mm 11mm; } }
</style></head><body>
  <div class="head">
    <div>
      <img src="${esc(logo)}" alt="" onerror="this.style.display='none'">
      <div class="co-sub">${esc(s?.name ?? "Serafimoski Tech DOOEL")}${s?.address ? "<br>" + esc(s.address) : ""}<br>ЕДБ: ${esc(s?.edb ?? "—")} · ЕМБС: ${esc(s?.embs ?? "—")}</div>
    </div>
    <div class="tag">
      <h2>ИЗВЕШТАЈ</h2>
      <div class="sub">за сметководител</div>
      <div class="meta">Период: <b>${dt(period.startDate)} — ${dt(period.endDate)}</b></div>
    </div>
  </div>
  <div class="rule"></div>

  <div class="kpis">
    <div class="kpi"><span class="lbl">Излезни фактури</span><div class="v">${den(rep?.outgoing?.total)} ден.</div><div class="n">${rep?.outgoing?.count ?? 0} документи · ДДВ ${den(rep?.outgoing?.totalVat)}</div></div>
    <div class="kpi"><span class="lbl">Влезни фактури</span><div class="v">${den(rep?.incoming?.total)} ден.</div><div class="n">${rep?.incoming?.count ?? 0} документи · ДДВ ${den(rep?.incoming?.totalVat)}</div></div>
    <div class="kpi"><span class="lbl">Приемници</span><div class="v">${den(rep?.totalReceipts)} ден.</div><div class="n">${rcList.length} документи</div></div>
    <div class="kpi"><span class="lbl">Требовања</span><div class="v">${den(rep?.totalRequisitionCost)} ден.</div><div class="n">${reqList.length} ставки</div></div>
    <div class="kpi hl"><span class="lbl">ДДВ салдо</span><div class="v">${den(Math.abs(vatBalance))} ден.</div><div class="n">${vatBalance >= 0 ? "за уплата" : "ДДВ побарување (за поврат)"}</div></div>
  </div>

  ${section("Излезни фактури", ["#", "Број", "Датум", ">Основица", ">ДДВ", ">Вкупно (ден.)"], out, outTotal)}
  ${vatRows ? section("ДДВ рекапитулација по стапки (излезни)", ["Стапка", ">Основица", ">ДДВ (ден.)"], vatRows) : ""}
  ${section("Влезни фактури", ["#", "Број", "Датум прием", ">Основица", ">ДДВ", ">Вкупно (ден.)"], inc, incTotal)}
  ${section("Приемници", ["#", "Број", "Датум", ">Вкупно (ден.)"], rc, rcTotal)}
  ${section("Испратници", ["#", "Број", "Датум", "Статус"], dnr)}
  ${section("Работни налози", ["#", "Број", "Датум", "Опис", "Статус", ">Трошок (ден.)"], wo, woTotal)}
  ${section("Требовања (потрошен материјал по работни налози)", ["#", "Раб. налог", "Материјал", ">Количина", ">Цена", ">Вкупно (ден.)"], req, reqTotal)}

  <div class="vatblock"><div class="vatplate">
    <div class="row"><span>Излезен ДДВ:</span><b>${den(vat?.outgoingVat)} ден.</b></div>
    <div class="row"><span>Влезен ДДВ (одбивка):</span><b>${den(vat?.incomingVat)} ден.</b></div>
    <div class="grand"><small>${vatBalance >= 0 ? "ДДВ ЗА УПЛАТА" : "ДДВ ЗА ПОВРАТ"}</small><span>${den(Math.abs(vatBalance))} ден.</span></div>
  </div></div>

  <div class="sigs"><div class="sig"><div class="line">Изготвил</div></div><div class="sig"><div class="line">Сметководител</div></div></div>
  <div class="foot"><b>${esc(s?.name ?? "Serafimoski Tech DOOEL")}</b> · ЕДБ ${esc(s?.edb ?? "")} · Извештај генериран од Metal ERP на ${dt(new Date())}</div>
<script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`;
  openPrint(html);
}


// ══════════════ ЕТИКЕТИ ЗА ОСТАТОЦИ (крајки) ══════════════
export async function printRemnantLabels(remnants: any[], settings: any) {
  const list = Array.isArray(remnants) ? remnants : [remnants];
  if (list.length === 0) return;

  // QR води до страницата за скенирање: /o/<код>
  const origin = window.location.origin;
  const qrMap = new Map<string, string>();
  // Се вчитува само при печатење етикети — да не тежи главниот пакет
  const QRCode = (await import("qrcode")).default;
  await Promise.all(
    list.map(async (r) => {
      if (!r?.code) return;
      try {
        const url = `${origin}/o/${encodeURIComponent(r.code)}`;
        const dataUrl = await QRCode.toDataURL(url, {
          errorCorrectionLevel: "M",
          margin: 0,
          width: 220,
          color: { dark: "#16112b", light: "#ffffff" },
        });
        qrMap.set(r.code, dataUrl);
      } catch {
        /* без QR — етикетата сепак се печати */
      }
    })
  );

  const totalKg = list.reduce((a, r) => a + (Number(r.weightKg ?? 0) || 0), 0);
  const cards = list
    .map((r) => {
      const lenM = (Number(r.lengthMm ?? 0) / 1000).toFixed(3);
      const qr = qrMap.get(r.code);
      return `<div class="lbl">
        <div class="lbl-top">
          <span class="lbl-co">${esc(settings?.name ?? "Serafimoski Tech")}</span>
          <span class="lbl-date">${dt(r.createdAt)}</span>
        </div>
        <div class="lbl-body">
          <div class="lbl-left">
            <div class="lbl-code">${esc(r.code)}</div>
            <div class="lbl-mat">${esc(r.materialName ?? "")}</div>
            <div class="lbl-sub">${esc(r.materialCode ?? "")}</div>
            <div class="lbl-len">${esc(Number(r.lengthMm ?? 0).toFixed(0))} <small>mm</small></div>
            <div class="lbl-sub">${lenM} m${(r.quantity ?? 1) > 1 ? ` · ${r.quantity} ком` : ""}${
              Number(r.weightKg ?? 0) > 0 ? ` · <b>${Number(r.weightKg).toFixed(1)} кг</b>` : ""
            }</div>
          </div>
          ${qr ? `<div class="lbl-qr"><img src="${qr}"><span>скенирај</span></div>` : ""}
        </div>
        <div class="lbl-foot">${r.location ? "📍 " + esc(r.location) : "&nbsp;"}</div>
      </div>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="mk"><head><meta charset="utf-8"><title>Етикети — остатоци</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  @page { size: A4; margin: 8mm; }
  body { font-family:'Segoe UI', Arial, sans-serif; color:#16112b; padding:8mm; }
  h1 { font-size:13px; margin-bottom:6mm; color:#b45309; letter-spacing:.5px; text-transform:uppercase; }
  .sheet { display:grid; grid-template-columns:repeat(3, 1fr); gap:4mm; }
  .lbl { border:1.5px solid #16112b; border-radius:4px; padding:3.5mm; height:42mm;
         display:flex; flex-direction:column; page-break-inside:avoid; }
  .lbl-body { display:flex; gap:2.5mm; flex:1; min-height:0; }
  .lbl-left { flex:1; display:flex; flex-direction:column; min-width:0; }
  .lbl-qr { width:17mm; display:flex; flex-direction:column; align-items:center; justify-content:flex-start; padding-top:1.5mm; }
  .lbl-qr img { width:17mm; height:17mm; display:block; }
  .lbl-qr span { font-size:6px; color:#999; letter-spacing:.3px; margin-top:.8mm; text-transform:uppercase; }
  .lbl-top { display:flex; justify-content:space-between; font-size:7px; color:#888; border-bottom:1px solid #eee; padding-bottom:1.5mm; }
  .lbl-co { font-weight:700; letter-spacing:.3px; }
  .lbl-code { font-size:17px; font-weight:800; letter-spacing:.5px; margin-top:2mm; color:#b45309; font-family:'Consolas', monospace; }
  .lbl-mat { font-size:9.5px; font-weight:600; margin-top:1.5mm; line-height:1.25; overflow:hidden; }
  .lbl-sub { font-size:7.5px; color:#777; }
  .lbl-len { font-size:20px; font-weight:800; margin-top:auto; line-height:1; }
  .lbl-len small { font-size:10px; font-weight:600; color:#777; }
  .lbl-foot { font-size:7.5px; color:#555; margin-top:1.5mm; border-top:1px dotted #ddd; padding-top:1.5mm; }
  @media print { body { padding:0; } }
</style></head><body>
  <h1>Етикети за остатоци · ${list.length} ${list.length === 1 ? "парче" : "парчиња"}${
    totalKg > 0 ? ` · вкупно ${totalKg.toFixed(1)} кг` : ""
  }</h1>
  <div class="sheet">${cards}</div>
<script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`;

  openPrint(html);
}

// ══════════════ ИЗЈАВА ЗА ВГРАДЕНИ МАТЕРИЈАЛИ (АТЕСТИ) ══════════════
export function printCertificateStatement(dn: any, certs: any[], settings: any) {
  const list = Array.isArray(certs) ? certs : [];
  const rows = list.map((c, i) => `<tr>
    <td class="c">${i + 1}</td>
    <td>${esc(c.materialName ?? "—")}</td>
    <td class="c"><b>${esc(c.heatNumber ?? "—")}</b></td>
    <td class="c">${esc(c.certNumber ?? "—")}</td>
    <td class="c">${esc(c.certStandard ?? "—")}</td>
    <td class="r">${Number(c.quantity ?? 0) > 0 ? den(c.quantity) : "—"}</td>
    <td>${esc(c.supplierName ?? "—")}</td>
  </tr>`).join("");

  const html = `<!doctype html>
<html lang="mk"><head><meta charset="utf-8"><title>Изјава за вградени материјали ${esc(dn?.dnNumber ?? "")}</title>
<style>
  :root { --steel: #6188AF; --dark: #16112b; }
  * { margin:0; padding:0; box-sizing:border-box; }
  @page { size: A4; margin: 14mm; }
  body { font-family:'Segoe UI', Arial, sans-serif; color:var(--dark); font-size:11px; line-height:1.45; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid var(--steel); padding-bottom:8px; }
  .co { font-size:15px; font-weight:800; letter-spacing:.3px; }
  .co small { display:block; font-weight:400; font-size:9px; color:#666; margin-top:2px; line-height:1.4; }
  .logo { height:34px; }
  h1 { font-size:15px; margin:14px 0 3px; text-transform:uppercase; letter-spacing:.6px; }
  .sub { font-size:10px; color:#666; margin-bottom:12px; }
  .meta { display:flex; gap:22px; font-size:10px; margin-bottom:12px; padding:7px 10px; background:#F4F7FA; border-left:3px solid var(--steel); }
  .meta b { display:block; font-size:11px; }
  .meta span { color:#777; text-transform:uppercase; font-size:8px; letter-spacing:.4px; }
  table { width:100%; border-collapse:collapse; margin-bottom:14px; }
  th { background:var(--dark); color:#fff; font-size:8.5px; text-transform:uppercase; letter-spacing:.4px; padding:6px 5px; text-align:left; }
  td { padding:5px; border-bottom:1px solid #E4E9EE; font-size:10px; }
  tr:nth-child(even) td { background:#FAFBFC; }
  .c { text-align:center; } .r { text-align:right; }
  .stmt { border:1.5px solid var(--dark); padding:10px 12px; font-size:10px; margin-bottom:16px; }
  .stmt b { display:block; margin-bottom:4px; font-size:10.5px; }
  .sigs { display:flex; justify-content:space-between; margin-top:26px; font-size:9px; }
  .sig { width:44%; text-align:center; }
  .sig .line { border-top:1px solid #999; margin-bottom:3px; height:34px; }
  .foot { margin-top:18px; border-top:1px solid #E4E9EE; padding-top:5px; font-size:8px; color:#999; text-align:center; }
</style></head><body>
  <div class="head">
    <div class="co">${esc(settings?.name ?? "Serafimoski Tech DOOEL")}
      <small>${esc(settings?.address ?? "")}${settings?.city ? ", " + esc(settings.city) : ""}<br>
      ЕДБ ${esc(settings?.edb ?? "—")}${settings?.phone ? " · тел. " + esc(settings.phone) : ""}</small>
    </div>
    <img class="logo" src="${esc(settings?.logoUrl || "/logo-black.png?v=1")}">
  </div>

  <h1>Изјава за вградени материјали</h1>
  <div class="sub">Следливост на материјалот согласно EN 10204 · тип 3.1</div>

  <div class="meta">
    <div><span>Испратница</span><b>${esc(dn?.dnNumber ?? "—")}</b></div>
    <div><span>Датум</span><b>${dt(dn?.dnDate ?? dn?.createdAt)}</b></div>
    <div><span>Купувач</span><b>${esc(dn?.customerName ?? "—")}</b></div>
    <div><span>Позиции</span><b>${list.length}</b></div>
  </div>

  <table><thead><tr>
    <th class="c" style="width:24px">#</th><th>Материјал</th>
    <th class="c" style="width:70px">Шаржа</th><th class="c" style="width:82px">Атест бр.</th>
    <th class="c" style="width:82px">Квалитет</th><th class="r" style="width:60px">Количина</th>
    <th style="width:92px">Добавувач</th>
  </tr></thead><tbody>
    ${rows || `<tr><td colspan="7" class="c" style="padding:16px;color:#999">Нема внесени шаржи за оваа испорака</td></tr>`}
  </tbody></table>

  <div class="stmt">
    <b>Изјавуваме под целосна одговорност:</b>
    Материјалите наведени во оваа изјава се вградени во производите испорачани со горенаведената
    испратница. За секоја наведена шаржа поседуваме оригинален испитен извештај (атест) издаден од
    производителот на челикот, кој е достапен на увид по барање на Инвеститорот или надзорниот орган.
    Материјалите одговараат на наведениот квалитет и стандард.
  </div>

  <div class="sigs">
    <div class="sig"><div class="line"></div>Одговорно лице · ${esc(settings?.name ?? "")}</div>
    <div class="sig"><div class="line"></div>Примил / Надзор</div>
  </div>

  <div class="foot">Документот е генериран од ERP системот на ${esc(settings?.name ?? "")} · ${dt(new Date())}</div>
<script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`;

  openPrint(html);
}


// ══════════════ PDF ВО ПРЕЛИСТУВАЧОТ (за праќање по е-пошта) ══════════════
/** Го исцртува HTML документот во скриен A4 iframe и враќа PDF како base64 (без префикс). */
export async function htmlToPdfBase64(html: string): Promise<string> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;";
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(html.replace(/<script>[\s\S]*?<\/script>/g, ""));
    doc.close();
    await new Promise<void>((res) => {
      const imgs = Array.from(doc.images);
      if (!imgs.length) return setTimeout(res, 150);
      let left = imgs.length;
      const done = () => { if (--left <= 0) setTimeout(res, 100); };
      imgs.forEach((im) => (im.complete ? done() : (im.onload = im.onerror = done)));
      setTimeout(res, 3000);
    });
    const body = doc.body;
    const canvas = await html2canvas(body, { scale: 2, useCORS: true, backgroundColor: "#ffffff", windowWidth: 794, width: 794, height: body.scrollHeight });
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = 210, pageH = 297;
    const imgH = (canvas.height * pageW) / canvas.width;
    const img = canvas.toDataURL("image/jpeg", 0.92);
    let y = 0;
    pdf.addImage(img, "JPEG", 0, y, pageW, imgH);
    let left = imgH - pageH;
    while (left > 1) {
      y -= pageH;
      pdf.addPage();
      pdf.addImage(img, "JPEG", 0, y, pageW, imgH);
      left -= pageH;
    }
    return pdf.output("datauristring").split(",")[1];
  } finally {
    frame.remove();
  }
}

// ══════════════ НАБАВНА НАРАЧКА (до добавувач) ══════════════
const PO_UNIT: Record<string, { mk: string; en: string }> = {
  kg: { mk: "кг", en: "kg" }, m: { mk: "м", en: "m" }, m2: { mk: "м²", en: "m²" }, pcs: { mk: "ком", en: "pcs" },
  l: { mk: "л", en: "l" }, sheet: { mk: "табла", en: "sheet" }, hour: { mk: "ч", en: "h" }, m_cut: { mk: "м", en: "m" }, bend: { mk: "свив.", en: "bend" },
};
const PO_T = {
  mk: { title: "НАБАВНА НАРАЧКА", date: "Датум", expected: "Рок за испорака", buyer: "Нарачател", supplier: "Добавувач", mat: "Материјал / опис",
    unit: "ЕМ", qty: "Кол.", price: "Цена", total: "Вкупно", net: "Износ без ДДВ", vat: "ДДВ 18%", grand: "ВКУПНО СО ДДВ", notes: "Напомена",
    terms: "Ве молиме потврдете ја нарачката и рокот за испорака. На фактурата наведете го бројот на нарачката.", sigBuyer: "Нарачал", sigSup: "Потврдил (добавувач)", cur: "ден.", tax: "ЕДБ", tel: "тел" },
  en: { title: "PURCHASE ORDER", date: "Date", expected: "Delivery by", buyer: "Buyer", supplier: "Supplier", mat: "Material / description",
    unit: "Unit", qty: "Qty", price: "Price", total: "Amount", net: "Net amount", vat: "VAT 18%", grand: "TOTAL INCL. VAT", notes: "Notes",
    terms: "Please confirm this order and the delivery date. Quote the order number on your invoice.", sigBuyer: "Ordered by", sigSup: "Confirmed (supplier)", cur: "MKD", tax: "Tax ID", tel: "tel" },
};

export function purchaseOrderHtml(po: any, settings: any, lang: DocLang = "mk"): string {
  const s = settings ?? {};
  const t = PO_T[lang];
  const sup = po?.supplier ?? {};
  const items: any[] = po?.items ?? [];
  const net = items.reduce((a, it) => a + Number(it.totalPrice ?? 0), 0) || Number(po?.totalAmount ?? 0);
  const rows = items.map((it: any, i: number) => {
    const u = PO_UNIT[it.materialUnit]?.[lang] ?? esc(it.materialUnit ?? "");
    const desc = it.description && it.description !== it.materialName ? `<div style="color:#666;font-size:10px">${esc(it.description)}</div>` : "";
    return `<tr>
      <td class="c">${i + 1}</td>
      <td><b>${esc(it.materialName ?? it.description ?? "—")}</b>${it.materialCode ? ` <span style="color:#999;font-size:9.5px">${esc(it.materialCode)}</span>` : ""}${desc}</td>
      <td class="c">${u}</td><td class="r">${Number(it.quantity ?? 0).toLocaleString("mk-MK", { maximumFractionDigits: 3 })}</td>
      <td class="r">${den(it.unitPrice)}</td><td class="r"><b>${den(it.totalPrice)}</b></td></tr>`;
  }).join("");
  const body = `
  ${header(s, t.title, po?.poNumber ?? "", `
    ${t.date}: <b>${dt(po?.createdAt)}</b><br>
    ${po?.expectedDate ? `${t.expected}: <b>${dt(po.expectedDate)}</b>` : ""}`)}
  <div class="parties">
    <div class="party"><h3>${t.buyer}</h3>
      <div class="n">${esc(s?.name ?? "Serafimoski Tech DOOEL")}</div>
      <div>${esc(s?.address ?? "")}</div><div>${t.tax}: ${esc(s?.edb ?? "—")}</div>
      ${s?.phone ? `<div>${t.tel}: ${esc(s.phone)}</div>` : ""}${s?.email ? `<div>${esc(s.email)}</div>` : ""}
    </div>
    <div class="party"><h3>${t.supplier}</h3>
      <div class="n">${esc(sup.name ?? "—")}</div>
      <div>${esc([sup.address, sup.city, sup.country].filter(Boolean).join(", "))}</div>
      ${sup.edb ? `<div>${t.tax}: ${esc(sup.edb)}</div>` : ""}
      ${sup.contactPerson ? `<div>${esc(sup.contactPerson)}</div>` : ""}
      ${sup.phone ? `<div>${t.tel}: ${esc(sup.phone)}</div>` : ""}${sup.email ? `<div>${esc(sup.email)}</div>` : ""}
    </div>
  </div>
  <table class="t"><thead><tr>
    <th class="c" style="width:26px">#</th><th>${t.mat}</th><th class="c" style="width:44px">${t.unit}</th>
    <th class="r" style="width:70px">${t.qty}</th><th class="r" style="width:80px">${t.price}</th><th class="r" style="width:92px">${t.total}</th>
  </tr></thead><tbody>${rows || `<tr><td colspan="6" class="c" style="padding:12px;color:#999">—</td></tr>`}</tbody></table>
  <div class="totals">
    <div class="row"><span>${t.net}</span><span>${den(net)} ${t.cur}</span></div>
    <div class="row"><span>${t.vat}</span><span>${den(net * 0.18)} ${t.cur}</span></div>
    <div class="row grand"><span>${t.grand}</span><span>${den(net * 1.18)} ${t.cur}</span></div>
  </div>
  ${po?.notes ? `<div class="box"><b>${t.notes}:</b> ${esc(po.notes)}</div>` : ""}
  <div class="notes">${t.terms}</div>
  <div class="sigs"><div class="sig"><div class="line">${t.sigBuyer}</div></div><div class="sig"><div class="line">${t.sigSup}</div></div></div>
  ${footer(s)}`;
  return shell(`${lang === "en" ? "Purchase order" : "Набавна нарачка"} ${po?.poNumber ?? ""}`, "#3a72b8", body);
}

export function printPurchaseOrder(po: any, settings: any, lang: DocLang = "mk") {
  openPrint(purchaseOrderHtml(po, settings, lang));
}
