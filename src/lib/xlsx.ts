// Вистински Excel (.xlsx) без тешка библиотека: XML деловите се пакуваат со jszip (веќе го користиме).
// Броевите остануваат броеви (може да се собираат во Excel), датумите се датуми (дд.мм.гггг),
// а текстот останува текст — така ЕДБ и броеви на фактури не губат нули од почеток.

export type Cell = string | number | null | undefined;
export type Sheet = {
  name: string;
  /** прв ред — наслови на колоните */
  header: string[];
  rows: Cell[][];
  /** ред со збир на дното (задебелен) */
  total?: Cell[];
  /** широчини на колоните во знаци; ако ги нема, се пресметуваат од содржината */
  widths?: number[];
  /** редови над табелата (наслов, период...) */
  title?: string[];
  /** индекси на редови (во rows) што се задебелуваат — поднаслови */
  boldRows?: number[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  // контролни знаци не смеат во XML
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const colName = (i: number) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const serial = (iso: string) => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000;
const safeSheetName = (n: string, used: Set<string>) => {
  let s = n.replace(/[[\]:*?/\\]/g, " ").slice(0, 31).trim() || "Лист";
  let k = 2; const base = s;
  while (used.has(s.toLowerCase())) s = `${base.slice(0, 28)} ${k++}`;
  used.add(s.toLowerCase()); return s;
};

// стилови: 0 обично, 1 наслов на колона, 2 број со 2 децимали, 3 датум, 4 задебелен број, 5 задебелен текст со линија, 6 наслов на лист, 7 поднаслов
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFDE7C2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// Колони со пари: секогаш „1.234,00“, и кога износот е цел број
const MONEY_HEADER = /ден|должи|побарува|салдо|износ|цена|трошок|основица|ддв|вкупно|приход|добивка|план|реално|отстапување/i;
const moneyCols = (sh: Sheet) => new Set(sh.header.map((_h, i) => i).filter(i =>
  !/%/.test(sh.header[i]) && (MONEY_HEADER.test(sh.header[i]) || sh.rows.some(r => typeof r[i] === "number" && !Number.isInteger(r[i] as number)))));

function cellXml(ref: string, v: Cell, kind: "head" | "body" | "total" | "title" | "bold", money = false) {
  if (v === null || v === undefined || v === "") return kind === "total" ? `<c r="${ref}" s="5"/>` : "";
  if (kind === "title") return `<c r="${ref}" t="inlineStr" s="${ref === "A1" ? 6 : 0}"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
  if (kind === "bold" && typeof v === "string") return `<c r="${ref}" t="inlineStr" s="7"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  if (kind === "head") return `<c r="${ref}" t="inlineStr" s="1"><is><t>${esc(String(v))}</t></is></c>`;
  if (typeof v === "number" && Number.isFinite(v)) {
    return `<c r="${ref}" s="${kind === "total" ? (money ? 4 : 5) : money || !Number.isInteger(v) ? 2 : 0}"><v>${v}</v></c>`;
  }
  const s = String(v);
  if (kind === "body" && ISO_DATE.test(s)) return `<c r="${ref}" s="3"><v>${serial(s)}</v></c>`;
  return `<c r="${ref}" t="inlineStr" s="${kind === "total" ? 5 : 0}"><is><t xml:space="preserve">${esc(s)}</t></is></c>`;
}

function sheetXml(sh: Sheet) {
  const cols = sh.header.length;
  const title = sh.title ?? [];
  const off = title.length ? title.length + 1 : 0; // празен ред по насловот
  const headRow = off + 1;
  const widths = sh.widths ?? sh.header.map((h, i) => {
    const longest = Math.max(h.length, ...sh.rows.slice(0, 300).map(r => {
      const v = r[i]; if (v === null || v === undefined) return 0;
      if (typeof v === "number") return Math.min(18, v.toLocaleString("mk-MK", { maximumFractionDigits: 2 }).length + 2);
      return ISO_DATE.test(String(v)) ? 11 : String(v).length;
    }));
    return Math.min(60, Math.max(8, longest + 2));
  });
  const money = moneyCols(sh);
  const rowsXml: string[] = [];
  title.forEach((t, i) => rowsXml.push(`<row r="${i + 1}">${cellXml(`A${i + 1}`, t, "title")}</row>`));
  rowsXml.push(`<row r="${headRow}">${sh.header.map((h, c) => cellXml(`${colName(c)}${headRow}`, h, "head")).join("")}</row>`);
  const bold = new Set(sh.boldRows ?? []);
  sh.rows.forEach((r, i) => {
    const n = headRow + 1 + i;
    rowsXml.push(`<row r="${n}">${r.slice(0, cols).map((v, c) => cellXml(`${colName(c)}${n}`, v, bold.has(i) ? "bold" : "body", money.has(c))).join("")}</row>`);
  });
  if (sh.total) {
    const n = headRow + 1 + sh.rows.length;
    rowsXml.push(`<row r="${n}">${sh.total.slice(0, cols).map((v, c) => cellXml(`${colName(c)}${n}`, v, "total", money.has(c))).join("")}</row>`);
  }
  const lastCol = colName(Math.max(0, cols - 1));
  const lastRow = headRow + sh.rows.length;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>${rowsXml.join("")}</sheetData>
${sh.rows.length ? `<autoFilter ref="A${headRow}:${lastCol}${lastRow}"/>` : ""}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

/** Симни датотека (Blob) со дадено име. */
export function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Направи .xlsx со еден или повеќе листови и симни го. */
export async function downloadXlsx(filename: string, sheets: Sheet[]) {
  saveBlob(await buildXlsx(sheets), filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

/** .xlsx како Blob (за симнување, ZIP или прилог во е-пошта). */
export async function buildXlsx(sheets: Sheet[]): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  // без посебни записи за папки (Excel ги сака само датотеките)
  const zip = new JSZip();
  const put = (path: string, data: string) => zip.file(path, data, { createFolders: false });
  const used = new Set<string>();
  const names = sheets.map(s => safeSheetName(s.name, used));
  put("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
</Types>`);
  put("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  // скриени имиња за филтрите; празен <definedNames/> Excel го смета за грешка, па се изоставува
  const filters = sheets.map((s, i) => {
    if (!s.rows.length) return "";
    const top = (s.title?.length ? s.title.length + 1 : 0) + 1;
    return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i]).replace(/'/g, "''")}'!$A$${top}:$${colName(s.header.length - 1)}$${top + s.rows.length}</definedName>`;
  }).join("");
  const definedNames = filters ? `<definedNames>${filters}</definedNames>` : "";
  put("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
${definedNames}
</workbook>`);
  put("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  put("xl/styles.xml", STYLES);
  sheets.forEach((s, i) => put(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", compression: "DEFLATE" });
}

/** Еден лист од табела каде првиот ред е насловот (за постоечките „Excel“ копчиња). */
export function downloadTableXlsx(filename: string, sheetName: string, rows: Cell[][], total?: Cell[]) {
  const [header, ...body] = rows;
  return downloadXlsx(filename, [{ name: sheetName, header: (header ?? []).map(String), rows: body, total }]);
}
