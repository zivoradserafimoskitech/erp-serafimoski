// Печатливи документи — A4, кирилица нативно, browser print → PDF
// Заедничка визуелна рамка: фактура, работен налог, испратница

type Money = string | number | null | undefined;

const den = (v: Money) => Number(v ?? 0).toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dt = (s: any) => { if (!s) return "—"; const d = new Date(s); return isNaN(d.getTime()) ? esc(s) : d.toLocaleDateString("mk-MK"); };

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
  .co img { height: 44px; max-width: 210px; object-fit: contain; }
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
  const logo = s?.logoUrl || "/logo.png";
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

// ══════════════ ФАКТУРА ══════════════
export function printInvoice(inv: any, settings: any) {
  const docTitle = String(inv?.invoiceType ?? "").includes("proforma") ? "ПРО-ФАКТУРА" : "ФАКТУРА";
  const c = inv?.customer ?? {};
  const s = settings ?? {};
  const items: any[] = inv?.items ?? [];
  const vatRate = Number(inv?.vatRate ?? s?.defaultVatRate ?? 18);
  const rows = items.map((it, i) => `<tr>
      <td class="c">${i + 1}</td><td>${esc(it.description)}</td><td class="c">${esc(it.unit ?? "")}</td>
      <td class="r">${den(it.quantity)}</td><td class="r">${den(it.unitPrice)}</td>
      <td class="r">${it.discount && Number(it.discount) > 0 ? den(it.discount) + "%" : "—"}</td>
      <td class="r"><b>${den(it.totalPrice)}</b></td></tr>`).join("");

  const body = `
  ${header(s, docTitle, "бр. " + (inv?.invoiceNumber ?? ""), `
    Датум на издавање: <b>${dt(inv?.issueDate)}</b><br>
    Рок за плаќање: <b>${dt(inv?.dueDate)}</b><br>
    Валута: ${esc(inv?.currency ?? "MKD")}`)}
  <div class="parties">
    <div class="party"><h3>Издавач</h3>
      <div class="n">${esc(s?.name ?? "Serafimoski Tech DOOEL")}</div>
      <div>${esc(s?.address ?? "")}</div>
      <div>ЕДБ: ${esc(s?.edb ?? "—")}</div>
      <div>Ж-ска: ${esc(s?.bankAccount ?? "—")}${s?.bankName ? " · " + esc(s.bankName) : ""}</div>
    </div>
    <div class="party"><h3>Примач</h3>
      <div class="n">${esc(c.company || c.name || "—")}</div>
      ${c.company && c.name ? `<div>${esc(c.name)}</div>` : ""}
      <div>${esc([c.address, c.city].filter(Boolean).join(", "))}</div>
      ${c.edb || c.taxNumber ? `<div>ЕДБ: ${esc(c.edb || c.taxNumber)}</div>` : ""}
      ${c.phone ? `<div>тел: ${esc(c.phone)}</div>` : ""}
    </div>
  </div>
  <table class="t"><thead><tr>
    <th class="c" style="width:26px">#</th><th>Опис</th><th class="c" style="width:42px">ЕМ</th>
    <th class="r" style="width:58px">Кол.</th><th class="r" style="width:76px">Цена (ден.)</th>
    <th class="r" style="width:52px">Попуст</th><th class="r" style="width:88px">Вкупно (ден.)</th>
  </tr></thead><tbody>${rows || `<tr><td colspan="7" class="c" style="padding:14px;color:#999">Нема ставки</td></tr>`}</tbody></table>
  <div class="totals">
    <div class="row"><span>Основица:</span><b>${den(inv?.subtotal)} ден.</b></div>
    <div class="row"><span>ДДВ (${vatRate}%):</span><b>${den(inv?.vatAmount)} ден.</b></div>
    <div class="row grand"><span>ЗА ПЛАЌАЊЕ:</span><span>${den(inv?.totalAmount)} ден.</span></div>
  </div>
  <div class="box"><b>Податоци за плаќање</b><br>
    Жиро сметка: <b>${esc(s?.bankAccount ?? "—")}</b>${s?.bankName ? " · " + esc(s.bankName) : ""}<br>
    Повикување на број: <b>${esc(inv?.invoiceNumber)}</b> · Рок: ${dt(inv?.dueDate)}
  </div>
  ${inv?.notes ? `<div class="notes"><b>Забелешка:</b> ${esc(inv.notes)}</div>` : ""}
  <div class="sigs"><div class="sig"><div class="line">Изготвил</div></div><div class="sig"><div class="line">Одобрил</div></div><div class="sig"><div class="line">Примил</div></div></div>
  ${footer(s)}`;
  openPrint(shell(`${docTitle} ${inv?.invoiceNumber ?? ""}`, "#3a72b8", body));
}

// ══════════════ РАБОТЕН НАЛОГ ══════════════
export function printWorkOrder(wo: any, settings: any) {
  const s = settings ?? {};
  const mats: any[] = wo?.materials ?? [];
  const ops: any[] = wo?.operations ?? [];

  const matRows = mats.map((m, i) => `<tr>
    <td class="c">${i + 1}</td><td>${esc(m.materialCode ?? "")}</td><td>${esc(m.materialName ?? "—")}</td>
    <td class="c">${esc(m.materialUnit ?? "")}</td><td class="r">${den(m.quantity)}</td>
    <td class="c">${m.isActual ? "Реално" : "Планирано"}</td></tr>`).join("");

  const opRows = ops.map((o) => `<tr>
    <td class="c">${o.sequence ?? ""}</td><td>${esc(OP_MK[o.operation] ?? o.operation)}</td>
    <td>${esc(o.description ?? "")}</td><td class="c">${o.estimatedTime ? esc(o.estimatedTime) + " мин" : "—"}</td>
    <td>${esc(o.operator ?? "")}</td><td class="c" style="width:52px">☐</td></tr>`).join("");

  const body = `
  ${header(s, "РАБОТЕН НАЛОГ", wo?.woNumber ?? "", `
    Статус: <span class="badge">${esc(STATUS_MK[wo?.status] ?? wo?.status ?? "")}</span><br>
    Приоритет: <b>${esc(PRIORITY_MK[wo?.priority] ?? wo?.priority ?? "—")}</b>`)}
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
    <th class="c" style="width:40px">ЕМ</th><th class="r" style="width:70px">Количина</th><th class="c" style="width:70px">Тип</th>
  </tr></thead><tbody>${matRows || `<tr><td colspan="6" class="c" style="padding:12px;color:#999">Нема материјали</td></tr>`}</tbody></table>
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
  const rows = items.map((it, i) => `<tr>
    <td class="c">${i + 1}</td><td>${esc(it.description)}</td>
    <td class="c">${esc(it.unit ?? "")}</td><td class="r"><b>${den(it.quantity)}</b></td>
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
    <th class="c" style="width:44px">ЕМ</th><th class="r" style="width:76px">Количина</th><th style="width:120px">Забелешка</th>
  </tr></thead><tbody>${rows || `<tr><td colspan="5" class="c" style="padding:14px;color:#999">Нема ставки</td></tr>`}</tbody></table>
  <div class="box">Стоката е испорачана комплетна и неоштетена. Примачот со потпис ја потврдува испораката.${dn?.notes ? "<br><b>Забелешка:</b> " + esc(dn.notes) : ""}</div>
  <div class="sigs"><div class="sig"><div class="line">Издал</div></div><div class="sig"><div class="line">Превезол</div></div><div class="sig"><div class="line">Примил (потпис и печат)</div></div></div>
  ${footer(s)}`;
  openPrint(shell(`Испратница ${dn?.dnNumber ?? ""}`, "#3a72b8", body));
}

// ══════════════ ПОНУДА (премиум шаблон — челик + килибар) ══════════════
export function printQuotation(q: any, settings: any) {
  const s = settings ?? {};
  const c = q?.customer ?? {};
  const items: any[] = q?.items ?? [];
  const vatRate = Number(q?.vatRate ?? s?.defaultVatRate ?? 18);
  const logo = s?.logoUrl || "/logo.png";
  const rows = items.map((it, i) => `<tr>
    <td class="c dim">${String(i + 1).padStart(2, "0")}</td><td class="desc">${esc(it.description)}</td><td class="c dim">${esc(it.unit ?? "")}</td>
    <td class="r">${den(it.quantity)}</td><td class="r">${den(it.unitPrice)}</td>
    <td class="r"><b>${den(it.totalPrice)}</b></td></tr>`).join("");

  const html = `<!doctype html>
<html lang="mk"><head><meta charset="utf-8"><title>Понуда ${esc(q?.quoteNumber ?? "")}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root { --steel: #1B2733; --steel-mid: #43546A; --steel-line: #D8DCE1; --amber: #DE7514; --amber-soft: #FBF3E9; --paper: #F5F3EF; }
  html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #232A32; padding: 12mm 13mm; font-variant-numeric: tabular-nums; }
  @page { size: A4; margin: 0; }
  .lbl { font-size: 8px; text-transform: uppercase; letter-spacing: 2px; color: var(--steel-mid); font-weight: 700; }

  /* Заглавие: лого лево, челичен таг со засечен агол десно */
  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  .head img { height: 52px; max-width: 250px; object-fit: contain; }
  .head .co-sub { font-size: 9px; color: var(--steel-mid); line-height: 1.6; margin-top: 6px; }
  .tag { background: var(--steel); color: #fff; padding: 13px 18px 12px 22px; min-width: 62mm; clip-path: polygon(0 0, 100% 0, 100% 100%, 14px 100%, 0 calc(100% - 14px)); position: relative; }
  .tag::after { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--amber); }
  .tag h2 { font-size: 19px; letter-spacing: 5px; font-weight: 800; }
  .tag .num { font-size: 14px; font-weight: 700; color: #F5A353; margin-top: 2px; letter-spacing: 1px; }
  .tag .meta { font-size: 9.5px; color: #B9C2CD; margin-top: 8px; line-height: 1.7; }
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
  .sum .grand { margin-top: 6px; background: var(--steel); color: #fff; font-weight: 800; font-size: 14px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: baseline; clip-path: polygon(0 0, 100% 0, 100% 100%, 12px 100%, 0 calc(100% - 12px)); border-top: 3px solid var(--amber); }
  .sum .grand small { font-size: 9px; letter-spacing: 2px; color: #B9C2CD; font-weight: 700; }

  .terms { margin-top: 16px; background: var(--amber-soft); border-left: 3px solid var(--amber); padding: 10px 14px; font-size: 10.5px; line-height: 1.75; }
  .terms .lbl { color: var(--amber); margin-bottom: 3px; display: block; }
  .terms b { color: var(--steel); }
  .notes { margin-top: 10px; font-size: 10px; color: #5A646E; line-height: 1.6; }

  .sigs { display: flex; justify-content: space-between; margin-top: 40px; gap: 26px; }
  .sig { flex: 1; text-align: center; }
  .sig .line { border-top: 1px solid var(--steel-mid); margin-top: 34px; padding-top: 5px; font-size: 9px; text-transform: uppercase; letter-spacing: 2px; color: var(--steel-mid); }

  .foot { margin-top: 18px; background: var(--steel); color: #B9C2CD; font-size: 8.5px; text-align: center; padding: 7px 10px; letter-spacing: .6px; clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%); }
  .foot b { color: #fff; }
  @media print { body { padding: 11mm 12mm; } }
</style></head><body>
  <div class="head">
    <div>
      <img src="${esc(logo)}" alt="" onerror="this.style.display='none'">
      <div class="co-sub">
        ${esc(s?.address ?? "")}${s?.address ? "<br>" : ""}
        ЕДБ: ${esc(s?.edb ?? "—")} · ЕМБС: ${esc(s?.embs ?? "—")}${s?.phone ? " · тел: " + esc(s.phone) : ""}${s?.email ? "<br>" + esc(s.email) : ""}
      </div>
    </div>
    <div class="tag">
      <h2>ПОНУДА</h2>
      <div class="num">${esc(q?.quoteNumber ?? "")}</div>
      <div class="meta">Датум: <b>${dt(q?.createdAt)}</b><br>Важи до: <b>${dt(q?.validUntil)}</b> · Валута: <b>${esc(q?.currency ?? "MKD")}</b></div>
    </div>
  </div>
  <div class="rule"></div>
  <div class="parties">
    <div class="party"><span class="lbl">Понудувач</span>
      <div class="n">${esc(s?.name ?? "Serafimoski Tech DOOEL")}</div>
      <div>${esc(s?.address ?? "")}</div>
      <div>ЕДБ: ${esc(s?.edb ?? "—")}</div>
      ${s?.phone ? `<div>тел: ${esc(s.phone)}</div>` : ""}
    </div>
    <div class="party"><span class="lbl">За клиент</span>
      <div class="n">${esc(c.company || c.name || "—")}</div>
      ${c.company && c.name ? `<div>${esc(c.name)}</div>` : ""}
      <div>${esc([c.address, c.city].filter(Boolean).join(", "))}</div>
      ${c.phone ? `<div>тел: ${esc(c.phone)}</div>` : ""}
    </div>
  </div>
  <table class="t"><thead><tr>
    <th class="c" style="width:28px">#</th><th>Опис</th><th class="c" style="width:44px">ЕМ</th>
    <th class="r" style="width:62px">Кол.</th><th class="r" style="width:82px">Цена (ден.)</th>
    <th class="r" style="width:92px">Вкупно (ден.)</th>
  </tr></thead><tbody>${rows || `<tr><td colspan="6" class="c" style="padding:16px;color:#999">Нема ставки</td></tr>`}</tbody></table>
  <div class="sum-wrap"><div class="sum">
    <div class="row"><span>Основица:</span><b>${den(q?.subtotal)} ден.</b></div>
    <div class="row"><span>ДДВ (${vatRate}%):</span><b>${den(q?.vatAmount)} ден.</b></div>
    <div class="grand"><small>ВКУПНО</small><span>${den(q?.totalAmount)} ден.</span></div>
  </div></div>
  <div class="terms"><span class="lbl">Услови</span>
    ${q?.deliveryDays ? `Рок на испорака: <b>${esc(q.deliveryDays)} дена</b><br>` : ""}
    ${q?.paymentTerms ? `Плаќање: <b>${esc(q.paymentTerms)}</b><br>` : ""}
    Понудата важи до <b>${dt(q?.validUntil)}</b>. Цените се изразени во денари${vatRate ? " со пресметан ДДВ во рекапитулацијата" : ""}.
  </div>
  ${q?.notes ? `<div class="notes"><b>Забелешка:</b> ${esc(q.notes)}</div>` : ""}
  <div class="sigs"><div class="sig"><div class="line">Изготвил</div></div><div class="sig"><div class="line">Одобрил</div></div></div>
  <div class="foot"><b>${esc(s?.name ?? "Serafimoski Tech DOOEL")}</b> · ${esc(s?.address ?? "")} · ЕДБ ${esc(s?.edb ?? "")} · Генерирано од Metal ERP</div>
<script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`;
  openPrint(html);
}

// ══════════════ ТРЕБОВАЊЕ (врзано со работен налог) ══════════════
export function printRequisition(wo: any, settings: any) {
  const s = settings ?? {};
  const mats: any[] = wo?.materials ?? [];
  const trbNumber = String(wo?.woNumber ?? "").replace(/^РН/, "ТРБ") || "ТРБ";
  const rows = mats.map((m, i) => `<tr>
    <td class="c">${i + 1}</td><td>${esc(m.materialCode ?? "")}</td><td>${esc(m.materialName ?? "—")}</td>
    <td class="c">${esc(m.materialUnit ?? "")}</td><td class="r"><b>${den(m.quantity)}</b></td>
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
    <th class="c" style="width:70px">Издадено</th><th style="width:90px">Забелешка</th>
  </tr></thead><tbody>${rows || `<tr><td colspan="7" class="c" style="padding:12px;color:#999">Нема материјали на налогот — додај ги прво во деталите</td></tr>`}</tbody></table>
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
  const sec = (title: string, heads: string[], rows: string) => `
    <div class="stitle">${title}</div>
    <table class="t"><thead><tr>${heads.map(h => `<th${h.startsWith(">") ? ' class=\"r\"' : ""}>${h.replace(/^>/, "")}</th>`).join("")}</tr></thead>
    <tbody>${rows || `<tr><td colspan="${heads.length}" class="c" style="padding:8px;color:#999">Нема записи</td></tr>`}</tbody></table>`;
  const out = (rep?.outgoing ?? []).map((i: any) => `<tr><td>${esc(i.invoiceNumber)}</td><td>${dt(i.issueDate)}</td><td class="r">${den(i.subtotal)}</td><td class="r">${den(i.vatAmount)}</td><td class="r"><b>${den(i.totalAmount)}</b></td></tr>`).join("");
  const inc = (rep?.incoming ?? []).map((i: any) => `<tr><td>${esc(i.invoiceNumber ?? i.documentNumber ?? "")}</td><td>${dt(i.receivedDate)}</td><td>${esc(i.supplierName ?? "")}</td><td class="r"><b>${den(i.totalAmount)}</b></td></tr>`).join("");
  const rc = (rep?.receiptsList ?? []).map((r: any) => `<tr><td>${esc(r.receiptNumber)}</td><td>${dt(r.receiptDate ?? r.createdAt)}</td><td class="r"><b>${den(r.totalAmount)}</b></td></tr>`).join("");
  const dnr = (rep?.deliveryNotesList ?? []).map((x: any) => `<tr><td>${esc(x.dnNumber)}</td><td>${dt(x.issueDate)}</td><td>${esc(STATUS_MK[x.status] ?? x.status ?? "")}</td></tr>`).join("");
  const wo = (rep?.workOrders ?? []).map((w: any) => `<tr><td>${esc(w.woNumber)}</td><td>${dt(w.createdAt)}</td><td>${esc(w.description ?? "")}</td><td>${esc(STATUS_MK[w.status] ?? w.status ?? "")}</td><td class="r">${den(w.costAmount)}</td></tr>`).join("");
  const vatBalance = Number(rep?.totalOutgoingVat ?? 0) - Number(rep?.totalIncomingVat ?? 0);
  const body = `
  ${header(s, "ИЗВЕШТАЈ", "за сметководител", `Период: <b>${dt(period.startDate)} — ${dt(period.endDate)}</b>`)}
  ${sec("Излезни фактури", ["Број", "Датум", ">Основица", ">ДДВ", ">Вкупно"], out)}
  ${sec("Влезни фактури", ["Број", "Датум", "Добавувач", ">Вкупно"], inc)}
  ${sec("Приемници", ["Број", "Датум", ">Вкупно"], rc)}
  ${sec("Испратници", ["Број", "Датум", "Статус"], dnr)}
  ${sec("Работни налози (со требовања)", ["Број", "Датум", "Опис", "Статус", ">Трошок"], wo)}
  <div class="totals" style="width:80mm">
    <div class="row"><span>Излезни — основица:</span><b>${den(rep?.totalOutgoingBase)} ден.</b></div>
    <div class="row"><span>Излезни — ДДВ:</span><b>${den(rep?.totalOutgoingVat)} ден.</b></div>
    <div class="row"><span>Влезни — вкупно:</span><b>${den(rep?.totalIncoming)} ден.</b></div>
    <div class="row"><span>Влезни — ДДВ:</span><b>${den(rep?.totalIncomingVat)} ден.</b></div>
    <div class="row grand"><span>ДДВ салдо:</span><span>${den(vatBalance)} ден.</span></div>
  </div>
  <div class="sigs"><div class="sig"><div class="line">Изготвил</div></div><div class="sig"><div class="line">Сметководител</div></div></div>
  ${footer(s)}`;
  openPrint(shell("Извештај за сметководител", "#3a72b8", body));
}
