// ===== УЈП е-Фактура API Service =====
// Комуникација со УЈП е-фактура систем преку API со JWS потпис

import { SignJWT, importPKCS8, importX509 } from "jose";
import { getDb } from "./queries/connection";
import { digitalCertificates } from "@db/schema";
import { eq, desc } from "drizzle-orm";

const UJP_TEST_BASE = "https://efakturatest.ujp.gov.mk";
const UJP_PROD_BASE = "https://efaktura.ujp.gov.mk";

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
  status: string;
  statusLabel: string;
  timestamp: string;
  buyerStatus?: string;
  rejectionReason?: string;
  rejectionComment?: string;
}

export interface CertificateInfo {
  id: number;
  name: string;
  certType: string;
  issuer: string | null;
  serialNumber: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  edb: string | null;
  isActive: string;
  lastUsedAt: Date | null;
}

// ===== CERTIFICATE MANAGEMENT =====

/**
 * Ги враќа активните сертификати од базата
 */
export async function getActiveCertificates(): Promise<CertificateInfo[]> {
  const db = getDb();
  return db
    .select({
      id: digitalCertificates.id,
      name: digitalCertificates.name,
      certType: digitalCertificates.certType,
      issuer: digitalCertificates.issuer,
      serialNumber: digitalCertificates.serialNumber,
      validFrom: digitalCertificates.validFrom,
      validTo: digitalCertificates.validTo,
      edb: digitalCertificates.edb,
      isActive: digitalCertificates.isActive,
      lastUsedAt: digitalCertificates.lastUsedAt,
    })
    .from(digitalCertificates)
    .where(eq(digitalCertificates.isActive, "active"))
    .orderBy(desc(digitalCertificates.createdAt));
}

/**
 * Зема сертификат со дешифриран приватен клуч
 */
export async function getCertificateWithKey(certId: number, decryptionKey?: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(digitalCertificates)
    .where(eq(digitalCertificates.id, certId));

  if (!rows[0]) return null;
  const cert = rows[0];

  // Провери валидност
  if (cert.validTo && new Date(cert.validTo) < new Date()) {
    await db
      .update(digitalCertificates)
      .set({ isActive: "expired" })
      .where(eq(digitalCertificates.id, certId));
    throw new Error("Сертификатот е истечен");
  }

  return {
    certificatePem: cert.certificatePem,
    privateKeyPem: cert.privateKeyEncrypted, // Ако е енкриптиран, треба дешифрирање
    hasPrivateKey: !!cert.privateKeyEncrypted,
  };
}

/**
 * Чување на нов сертификат
 */
export async function storeCertificate(data: {
  name: string;
  certType: "qualified" | "advanced" | "test";
  certificatePem: string;
  privateKeyPem?: string;
  issuer?: string;
  serialNumber?: string;
  validFrom?: string;
  validTo?: string;
  edb?: string;
}) {
  const db = getDb();

  // Енкриптирај го приватниот клуч ако постои
  let encryptedKey: string | undefined;
  let encryptionIv: string | undefined;
  let encryptionAuthTag: string | undefined;

  if (data.privateKeyPem) {
    const crypto = await import("node:crypto");
    const iv = crypto.randomBytes(16);
    const masterKey = getMasterKey();
    const cipher = crypto.createCipheriv("aes-256-cbc", masterKey, iv);
    encryptedKey = cipher.update(data.privateKeyPem, "utf8", "base64");
    encryptedKey += cipher.final("base64");
    encryptionIv = iv.toString("base64");
    encryptionAuthTag = (cipher as any).getAuthTag?.()?.toString("base64");
  }

  const result = await db.insert(digitalCertificates).values({
    name: data.name,
    certType: data.certType,
    certificatePem: data.certificatePem,
    privateKeyEncrypted: encryptedKey,
    encryptionIv,
    encryptionAuthTag,
    issuer: data.issuer ?? null,
    serialNumber: data.serialNumber ?? null,
    validFrom: data.validFrom ? new Date(data.validFrom) : null,
    validTo: data.validTo ? new Date(data.validTo) : null,
    edb: data.edb ?? null,
    isActive: "active",
  } as any);

  return Number(result[0].insertId);
}

/**
 * Дешифрирање на приватен клуч
 */
async function decryptPrivateKey(cert: any): Promise<string | null> {
  if (!cert.privateKeyEncrypted) return null;
  try {
    const crypto = await import("node:crypto");
    const iv = Buffer.from(cert.encryptionIv, "base64");
    const masterKey = getMasterKey();
    const decipher = crypto.createDecipheriv("aes-256-cbc", masterKey, iv);
    let decrypted = decipher.update(cert.privateKeyEncrypted, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return null;
  }
}

function getMasterKey(): Buffer {
  // Мастер клучот треба да доаѓа од environment variable
  const key = process.env.CERT_ENCRYPTION_KEY;
  if (!key) {
    // Fallback за dev - НЕ КОРИСТИ во продукција!
    console.warn("CERT_ENCRYPTION_KEY not set, using fallback key");
    return Buffer.from("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "hex");
  }
  // Хеширај го за да добиеш 32 бајти
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(key).digest();
}

// ===== JWS SIGNING =====

/**
 * Креирање на JWS потпис за УЈП
 * Ова е критичната функција за правна важност на фактурата
 */
async function createJWS(payload: any, certId: number): Promise<string> {
  const db = getDb();
  const rows = await db
    .select()
    .from(digitalCertificates)
    .where(eq(digitalCertificates.id, certId));

  if (!rows[0]) throw new Error("Сертификатот не е пронајден");
  const cert = rows[0];

  if (cert.validTo && new Date(cert.validTo) < new Date()) {
    throw new Error("Сертификатот е истечен. Обновете го за да испраќате фактури.");
  }

  // Дешифрирај го приватниот клуч
  const privateKeyPem = await decryptPrivateKey(cert);
  if (!privateKeyPem) {
    throw new Error("Приватниот клуч не е достапен. Прикачете го сертификатот со приватен клуч.");
  }

  try {
    // Увези го приватниот клуч
    const privateKey = await importPKCS8(privateKeyPem, "RS256");

    // Увези го сертификатот за x5c хедер
    const x509Cert = cert.certificatePem
      .replace(/-----BEGIN CERTIFICATE-----/g, "")
      .replace(/-----END CERTIFICATE-----/g, "")
      .replace(/\s/g, "");

    // Креирај JWS
    const jws = await new SignJWT(payload)
      .setProtectedHeader({
        alg: "RS256",
        typ: "JWS",
        x5c: [x509Cert],
      })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    // Ажурирај lastUsedAt
    await db
      .update(digitalCertificates)
      .set({ lastUsedAt: new Date() })
      .where(eq(digitalCertificates.id, certId));

    return jws;
  } catch (err: any) {
    throw new Error(`Грешка при потпишување: ${err.message}`);
  }
}

// ===== UJP API CALLS =====

/**
 * Пребарување на компанија по ЕДБ во УЈП регистар
 */
export async function lookupCompany(edb: string): Promise<UJPCompany | null> {
  try {
    const res = await fetch(`${API_BASE}/companies/${edb}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
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
 * Испраќање на фактура до УЈП со JWS потпис
 */
export async function sendInvoice(
  payload: UJPInvoicePayload,
  certId?: number,
  certificateData?: { cert: string; pin: string }
): Promise<UJPResponse> {
  try {
    // Конструирање на УЈП JSON формат
    const ujpPayload = buildUJPPayload(payload);

    // TEST MODE: Ако нема сертификат, користи симулација
    if (!certId && !certificateData) {
      console.warn("[UJP] Испраќање во ТЕСТ режим (без сертификат)");
      return simulateUJPResponse(payload.invoiceNumber);
    }

    // PRODUCTION MODE: Потпиши со JWS
    let jws: string;
    if (certId) {
      jws = await createJWS(ujpPayload, certId);
    } else if (certificateData) {
      // Legacy mode - PEM сертификат директно
      jws = await createJWSFromPem(ujpPayload, certificateData);
    } else {
      throw new Error("Нема сертификат за потпишување");
    }

    // Испрати до УЈП
    const res = await fetch(`${API_BASE}/JSONReceiver/sales-invoices/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/jws",
        Accept: "application/json",
      },
      body: jws,
    });

    if (!res.ok) {
      const err = await res.text();
      return { status: res.status, message: err, error: err };
    }

    return (await res.json()) as UJPResponse;
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
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
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
    const res = await fetch(
      `${API_BASE}/einvoice_api/documents/sales-invoice/pdf?euid=${euid}`,
      { method: "GET", headers: { Accept: "application/pdf" } }
    );
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
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
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
    paymentType: p.paymentType || "42",
    seller: {
      edb: p.sellerEdb,
      name: p.sellerName,
      address: { street: p.sellerAddress, city: p.sellerCity },
      vatNumber: p.sellerVatNumber,
    },
    buyer: {
      edb: p.buyerEdb,
      name: p.buyerName,
      address: { street: p.buyerAddress, city: p.buyerCity },
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
    taxTotals: [
      {
        taxType: "VAT",
        taxableAmount: p.subtotal,
        taxAmount: p.vatAmount,
        taxPercentage: p.items[0]?.vatRate || 18,
      },
    ],
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
    m2: "MTK",
    m: "MTR",
    kg: "KGM",
    pcs: "C62",
    kom: "C62",
    hour: "HUR",
    set: "SET",
    l: "LTR",
    job: "C62",
  };
  return map[unit] || "C62";
}

function simulateUJPResponse(_invoiceNumber: string): UJPResponse {
  const euid = crypto.randomUUID();
  return {
    euid,
    message: "Invoice saved successfully (TEST MODE - без правна важност)",
    qr_link: `${API_BASE}/euid/${euid}`,
    status: 200,
    timestamp: new Date().toISOString(),
  };
}

async function createJWSFromPem(
  payload: any,
  certData: { cert: string; pin: string }
): Promise<string> {
  // Legacy mode - креирање JWS од PEM сертификат
  const privateKey = await importPKCS8(certData.cert, "RS256");
  const x509Cert = certData.cert
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s/g, "");

  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", typ: "JWS", x5c: [x509Cert] })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}

function parseStatusResponse(data: any): UJPStatusResponse {
  const statusMap: Record<string, string> = {
    "00": "Draft",
    "01": "Submitted",
    "03": "Accepted",
    "05": "Rejected",
    "07": "Voided",
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
  const issueDate = invoice.issueDate
    ? String(invoice.issueDate).split("T")[0]
    : new Date().toISOString().split("T")[0];
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
  ${(invoice.items || [])
      .map(
        (item: any, idx: number) => `
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
  </cac:InvoiceLine>`
      )
      .join("")}
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
