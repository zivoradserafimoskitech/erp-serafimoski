// ===== УЈП е-Фактура API Service =====
// Комуникација со УЈП е-фактура систем преку API

const UJP_TEST_BASE = "https://efakturatest.ujp.gov.mk";
const UJP_PROD_BASE = "https://efaktura.ujp.gov.mk";

// Користи тест околина по дифолт
const API_BASE = process.env.UJP_ENV === "production" ? UJP_PROD_BASE : UJP_TEST_BASE;

export interface UJPCompany {
  edb: string;
  name: string;
  address: string;
  city: string;
  postalCode: string;
  vatRegistered: boolean;
  vatNumber: string | null;
}

export interface UJPInvoiceItem {
  lineNumber: number;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  vatRate: number;
  vatAmount: number;
}

export interface UJPInvoicePayload {
  invoiceNumber: string;
  issueDate: string;
  dueDate?: string;
  sellerEdb: string;
  sellerName: string;
  sellerAddress: string;
  sellerCity: string;
  sellerVatNumber: string | null;
  buyerEdb: string;
  buyerName: string;
  buyerAddress: string;
  buyerCity: string;
  buyerVatNumber: string | null;
  currency: string;
  paymentType: string;
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
  items: UJPInvoiceItem[];
  notes?: string;
}

export interface UJPResponse {
  euid?: string;
  message: string;
  qr_link?: string;
  status: number;
  timestamp?: string;
  error?: string;
}

export interface UJPStatusResponse {
  euid: string;
  invoiceNumber: string;
  status: string; // 00=Draft, 01=Submitted, 03=Accepted, 05=Rejected, 07=Voided
  statusLabel: string;
  timestamp: string;
  buyerStatus?: string;
  rejectionReason?: string;
  rejectionComment?: string;
}

/**
 * Пребарување на компанија по ЕДБ во УЈП регистар
 */
export async function lookupCompany(edb: string): Promise<UJPCompany | null> {
  try {
    const res = await fetch(`${API_BASE}/companies/${edb}`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return {
      edb: data.edb || data.taxNumber || edb,
      name: data.name || "",
      address: data.address || data.street || "",
      city: data.city || "",
      postalCode: data.postalCode || "",
      vatRegistered: data.vatRegistered || false,
      vatNumber: data.vatNumber || null,
    };
  } catch {
    return null;
  }
}

/**
 * Испраќање на фактура до УЈП
 * Во реална ситуација овде би се додал JWS потпис со сертификат
 */
export async function sendInvoice(payload: UJPInvoicePayload, certificateData?: { cert: string; pin: string }): Promise<UJPResponse> {
  try {
    // Конструирање на УЈП JSON формат
    const ujpPayload = buildUJPPayload(payload);

    // Во тест фаза - симулирање на успешен одговор
    // Во продукција овде би се потпишувало со JWS и се праќало на УЈП
    if (!certificateData) {
      // Тест режим - симулиран одговор
      return simulateUJPResponse(payload.invoiceNumber);
    }

    // Реално испраќање до УЈП
    const jws = await signPayload(ujpPayload, certificateData);
    const res = await fetch(`${API_BASE}/JSONReceiver/sales-invoices/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/jws",
        "Accept": "application/json",
        "X-EUJPID": certificateData.cert,
      },
      body: jws,
    });

    if (!res.ok) {
      const err = await res.text();
      return { status: res.status, message: err, error: err };
    }

    return await res.json() as UJPResponse;
  } catch (err: any) {
    return { status: 500, message: err.message, error: err.message };
  }
}

/**
 * Проверка на статус на испратена фактура
 */
export async function checkInvoiceStatus(euid: string): Promise<UJPStatusResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/sales-invoice/changes?euid=${euid}`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return parseStatusResponse(data);
  } catch {
    return null;
  }
}

/**
 * Преземање на УЈП PDF за фактура
 */
export async function downloadUJPPdf(euid: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${API_BASE}/einvoice_api/documents/sales-invoice/pdf?euid=${euid}`, {
      method: "GET",
      headers: {
        "Accept": "application/pdf",
      },
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Проверка на промени во статусите за период
 */
export async function getStatusChanges(date: string): Promise<UJPStatusResponse[]> {
  try {
    const res = await fetch(`${API_BASE}/sales-invoice/changes?date=${date}`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data.changes || []).map(parseStatusResponse).filter(Boolean);
  } catch {
    return [];
  }
}

// ===== HELPERS =====

function buildUJPPayload(p: UJPInvoicePayload): any {
  return {
    invoiceNumber: p.invoiceNumber,
    issueDate: p.issueDate,
    dueDate: p.dueDate || p.issueDate,
    documentCurrencyCode: p.currency || "MKD",
    paymentType: p.paymentType || "42", // 42 = По фактура
    seller: {
      edb: p.sellerEdb,
      name: p.sellerName,
      address: {
        street: p.sellerAddress,
        city: p.sellerCity,
      },
      vatNumber: p.sellerVatNumber,
    },
    buyer: {
      edb: p.buyerEdb,
      name: p.buyerName,
      address: {
        street: p.buyerAddress,
        city: p.buyerCity,
      },
      vatNumber: p.buyerVatNumber,
    },
    lineItems: p.items.map((item, idx) => ({
      lineNumber: idx + 1,
      description: item.description,
      quantity: item.quantity,
      unitCode: mapUnitCode(item.unit),
      unitPrice: item.unitPrice,
      lineTotal: item.totalPrice,
      vatRate: item.vatRate,
      vatAmount: item.vatAmount,
    })),
    taxTotals: [{
      taxType: "VAT",
      taxableAmount: p.subtotal,
      taxAmount: p.vatAmount,
      taxPercentage: p.items[0]?.vatRate || 18,
    }],
    legalMonetaryTotal: {
      lineExtensionAmount: p.subtotal,
      taxExclusiveAmount: p.subtotal,
      taxInclusiveAmount: p.totalAmount,
      payableAmount: p.totalAmount,
    },
    note: p.notes || "",
  };
}

function mapUnitCode(unit: string): string {
  const map: Record<string, string> = {
    m2: "MTK", m: "MTR", kg: "KGM", pcs: "C62", kom: "C62",
    hour: "HUR", set: "SET", l: "LTR", job: "C62",
  };
  return map[unit] || "C62";
}

function simulateUJPResponse(_invoiceNumber: string): UJPResponse {
  const euid = crypto.randomUUID();
  return {
    euid,
    message: "Invoice saved successfully (TEST MODE)",
    qr_link: `${API_BASE}/euid/${euid}`,
    status: 200,
    timestamp: new Date().toISOString(),
  };
}

async function signPayload(payload: any, certData: { cert: string; pin: string }): Promise<string> {
  // Оваа функција би го креирала JWS потписот со квалификуван сертификат
  // За сега враќање на JSON како string - во продукција ова е JWS
  const header = { alg: "RS256", typ: "JWS", x5c: [certData.cert] };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  // Симулиран потпис - во продукција ова е реален криптографски потпис
  const signature = "SIMULATED_SIGNATURE_" + Date.now();
  return `${headerB64}.${payloadB64}.${signature}`;
}

function parseStatusResponse(data: any): UJPStatusResponse {
  const statusMap: Record<string, string> = {
    "00": "Draft", "01": "Submitted", "03": "Accepted",
    "05": "Rejected", "07": "Voided",
  };
  return {
    euid: data.euid || "",
    invoiceNumber: data.invoiceNumber || "",
    status: data.status || "00",
    statusLabel: statusMap[data.status] || `Status ${data.status}`,
    timestamp: data.timestamp || new Date().toISOString(),
    buyerStatus: data.buyerStatus,
    rejectionReason: data.rejectionReason,
    rejectionComment: data.rejectionComment,
  };
}

/**
 * Генерирање на УЈП XML формат (UBL 2.1 Invoice)
 */
export function generateUJPXml(invoice: any): string {
  const issueDate = invoice.issueDate ? String(invoice.issueDate).split("T")[0] : new Date().toISOString().split("T")[0];
  const total = invoice.totalAmount || "0";
  const vat = invoice.vatAmount || "0";
  const subtotal = invoice.subtotal || "0";
  const vatRate = invoice.vatRate || "18";
  const currency = invoice.currency || "MKD";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>${escapeXml(invoice.invoiceNumber)}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>${currency}</cbc:TaxCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(invoice.sellerName || "Вашата Фирма")}</cbc:RegistrationName>
        <cbc:CompanyID>${escapeXml(invoice.sellerEdb || "MK1234567890123")}</cbc:CompanyID>
      </cac:PartyLegalEntity>
      ${invoice.sellerVatNumber ? `<cbc:CompanyID schemeID="VAT">${escapeXml(invoice.sellerVatNumber)}</cbc:CompanyID>` : ""}
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(invoice.buyerName || invoice.customerName || "")}</cbc:RegistrationName>
        <cbc:CompanyID>${escapeXml(invoice.buyerEdb || "")}</cbc:CompanyID>
      </cac:PartyLegalEntity>
      ${invoice.buyerVatNumber ? `<cbc:CompanyID schemeID="VAT">${escapeXml(invoice.buyerVatNumber)}</cbc:CompanyID>` : ""}
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${vat}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${subtotal}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${vat}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${vatRate}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${subtotal}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${subtotal}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${total}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${currency}">${total}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${(invoice.items || []).map((item: any, idx: number) => `
  <cac:InvoiceLine>
    <cbc:ID>${idx + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${mapUnitCode(item.unit || "pcs")}">${item.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currency}">${item.totalPrice || item.lineTotal || "0"}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${escapeXml(item.description)}</cbc:Name>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currency}">${item.unitPrice}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`).join("")}
</Invoice>`;
}

function escapeXml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
