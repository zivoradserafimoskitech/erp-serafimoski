// Печатлива фактура — A4, кирилица нативно, browser print → PDF
type Money = string | number | null | undefined;

const den = (v: Money) => {
  const n = Number(v ?? 0);
  return n.toLocaleString("mk-MK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const esc = (s: any) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dt = (s: any) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? esc(s) : d.toLocaleDateString("mk-MK");
};

export function printInvoice(inv: any, settings: any) {
  const c = inv?.customer ?? {};
  const s = settings ?? {};
  const items: any[] = inv?.items ?? [];
  const vatRate = Number(inv?.vatRate ?? s?.defaultVatRate ?? 18);

  const rows = items.map((it, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td>${esc(it.description)}</td>
      <td class="c">${esc(it.unit ?? "")}</td>
      <td class="r">${den(it.quantity)}</td>
      <td class="r">${den(it.unitPrice)}</td>
      <td class="r">${it.discount && Number(it.discount) > 0 ? den(it.discount) + "%" : "—"}</td>
      <td class="r">${den(it.totalPrice)}</td>
    </tr>`).join("");

  const html = `<!doctype html>
<html lang="mk"><head><meta charset="utf-8"><title>Фактура ${esc(inv?.invoiceNumber)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a1a; padding: 14mm 12mm; }
  @page { size: A4; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #d97706; padding-bottom: 10px; }
  .co { display: flex; gap: 10px; align-items: center; }
  .co img { height: 46px; }
  .co h1 { font-size: 17px; color: #d97706; }
  .co .sub { font-size: 10px; color: #555; line-height: 1.5; }
  .doc { text-align: right; }
  .doc h2 { font-size: 21px; letter-spacing: 1px; }
  .doc .num { font-size: 15px; font-weight: 700; color: #d97706; }
  .meta { font-size: 10px; color: #555; margin-top: 4px; line-height: 1.6; }
  .parties { display: flex; gap: 12px; margin: 14px 0; }
  .party { flex: 1; border: 1px solid #ddd; border-radius: 6px; padding: 9px 11px; }
  .party h3 { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #d97706; margin-bottom: 5px; }
  .party .n { font-weight: 700; font-size: 12.5px; margin-bottom: 2px; }
  .party div { line-height: 1.55; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
  table.items th { background: #1f2937; color: #fff; font-size: 9.5px; text-transform: uppercase; letter-spacing: .4px; padding: 6px 7px; text-align: left; }
  table.items td { border-bottom: 1px solid #e5e7eb; padding: 6px 7px; }
  table.items tr:nth-child(even) td { background: #fafafa; }
  .c { text-align: center; } .r { text-align: right; white-space: nowrap; }
  .totals { margin-top: 10px; margin-left: auto; width: 62mm; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 8px; }
  .totals .grand { background: #1f2937; color: #fff; font-weight: 700; font-size: 13px; border-radius: 4px; margin-top: 4px; padding: 7px 8px; }
  .pay { margin-top: 14px; border: 1px dashed #d97706; border-radius: 6px; padding: 9px 11px; font-size: 10.5px; line-height: 1.7; }
  .pay b { color: #d97706; }
  .notes { margin-top: 10px; font-size: 10px; color: #555; }
  .sigs { display: flex; justify-content: space-between; margin-top: 34px; gap: 20px; }
  .sig { flex: 1; text-align: center; font-size: 10px; color: #555; }
  .sig .line { border-top: 1px solid #999; margin-top: 30px; padding-top: 4px; }
  .foot { margin-top: 18px; text-align: center; font-size: 8.5px; color: #999; border-top: 1px solid #eee; padding-top: 6px; }
  @media print { body { padding: 12mm 11mm; } .noprint { display: none; } }
</style></head><body>
  <div class="head">
    <div class="co">
      ${s.logoUrl ? `<img src="${esc(s.logoUrl)}" alt="">` : ""}
      <div>
        <h1>${esc(s.name ?? "Serafimoski Tech DOOEL")}</h1>
        <div class="sub">
          ${esc(s.address ?? "")}<br>
          ЕДБ: ${esc(s.edb ?? "—")} &nbsp;·&nbsp; ЕМБС: ${esc(s.embs ?? "—")}<br>
          ${s.phone ? "тел: " + esc(s.phone) + " · " : ""}${esc(s.email ?? "")}
        </div>
      </div>
    </div>
    <div class="doc">
      <h2>ФАКТУРА</h2>
      <div class="num">бр. ${esc(inv?.invoiceNumber)}</div>
      <div class="meta">
        Датум на издавање: <b>${dt(inv?.issueDate)}</b><br>
        Рок за плаќање: <b>${dt(inv?.dueDate)}</b><br>
        Валута: ${esc(inv?.currency ?? "MKD")}
      </div>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <h3>Издавач</h3>
      <div class="n">${esc(s.name ?? "Serafimoski Tech DOOEL")}</div>
      <div>${esc(s.address ?? "")}</div>
      <div>ЕДБ: ${esc(s.edb ?? "—")}</div>
      <div>Ж-ска: ${esc(s.bankAccount ?? "—")} · ${esc(s.bankName ?? "")}</div>
    </div>
    <div class="party">
      <h3>Примач</h3>
      <div class="n">${esc(c.company || c.name || "—")}</div>
      ${c.company && c.name ? `<div>${esc(c.name)}</div>` : ""}
      <div>${esc([c.address, c.city].filter(Boolean).join(", "))}</div>
      ${c.taxNumber || c.edb ? `<div>ЕДБ: ${esc(c.edb || c.taxNumber)}</div>` : ""}
      ${c.phone ? `<div>тел: ${esc(c.phone)}</div>` : ""}
    </div>
  </div>

  <table class="items">
    <thead><tr>
      <th class="c" style="width:24px">#</th><th>Опис</th><th class="c" style="width:40px">ЕМ</th>
      <th class="r" style="width:60px">Кол.</th><th class="r" style="width:75px">Цена</th>
      <th class="r" style="width:52px">Попуст</th><th class="r" style="width:85px">Вкупно</th>
    </tr></thead>
    <tbody>${rows || `<tr><td colspan="7" class="c" style="padding:14px;color:#999">Нема ставки</td></tr>`}</tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Основица:</span><b>${den(inv?.subtotal)} ден.</b></div>
    <div class="row"><span>ДДВ (${vatRate}%):</span><b>${den(inv?.vatAmount)} ден.</b></div>
    <div class="row grand"><span>ЗА ПЛАЌАЊЕ:</span><span>${den(inv?.totalAmount)} ден.</span></div>
  </div>

  <div class="pay">
    <b>Податоци за плаќање</b><br>
    Жиро сметка: <b>${esc(s.bankAccount ?? "—")}</b> · ${esc(s.bankName ?? "")}<br>
    Повикување на број: <b>${esc(inv?.invoiceNumber)}</b> · Рок: ${dt(inv?.dueDate)}
  </div>

  ${inv?.notes ? `<div class="notes"><b>Забелешка:</b> ${esc(inv.notes)}</div>` : ""}

  <div class="sigs">
    <div class="sig"><div class="line">Изготвил</div></div>
    <div class="sig"><div class="line">Одобрил</div></div>
    <div class="sig"><div class="line">Примил</div></div>
  </div>

  <div class="foot">${esc(s.name ?? "Serafimoski Tech DOOEL")} · ${esc(s.address ?? "")} · ЕДБ ${esc(s.edb ?? "")} · Генерирано од Metal ERP</div>
<script>window.onload = () => setTimeout(() => window.print(), 250);</script>
</body></html>`;

  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) { alert("Дозволи pop-up прозорци за печатење на фактурата."); return; }
  w.document.write(html);
  w.document.close();
}
