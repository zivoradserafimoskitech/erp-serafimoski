import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  decimal,
  int,
  bigint,
  date,
} from "drizzle-orm/mysql-core";

// ============= USERS =============
export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["admin", "manager", "operator"]).default("operator").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ============= MATERIALS (Суровини/Материјали) =============
export const materials = mysqlTable("materials", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  type: mysqlEnum("type", [
    "steel_sheet",      // челичен лим
    "steel_profile",    // челичен профил
    "steel_bar",        // челична прачка
    "aluminum_sheet",   // алуминиумски лим
    "aluminum_profile", // алуминиумски профил
    "stainless_sheet",  // нерѓосувачки лим
    "pipe",             // цевка
    "angle",            // аголник
    "channel",          // канал
    "screws",           // завртки
    "welding",          // заварување
    "paint",            // боја
    "other",            // други
  ]).notNull(),
  unit: mysqlEnum("unit", ["kg", "m", "m2", "pcs", "l"]).notNull(),
  description: text("description"),
  minStock: decimal("minStock", { precision: 12, scale: 3 }).default("0").notNull(),
  currentStock: decimal("currentStock", { precision: 12, scale: 3 }).default("0").notNull(),
  location: varchar("location", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Material = typeof materials.$inferSelect;
export type InsertMaterial = typeof materials.$inferInsert;

// ============= INVENTORY TRANSACTIONS (Движења во склад) =============
export const inventoryTransactions = mysqlTable("inventory_transactions", {
  id: serial("id").primaryKey(),
  materialId: bigint("materialId", { mode: "number", unsigned: true }).notNull(),
  type: mysqlEnum("type", ["receipt", "issue", "adjustment", "return", "scrap"]).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }),
  totalPrice: decimal("totalPrice", { precision: 12, scale: 2 }),
  reference: varchar("reference", { length: 255 }),
  notes: text("notes"),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type InventoryTransaction = typeof inventoryTransactions.$inferSelect;
export type InsertInventoryTransaction = typeof inventoryTransactions.$inferInsert;

// ============= CUSTOMERS (Клиенти) =============
export const customers = mysqlTable("customers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  company: varchar("company", { length: 255 }),
  contactPerson: varchar("contactPerson", { length: 255 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  country: varchar("country", { length: 100 }).default("Македонија"),
  taxNumber: varchar("taxNumber", { length: 50 }),
  notes: text("notes"),
  isActive: mysqlEnum("isActive", ["active", "inactive"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = typeof customers.$inferInsert;

// ============= ORDERS (Нарачки од клиенти) =============
export const orders = mysqlTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: varchar("orderNumber", { length: 50 }).notNull().unique(),
  customerId: bigint("customerId", { mode: "number", unsigned: true }).notNull(),
  status: mysqlEnum("status", [
    "pending",      // чекање
    "confirmed",    // потврдена
    "in_production", // во производство
    "ready",        // готова
    "delivered",    // испорачана
    "cancelled",    // откажана
  ]).default("pending").notNull(),
  priority: mysqlEnum("priority", ["low", "normal", "high", "urgent"]).default("normal").notNull(),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  deliveryDate: date("deliveryDate"),
  notes: text("notes"),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

// ============= ORDER ITEMS (Ставки во нарачка) =============
export const orderItems = mysqlTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: bigint("orderId", { mode: "number", unsigned: true }).notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  drawingNumber: varchar("drawingNumber", { length: 100 }),
  quantity: int("quantity").notNull(),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull(),
  totalPrice: decimal("totalPrice", { precision: 12, scale: 2 }).notNull(),
  material: varchar("material", { length: 255 }),
  dimensions: varchar("dimensions", { length: 255 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OrderItem = typeof orderItems.$inferSelect;
export type InsertOrderItem = typeof orderItems.$inferInsert;

// ============= SUPPLIERS (Добавувачи) =============
export const suppliers = mysqlTable("suppliers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  contactPerson: varchar("contactPerson", { length: 255 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  country: varchar("country", { length: 100 }).default("Македонија"),
  materials: text("materials"),
  isActive: mysqlEnum("isActive", ["active", "inactive"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = typeof suppliers.$inferInsert;

// ============= PURCHASE ORDERS (Набавни нарачки) =============
export const purchaseOrders = mysqlTable("purchase_orders", {
  id: serial("id").primaryKey(),
  poNumber: varchar("poNumber", { length: 50 }).notNull().unique(),
  supplierId: bigint("supplierId", { mode: "number", unsigned: true }).notNull(),
  status: mysqlEnum("status", [
    "draft",        // нацрт
    "sent",         // испратена
    "confirmed",    // потврдена
    "received",     // примена
    "cancelled",    // откажана
  ]).default("draft").notNull(),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  expectedDate: date("expectedDate"),
  notes: text("notes"),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type InsertPurchaseOrder = typeof purchaseOrders.$inferInsert;

// ============= PURCHASE ORDER ITEMS =============
export const purchaseOrderItems = mysqlTable("purchase_order_items", {
  id: serial("id").primaryKey(),
  purchaseOrderId: bigint("purchaseOrderId", { mode: "number", unsigned: true }).notNull(),
  materialId: bigint("materialId", { mode: "number", unsigned: true }).notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull(),
  totalPrice: decimal("totalPrice", { precision: 12, scale: 2 }).notNull(),
  receivedQuantity: decimal("receivedQuantity", { precision: 12, scale: 3 }).default("0").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PurchaseOrderItem = typeof purchaseOrderItems.$inferSelect;
export type InsertPurchaseOrderItem = typeof purchaseOrderItems.$inferInsert;

// ============= WORK ORDERS (Работни налози) =============
export const workOrders = mysqlTable("work_orders", {
  id: serial("id").primaryKey(),
  woNumber: varchar("woNumber", { length: 50 }).notNull().unique(),
  orderId: bigint("orderId", { mode: "number", unsigned: true }),
  description: varchar("description", { length: 500 }).notNull(),
  status: mysqlEnum("status", [
    "pending",      // чекање
    "in_progress",  // во тек
    "on_hold",      // ставено на чекање
    "completed",    // завршено
    "cancelled",    // откажано
  ]).default("pending").notNull(),
  priority: mysqlEnum("priority", ["low", "normal", "high", "urgent"]).default("normal").notNull(),
  plannedStart: date("plannedStart"),
  plannedEnd: date("plannedEnd"),
  actualStart: date("actualStart"),
  actualEnd: date("actualEnd"),
  assignedTo: varchar("assignedTo", { length: 255 }),
  notes: text("notes"),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type WorkOrder = typeof workOrders.$inferSelect;
export type InsertWorkOrder = typeof workOrders.$inferInsert;

// ============= WORK ORDER OPERATIONS (Операции во работен налог) =============
export const workOrderOperations = mysqlTable("work_order_operations", {
  id: serial("id").primaryKey(),
  workOrderId: bigint("workOrderId", { mode: "number", unsigned: true }).notNull(),
  operation: mysqlEnum("operation", [
    "cutting_laser",    // ласерско сечење
    "cutting_plasma",   // плазма сечење
    "bending",          // виткање
    "welding_mig",      // MIG заварување
    "welding_tig",      // TIG заварување
    "grinding",         // брусење
    "drilling",         // дупчење
    "painting",         // бојадисување
    "assembly",         // монтажа
    "quality_control",  // контрола на квалитет
    "packaging",        // пакување
  ]).notNull(),
  sequence: int("sequence").notNull(),
  description: varchar("description", { length: 500 }),
  estimatedTime: decimal("estimatedTime", { precision: 8, scale: 2 }),
  actualTime: decimal("actualTime", { precision: 8, scale: 2 }),
  status: mysqlEnum("status", ["pending", "in_progress", "completed", "skipped"]).default("pending").notNull(),
  operator: varchar("operator", { length: 255 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type WorkOrderOperation = typeof workOrderOperations.$inferSelect;
export type InsertWorkOrderOperation = typeof workOrderOperations.$inferInsert;

// ============= OUTGOING INVOICES (Излезни фактури) =============
export const invoices = mysqlTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: varchar("invoiceNumber", { length: 50 }).notNull().unique(),
  customerId: bigint("customerId", { mode: "number", unsigned: true }).notNull(),
  orderId: bigint("orderId", { mode: "number", unsigned: true }),
  status: mysqlEnum("status", [
    "draft",        // нацрт
    "issued",       // издадена
    "sent",         // испратена
    "paid",         // платена
    "overdue",      // задоцнета
    "cancelled",    // откажана
  ]).default("draft").notNull(),
  invoiceType: mysqlEnum("invoiceType", [
    "standard",     // стандардна
    "proforma",     // проформа
    "credit_note",  // кредитна нота
  ]).default("standard").notNull(),
  issueDate: date("issueDate").notNull(),
  dueDate: date("dueDate"),
  subtotal: decimal("subtotal", { precision: 14, scale: 2 }).default("0").notNull(),
  vatRate: decimal("vatRate", { precision: 5, scale: 2 }).default("18").notNull(),
  vatAmount: decimal("vatAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  currency: varchar("currency", { length: 10 }).default("MKD").notNull(),
  notes: text("notes"),
  eInvoiceId: varchar("eInvoiceId", { length: 255 }),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = typeof invoices.$inferInsert;

// ============= INCOMING INVOICES (Влезни фактури од добавувачи) =============
export const incomingInvoices = mysqlTable("incoming_invoices", {
  id: serial("id").primaryKey(),
  supplierInvoiceNumber: varchar("supplierInvoiceNumber", { length: 50 }).notNull(),
  supplierId: bigint("supplierId", { mode: "number", unsigned: true }).notNull(),
  poId: bigint("poId", { mode: "number", unsigned: true }),
  status: mysqlEnum("status", [
    "received",     // примена
    "verified",     // верифицирана
    "paid",         // платена
    "disputed",     // оспорена
    "cancelled",    // откажана
  ]).default("received").notNull(),
  issueDate: date("issueDate"),
  receivedDate: date("receivedDate").notNull(),
  dueDate: date("dueDate"),
  subtotal: decimal("subtotal", { precision: 14, scale: 2 }).default("0").notNull(),
  vatRate: decimal("vatRate", { precision: 5, scale: 2 }).default("18").notNull(),
  vatAmount: decimal("vatAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  currency: varchar("currency", { length: 10 }).default("MKD").notNull(),
  notes: text("notes"),
  fileUrl: text("fileUrl"),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type IncomingInvoice = typeof incomingInvoices.$inferSelect;
export type InsertIncomingInvoice = typeof incomingInvoices.$inferInsert;

// ============= DOCUMENT ITEMS (Ставки за фактури/приемници/испратници) =============
export const documentItems = mysqlTable("document_items", {
  id: serial("id").primaryKey(),
  documentId: bigint("documentId", { mode: "number", unsigned: true }).notNull(),
  documentType: mysqlEnum("documentType", ["invoice", "incoming_invoice", "receipt", "delivery_note"]).notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).default("1").notNull(),
  unit: varchar("unit", { length: 20 }).default("ком").notNull(),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull(),
  discount: decimal("discount", { precision: 5, scale: 2 }).default("0").notNull(),
  totalPrice: decimal("totalPrice", { precision: 12, scale: 2 }).notNull(),
  vatRate: decimal("vatRate", { precision: 5, scale: 2 }).default("18").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DocumentItem = typeof documentItems.$inferSelect;
export type InsertDocumentItem = typeof documentItems.$inferInsert;

// ============= RECEIPTS (Приемници) =============
export const receipts = mysqlTable("receipts", {
  id: serial("id").primaryKey(),
  receiptNumber: varchar("receiptNumber", { length: 50 }).notNull().unique(),
  supplierId: bigint("supplierId", { mode: "number", unsigned: true }),
  poId: bigint("poId", { mode: "number", unsigned: true }),
  status: mysqlEnum("status", [
    "draft",        // нацрт
    "confirmed",    // потврден
    "cancelled",    // откажан
  ]).default("draft").notNull(),
  receiptDate: date("receiptDate").notNull(),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).default("0").notNull(),
  notes: text("notes"),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Receipt = typeof receipts.$inferSelect;
export type InsertReceipt = typeof receipts.$inferInsert;

// ============= DELIVERY NOTES (Испратници) =============
export const deliveryNotes = mysqlTable("delivery_notes", {
  id: serial("id").primaryKey(),
  dnNumber: varchar("dnNumber", { length: 50 }).notNull().unique(),
  customerId: bigint("customerId", { mode: "number", unsigned: true }).notNull(),
  orderId: bigint("orderId", { mode: "number", unsigned: true }),
  status: mysqlEnum("status", [
    "draft",        // нацрт
    "issued",       // издаден
    "delivered",    // испорачан
    "cancelled",    // откажан
  ]).default("draft").notNull(),
  issueDate: date("issueDate").notNull(),
  deliveryDate: date("deliveryDate"),
  totalItems: int("totalItems").default(0).notNull(),
  notes: text("notes"),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DeliveryNote = typeof deliveryNotes.$inferSelect;
export type InsertDeliveryNote = typeof deliveryNotes.$inferInsert;

// ============= E-INVOICES (УЈП е-фактури) =============
export const eInvoices = mysqlTable("e_invoices", {
  id: serial("id").primaryKey(),
  invoiceId: bigint("invoiceId", { mode: "number", unsigned: true }).notNull(),
  ujpInvoiceId: varchar("ujpInvoiceId", { length: 255 }),
  status: mysqlEnum("status", [
    "pending",       // чекање
    "sent_to_ujp",   // испратена до УЈП
    "approved",      // одобрена
    "rejected",      // одбиена
    "cancelled",     // откажана
  ]).default("pending").notNull(),
  xmlContent: text("xmlContent"),
  responseMessage: text("responseMessage"),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EInvoice = typeof eInvoices.$inferSelect;
export type InsertEInvoice = typeof eInvoices.$inferInsert;

// ============= PARSED INVOICES (Парсирани фактури од PDF) =============
export const parsedInvoices = mysqlTable("parsed_invoices", {
  id: serial("id").primaryKey(),
  originalFileName: varchar("originalFileName", { length: 500 }).notNull(),
  supplierName: varchar("supplierName", { length: 255 }),
  invoiceNumber: varchar("invoiceNumber", { length: 100 }),
  issueDate: date("issueDate"),
  dueDate: date("dueDate"),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }),
  vatAmount: decimal("vatAmount", { precision: 14, scale: 2 }),
  currency: varchar("currency", { length: 10 }),
  rawText: text("rawText"),
  status: mysqlEnum("status", ["parsed", "verified", "imported"]).default("parsed").notNull(),
  matchedInvoiceId: bigint("matchedInvoiceId", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
