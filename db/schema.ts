import {
  pgTable,
  
  serial,
  varchar,
  text,
  timestamp,
  decimal,
  integer,
  bigint,
  date,
} from "drizzle-orm/pg-core";

// ============= COMPANY SETTINGS =============
export const companySettings = pgTable("company_settings", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  address: text("address"),
  edb: varchar("edb", { length: 20 }).notNull(),
  embs: varchar("embs", { length: 20 }),
  bankName: varchar("bank_name", { length: 255 }),
  bankAccount: varchar("bank_account", { length: 50 }),
  phone: varchar("phone", { length: 50 }),
  email: varchar("email", { length: 320 }),
  logoUrl: text("logo_url"),
  defaultVatRate: decimal("default_vat_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  valuationMethod: varchar("valuation_method", { length: 50 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull().default("MKD"),
  timezone: varchar("timezone", { length: 50 }).notNull(),
  emailImapHost: varchar("email_imap_host", { length: 255 }),
  emailImapPort: integer("email_imap_port").default(993),
  emailImapSecure: integer("email_imap_secure").default(1),
  emailUsername: varchar("email_username", { length: 255 }),
  emailPassword: varchar("email_password", { length: 255 }),
  emailCheckInterval: integer("email_check_interval").default(60),
  // Параметри за кроење / остатоци
  cutKerfMm: decimal("cut_kerf_mm", { precision: 6, scale: 1 }).default("2"),
  minRemnantMm: decimal("min_remnant_mm", { precision: 8, scale: 1 }).default("300"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type CompanySetting = typeof companySettings.$inferSelect;

// ============= USERS =============
// ============= РАСПРЕДЕЛБА НА УПЛАТИ =============
// Една банкарска ставка може да покрие повеќе фактури,
// и една фактура може да се плати од повеќе уплати.
export const paymentAllocations = pgTable("payment_allocations", {
  id: serial("id").primaryKey(),
  txId: bigint("tx_id", { mode: "number", unsigned: true }).notNull(),
  docType: varchar("doc_type", { length: 30 }).notNull(), // invoice | incoming_invoice
  docId: bigint("doc_id", { mode: "number", unsigned: true }).notNull(),
  docRef: varchar("doc_ref", { length: 120 }),
  amount: decimal("amount", { precision: 16, scale: 2 }).notNull().default("0"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PaymentAllocation = typeof paymentAllocations.$inferSelect;

// ============= ОСНОВНИ СРЕДСТВА =============
export const fixedAssets = pgTable("fixed_assets", {
  id: serial("id").primaryKey(),
  inventoryNo: varchar("inventory_no", { length: 40 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 60 }).notNull().default("machine"),
  description: text("description"),
  location: varchar("location", { length: 150 }),
  supplierId: bigint("supplier_id", { mode: "number", unsigned: true }),
  invoiceRef: varchar("invoice_ref", { length: 80 }),
  // Набавка
  acquisitionDate: date("acquisition_date").notNull(),
  acquisitionValue: decimal("acquisition_value", { precision: 16, scale: 2 }).notNull().default("0"),
  salvageValue: decimal("salvage_value", { precision: 16, scale: 2 }).notNull().default("0"),
  // Амортизација
  usefulLifeYears: decimal("useful_life_years", { precision: 6, scale: 2 }).notNull().default("5"),
  rate: decimal("rate", { precision: 6, scale: 2 }).notNull().default("20"),
  method: varchar("method", { length: 20 }).notNull().default("linear"),
  depreciationStart: date("depreciation_start"),
  // Состојба
  status: varchar("status", { length: 20 }).notNull().default("active"),
  disposalDate: date("disposal_date"),
  disposalValue: decimal("disposal_value", { precision: 16, scale: 2 }).default("0"),
  disposalNote: text("disposal_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type FixedAsset = typeof fixedAssets.$inferSelect;

// Пресметана амортизација по година — се запишува кога ќе се затвори годината
export const depreciationEntries = pgTable("depreciation_entries", {
  id: serial("id").primaryKey(),
  assetId: bigint("asset_id", { mode: "number", unsigned: true }).notNull(),
  year: integer("year").notNull(),
  months: integer("months").notNull().default(12),
  amount: decimal("amount", { precision: 16, scale: 2 }).notNull().default("0"),
  accumulatedAfter: decimal("accumulated_after", { precision: 16, scale: 2 }).notNull().default("0"),
  bookValueAfter: decimal("book_value_after", { precision: 16, scale: 2 }).notNull().default("0"),
  postedAt: timestamp("posted_at").defaultNow().notNull(),
  note: text("note"),
});

export type DepreciationEntry = typeof depreciationEntries.$inferSelect;

// ============= БАНКА: ИЗВОДИ И СТАВКИ =============
export const bankStatements = pgTable("bank_statements", {
  id: serial("id").primaryKey(),
  accountNumber: varchar("account_number", { length: 40 }).notNull(),
  statementNo: varchar("statement_no", { length: 20 }),
  statementDate: date("statement_date").notNull(),
  prevBalance: decimal("prev_balance", { precision: 16, scale: 2 }).default("0"),
  debitTotal: decimal("debit_total", { precision: 16, scale: 2 }).default("0"),
  creditTotal: decimal("credit_total", { precision: 16, scale: 2 }).default("0"),
  newBalance: decimal("new_balance", { precision: 16, scale: 2 }).default("0"),
  currency: varchar("currency", { length: 10 }).default("MKD"),
  sourceFormat: varchar("source_format", { length: 20 }),
  fileName: varchar("file_name", { length: 255 }),
  importedAt: timestamp("imported_at").defaultNow().notNull(),
});

export type BankStatement = typeof bankStatements.$inferSelect;

export const bankTransactions = pgTable("bank_transactions", {
  id: serial("id").primaryKey(),
  statementId: bigint("statement_id", { mode: "number", unsigned: true }),
  accountNumber: varchar("account_number", { length: 40 }),
  txDate: date("tx_date").notNull(),
  direction: varchar("direction", { length: 10 }).notNull(), // in | out
  amount: decimal("amount", { precision: 16, scale: 2 }).notNull().default("0"),
  provision: decimal("provision", { precision: 14, scale: 2 }).default("0"),
  counterpartyName: varchar("counterparty_name", { length: 255 }),
  counterpartyAccount: varchar("counterparty_account", { length: 40 }),
  purpose: text("purpose"),
  code: varchar("code", { length: 10 }),
  refPbo: varchar("ref_pbo", { length: 60 }),
  refPbz: varchar("ref_pbz", { length: 60 }),
  bankRef: varchar("bank_ref", { length: 60 }),
  // Поврзување со документ
  matchStatus: varchar("match_status", { length: 20 }).notNull().default("unmatched"),
  matchedType: varchar("matched_type", { length: 30 }),
  matchedId: bigint("matched_id", { mode: "number", unsigned: true }),
  matchedRef: varchar("matched_ref", { length: 120 }),
  partnerId: bigint("partner_id", { mode: "number", unsigned: true }),
  partnerType: varchar("partner_type", { length: 20 }),
  note: text("note"),
  dedupeKey: varchar("dedupe_key", { length: 180 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type BankTransaction = typeof bankTransactions.$inferSelect;

// ============= КОРИСНИЦИ НА АПЛИКАЦИЈАТА (улоги и пристап) =============
// Секој има свој код за влез. Улогата одредува што смее.
export const appUsers = pgTable("app_users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  passcode: varchar("passcode", { length: 120 }).notNull().unique(),
  role: varchar("role", { length: 20 }).notNull().default("operator"),
  isActive: varchar("is_active", { length: 20 }).notNull().default("active"),
  note: text("note"),
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AppUser = typeof appUsers.$inferSelect;

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("union_id", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: varchar("role", { length: 50 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("last_sign_in_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ============= AUDIT LOG =============
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }),
  userName: varchar("user_name", { length: 255 }),
  action: varchar("action", { length: 50 }).notNull(), // CREATE, UPDATE, DELETE, CONFIRM
  entityType: varchar("entity_type", { length: 50 }).notNull(), // material, receipt, invoice, etc.
  entityId: bigint("entity_id", { mode: "number", unsigned: true }),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AuditLog = typeof auditLog.$inferSelect;

// ============= UNITS =============
export const units = pgTable("units", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  nameMk: varchar("name_mk", { length: 100 }),
  category: varchar("category", { length: 50 }).notNull(),
  isActive: varchar("is_active", { length: 50 }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Unit = typeof units.$inferSelect;

// ============= UNIT CONVERSIONS =============
export const unitConversions = pgTable("unit_conversions", {
  id: serial("id").primaryKey(),
  fromUnitId: bigint("from_unit_id", { mode: "number", unsigned: true }).notNull(),
  toUnitId: bigint("to_unit_id", { mode: "number", unsigned: true }).notNull(),
  factor: decimal("factor", { precision: 18, scale: 8 }).notNull().default("0"), // multiply fromUnit by factor to get toUnit
  materialType: varchar("material_type", { length: 50 }), // e.g. "steel_sheet" for density-based conversions
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type UnitConversion = typeof unitConversions.$inferSelect;

// ============= WAREHOUSES =============
export const warehouses = pgTable("warehouses", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  address: text("address"),
  isActive: varchar("is_active", { length: 50 }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Warehouse = typeof warehouses.$inferSelect;

// ============= MATERIALS =============
export const materials = pgTable("materials", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  type: varchar("type", { length: 50 }).notNull(),
  unit: varchar("unit", { length: 50 }).notNull(),
  description: text("description"),
  minStock: decimal("min_stock", { precision: 12, scale: 3 }).notNull().default("0"),
  currentStock: decimal("current_stock", { precision: 12, scale: 3 }).notNull().default("0"),
  avgCost: decimal("avg_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  lastPurchasePrice: decimal("last_purchase_price", { precision: 12, scale: 2 }).notNull().default("0"),
  // Тежина по единица мера: kg/m за профили, kg/m² за лим, kg/ком за парчиња
  weightPerUnit: decimal("weight_per_unit", { precision: 12, scale: 4 }).default("0"),
  // Од кој материјал е: steel | stainless | aluminum | copper | brass
  densityKey: varchar("density_key", { length: 20 }).default("steel"),
  defaultSupplierId: bigint("default_supplier_id", { mode: "number", unsigned: true }),
  location: varchar("location", { length: 100 }),
  isActive: varchar("is_active", { length: 50 }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Material = typeof materials.$inferSelect;
export type InsertMaterial = typeof materials.$inferInsert;

// ============= MATERIAL WAREHOUSE STOCK =============
export const materialStock = pgTable("material_stock", {
  id: serial("id").primaryKey(),
  materialId: bigint("material_id", { mode: "number", unsigned: true }).notNull(),
  warehouseId: bigint("warehouse_id", { mode: "number", unsigned: true }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull().default("0"),
  avgCost: decimal("avg_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type MaterialStock = typeof materialStock.$inferSelect;

// ============= MATERIAL LOTS (for FIFO) =============
export const materialLots = pgTable("material_lots", {
  id: serial("id").primaryKey(),
  materialId: bigint("material_id", { mode: "number", unsigned: true }).notNull(),
  warehouseId: bigint("warehouse_id", { mode: "number", unsigned: true }).notNull(),
  receiptId: bigint("receipt_id", { mode: "number", unsigned: true }),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull().default("0"),
  remainingQty: decimal("remaining_qty", { precision: 12, scale: 3 }).notNull().default("0"),
  unitCost: decimal("unit_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  landedCost: decimal("landed_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  date: date("date").notNull(),
  // Следливост: шаржа и атест на партијата
  heatNumber: varchar("heat_number", { length: 60 }),
  certNumber: varchar("cert_number", { length: 80 }),
  certStandard: varchar("cert_standard", { length: 60 }),
  certUrl: text("cert_url"),
  supplierId: bigint("supplier_id", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type MaterialLot = typeof materialLots.$inferSelect;

// ============= АТЕСТИ ВРЗАНИ ЗА ИСПРАТНИЦА =============
// Кои шаржи се вградени во конкретна испорака — основа за изјавата кон купувачот
export const dnCertificates = pgTable("dn_certificates", {
  id: serial("id").primaryKey(),
  deliveryNoteId: bigint("delivery_note_id", { mode: "number", unsigned: true }).notNull(),
  lotId: bigint("lot_id", { mode: "number", unsigned: true }),
  materialId: bigint("material_id", { mode: "number", unsigned: true }),
  materialName: varchar("material_name", { length: 255 }),
  heatNumber: varchar("heat_number", { length: 60 }),
  certNumber: varchar("cert_number", { length: 80 }),
  certStandard: varchar("cert_standard", { length: 60 }),
  certUrl: text("cert_url"),
  supplierName: varchar("supplier_name", { length: 255 }),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).default("0"),
  unit: varchar("unit", { length: 20 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DnCertificate = typeof dnCertificates.$inferSelect;

// ============= ОСТАТОЦИ (крајки) =============
export const materialRemnants = pgTable("material_remnants", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  materialId: bigint("material_id", { mode: "number", unsigned: true }).notNull(),
  warehouseId: bigint("warehouse_id", { mode: "number", unsigned: true }),
  lengthMm: decimal("length_mm", { precision: 12, scale: 1 }).notNull().default("0"),
  quantity: integer("quantity").notNull().default(1),
  location: varchar("location", { length: 150 }),
  workOrderId: bigint("work_order_id", { mode: "number", unsigned: true }),
  sourceRemnantId: bigint("source_remnant_id", { mode: "number", unsigned: true }),
  status: varchar("status", { length: 30 }).notNull().default("available"),
  usedInRef: varchar("used_in_ref", { length: 255 }),
  usedAt: timestamp("used_at"),
  notes: text("notes"),
  createdBy: varchar("created_by", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type MaterialRemnant = typeof materialRemnants.$inferSelect;
export type InsertMaterialRemnant = typeof materialRemnants.$inferInsert;

// ============= INVENTORY TRANSACTIONS =============
export const inventoryTransactions = pgTable("inventory_transactions", {
  id: serial("id").primaryKey(),
  materialId: bigint("material_id", { mode: "number", unsigned: true }).notNull(),
  warehouseId: bigint("warehouse_id", { mode: "number", unsigned: true }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull().default("0"),
  unitCost: decimal("unit_cost", { precision: 12, scale: 2 }),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }),
  reference: varchar("reference", { length: 255 }),
  sourceDocType: varchar("source_doc_type", { length: 50 }), // receipt, work_order, adjustment, transfer
  sourceDocId: bigint("source_doc_id", { mode: "number", unsigned: true }),
  notes: text("notes"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type InventoryTransaction = typeof inventoryTransactions.$inferSelect;
export type InsertInventoryTransaction = typeof inventoryTransactions.$inferInsert;

// ============= STOCK TRANSFERS =============
export const stockTransfers = pgTable("stock_transfers", {
  id: serial("id").primaryKey(),
  transferNumber: varchar("transfer_number", { length: 50 }).notNull().unique(),
  fromWarehouseId: bigint("from_warehouse_id", { mode: "number", unsigned: true }).notNull(),
  toWarehouseId: bigint("to_warehouse_id", { mode: "number", unsigned: true }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  transferDate: date("transfer_date").notNull(),
  notes: text("notes"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type StockTransfer = typeof stockTransfers.$inferSelect;

// ============= STOCK TRANSFER ITEMS =============
export const stockTransferItems = pgTable("stock_transfer_items", {
  id: serial("id").primaryKey(),
  transferId: bigint("transfer_id", { mode: "number", unsigned: true }).notNull(),
  materialId: bigint("material_id", { mode: "number", unsigned: true }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull().default("0"),
  unitCost: decimal("unit_cost", { precision: 12, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type StockTransferItem = typeof stockTransferItems.$inferSelect;

// ============= INVENTORY COUNTS (Popis) =============
export const inventoryCounts = pgTable("inventory_counts", {
  id: serial("id").primaryKey(),
  countNumber: varchar("count_number", { length: 50 }).notNull().unique(),
  warehouseId: bigint("warehouse_id", { mode: "number", unsigned: true }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  countDate: date("count_date").notNull(),
  notes: text("notes"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type InventoryCount = typeof inventoryCounts.$inferSelect;

// ============= INVENTORY COUNT ITEMS =============
export const inventoryCountItems = pgTable("inventory_count_items", {
  id: serial("id").primaryKey(),
  countId: bigint("count_id", { mode: "number", unsigned: true }).notNull(),
  materialId: bigint("material_id", { mode: "number", unsigned: true }).notNull(),
  systemQty: decimal("system_qty", { precision: 12, scale: 3 }).notNull().default("0"),
  countedQty: decimal("counted_qty", { precision: 12, scale: 3 }),
  difference: decimal("difference", { precision: 12, scale: 3 }),
  unitCost: decimal("unit_cost", { precision: 12, scale: 2 }),
  totalDifference: decimal("total_difference", { precision: 12, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type InventoryCountItem = typeof inventoryCountItems.$inferSelect;

// ============= CUSTOMERS =============
export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  company: varchar("company", { length: 255 }),
  contactPerson: varchar("contact_person", { length: 255 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  country: varchar("country", { length: 100 }),
  taxNumber: varchar("tax_number", { length: 50 }),
  edb: varchar("edb", { length: 20 }),
  notes: text("notes"),
  isActive: varchar("is_active", { length: 50 }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = typeof customers.$inferInsert;

// ============= ORDERS =============
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: varchar("order_number", { length: 50 }).notNull().unique(),
  customerId: bigint("customer_id", { mode: "number", unsigned: true }).notNull(),
  quoteId: bigint("quote_id", { mode: "number", unsigned: true }),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  priority: varchar("priority", { length: 50 }).notNull().default("normal"),
  totalAmount: decimal("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  costAmount: decimal("cost_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  marginAmount: decimal("margin_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  marginPercent: decimal("margin_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  deliveryDate: date("delivery_date"),
  notes: text("notes"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

// ============= ORDER ITEMS =============
export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: bigint("order_id", { mode: "number", unsigned: true }).notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  drawingNumber: varchar("drawing_number", { length: 100 }),
  quantity: integer("quantity").notNull(),
  unitPrice: decimal("unit_price", { precision: 12, scale: 2 }).notNull().default("0"),
  totalPrice: decimal("total_price", { precision: 12, scale: 2 }).notNull().default("0"),
  costPrice: decimal("cost_price", { precision: 12, scale: 2 }).notNull().default("0"),
  marginAmount: decimal("margin_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  material: varchar("material", { length: 255 }),
  dimensions: varchar("dimensions", { length: 255 }),
  productId: bigint("product_id", { mode: "number", unsigned: true }),
  weightPerUnit: decimal("weight_per_unit", { precision: 12, scale: 4 }).default("0"),
  weightKg: decimal("weight_kg", { precision: 12, scale: 3 }).default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type OrderItem = typeof orderItems.$inferSelect;
export type InsertOrderItem = typeof orderItems.$inferInsert;

// ============= SUPPLIERS =============
export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  edb: varchar("edb", { length: 20 }),
  contactPerson: varchar("contact_person", { length: 255 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  country: varchar("country", { length: 100 }),
  paymentTerms: varchar("payment_terms", { length: 100 }),
  defaultCurrency: varchar("default_currency", { length: 10 }),
  materials: text("materials"),
  isActive: varchar("is_active", { length: 50 }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = typeof suppliers.$inferInsert;

// ============= PURCHASE ORDERS =============
export const purchaseOrders = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  poNumber: varchar("po_number", { length: 50 }).notNull().unique(),
  supplierId: bigint("supplier_id", { mode: "number", unsigned: true }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  totalAmount: decimal("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  expectedDate: date("expected_date"),
  notes: text("notes"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type InsertPurchaseOrder = typeof purchaseOrders.$inferInsert;

// ============= PURCHASE ORDER ITEMS =============
export const purchaseOrderItems = pgTable("purchase_order_items", {
  id: serial("id").primaryKey(),
  purchaseOrderId: bigint("purchase_order_id", { mode: "number", unsigned: true }).notNull(),
  materialId: bigint("material_id", { mode: "number", unsigned: true }).notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull().default("0"),
  unitPrice: decimal("unit_price", { precision: 12, scale: 2 }).notNull().default("0"),
  totalPrice: decimal("total_price", { precision: 12, scale: 2 }).notNull().default("0"),
  receivedQuantity: decimal("received_quantity", { precision: 12, scale: 3 }).notNull().default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PurchaseOrderItem = typeof purchaseOrderItems.$inferSelect;
export type InsertPurchaseOrderItem = typeof purchaseOrderItems.$inferInsert;

// ============= WORK ORDERS =============
export const workOrders = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  woNumber: varchar("wo_number", { length: 50 }).notNull().unique(),
  orderId: bigint("order_id", { mode: "number", unsigned: true }),
  quotationId: bigint("quotation_id", { mode: "number", unsigned: true }),
  description: varchar("description", { length: 500 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  priority: varchar("priority", { length: 50 }).notNull().default("normal"),
  plannedStart: date("planned_start"),
  plannedEnd: date("planned_end"),
  actualStart: date("actual_start"),
  actualEnd: date("actual_end"),
  assignedTo: varchar("assigned_to", { length: 255 }),
  costAmount: decimal("cost_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type WorkOrder = typeof workOrders.$inferSelect;
export type InsertWorkOrder = typeof workOrders.$inferInsert;

// ============= WORK ORDER OPERATIONS =============
export const workOrderOperations = pgTable("work_order_operations", {
  id: serial("id").primaryKey(),
  workOrderId: bigint("work_order_id", { mode: "number", unsigned: true }).notNull(),
  operation: varchar("operation", { length: 50 }).notNull(),
  sequence: integer("sequence").notNull(),
  description: varchar("description", { length: 500 }),
  estimatedTime: decimal("estimated_time", { precision: 8, scale: 2 }),
  actualTime: decimal("actual_time", { precision: 8, scale: 2 }),
  estimatedQty: decimal("estimated_qty", { precision: 12, scale: 3 }),
  actualQty: decimal("actual_qty", { precision: 12, scale: 3 }),
  qtyUnit: varchar("qty_unit", { length: 20 }), // m2, m_cut, bend, hour
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  operator: varchar("operator", { length: 255 }),
  costRate: decimal("cost_rate", { precision: 12, scale: 2 }).notNull().default("0"),
  costAmount: decimal("cost_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type WorkOrderOperation = typeof workOrderOperations.$inferSelect;
export type InsertWorkOrderOperation = typeof workOrderOperations.$inferInsert;

// ============= WORK ORDER MATERIALS =============
// ============= ВРЕМЕ ПО ОПЕРАЦИЈА (скенирање на подот) =============
export const operationTimeLogs = pgTable("operation_time_logs", {
  id: serial("id").primaryKey(),
  operationId: bigint("operation_id", { mode: "number", unsigned: true }).notNull(),
  workOrderId: bigint("work_order_id", { mode: "number", unsigned: true }).notNull(),
  operator: varchar("operator", { length: 255 }),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  minutes: decimal("minutes", { precision: 10, scale: 2 }).default("0"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type OperationTimeLog = typeof operationTimeLogs.$inferSelect;

export const workOrderMaterials = pgTable("work_order_materials", {
  id: serial("id").primaryKey(),
  workOrderId: bigint("work_order_id", { mode: "number", unsigned: true }).notNull(),
  materialId: bigint("material_id", { mode: "number", unsigned: true }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull().default("0"),
  unitCost: decimal("unit_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  isActual: varchar("is_actual", { length: 50 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type WorkOrderMaterial = typeof workOrderMaterials.$inferSelect;

// ============= MACHINES =============
export const machines = pgTable("machines", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  type: varchar("type", { length: 50 }).notNull(),
  costPerHour: decimal("cost_per_hour", { precision: 12, scale: 2 }).notNull().default("0"),
  costPerMeter: decimal("cost_per_meter", { precision: 12, scale: 2 }).notNull().default("0"),
  annualAmortization: decimal("annual_amortization", { precision: 14, scale: 2 }).notNull().default("0"),
  annualElectricity: decimal("annual_electricity", { precision: 14, scale: 2 }).notNull().default("0"),
  annualGas: decimal("annual_gas", { precision: 14, scale: 2 }).notNull().default("0"),
  annualService: decimal("annual_service", { precision: 14, scale: 2 }).notNull().default("0"),
  annualHours: decimal("annual_hours", { precision: 8, scale: 2 }).notNull().default("0"),
  isActive: varchar("is_active", { length: 50 }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Machine = typeof machines.$inferSelect;

// ============= LABOR RATES =============
export const laborRates = pgTable("labor_rates", {
  id: serial("id").primaryKey(),
  role: varchar("role", { length: 255 }).notNull(),
  roleCode: varchar("role_code", { length: 50 }).notNull().unique(),
  costPerHour: decimal("cost_per_hour", { precision: 12, scale: 2 }).notNull().default("0"),
  grossSalary: decimal("gross_salary", { precision: 12, scale: 2 }).notNull().default("0"),
  contributionsPct: decimal("contributions_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  description: text("description"),
  isActive: varchar("is_active", { length: 50 }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LaborRate = typeof laborRates.$inferSelect;

// ============= OVERHEAD =============
export const overhead = pgTable("overhead", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  rateType: varchar("rate_type", { length: 50 }).notNull(),
  rateValue: decimal("rate_value", { precision: 12, scale: 4 }).notNull().default("0"),
  annualAmount: decimal("annual_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  description: text("description"),
  isActive: varchar("is_active", { length: 50 }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Overhead = typeof overhead.$inferSelect;

// ============= SERVICES =============
export const services = pgTable("services", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  type: varchar("type", { length: 50 }).notNull(),
  unit: varchar("unit", { length: 50 }).notNull(),
  description: text("description"),
  costRate: decimal("cost_rate", { precision: 12, scale: 2 }).notNull().default("0"),
  saleRate: decimal("sale_rate", { precision: 12, scale: 2 }).notNull().default("0"),
  machineId: bigint("machine_id", { mode: "number", unsigned: true }),
  isActive: varchar("is_active", { length: 50 }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Service = typeof services.$inferSelect;
export type InsertService = typeof services.$inferInsert;

// ============= PRODUCTS =============
export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  category: varchar("category", { length: 50 }).notNull(),
  description: text("description"),
  unit: varchar("unit", { length: 50 }).notNull(),
  basis: varchar("basis", { length: 50 }).notNull(),
  defaultPrice: decimal("default_price", { precision: 12, scale: 2 }).notNull().default("0"),
  materialCost: decimal("material_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  laborCost: decimal("labor_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  machineCost: decimal("machine_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  overheadCost: decimal("overhead_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  isActive: varchar("is_active", { length: 50 }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

// ============= PRODUCT COMPONENTS (BOM / Normativi) =============
export const productComponents = pgTable("product_components", {
  id: serial("id").primaryKey(),
  productId: bigint("product_id", { mode: "number", unsigned: true }).notNull(),
  kind: varchar("kind", { length: 50 }).notNull(),
  refId: bigint("ref_id", { mode: "number", unsigned: true }).notNull(),
  perUnit: decimal("per_unit", { precision: 12, scale: 6 }).notNull().default("0"),
  wastePct: decimal("waste_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  scale: varchar("scale", { length: 50 }).notNull(),
  notes: text("notes"),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ProductComponent = typeof productComponents.$inferSelect;

// ============= QUOTATIONS =============
export const quotations = pgTable("quotations", {
  id: serial("id").primaryKey(),
  quoteNumber: varchar("quote_number", { length: 50 }).notNull().unique(),
  customerId: bigint("customer_id", { mode: "number", unsigned: true }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  subtotal: decimal("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  costAmount: decimal("cost_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  marginAmount: decimal("margin_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  marginPercent: decimal("margin_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  vatRate: decimal("vat_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  vatAmount: decimal("vat_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  totalAmount: decimal("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  currency: varchar("currency", { length: 10 }).notNull().default("MKD"),
  validUntil: date("valid_until"),
  deliveryDays: integer("delivery_days").default(14),
  paymentTerms: varchar("payment_terms", { length: 255 }),
  notes: text("notes"),
  convertedOrderId: bigint("converted_order_id", { mode: "number", unsigned: true }),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Quotation = typeof quotations.$inferSelect;
export type InsertQuotation = typeof quotations.$inferInsert;

// ============= QUOTATION ITEMS =============
export const quotationItems = pgTable("quotation_items", {
  id: serial("id").primaryKey(),
  quotationId: bigint("quotation_id", { mode: "number", unsigned: true }).notNull(),
  itemType: varchar("item_type", { length: 50 }).notNull(),
  referenceId: bigint("reference_id", { mode: "number", unsigned: true }),
  description: varchar("description", { length: 500 }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull().default("0"),
  unit: varchar("unit", { length: 20 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 12, scale: 2 }).notNull().default("0"),
  unitCost: decimal("unit_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  totalPrice: decimal("total_price", { precision: 12, scale: 2 }).notNull().default("0"),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  vatRate: decimal("vat_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  weightPerUnit: decimal("weight_per_unit", { precision: 12, scale: 4 }).default("0"),
  weightKg: decimal("weight_kg", { precision: 12, scale: 3 }).default("0"),
  // Ценење: "unit" = по единица мера, "kg" = внесена е цена по килограм
  priceMode: varchar("price_mode", { length: 10 }).default("unit"),
  pricePerKg: decimal("price_per_kg", { precision: 12, scale: 4 }).default("0"),
  notes: text("notes"),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type QuotationItem = typeof quotationItems.$inferSelect;
export type InsertQuotationItem = typeof quotationItems.$inferInsert;

// ============= OUTGOING INVOICES =============
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: varchar("invoice_number", { length: 50 }).notNull().unique(),
  customerId: bigint("customer_id", { mode: "number", unsigned: true }).notNull(),
  orderId: bigint("order_id", { mode: "number", unsigned: true }),
  workOrderId: bigint("work_order_id", { mode: "number", unsigned: true }),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  invoiceType: varchar("invoice_type", { length: 50 }).notNull(),
  issueDate: date("issue_date").notNull(),
  dueDate: date("due_date"),
  subtotal: decimal("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  vatRate: decimal("vat_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  vatAmount: decimal("vat_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  totalAmount: decimal("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  currency: varchar("currency", { length: 10 }).notNull().default("MKD"),
  notes: text("notes"),
  eInvoiceId: varchar("e_invoice_id", { length: 255 }),
  originalInvoiceId: bigint("original_invoice_id", { mode: "number", unsigned: true }), // for credit notes
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = typeof invoices.$inferInsert;

// ============= INCOMING INVOICES =============
export const incomingInvoices = pgTable("incoming_invoices", {
  id: serial("id").primaryKey(),
  supplierInvoiceNumber: varchar("supplier_invoice_number", { length: 50 }).notNull(),
  supplierId: bigint("supplier_id", { mode: "number", unsigned: true }).notNull(),
  poId: bigint("po_id", { mode: "number", unsigned: true }),
  receiptId: bigint("receipt_id", { mode: "number", unsigned: true }),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  issueDate: date("issue_date"),
  receivedDate: date("received_date").notNull(),
  dueDate: date("due_date"),
  subtotal: decimal("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  vatRate: decimal("vat_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  vatAmount: decimal("vat_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  totalAmount: decimal("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  currency: varchar("currency", { length: 10 }).notNull().default("MKD"),
  notes: text("notes"),
  fileUrl: text("file_url"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type IncomingInvoice = typeof incomingInvoices.$inferSelect;
export type InsertIncomingInvoice = typeof incomingInvoices.$inferInsert;

// ============= DOCUMENT ITEMS =============
export const documentItems = pgTable("document_items", {
  id: serial("id").primaryKey(),
  documentId: bigint("document_id", { mode: "number", unsigned: true }).notNull(),
  documentType: varchar("document_type", { length: 50 }).notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull().default("0"),
  unit: varchar("unit", { length: 20 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 12, scale: 2 }).notNull().default("0"),
  discount: decimal("discount", { precision: 5, scale: 2 }).notNull().default("0"),
  totalPrice: decimal("total_price", { precision: 12, scale: 2 }).notNull().default("0"),
  vatRate: decimal("vat_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  productId: bigint("product_id", { mode: "number", unsigned: true }),
  serviceId: bigint("service_id", { mode: "number", unsigned: true }),
  materialId: bigint("material_id", { mode: "number", unsigned: true }),
  weightKg: decimal("weight_kg", { precision: 12, scale: 3 }).default("0"),
  itemType: varchar("item_type", { length: 50 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DocumentItem = typeof documentItems.$inferSelect;
export type InsertDocumentItem = typeof documentItems.$inferInsert;

// ============= RECEIPTS =============
export const receipts = pgTable("receipts", {
  id: serial("id").primaryKey(),
  receiptNumber: varchar("receipt_number", { length: 50 }).notNull().unique(),
  supplierId: bigint("supplier_id", { mode: "number", unsigned: true }),
  poId: bigint("po_id", { mode: "number", unsigned: true }),
  warehouseId: bigint("warehouse_id", { mode: "number", unsigned: true }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  receiptDate: date("receipt_date").notNull(),
  supplierDocNumber: varchar("supplier_doc_number", { length: 100 }),
  transportCost: decimal("transport_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  customsCost: decimal("customs_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  otherCost: decimal("other_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  totalAmount: decimal("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  fileUrl: text("file_url"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Receipt = typeof receipts.$inferSelect;
export type InsertReceipt = typeof receipts.$inferInsert;

// ============= RECEIPT ITEMS =============
export const receiptItems = pgTable("receipt_items", {
  id: serial("id").primaryKey(),
  receiptId: bigint("receipt_id", { mode: "number", unsigned: true }).notNull(),
  materialId: bigint("material_id", { mode: "number", unsigned: true }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull().default("0"),
  unit: varchar("unit", { length: 20 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 12, scale: 2 }).notNull().default("0"),
  totalPrice: decimal("total_price", { precision: 12, scale: 2 }).notNull().default("0"),
  landedCostAlloc: decimal("landed_cost_alloc", { precision: 12, scale: 2 }).notNull().default("0"),
  vatRate: decimal("vat_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  // Следливост на челик: шаржа (heat number) и атест EN 10204
  heatNumber: varchar("heat_number", { length: 60 }),
  certNumber: varchar("cert_number", { length: 80 }),
  certStandard: varchar("cert_standard", { length: 60 }),
  certUrl: text("cert_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ReceiptItem = typeof receiptItems.$inferSelect;

// ============= DELIVERY NOTES =============
export const deliveryNotes = pgTable("delivery_notes", {
  id: serial("id").primaryKey(),
  dnNumber: varchar("dn_number", { length: 50 }).notNull().unique(),
  customerId: bigint("customer_id", { mode: "number", unsigned: true }).notNull(),
  orderId: bigint("order_id", { mode: "number", unsigned: true }),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  issueDate: date("issue_date").notNull(),
  deliveryDate: date("delivery_date"),
  totalItems: integer("total_items").default(0).notNull(),
  notes: text("notes"),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DeliveryNote = typeof deliveryNotes.$inferSelect;
export type InsertDeliveryNote = typeof deliveryNotes.$inferInsert;

// ============= E-INVOICES =============
export const eInvoices = pgTable("e_invoices", {
  id: serial("id").primaryKey(),
  invoiceId: bigint("invoice_id", { mode: "number", unsigned: true }).notNull(),
  ujpInvoiceId: varchar("ujp_invoice_id", { length: 255 }),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  xmlContent: text("xml_content"),
  responseMessage: text("response_message"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EInvoice = typeof eInvoices.$inferSelect;
export type InsertEInvoice = typeof eInvoices.$inferInsert;

// ============= PARSED INVOICES =============
export const parsedInvoices = pgTable("parsed_invoices", {
  id: serial("id").primaryKey(),
  originalFileName: varchar("original_file_name", { length: 500 }).notNull(),
  supplierName: varchar("supplier_name", { length: 255 }),
  invoiceNumber: varchar("invoice_number", { length: 100 }),
  issueDate: date("issue_date"),
  dueDate: date("due_date"),
  totalAmount: decimal("total_amount", { precision: 14, scale: 2 }),
  vatAmount: decimal("vat_amount", { precision: 14, scale: 2 }),
  currency: varchar("currency", { length: 10 }),
  rawText: text("raw_text"),
  fileUrl: text("file_url"),
  documentType: varchar("document_type", { length: 50 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  matchedInvoiceId: bigint("matched_invoice_id", { mode: "number", unsigned: true }),
  // Резултат од читањето
  supplierTaxId: varchar("supplier_tax_id", { length: 20 }),
  matchedSupplierId: bigint("matched_supplier_id", { mode: "number", unsigned: true }),
  baseAmount: decimal("base_amount", { precision: 14, scale: 2 }),
  confidence: integer("confidence").default(0),
  parseNotes: text("parse_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============= PARSED RECEIPT ITEMS (OCR results) =============
export const parsedReceiptItems = pgTable("parsed_receipt_items", {
  id: serial("id").primaryKey(),
  parsedInvoiceId: bigint("parsed_invoice_id", { mode: "number", unsigned: true }).notNull(),
  rawDescription: text("raw_description").notNull(),
  matchedMaterialId: bigint("matched_material_id", { mode: "number", unsigned: true }),
  matchedMaterialName: varchar("matched_material_name", { length: 255 }),
  matchConfidence: decimal("match_confidence", { precision: 5, scale: 2 }).notNull().default("0"),
  quantity: decimal("quantity", { precision: 12, scale: 3 }),
  unit: varchar("unit", { length: 20 }),
  unitPrice: decimal("unit_price", { precision: 12, scale: 2 }),
  totalPrice: decimal("total_price", { precision: 12, scale: 2 }),
  vatRate: decimal("vat_rate", { precision: 5, scale: 2 }),
  isConfirmed: varchar("is_confirmed", { length: 50 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ParsedReceiptItem = typeof parsedReceiptItems.$inferSelect;

// ============= FINISHED GOODS STOCK (for invoicing products)
export const finishedGoodsStock = pgTable("finished_goods_stock", {
  id: serial("id").primaryKey(),
  productId: bigint("product_id", { mode: "number", unsigned: true }).notNull(),
  warehouseId: bigint("warehouse_id", { mode: "number", unsigned: true }).notNull(),
  workOrderId: bigint("work_order_id", { mode: "number", unsigned: true }),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull().default("0"),
  unitCost: decimal("unit_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type FinishedGoodsStock = typeof finishedGoodsStock.$inferSelect;

// ============= DIGITAL CERTIFICATES (for UJP e-Faktura signing) =============
export const digitalCertificates = pgTable("digital_certificates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  certType: varchar("cert_type", { length: 50 }).notNull(),
  // PEM encoded certificate (public key)
  certificatePem: text("certificate_pem").notNull(),
  // Encrypted private key (PEM, encrypted with AES-256-GCM)
  privateKeyEncrypted: text("private_key_encrypted"),
  // Key encryption IV
  encryptionIv: varchar("encryption_iv", { length: 100 }),
  // Key encryption auth tag
  encryptionAuthTag: varchar("encryption_auth_tag", { length: 100 }),
  issuer: varchar("issuer", { length: 255 }),
  serialNumber: varchar("serial_number", { length: 100 }),
  validFrom: date("valid_from"),
  validTo: date("valid_to"),
  edb: varchar("edb", { length: 20 }),
  isActive: varchar("is_active", { length: 50 }).notNull().default("active"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DigitalCertificate = typeof digitalCertificates.$inferSelect;

// ============= DOCUMENT COUNTERS =============
export const docCounters = pgTable("doc_counters", {
  id: serial("id").primaryKey(),
  kind: varchar("kind", { length: 10 }).notNull(), // PO, RN, IS, PF, VF, PR, FV, KN
  year: integer("year").notNull(),
  value: integer("value").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DocCounter = typeof docCounters.$inferSelect;

// ============= EMAIL INVOICES (received via email) =============
export const emailInvoices = pgTable("email_invoices", {
  id: serial("id").primaryKey(),
  subject: varchar("subject", { length: 500 }),
  senderEmail: varchar("sender_email", { length: 255 }),
  senderName: varchar("sender_name", { length: 255 }),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
  pdfBase64: text("pdf_base64"),
  pdfFilename: varchar("pdf_filename", { length: 255 }),
  parsedSupplierName: varchar("parsed_supplier_name", { length: 255 }),
  parsedInvoiceNumber: varchar("parsed_invoice_number", { length: 100 }),
  parsedTotalAmount: varchar("parsed_total_amount", { length: 50 }),
  parsedIssueDate: varchar("parsed_issue_date", { length: 20 }),
  matchedSupplierId: bigint("matched_supplier_id", { mode: "number", unsigned: true }),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  rawText: text("raw_text"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EmailInvoice = typeof emailInvoices.$inferSelect;
