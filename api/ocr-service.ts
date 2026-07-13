import { getDb } from "./queries/connection";
import { materials, suppliers } from "@db/schema";
import { eq } from "drizzle-orm";

// Dynamic imports for ESM compatibility
let Fuse: any;
let pdfParse: any;

async function loadDeps() {
  if (!Fuse) {
    const fuseMod = await import("fuse.js");
    Fuse = fuseMod.default || fuseMod;
  }
  if (!pdfParse) {
    const { createRequire } = await import("module");
    const require = createRequire(import.meta.url);
    pdfParse = require("pdf-parse");
  }
}

export interface ExtractedItem {
  rawDescription: string;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  totalPrice: string | null;
  vatRate: string | null;
}

export interface ParsedDocument {
  supplierName: string | null;
  documentNumber: string | null;
  issueDate: string | null;
  totalAmount: string | null;
  vatAmount: string | null;
  currency: string | null;
  rawText: string;
  items: ExtractedItem[];
}

export interface MatchedItem {
  rawDescription: string;
  matchedMaterialId: number | null;
  matchedMaterialName: string | null;
  matchConfidence: number;
  quantity: string | null;
  unit: string | null;
  unitPrice: string | null;
  totalPrice: string | null;
  vatRate: string | null;
}

// Parse quantity from text
function parseQuantity(text: string): { quantity: string | null; unit: string | null } {
  const patterns = [
    // "100 kg", "1.5 m2", "2,50 m" etc.
    /(\d+[.,]?\d*)\s*(kg|кг|m2|м2|m\^2|m|м|kom|ком|pcs|шт|l|л|m_cut|bend|sheet|tab)/i,
    // Number followed by unit in same word
    /(\d+[.,]?\d*)\s*(бр|кг|м2|м|л|т|mm|cm)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const qty = match[1].replace(",", ".");
      let unit = match[2].toLowerCase();
      // Normalize units
      if (unit === "кг") unit = "kg";
      if (unit === "м2" || unit === "m^2") unit = "m2";
      if (unit === "м") unit = "m";
      if (unit === "ком" || unit === "бр" || unit === "шт") unit = "pcs";
      if (unit === "л") unit = "l";
      if (unit === "т") unit = "kg";
      return { quantity: qty, unit };
    }
  }

  // Try to find just a number
  const numMatch = text.match(/(\d+[.,]?\d*)/);
  if (numMatch) {
    return { quantity: numMatch[1].replace(",", "."), unit: null };
  }

  return { quantity: null, unit: null };
}

// Parse price from text
function parsePrice(text: string): string | null {
  // Match MKD price patterns: "1.234,56", "1234.56", "1,234.56 MKD"
  const patterns = [
    /(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})/, // "1.234,56" or "1,234.56"
    /(\d+[.,]\d{2})/, // "123.45"
    /(\d+)/, // Just a number
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let price = match[1].replace(/\./g, "").replace(",", ".");
      // If it was "1.234,56" -> remove all dots then replace comma
      // If it was "1,234.56" -> remove comma
      if (match[1].includes(".") && match[1].includes(",")) {
        // Determine which is decimal separator
        const lastDot = match[1].lastIndexOf(".");
        const lastComma = match[1].lastIndexOf(",");
        if (lastComma > lastDot) {
          // "1.234,56" format (European)
          price = match[1].replace(/\./g, "").replace(",", ".");
        } else {
          // "1,234.56" format (US)
          price = match[1].replace(/,/g, "");
        }
      }
      return price;
    }
  }
  return null;
}

// Extract document info from raw text
function extractDocumentInfo(text: string): {
  supplierName: string | null;
  documentNumber: string | null;
  issueDate: string | null;
  totalAmount: string | null;
  vatAmount: string | null;
  currency: string | null;
} {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  // Try to find supplier name - usually first few lines contain company name
  let supplierName: string | null = null;
  const supplierPatterns = [
    /(?:добавувач|испраќач|од|supplier|from|seller)[\s:]*(.{3,100})/i,
    /(?:добавувач|испраќач|од|supplier|from|seller)[\s:]*\n?(.{3,100})/i,
  ];
  for (const pattern of supplierPatterns) {
    const match = text.match(pattern);
    if (match) {
      supplierName = match[1].trim().substring(0, 100);
      break;
    }
  }
  // Fallback: check known suppliers from text
  if (!supplierName) {
    const knownSuppliers = ["Metal Net", "Метал Нет", "BAUMANN", "SALVAGNINI", "ARKU", "WEMO"];
    for (const name of knownSuppliers) {
      if (text.toLowerCase().includes(name.toLowerCase())) {
        supplierName = name;
        break;
      }
    }
  }

  // Find document number - patterns like "ПР-001/2025", "Invoice #123", "Ф-123"
  let documentNumber: string | null = null;
  const docNumPatterns = [
    /(?:приемница|фактура|испратница|документ)[\s#№:\-]*([A-ZА-Я]{0,4}\s*[-]?\d+[/\-]?\d{0,4})/i,
    /(?:број|br|no|№)[.\s:\-]*([A-ZА-Я]{0,4}\s*[-]?\d+[/\-]?\d{0,4})/i,
    /#\s*(\d+)/,
    /ПР\s*[-]?\d+[/\-]?\d{2,4}/i,
    /[A-Z]{2,4}\s*[-]?\d+[/\-]\d{2,4}/i,
  ];
  for (const pattern of docNumPatterns) {
    const match = text.match(pattern);
    if (match) {
      documentNumber = match[0].substring(0, 50);
      break;
    }
  }

  // Find date - DD.MM.YYYY or DD/MM/YYYY or YYYY-MM-DD
  let issueDate: string | null = null;
  const datePatterns = [
    /(\d{2}[./-]\d{2}[./-]\d{4})/,
    /(\d{4}[./-]\d{2}[./-]\d{2})/,
  ];
  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      const d = match[1];
      if (d.includes(".")) {
        const parts = d.split(".");
        issueDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
      } else if (d.includes("/")) {
        const parts = d.split("/");
        issueDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
      } else {
        issueDate = d;
      }
      break;
    }
  }

  // Find total amount - usually near words like "вкупно", "total", "сума"
  let totalAmount: string | null = null;
  const totalPatterns = [
    /(?:вкупно|total|сума|задолжување|износ|сум)[\s:]*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})/i,
    /(?:вкупно|total|сума|задолжување|износ|сум)[\s:]*(\d+[.,]\d{1,2})/i,
  ];
  for (const pattern of totalPatterns) {
    const match = text.match(pattern);
    if (match) {
      totalAmount = parsePrice(match[1]);
      break;
    }
  }

  // Find VAT amount
  let vatAmount: string | null = null;
  const vatPatterns = [
    /(?:ддв|vat|данок)[\s:]*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})/i,
    /(?:ддв|vat|данок)[\s:]*(\d+[.,]\d{1,2})/i,
  ];
  for (const pattern of vatPatterns) {
    const match = text.match(pattern);
    if (match) {
      vatAmount = parsePrice(match[1]);
      break;
    }
  }

  // Currency detection
  let currency = "MKD";
  if (text.includes("EUR") || text.includes("€")) currency = "EUR";
  if (text.includes("USD") || text.includes("$")) currency = "USD";

  return { supplierName, documentNumber, issueDate, totalAmount, vatAmount, currency };
}

// Extract line items from receipt text
function extractItems(text: string): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  // Skip header/footer lines that don't look like items
  const skipPatterns = [
    /^(добавувач|испраќач|купувач|примател|датум|број|вкупно|сума|ддв|данок|банка|тел|факс|емаил|адреса|iban|swif)/i,
    /^(page|tel|fax|email|address|bank|www|http|потврди|одобри|забелешка)/i,
    /^(реон|скопје|гази баба|битола|тетово|охрид|куманово|прилеп)/i,
    /^(едб|ембс|жиро|сметка|даночен број)/i,
    /^№?\s*\d+\s*(од|од\s+вкупно)\s*\d+/i, // "1 од 2" page numbering
    /^(датум| Datum|месец|година)/i,
  ];

  // Improved item detection: look for lines with material-like descriptions + numbers
  for (const line of lines) {
    let shouldSkip = false;
    for (const pattern of skipPatterns) {
      if (pattern.test(line)) {
        shouldSkip = true;
        break;
      }
    }
    if (shouldSkip) continue;
    if (line.length < 5) continue; // Too short to be an item

    // Check if line has numbers that could be quantity and price
    const numbers = line.match(/\d+[.,]?\d*/g);
    if (!numbers || numbers.length < 2) continue; // Need at least qty and price

    const { quantity, unit } = parseQuantity(line);
    const unitPrice = parsePrice(line);

    // Try to get total price - usually last number
    let totalPrice: string | null = null;
    if (numbers.length >= 3) {
      const lastNum = numbers[numbers.length - 1];
      totalPrice = parsePrice(lastNum);
    }

    // Check for table-like format: description qty unit price total
    // Try to extract description from before the first number
    const firstNumMatch = line.match(/\d+[.,]?\d*/);
    let description = line;
    if (firstNumMatch && firstNumMatch.index && firstNumMatch.index > 3) {
      description = line.substring(0, firstNumMatch.index).trim();
    }

    // If description is too short, try alternative approach
    if (description.length < 3) {
      description = line
        .replace(/\d+[.,]?\d*\s*(kg|кг|m2|м2|m|м|kom|ком|pcs|шт|l|л|m_cut|bend|sheet|tab|бр|mm|cm)/gi, "")
        .replace(/\d+[.,]?\d*/g, "")
        .replace(/[\s_\-]+/g, " ")
        .trim();
    }

    if (description.length < 3) continue;

    items.push({
      rawDescription: line,
      quantity,
      unit,
      unitPrice,
      totalPrice,
      vatRate: "18",
    });
  }

  // If no items found with line-by-line, try structured patterns
  if (items.length === 0) {
    // Pattern: description | qty | unit | unitPrice | totalPrice
    const tableRowPattern = /^(.{3,50}?)[\s|]+(\d+[.,]?\d*)\s+(кг|kg|м|m|м2|m2|ком|ком.|бр|шт|pcs|л|l|таб)[\s|]+(\d+[.,]?\d*)[\s|]+(\d+[.,]?\d*)/gim;
    let match;
    while ((match = tableRowPattern.exec(text)) !== null) {
      const desc = match[1].trim();
      const qty = match[2].replace(",", ".");
      let u = match[3].trim().toLowerCase();
      const price = parsePrice(match[4]);
      const total = parsePrice(match[5]);

      if (u === "кг") u = "kg";
      else if (u === "м2" || u === "m^2") u = "m2";
      else if (u === "м") u = "m";
      else if (u === "ком" || u === "ком." || u === "бр" || u === "шт") u = "pcs";
      else if (u === "л") u = "l";
      else if (u === "таб") u = "sheet";

      items.push({
        rawDescription: desc,
        quantity: qty,
        unit: u,
        unitPrice: price,
        totalPrice: total,
        vatRate: "18",
      });
    }
  }

  // Try pipe-separated table format
  if (items.length === 0) {
    const pipePattern = /\|\s*(.{3,40}?)\s*\|\s*(\d+[.,]?\d*)\s*\|\s*(\w+)\s*\|\s*(\d+[.,]?\d*)\s*\|\s*(\d+[.,]?\d*)\s*\|/gi;
    let match;
    while ((match = pipePattern.exec(text)) !== null) {
      const desc = match[1].trim();
      const qty = match[2].replace(",", ".");
      let u = match[3].trim().toLowerCase();
      const price = parsePrice(match[4]);
      const total = parsePrice(match[5]);

      if (u === "кг") u = "kg";
      else if (u === "м2" || u === "m^2") u = "m2";
      else if (u === "м") u = "m";
      else if (u === "ком" || u === "ком.") u = "pcs";

      items.push({
        rawDescription: desc,
        quantity: qty,
        unit: u,
        unitPrice: price,
        totalPrice: total,
        vatRate: "18",
      });
    }
  }

  // Deduplicate items with same description
  const seen = new Set<string>();
  return items.filter(item => {
    const key = item.rawDescription.toLowerCase().substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Match extracted items against materials catalog
export async function matchItemsToMaterials(
  items: ExtractedItem[],
  threshold: number = 0.3
): Promise<MatchedItem[]> {
  const db = getDb();
  const allMaterials = await db
    .select({ id: materials.id, name: materials.name, code: materials.code })
    .from(materials)
    .where(eq(materials.isActive, "active"));

  if (allMaterials.length === 0) {
    return items.map(item => ({
      ...item,
      matchedMaterialId: null,
      matchedMaterialName: null,
      matchConfidence: 0,
    }));
  }

  await loadDeps();

  // Build searchable list
  const searchList = allMaterials.map(m => ({
    id: m.id,
    name: m.name,
    code: m.code,
    combined: `${m.name} ${m.code}`,
  }));

  const fuseOptions = {
    keys: ["name", "code", "combined"],
    threshold: threshold,
    includeScore: true,
  };

  const fuse = new Fuse(searchList, fuseOptions);

  return items.map(item => {
    const searchResults = fuse.search(item.rawDescription);

    if (searchResults.length > 0 && searchResults[0].score !== undefined) {
      const best = searchResults[0];
      const confidence = Math.round((1 - best.score) * 100);

      return {
        ...item,
        matchedMaterialId: best.item.id,
        matchedMaterialName: best.item.name,
        matchConfidence: confidence,
      };
    }

    return {
      ...item,
      matchedMaterialId: null,
      matchedMaterialName: null,
      matchConfidence: 0,
    };
  });
}

// Main function to parse a PDF buffer
export async function parsePdfDocument(buffer: Buffer): Promise<ParsedDocument> {
  let rawText = "";

  try {
    await loadDeps();
    const pdfData = await pdfParse(buffer);
    rawText = pdfData.text;
  } catch (error) {
    console.error("PDF parse error:", error);
    rawText = "";
  }

  if (!rawText || rawText.trim().length === 0) {
    return {
      supplierName: null,
      documentNumber: null,
      issueDate: null,
      totalAmount: null,
      vatAmount: null,
      currency: "MKD",
      rawText: "",
      items: [],
    };
  }

  const docInfo = extractDocumentInfo(rawText);
  const items = extractItems(rawText);

  return {
    ...docInfo,
    rawText,
    items,
  };
}

// Parse text document (for direct text input or image OCR)
export async function parseTextDocument(text: string): Promise<ParsedDocument> {
  const docInfo = extractDocumentInfo(text);
  const items = extractItems(text);

  return {
    ...docInfo,
    rawText: text,
    items,
  };
}

// Get list of all active materials for matching
export async function getMaterialsForMatching(): Promise<
  Array<{ id: number; name: string; code: string }>
> {
  const db = getDb();
  return db
    .select({ id: materials.id, name: materials.name, code: materials.code })
    .from(materials)
    .where(eq(materials.isActive, "active"));
}
