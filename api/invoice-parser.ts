// Читање на влезни фактури од PDF текст.
// Македонските добавувачи немаат заеднички распоред, па се работи со
// повеќе обрасци подредени по сигурност, плус математичка проверка.

export type ParsedInvoiceItem = {
  code: string | null;
  description: string;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  vatRate: number | null;
  total: number | null;
};

export type ParsedInvoice = {
  supplierName: string | null;
  supplierTaxId: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  baseAmount: number | null;
  vatAmount: number | null;
  totalAmount: number | null;
  currency: string;
  items: ParsedInvoiceItem[];
  confidence: number;          // 0-100
  missing: string[];           // што не е препознаено
  notes: string[];             // предупредувања за човекот
};

// ── Броеви: некои добавувачи пишуваат 15,426.00, други 15.426,00 ──
export function parseAmount(raw: string): number | null {
  if (!raw) return null;
  const s = String(raw).trim().replace(/\s/g, "");
  if (!/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;

  if (lastComma > lastDot) {
    // европски: точка = илјади, запирка = децимала
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    // англиски: запирка = илјади, точка = децимала
    normalized = s.replace(/,/g, "");
  } else {
    normalized = s;
  }
  const v = parseFloat(normalized);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

/** Сите износи во текстот, со позиција — за математичките проверки */
function allAmounts(text: string): { value: number; index: number }[] {
  const out: { value: number; index: number }[] = [];
  const re = /\d{1,3}(?:[.,]\d{3})*[.,]\d{2}\b|\b\d+[.,]\d{2}\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = parseAmount(m[0]);
    if (v !== null && v > 0) out.push({ value: v, index: m.index });
  }
  return out;
}

const toIso = (d: string): string | null => {
  const m = d.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const m2 = d.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (m2) return `${m2[1]}-${m2[2].padStart(2, "0")}-${m2[3].padStart(2, "0")}`;
  return null;
};

/** Кај некои PDF-ови етикетите се во еден блок, а вредностите во следниот.
 *  „Број на корисник:/Фактура број:/Датум:" па дури потоа трите вредности. */
function labelBlockMap(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = text.split("\n").map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (!/:$/.test(lines[i])) continue;
    const labels: string[] = [];
    let j = i;
    while (j < lines.length && /:$/.test(lines[j]) && lines[j].length > 2) {
      labels.push(lines[j].replace(/:$/, "").trim());
      j++;
    }
    if (labels.length < 2) continue;
    const values: string[] = [];
    while (j < lines.length && values.length < labels.length) {
      if (lines[j] && !/:$/.test(lines[j])) values.push(lines[j]);
      else break;
      j++;
    }
    if (values.length === labels.length) {
      labels.forEach((l, k) => out.set(l.toLowerCase(), values[k]));
    }
    i = j - 1;
  }
  return out;
}

const firstMatch = (text: string, patterns: RegExp[]): string | null => {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return (m[1] ?? m[0]).trim();
  }
  return null;
};

// ══════════ ДАНОЧЕН БРОЈ ══════════
/**
 * Македонски ЕДБ: 13 цифри што почнуваат со 40, понекогаш со префикс МК.
 * На фактурата ги има барем два — нашиот и на добавувачот.
 */
export function extractTaxIds(text: string): string[] {
  const out = new Set<string>();
  const re = /(?:МК|MK)?\s?(40\d{11})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(m[1]);
  return Array.from(out);
}

// ══════════ ГЛАВНО ЧИТАЊЕ ══════════
export function parseInvoiceText(
  text: string,
  ownTaxId?: string | null,
  ownName?: string | null
): ParsedInvoice {
  const notes: string[] = [];
  const missing: string[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const labelMap = labelBlockMap(text);
  const fromLabels = (...keys: string[]): string | null => {
    for (const [k, v] of labelMap) {
      if (keys.some((want) => k.includes(want))) return v;
    }
    return null;
  };

  // ── Даночен број на добавувачот = оној што не е наш ──
  const taxIds = extractTaxIds(text);
  const own = (ownTaxId ?? "").replace(/\D/g, "");
  const supplierTaxId = taxIds.find((t) => t !== own) ?? null;
  if (taxIds.length > 0 && !supplierTaxId) {
    notes.push("Во документот е најден само нашиот даночен број — добавувачот не е препознаен по ЕДБ.");
  }

  // ── Назив на добавувачот ──
  let supplierName: string | null = null;
  const LEGAL = /(ДООЕЛ|Д\.?О\.?О\.?Е\.?Л|ДОО|АД\b|ТП\b|LLC|LTD|GmbH)/i;
  const cleanName = (l: string) =>
    l.replace(/(?:ЕДБ|Број ДДВ|ЕМБС|Даночен број)[:\s]*.*$/i, "")
     .replace(/\s+(?:НЛБ|Халк|Комерцијална|Стопанска|Шпаркасе|Тутунска|Капитал|ПроКредит|Уни|Централна)\s*Банка.*$/i, "")
     .replace(/\s+Жиро\s*с?-?ки.*$/i, "")
     .replace(/\s*\d{4,}.*$/, "")
     .replace(/[|“”"]/g, " ")
     .replace(/\s{2,}/g, " ")
     .trim();

  // Редови што припаѓаат на купувачот — нашето име и сè веднаш под „Купувач:"
  const ownKey = (ownName ?? "").toUpperCase().replace(/[^А-ЯЀ-ӿA-Z]/g, "").slice(0, 12);
  const buyerLines = new Set<number>();
  lines.forEach((l, i) => {
    if (/^(купувач|корисник|примач|наручител)\s*:?/i.test(l)) {
      for (let k = i; k <= Math.min(lines.length - 1, i + 5); k++) buyerLines.add(k);
    }
    if (ownKey && l.toUpperCase().replace(/[^А-ЯЀ-ӿA-Z]/g, "").includes(ownKey)) buyerLines.add(i);
  });

  if (supplierTaxId) {
    const idx = lines.findIndex((l) => l.replace(/\s/g, "").includes(supplierTaxId));
    if (idx >= 0) {
      // Најблискиот ред со правна форма, во опсег од шест реда горе-долу
      let best: { name: string; dist: number } | null = null;
      for (let i = Math.max(0, idx - 6); i <= Math.min(lines.length - 1, idx + 6); i++) {
        const c = cleanName(lines[i]);
        if (c.length < 5 || !LEGAL.test(c)) continue;
        if (/купувач|корисник|адреса|примач/i.test(c)) continue;
        if (buyerLines.has(i)) continue;
        const dist = Math.abs(i - idx);
        if (!best || dist < best.dist) best = { name: c, dist };
      }
      if (best) supplierName = best.name.slice(0, 120);
    }
  }
  if (!supplierName) {
    const cand = lines
      .slice(0, 15)
      .find((l, i) => LEGAL.test(l) && !/купувач|корисник|адреса/i.test(l) && !buyerLines.has(i));
    if (cand) supplierName = cleanName(cand).slice(0, 120);
  }
  if (!supplierName && lines.length > 0) {
    // Последна инстанца: првиот содржаен ред од документот
    const c = cleanName(lines[0]);
    if (c.length > 4) supplierName = c.slice(0, 120);
  }
  if (!supplierName) missing.push("добавувач");

  // ── Број на фактура ──
  const hasDigit = (v: string | null) => !!v && /\d/.test(v);
  let invoiceNumber = fromLabels("фактура број", "број на фактура", "фактура бр");
  if (!hasDigit(invoiceNumber)) invoiceNumber = null;
  if (!invoiceNumber) invoiceNumber = firstMatch(text, [
    /ФАКТУРА\s*(?:бр\.?|број)\s*[:№#]?\s*([0-9A-ZА-ЯЀ-ӿ][0-9A-ZА-ЯЀ-ӿ\-\/]{2,30})/i,
    /Фактура\s*број\s*[:№#]?\s*\n?\s*([0-9][0-9A-ZА-ЯЀ-ӿ\-\/ ]{2,30})/i,
    /\n(\d{1,2}-[A-ZА-Я]-\d{2,6})\n/,                    // МЕТАЛ-НЕТ: 7-A-3464
    /(?:фактура|сметка|invoice)\s*(?:бр\.?|број|no\.?|#)\s*[:]?\s*([0-9A-Z][0-9A-Z\-\/]{2,30})/i,
  ]);
  if (!hasDigit(invoiceNumber)) invoiceNumber = null;
  if (invoiceNumber) invoiceNumber = invoiceNumber.replace(/\s*-\s*/g, "-").trim();
  if (!invoiceNumber) missing.push("број на фактура");

  // ── Датуми ──
  const issueRaw = (fromLabels("датум на издавање", "место и датум") ?? "").match(/\d{1,2}[./-]\d{1,2}[./-]\d{4}/)?.[0]
    ?? firstMatch(text, [
    /(?:датум\s*на\s*издавање|место\s*и\s*датум\s*на\s*издавање)[:\s]*[^\n\d]*(\d{1,2}[./-]\d{1,2}[./-]\d{4})/i,
    /(?:^|\n)\s*датум[:\s]+(\d{1,2}[./-]\d{1,2}[./-]\d{4})/i,
    /(\d{1,2}[./-]\d{1,2}[./-]\d{4})/,
  ]);
  const issueDate = issueRaw ? toIso(issueRaw) : null;
  if (!issueDate) missing.push("датум");

  const dueRaw = firstMatch(text, [
    /(?:доспева|рок\s*на\s*плаќање|валута|доспеаност)[:\s]*(\d{1,2}[./-]\d{1,2}[./-]\d{4})/i,
    /со\s*рок\s*до\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})/i,
  ]);
  const dueDate = dueRaw ? toIso(dueRaw) : null;

  // ── Износи ──
  const amt = (patterns: RegExp[]): number | null => {
    const raw = firstMatch(text, patterns);
    return raw ? parseAmount(raw) : null;
  };

  // Важно: [^\S\n]* значи „празни места, но без нов ред" —
  // инаку етикетата фаќа број од следниот ред кој припаѓа на друга колона.
  let baseAmount = amt([
    /ОСНОВА[^\S\n]*:[^\S\n]*([\d.,]+)/i,
    /(?:вкупно[^\S\n]*без[^\S\n]*ддв|основица|даночна[^\S\n]*основа)[^\S\n]*:?[^\S\n]*([\d.,]+)/i,
  ]);
  let vatAmount = amt([
    /(?:^|\n)[^\S\n]*ДДВ[^\S\n]*:[^\S\n]*([\d.,]+)/im,
    /ДДВ[^\S\n]*\([^\S\n]*18[^\S\n]*%?[^\S\n]*\)[^\S\n]*:[^\S\n]*([\d.,]+)/i,
    /ДДВ\D{0,3}18[^\S\n]*%[^\S\n]*([\d.,]+)/i,
  ]);
  let totalAmount = amt([
    /ЗА[^\S\n]*НАПЛАТА[^\S\n]*:[^\S\n]*([\d.,]+)/i,
    /(?:вкупно[^\S\n]*со[^\S\n]*ддв)[^\S\n]*:?[^\S\n]*([\d.,]+)/i,
    /износ[^\S\n]*за[^\S\n]*плаќање[^\S\n]*по[^\S\n]*фактура[^\n]*?(\d[\d.,]*)[^\S\n]*$/im,
  ]);

  // „Вкупно за плаќање“ кај сметките за струја го содржи и стариот долг —
  // се користи само ако нема поспецифичен износ.
  const hasOldDebt = /заостанат\s*долг/i.test(text);
  if (totalAmount === null) {
    const loose = amt([/вкупно[^\S\n]*за[^\S\n]*плаќање[^\S\n]*:?[^\S\n]*([\d.,]+)/i]);
    if (loose !== null) {
      totalAmount = loose;
      if (hasOldDebt) {
        notes.push("Износот е земен од „Вкупно за плаќање“ кој кај сметките за струја може да вклучува заостанат долг — провери.");
      }
    }
  }

  // ── Математичка проверка: основа + ДДВ ≈ вкупно (толеранција од заокружување) ──
  const nums = allAmounts(text);
  const fits = (b: number, v: number, t: number) =>
    Math.abs(b + v - t) <= 1.01 && b > 0 && v > 0 && Math.abs(v / b - 0.18) < 0.02;

  if (totalAmount === null || baseAmount === null || vatAmount === null) {
    // Барај тројка што се собира и има ДДВ од 18%
    let best: { b: number; v: number; t: number; span: number } | null = null;
    for (let i = 0; i < nums.length; i++) {
      for (let j = i + 1; j < Math.min(nums.length, i + 6); j++) {
        for (let k = j + 1; k < Math.min(nums.length, j + 6); k++) {
          const [b, v, t] = [nums[i].value, nums[j].value, nums[k].value];
          if (!fits(b, v, t)) continue;
          // Најголемата исправна тројка е збирот на фактурата;
          // помалите се редови од ставките, кои исто имаат 18%.
          const span = nums[k].index - nums[i].index;
          if (!best || t > best.t) best = { b, v, t, span };
        }
      }
    }
    if (best) {
      if (baseAmount === null) baseAmount = best.b;
      if (vatAmount === null) vatAmount = best.v;
      if (totalAmount === null) totalAmount = best.t;
      notes.push("Износите се пресметани по проверка основа + ДДВ = вкупно, не се прочитани од етикета.");
    }
  }

  if (totalAmount === null) missing.push("вкупен износ");

  // Последна проверка на веродостојност
  if (baseAmount && vatAmount && totalAmount && Math.abs(baseAmount + vatAmount - totalAmount) > 1.01) {
    notes.push(`Основа ${baseAmount} + ДДВ ${vatAmount} не дава ${totalAmount} — провери ги износите.`);
  }

  // ── Ставки ──
  const items = parseItems(text);

  // ── Оцена ──
  let confidence = 0;
  if (supplierName) confidence += 20;
  if (supplierTaxId) confidence += 15;
  if (invoiceNumber) confidence += 25;
  if (issueDate) confidence += 15;
  if (totalAmount) confidence += 25;

  return {
    supplierName, supplierTaxId, invoiceNumber, issueDate, dueDate,
    baseAmount, vatAmount, totalAmount, currency: "MKD",
    items, confidence, missing, notes,
  };
}

// ══════════ СТАВКИ ══════════
function parseItems(text: string): ParsedInvoiceItem[] {
  const items: ParsedInvoiceItem[] = [];

  // Распоред на МЕТАЛ-НЕТ по извлекување:
  // шифра, ДДВ%, ЕдМ, количина, основна цена, вкупно, износ ДДВ, Р.Б, цена со ДДВ, назив
  const metalNet = /^(\d{3,6})\s+(\d{1,2})\s+([А-ЯЀ-ӿA-Z]{2,4})\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+(\d{1,3})\s+([\d.,]+)\s+(.+)$/;

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\t/g, " ").replace(/\s+/g, " ").trim();
    const m = line.match(metalNet);
    if (m) {
      items.push({
        code: m[1],
        description: m[10].trim(),
        unit: m[3],
        quantity: parseAmount(m[4]),
        unitPrice: parseAmount(m[5]),
        vatRate: Number(m[2]),
        total: parseAmount(m[6]),
      });
    }
  }
  if (items.length > 0) return items;

  // Општ распоред: реден број, опис, па неколку износи на крајот
  const generic = /^(\d{1,2})\s+(.{4,80}?)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)$/;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    const m = line.match(generic);
    if (!m) continue;
    const total = parseAmount(m[5]);
    if (total === null || total <= 0) continue;
    items.push({
      code: null,
      description: m[2].trim(),
      unit: null,
      quantity: null,
      unitPrice: parseAmount(m[3]),
      vatRate: null,
      total,
    });
  }
  return items;
}
