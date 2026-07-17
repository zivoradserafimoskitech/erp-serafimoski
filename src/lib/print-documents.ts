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
  :root { --accent: ${accent}; --dark: #1f2937; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; padding: 13mm 12mm; }
  @page { size: A4; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid var(--accent); padding-bottom: 11px; }
  .co { display: flex; gap: 12px; align-items: center; }
  .co img { height: 52px; max-width: 150px; object-fit: contain; }
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
  const w = window.open("", "_blank", "width=920,height=1120");
  if (!w) { alert("Дозволи pop-up прозорци за печатење."); return; }
  w.document.write(html);
  w.document.close();
}

// ══════════════ ФАКТУРА ══════════════
export function printInvoice(inv: any, settings: any) {
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
  ${header(s, "ФАКТУРА", "бр. " + (inv?.invoiceNumber ?? ""), `
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
  openPrint(shell(`Фактура ${inv?.invoiceNumber ?? ""}`, "#d97706", body));
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
  openPrint(shell(`Работен налог ${wo?.woNumber ?? ""}`, "#2563eb", body));
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
  openPrint(shell(`Испратница ${dn?.dnNumber ?? ""}`, "#059669", body));
}

// ══════════════ ПОНУДА ══════════════
export function printQuotation(q: any, settings: any) {
  const s = settings ?? {};
  const c = q?.customer ?? {};
  const items: any[] = q?.items ?? [];
  const vatRate = Number(q?.vatRate ?? s?.defaultVatRate ?? 18);
  const rows = items.map((it, i) => `<tr>
    <td class="c">${i + 1}</td><td>${esc(it.description)}</td><td class="c">${esc(it.unit ?? "")}</td>
    <td class="r">${den(it.quantity)}</td><td class="r">${den(it.unitPrice)}</td>
    <td class="r"><b>${den(it.totalPrice)}</b></td></tr>`).join("");

  const body = `
  ${header(s, "ПОНУДА", q?.quoteNumber ?? "", `
    Датум: <b>${dt(q?.createdAt)}</b><br>
    Важи до: <b>${dt(q?.validUntil)}</b><br>
    Валута: ${esc(q?.currency ?? "MKD")}`)}
  <div class="parties">
    <div class="party"><h3>Понудувач</h3>
      <div class="n">${esc(s?.name ?? "Serafimoski Tech DOOEL")}</div>
      <div>${esc(s?.address ?? "")}</div>
      <div>ЕДБ: ${esc(s?.edb ?? "—")}</div>
      ${s?.phone ? `<div>тел: ${esc(s.phone)}</div>` : ""}
    </div>
    <div class="party"><h3>За клиент</h3>
      <div class="n">${esc(c.company || c.name || "—")}</div>
      ${c.company && c.name ? `<div>${esc(c.name)}</div>` : ""}
      <div>${esc([c.address, c.city].filter(Boolean).join(", "))}</div>
      ${c.phone ? `<div>тел: ${esc(c.phone)}</div>` : ""}
    </div>
  </div>
  <table class="t"><thead><tr>
    <th class="c" style="width:26px">#</th><th>Опис</th><th class="c" style="width:44px">ЕМ</th>
    <th class="r" style="width:60px">Кол.</th><th class="r" style="width:80px">Цена (ден.)</th>
    <th class="r" style="width:90px">Вкупно (ден.)</th>
  </tr></thead><tbody>${rows || `<tr><td colspan="6" class="c" style="padding:14px;color:#999">Нема ставки</td></tr>`}</tbody></table>
  <div class="totals">
    <div class="row"><span>Основица:</span><b>${den(q?.subtotal)} ден.</b></div>
    <div class="row"><span>ДДВ (${vatRate}%):</span><b>${den(q?.vatAmount)} ден.</b></div>
    <div class="row grand"><span>ВКУПНО:</span><span>${den(q?.totalAmount)} ден.</span></div>
  </div>
  <div class="box"><b>Услови</b><br>
    ${q?.deliveryDays ? `Рок на испорака: <b>${esc(q.deliveryDays)} дена</b><br>` : ""}
    ${q?.paymentTerms ? `Плаќање: <b>${esc(q.paymentTerms)}</b><br>` : ""}
    Понудата важи до <b>${dt(q?.validUntil)}</b>. Цените се изразени во денари${vatRate ? " со пресметан ДДВ во рекапитулацијата" : ""}.
  </div>
  ${q?.notes ? `<div class="notes"><b>Забелешка:</b> ${esc(q.notes)}</div>` : ""}
  <div class="sigs"><div class="sig"><div class="line">Изготвил</div></div><div class="sig"><div class="line">Одобрил</div></div></div>
  ${footer(s)}`;
  openPrint(shell(`Понуда ${q?.quoteNumber ?? ""}`, "#7c3aed", body));
}
