// Читање изводи од Комерцијална банка — четири формати.
// Сите враќаат иста структура, за да не се разликува понатаму низ системот.

export type ParsedTx = {
  txDate: string;              // YYYY-MM-DD
  direction: "in" | "out";
  amount: number;
  provision: number;
  counterpartyName: string;
  counterpartyAccount: string;
  purpose: string;
  code: string;
  refPbo: string;
  refPbz: string;
  bankRef: string;
};

export type ParsedStatement = {
  accountNumber: string;
  statementNo: string;
  statementDate: string;
  prevBalance: number;
  debitTotal: number;
  creditTotal: number;
  newBalance: number;
  currency: string;
  transactions: ParsedTx[];
};

export type ParseOutcome = {
  format: string;
  statements: ParsedStatement[];
  looseTransactions: ParsedTx[]; // ставки без заглавие (се спојуваат по датум)
  warnings: string[];
};

// ── помошни ──
const num = (s: string): number => {
  const cleaned = String(s ?? "").replace(/[^\d.,+-]/g, "").replace(/,/g, "");
  const v = parseFloat(cleaned);
  return Number.isFinite(v) ? v : 0;
};
/** Износ во кој било запис: 115.000,00 (МК), 115,000.00 (EN), 115000,00, 115000.00. Последниот знак е децимален. */
export const numAny = (s: string): number => {
  let t = String(s ?? "").replace(/[^\d.,+-]/g, "");
  const lastDot = t.lastIndexOf("."), lastComma = t.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    t = t.split(dec === "." ? "," : ".").join("");
    if (dec === ",") t = t.replace(",", ".");
  } else if (lastComma >= 0) {
    // само запирка: децимална ако по неа има 1-2 цифри, инаку илјадарки
    t = /,\d{1,2}$/.test(t) && t.split(",").length === 2 ? t.replace(",", ".") : t.replace(/,/g, "");
  } else if (lastDot >= 0 && (t.split(".").length > 2 || /\.\d{3}$/.test(t))) {
    t = t.replace(/\./g, ""); // 115.000 или 1.234.567 -- илјадарки
  }
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : 0;
};
const trimAcc = (s: string): string => String(s ?? "").trim().replace(/^0+(?=\d{10,})/, "");
const clean = (s: string): string => String(s ?? "").trim().replace(/\s+/g, " ");

/** Латиницата на КБ назад во кирилица — за да се совпаѓа со имињата во системот */
const TRANSLIT: [RegExp, string][] = [
  [/Zh/g, "Ж"], [/zh/g, "ж"], [/Ch/g, "Ч"], [/ch/g, "ч"],
  [/Sh/g, "Ш"], [/sh/g, "ш"], [/Kj/g, "Ќ"], [/kj/g, "ќ"],
  [/Gj/g, "Ѓ"], [/gj/g, "ѓ"], [/Dj/g, "Џ"], [/dj/g, "џ"],
];
export function toCyrillic(input: string): string {
  let s = input;
  for (const [re, r] of TRANSLIT) s = s.replace(re, r);
  const map: Record<string, string> = {
    A: "А", B: "Б", V: "В", G: "Г", D: "Д", E: "Е", Z: "З", I: "И", J: "Ј",
    K: "К", L: "Л", M: "М", N: "Н", O: "О", P: "П", R: "Р", S: "С", T: "Т",
    U: "У", F: "Ф", H: "Х", C: "Ц", Q: "Љ", W: "Њ", X: "Х", Y: "Ѕ",
    a: "а", b: "б", v: "в", g: "г", d: "д", e: "е", z: "з", i: "и", j: "ј",
    k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", r: "р", s: "с", t: "т",
    u: "у", f: "ф", h: "х", c: "ц", q: "љ", w: "њ", x: "х", y: "ѕ",
  };
  return s.split("").map((ch) => map[ch] ?? ch).join("");
}

// ══════════ 1. KB водечки слог (заглавија на изводи) ══════════
// 000300120000154842 2026.06.01 044 +prev +debit +credit +new
export function parseKbLeading(text: string): ParsedStatement[] {
  const out: ParsedStatement[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length < 60) continue;
    const acc = trimAcc(line.slice(0, 18));
    const dateRaw = line.slice(18, 28);
    const stNo = line.slice(28, 31).trim().replace(/^0+/, "") || line.slice(28, 31).trim();
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(dateRaw)) continue;
    const amounts = line.slice(31).match(/[+-]\d+\.\d{2}/g) ?? [];
    out.push({
      accountNumber: acc,
      statementNo: stNo,
      statementDate: dateRaw.replace(/\./g, "-"),
      prevBalance: num(amounts[0] ?? "0"),
      debitTotal: num(amounts[1] ?? "0"),
      creditTotal: num(amounts[2] ?? "0"),
      newBalance: num(amounts[3] ?? "0"),
      currency: "MKD",
      transactions: [],
    });
  }
  return out;
}

// ══════════ 2. KB ставки (фиксна ширина, 295 знаци) ══════════
export function parseKbItems(text: string): ParsedTx[] {
  const out: ParsedTx[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length < 250) continue;
    const dateRaw = line.slice(163, 173);
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(dateRaw)) continue;

    const debit = num(line.slice(106, 125));
    const credit = num(line.slice(125, 144));
    const provision = num(line.slice(144, 163));
    const isIn = credit > 0;

    out.push({
      txDate: dateRaw.replace(/\./g, "-"),
      direction: isIn ? "in" : "out",
      amount: isIn ? credit : debit,
      provision,
      counterpartyName: toCyrillic(clean(line.slice(18, 88))),
      counterpartyAccount: trimAcc(line.slice(88, 106)),
      purpose: toCyrillic(clean(line.slice(173, 243))),
      code: clean(line.slice(243, 246)),
      refPbo: clean(line.slice(246, 270)),
      refPbz: clean(line.slice(270, 294)),
      bankRef: "",
    });
  }
  return out;
}

// ══════════ 3. MT940 (SWIFT) ══════════
export function parseMT940(text: string): ParsedStatement[] {
  const out: ParsedStatement[] = [];
  const blocks = text.split(/\{1:/).filter((b) => b.includes(":20:"));

  for (const block of blocks) {
    const body = block.replace(/\r/g, "");
    const get = (tag: string) => {
      const m = body.match(new RegExp(`:${tag}:([^\\n]*)`));
      return m ? m[1].trim() : "";
    };

    const account = trimAcc(get("25"));
    const stRaw = get("28C");         // 44/1
    const statementNo = stRaw.split("/")[0] ?? "";
    const open = get("60F");           // C260601MKD694,
    const close = get("62F");

    const balOf = (v: string) => {
      const m = v.match(/^([CD])(\d{6})([A-Z]{3})([\d.,]+)/);
      if (!m) return { date: "", currency: "MKD", value: 0 };
      const [, , d, cur, amt] = m;
      const yy = d.slice(0, 2), mm = d.slice(2, 4), dd = d.slice(4, 6);
      return {
        date: `20${yy}-${mm}-${dd}`,
        currency: cur,
        value: parseFloat(amt.replace(/\./g, "").replace(",", ".")) || 0,
      };
    };
    const ob = balOf(open);
    const cb = balOf(close);

    // Ставките: :61: и следниот :86:
    const txs: ParsedTx[] = [];
    const parts = body.split(/\n:61:/).slice(1);
    for (const part of parts) {
      const lines = part.split("\n");
      const head = lines[0] ?? "";
      // 2606010601DD100,NMSC15274531
      const m = head.match(/^(\d{6})(\d{4})?([CD])([DC])?([\d.,]+)N(\w{3})(\S*)/);
      if (!m) continue;
      const [, valueDate, , dc, , amtRaw, , ref] = m;
      const yy = valueDate.slice(0, 2), mm = valueDate.slice(2, 4), dd = valueDate.slice(4, 6);
      const amount = parseFloat(String(amtRaw).replace(/\./g, "").replace(",", ".")) || 0;

      const detailLines = part.split(/\n:86:/)[1]?.split("\n") ?? [];
      const detail = detailLines
        .filter((l) => !l.startsWith(":") && l.trim() !== "-}")
        .map((l) => l.trim());

      let counterAcc = "", counterName = "", purpose = "", pbo = "";
      for (const d of detail) {
        if (d.startsWith("/BENM/")) counterAcc = trimAcc(d.replace("/BENM/", ""));
        else if (d.startsWith("/")) {
          const v = d.replace(/^\//, "");
          if (v === "EMPTY/" || v === "EMPTY") continue;
          if (!counterName) counterName = v;
          else if (v.includes("//")) pbo = v.split("//")[1] ?? "";
          else purpose = purpose ? `${purpose} ${v}` : v;
        }
      }

      txs.push({
        txDate: `20${yy}-${mm}-${dd}`,
        direction: dc === "C" ? "in" : "out",
        amount,
        provision: 0,
        counterpartyName: toCyrillic(clean(counterName)),
        counterpartyAccount: counterAcc,
        purpose: toCyrillic(clean(purpose)),
        code: "",
        refPbo: clean(pbo),
        refPbz: "",
        bankRef: clean(ref),
      });
    }

    const debitTotal = txs.filter((t) => t.direction === "out").reduce((a, t) => a + t.amount, 0);
    const creditTotal = txs.filter((t) => t.direction === "in").reduce((a, t) => a + t.amount, 0);

    out.push({
      accountNumber: account,
      statementNo,
      statementDate: cb.date || ob.date,
      prevBalance: ob.value,
      debitTotal,
      creditTotal,
      newBalance: cb.value,
      currency: cb.currency || "MKD",
      transactions: txs,
    });
  }
  return out;
}

// ══════════ 4. PDF (извлечен текст) ══════════
// PDF-от нема стандарден формат: прво се бара заглавјето на КБ, а ставките се читаат по редови —
// ред со датум и износ(и). Кога има две колони за износ (должи / побарува), насоката е од колоната.
const MK_AMOUNT = /-?\d{1,3}(?:[.\s]\d{3})*,\d{2}(?!\d)|-?\d+,\d{2}(?!\d)|-?\d{1,3}(?:,\d{3})*\.\d{2}(?!\d)/g;
const DATE_RX = /(\d{2})[./](\d{2})[./](\d{4}|\d{2})(?!\d)/;
const ACC_RX = /(?<!\d)(\d{3})[- ]?(\d{10})[- ]?(\d{2})(?!\d)/;
const IN_WORDS = /(уплат|прилив|приход|наплат|побарува|кредит|credit|incoming)/i;
const OUT_WORDS = /(исплат|одлив|плаќањ|провизиј|надомест|должи|дебит|debit|outgoing|налог за пренос)/i;
const isoDate = (m: RegExpMatchArray) => `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2]}-${m[1]}`;

export function parsePdfTransactions(text: string): { txs: ParsedTx[]; unsure: number } {
  const txs: ParsedTx[] = [];
  let unsure = 0;
  let last: ParsedTx | null = null, cont = 0;
  for (const raw of text.split(/\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    const dm = line.match(DATE_RX);
    if (!dm) {
      // продолжение на ставката (текстот во тесна колона се префрла во следниот ред): цел, сметка на партнерот
      if (last && line && cont < 3 && !/(салдо|вкупно|страна|страница|page)/i.test(line) && !(line.match(MK_AMOUNT) ?? []).length) {
        const acc = line.match(ACC_RX);
        if (acc && !last.counterpartyAccount) last.counterpartyAccount = `${acc[1]}${acc[2]}${acc[3]}`;
        const extra = line.replace(new RegExp(ACC_RX.source, "g"), " ").replace(/\s+/g, " ").trim();
        if (extra) last.purpose = `${last.purpose} ${extra}`.trim();
        cont++;
      } else { last = null; }
      continue;
    }
    // датумите и сметките не се износи (29.09.2026 инаку би изгледало како 29.09)
    const forAmounts = line.replace(new RegExp(DATE_RX.source, "g"), " ").replace(new RegExp(ACC_RX.source, "g"), " ");
    const amounts = (forAmounts.match(MK_AMOUNT) ?? []).map(numAny);
    if (!amounts.length) continue;
    // заглавија/збирови не се ставки
    if (/(претходно салдо|ново салдо|вкупно|состојба|салдо на ден|промет вкупно|број на извод)/i.test(line)) continue;
    let direction: "in" | "out" | null = null;
    let amount = 0;
    const nonZero = amounts.map((v, i) => ({ v: Math.abs(v), i })).filter(x => x.v > 0.004);
    if (amounts.length >= 2 && nonZero.length >= 1 && (Math.abs(amounts[0]) < 0.005 || Math.abs(amounts[1]) < 0.005)) {
      // колони должи | побарува (| салдо): која е пополнета
      const first = Math.abs(amounts[0]) > 0.004;
      direction = first ? "out" : "in";
      amount = first ? Math.abs(amounts[0]) : Math.abs(amounts[1]);
    } else if (nonZero.length >= 1) {
      amount = nonZero[0].v;
      if (amounts[nonZero[0].i] < 0) direction = "out";
      else if (OUT_WORDS.test(line) && !IN_WORDS.test(line)) direction = "out";
      else if (IN_WORDS.test(line) && !OUT_WORDS.test(line)) direction = "in";
    }
    if (!direction || !(amount > 0)) { unsure++; last = null; continue; }
    const acc = line.match(ACC_RX);
    const rest = line.replace(new RegExp(DATE_RX.source, "g"), " ").replace(MK_AMOUNT, " ").replace(new RegExp(ACC_RX.source, "g"), " ").replace(/\s+/g, " ").trim();
    last = {
      txDate: isoDate(dm), direction, amount, provision: 0,
      counterpartyName: rest.slice(0, 120), counterpartyAccount: acc ? `${acc[1]}${acc[2]}${acc[3]}` : "",
      purpose: rest, code: "", refPbo: "", refPbz: "", bankRef: "",
    };
    cont = 0;
    txs.push(last);
  }
  return { txs, unsure };
}

export function parsePdfText(text: string): { statements: ParsedStatement[]; warnings: string[] } {
  const warnings: string[] = [];
  const statements: ParsedStatement[] = [];
  const chunks = text.split(/Извод за промените и состојбата на сметката за ден/i).slice(1);

  for (const ch of chunks) {
    const head = ch.match(/(\d{2})\.(\d{2})\.(\d{4}),?\s*број на извод\s*(\d+)/i);
    const acc = ch.match(/Број на сметката:\s*(\d+)/i);
    if (!head) continue;
    const [, dd, mm, yyyy, no] = head;

    const balRow = ch.match(
      /([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+\d+\s+\d+\s+[\d.,]+/
    );

    statements.push({
      accountNumber: acc ? acc[1] : "",
      statementNo: no,
      statementDate: `${yyyy}-${mm}-${dd}`,
      prevBalance: balRow ? numAny(balRow[1]) : 0,
      debitTotal: balRow ? numAny(balRow[2]) : 0,
      creditTotal: balRow ? numAny(balRow[3]) : 0,
      newBalance: balRow ? numAny(balRow[4]) : 0,
      currency: "MKD",
      transactions: [],
    });
  }

  // Друг распоред (друга банка): заглавје од општи зборови
  if (!statements.length) {
    const no = text.match(/извод\s*(?:бр(?:ој)?\.?|број|no\.?)\s*[:#]?\s*(\d+)/i);
    const dt = text.match(/(?:за ден|на ден|датум(?: на извод)?)\s*:?\s*(\d{2})[./](\d{2})[./](\d{4})/i) ?? text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    const acc = text.match(/(?:сметка|account)[^\d]{0,20}(\d{3}[- ]?\d{10}[- ]?\d{2})/i) ?? text.match(ACC_RX);
    const bal = (rx: RegExp) => { const m = text.match(rx); return m ? numAny(m[1]) : 0; };
    if (dt && acc) {
      statements.push({
        accountNumber: String(acc[1] ?? acc[0]).replace(/\D/g, ""),
        statementNo: no ? no[1] : "",
        statementDate: `${dt[3]}-${dt[2]}-${dt[1]}`,
        prevBalance: bal(/(?:претходно салдо|почетно салдо|салдо на почеток)[^\d-]*(-?[\d.,\s]+,\d{2})/i),
        debitTotal: bal(/(?:вкупно должи|вкупно одливи|промет должи)[^\d-]*(-?[\d.,\s]+,\d{2})/i),
        creditTotal: bal(/(?:вкупно побарува|вкупно приливи|промет побарува)[^\d-]*(-?[\d.,\s]+,\d{2})/i),
        newBalance: bal(/(?:ново салдо|крајно салдо|салдо на крај)[^\d-]*(-?[\d.,\s]+,\d{2})/i),
        currency: /\bEUR\b/.test(text) && !/\bMKD\b|ден/.test(text) ? "EUR" : "MKD",
        transactions: [],
      });
    }
  }

  // Ставки по редови
  const { txs, unsure } = parsePdfTransactions(text);
  if (statements.length === 1) statements[0].transactions = txs;
  else if (statements.length > 1) {
    for (const t of txs) (statements.find(s => s.statementDate === t.txDate) ?? statements[statements.length - 1]).transactions.push(t);
  }

  if (txs.length) warnings.push(`Од PDF-от се прочитани ${txs.length} ставки — провери ги износите и насоката (прилив/одлив).`);
  if (unsure) warnings.push(`${unsure} редови со датум и износ не се внесени, бидејќи не е јасно дали се прилив или одлив.`);
  if (!statements.length && !txs.length) {
    warnings.push("PDF-от е прочитан, но форматот на изводот не е препознаен. Испрати слика од изводот за да се додаде, или внеси го .300 / MT940 од е-банкарството.");
  }
  return { statements, warnings: statements.length && !txs.length ? [...warnings, "Од PDF-от се прочитани само заглавијата. За ставки користи ги .300 или MT940 датотеките."] : warnings };
}

// Ставки од PDF без заглавје се враќаат како „слободни“
export function parsePdfOutcome(text: string): ParseOutcome {
  const r = parsePdfText(text);
  if (r.statements.length) return { format: "PDF", statements: r.statements, looseTransactions: [], warnings: r.warnings };
  const { txs } = parsePdfTransactions(text);
  return { format: "PDF", statements: [], looseTransactions: txs, warnings: r.warnings };
}

// ══════════ Препознавање на форматот ══════════
export function detectAndParse(fileName: string, text: string): ParseOutcome {
  const warnings: string[] = [];
  const name = (fileName || "").toLowerCase();

  // PDF: секогаш како PDF (текстот од PDF има долги редови и порано се препознаваше како „KB ставки“ -> 0 ставки)
  if (name.endsWith(".pdf")) return parsePdfOutcome(text);

  if (text.includes("{1:F01") || /:20:[A-Z0-9]/.test(text)) {
    return { format: "MT940", statements: parseMT940(text), looseTransactions: [], warnings };
  }

  if (name.includes("vodecki") || name.includes("vodechki")) {
    return { format: "KB водечки слог", statements: parseKbLeading(text), looseTransactions: [], warnings };
  }

  if (name.includes("stavki")) {
    return { format: "KB ставки", statements: [], looseTransactions: parseKbItems(text), warnings };
  }

  // .300 без препознатливо име — погоди по должина на редот
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length > 0) {
    const len = lines[0].length;
    if (len > 250) {
      return { format: "KB ставки", statements: [], looseTransactions: parseKbItems(text), warnings };
    }
    if (len > 90 && len < 140) {
      return { format: "KB водечки слог", statements: parseKbLeading(text), looseTransactions: [], warnings };
    }
  }

  if (text.includes("Извод за промените")) return parsePdfOutcome(text);

  warnings.push("Форматот не е препознаен.");
  return { format: "непознат", statements: [], looseTransactions: [], warnings };
}

/** Клуч за спречување двојно внесување на иста ставка */
export function dedupeKey(accountNumber: string, t: ParsedTx): string {
  const base = [
    accountNumber, t.txDate, t.direction, t.amount.toFixed(2),
    t.counterpartyAccount || t.counterpartyName.slice(0, 20),
    (t.bankRef || t.purpose).slice(0, 40),
  ].join("|");
  return base.slice(0, 180);
}
