import {
  pgTable,
  pgEnum,
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
  defaultVatRate: decimal("default_vat_rate", { precision: 5, scale: 2 }).notNull(),
  valuationMethod: varchar.notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  timezone: varchar("timezone", { length: 50 }).notNull(),
  emailImapHost: varchar("emailImapHost", { length: 255 }),
  emailImapPort: integer("emailImapPort").default(993),
  emailImapSecure: integer("emailImapSecure").default(1),
  emailUsername: varchar("emailUsername", { length: 255 }),
  emailPassword: varchar("emailPassword", { length: 255 }),
  emailCheckInterval: integer("emailCheckInterval").default(60),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type CompanySetting = typeof companySettings.$inferSelect;

// ============= USERS =============
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: varchar.notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ============= AUDIT LOG =============
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }),
  userName: varchar("user_name", { length: 255 }),
  action: varchar("action", { length: 50 }).notNull(), // CREATE, UPDATE, DELETE, CONFIRM
  entityType: varchar("entity_type", { length: 50 }).notNull(), // material, receipt, invoice, etc.
  entityId: bigint("entity_id", { mode: "number", unsigned: true }),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuditLog = typeof auditLog.$inferSelect;

// ============= UNITS =============
export const units = pgTable("units", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  nameMk: varchar("name_mk", { length: 100 }),
  category: varchar.notNull(),
  isActive: varchar.notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Unit = typeof units.$inferSelect;

// ============= UNIT CONVERSIONS =============
export const unitConversions = pgTable("unit_conversions", {
  id: serial("id").primaryKey(),
  fromUnitId: bigint("from_unit_id", { mode: "number", unsigned: true }).notNull(),
  toUnitId: bigint("to_unit_id", { mode: "number", unsigned: true }).notNull(),
  factor: decimal("factor", { precision: 18, scale: 8 }).notNull(), // multiply fromUnit by factor to get toUnit
  materialType: varchar("material_type", { length: 50 }), // e.g. "steel_sheet" for density-based conversions
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type UnitConversion = typeof unitConversions.$inferSelect;

// ============= WAREHOUSES =============
export const warehouses = pgTable("warehouses", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar.notNull(),
  address: text("address"),
  isActive: varchar.notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Warehouse = typeof warehouses.$inferSelect;

// ============= MATERIALS =============
export const materials = pgTable("materials", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  type: pgEnum("type", [
    "steel_sheet",
    "steel_profile",
    "steel_bar",
    "aluminum_sheet",
    "aluminum_profile",
    "stainless_sheet",
    "pipe",
    "angle",
    "channel",
    "screws",
    "welding",
    "paint",
    "other",
  ]).notNull(),
  unit: varchar.notNull(),
  description: text("description"),
  minStock: decimal("minStock", { precision: 12, scale: 3 }).notNull(),
  currentStock: decimal("currentStock", { precision: 12, scale: 3 }).notNull(),
  avgCost: decimal("avgCost", { precision: 12, scale: 2 }).notNull(),
  lastPurchasePrice: decimal("lastPurchasePrice", { precision: 12, scale: 2 }).notNull(),
  location: varchar("location", { length: 100 }),
  isActive: varchar.notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Material = typeof materials.$inferSelect;
export type InsertMaterial = typeof materials.$inferInsert;

// ============= MATERIAL WAREHOUSE STOCK =============
export const materialStock = pgTable("material_stock", {
  id: serial("id").primaryKey(),
  materialId: bigint("materialId", { mode: "number", unsigned: true }).notNull(),
  warehouseId: bigint("warehouseId", { mode: "number", unsigned: true }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  avgCost: decimal("avgCost", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type MaterialStock = typeof materialStock.$inferSelect;

// ============= MATERIAL LOTS (for FIFO) =============
export const materialLots = pgTable("material_lots", {
  id: serial("id").primaryKey(),
  materialId: bigint("materialId", { mode: "number", unsigned: true }).notNull(),
  warehouseId: bigint("warehouseId", { mode: "number", unsigned: true }).notNull(),
  receiptId: bigint("receiptId", { mode: "number", unsigned: true }),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  remainingQty: decimal("remaining_qty", { precision: 12, scale: 3 }).notNull(),
  unitCost: decimal("unit_cost", { precision: 12, scale: 2 }).notNull(),
  landedCost: decimal("landed_cost", { precision: 12, scale: 2 }).notNull(),
  date: date("date").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type MaterialLot = typeof materialLots.$inferSelect;

// ============= INVENTORY TRANSACTIONS =============
export const inventoryTransactions = pgTable("inventory_transactions", {
  id: serial("id").primaryKey(),
  materialId: bigint("materialId", { mode: "number", unsigned: true }).notNull(),
  warehouseId: bigint("warehouseId", { mode: "number", unsigned: true }).notNull(),
  type: varchar.notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  unitCost: decimal("unitCost", { precision: 12, scale: 2 }),
  totalCost: decimal("totalCost", { precision: 12, scale: 2 }),
  reference: varchar("reference", { length: 255 }),
  sourceDocType: varchar("source_doc_type", { length: 50 }), // receipt, work_order, adjustment, transfer
  sourceDocId: bigint("source_doc_id", { mode: "number", unsigned: true }),
  notes: text("notes"),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type InventoryTransaction = typeof inventoryTransactions.$inferSelect;
export type InsertInventoryTransaction = typeof inventoryTransactions.$inferInsert;

// ============= STOCK TRANSFERS =============
export const stockTransfers = pgTable("stock_transfers", {
  id: serial("id").primaryKey(),
  transferNumber: varchar("transfer_number", { length: 50 }).notNull().unique(),
  fromWarehouseId: bigint("from_warehouse_id", { mode: "number", unsigned: true }).notNull(),
  toWarehouseId: bigint("to_warehouse_id", { mode: "number", unsigned: true }).notNull(),
  status: varchar.notNull(),
  transferDate: date("transfer_date").notNull(),
  notes: text("notes"),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type StockTransfer = typeof stockTransfers.$inferSelect;

// ============= STOCK TRANSFER ITEMS =============
export const stockTransferItems = pgTable("stock_transfer_items", {
  id: serial("id").primaryKey(),
  transferId: bigint("transfer_id", { mode: "number", unsigned: true }).notNull(),
  materialId: bigint("materialId", { mode: "number", unsigned: true }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  unitCost: decimal("unit_cost", { precision: 12, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type StockTransferItem = typeof stockTransferItems.$inferSelect;

// ============= INVENTORY COUNTS (Popis) =============
export const inventoryCounts = pgTable("inventory_counts", {
  id: serial("id").primaryKey(),
  countNumber: varchar("count_number", { length: 50 }).notNull().unique(),
  warehouseId: bigint("warehouseId", { mode: "number", unsigned: true }).notNull(),
  status: varchar.notNull(),
  countDate: date("count_date").notNull(),
  notes: text("notes"),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type InventoryCount = typeof inventoryCounts.$inferSelect;

// ============= INVENTORY COUNT ITEMS =============
export const inventoryCountItems = pgTable("inventory_count_items", {
  id: serial("id").primaryKey(),
  countId: bigint("count_id", { mode: "number", unsigned: true }).notNull(),
  materialId: bigint("materialId", { mode: "number", unsigned: true }).notNull(),
  systemQty: decimal("system_qty", { precision: 12, scale: 3 }).notNull(),
  countedQty: decimal("counted_qty", { precision: 12, scale: 3 }),
  difference: decimal("difference", { precision: 12, scale: 3 }),
  unitCost: decimal("unit_cost", { precision: 12, scale: 2 }),
  totalDifference: decimal("total_difference", { precision: 12, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type InventoryCountItem = typeof inventoryCountItems.$inferSelect;

// ============= CUSTOMERS =============
export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  company: varchar("company", { length: 255 }),
  contactPerson: varchar("contactPerson", { length: 255 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  country: varchar("country", { length: 100 }),
  taxNumber: varchar("taxNumber", { length: 50 }),
  edb: varchar("edb", { length: 20 }),
  notes: text("notes"),
  isActive: varchar.notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = typeof customers.$inferInsert;

// ============= ORDERS =============
export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: varchar("orderNumber", { length: 50 }).notNull().unique(),
  customerId: bigint("customerId", { mode: "number", unsigned: true }).notNull(),
  quoteId: bigint("quoteId", { mode: "number", unsigned: true }),
  status: pgEnum("status", [
    "pending",
    "confirmed",
    "in_production",
    "ready",
    "delivered",
    "cancelled",
  ]).notNull(),
  priority: varchar.notNull(),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).notNull(),
  costAmount: decimal("cost_amount", { precision: 14, scale: 2 }).notNull(),
  marginAmount: decimal("margin_amount", { precision: 14, scale: 2 }).notNull(),
  marginPercent: decimal("margin_percent", { precision: 5, scale: 2 }).notNull(),
  deliveryDate: date("deliveryDate"),
  notes: text("notes"),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

// ============= ORDER ITEMS =============
export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: bigint("orderId", { mode: "number", unsigned: true }).notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  drawingNumber: varchar("drawingNumber", { length: 100 }),
  quantity: integer("quantity").notNull(),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull(),
  totalPrice: decimal("totalPrice", { precision: 12, scale: 2 }).notNull(),
  costPrice: decimal("cost_price", { precision: 12, scale: 2 }).notNull(),
  marginAmount: decimal("margin_amount", { precision: 12, scale: 2 }).notNull(),
  material: varchar("material", { length: 255 }),
  dimensions: varchar("dimensions", { length: 255 }),
  productId: bigint("product_id", { mode: "number", unsigned: true }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OrderItem = typeof orderItems.$inferSelect;
export type InsertOrderItem = typeof orderItems.$inferInsert;

// ============= SUPPLIERS =============
export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  edb: varchar("edb", { length: 20 }),
  contactPerson: varchar("contactPerson", { length: 255 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  country: varchar("country", { length: 100 }),
  paymentTerms: varchar("payment_terms", { length: 100 }),
  defaultCurrency: varchar("default_currency", { length: 10 }),
  materials: text("materials"),
  isActive: varchar.notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Supplier = typeof suppliers.$inferSelect;
export type InsertSupplier = typeof suppliers.$inferInsert;

// ============= PURCHASE ORDERS =============
export const purchaseOrders = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  poNumber: varchar("poNumber", { length: 50 }).notNull().unique(),
  supplierId: bigint("supplierId", { mode: "number", unsigned: true }).notNull(),
  status: pgEnum("status", [
    "draft",
    "sent",
    "confirmed",
    "partial",
    "received",
    "cancelled",
  ]).notNull(),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).notNull(),
  expectedDate: date("expectedDate"),
  notes: text("notes"),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type InsertPurchaseOrder = typeof purchaseOrders.$inferInsert;

// ============= PURCHASE ORDER ITEMS =============
export const purchaseOrderItems = pgTable("purchase_order_items", {
  id: serial("id").primaryKey(),
  purchaseOrderId: bigint("purchaseOrderId", { mode: "number", unsigned: true }).notNull(),
  materialId: bigint("materialId", { mode: "number", unsigned: true }).notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull(),
  totalPrice: decimal("totalPrice", { precision: 12, scale: 2 }).notNull(),
  receivedQuantity: decimal("receivedQuantity", { precision: 12, scale: 3 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PurchaseOrderItem = typeof purchaseOrderItems.$inferSelect;
export type InsertPurchaseOrderItem = typeof purchaseOrderItems.$inferInsert;

// ============= WORK ORDERS =============
export const workOrders = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  woNumber: varchar("woNumber", { length: 50 }).notNull().unique(),
  orderId: bigint("orderId", { mode: "number", unsigned: true }),
  description: varchar("description", { length: 500 }).notNull(),
  status: pgEnum("status", [
    "pending",
    "in_progress",
    "on_hold",
    "completed",
    "cancelled",
  ]).notNull(),
  priority: varchar.notNull(),
  plannedStart: date("plannedStart"),
  plannedEnd: date("plannedEnd"),
  actualStart: date("actualStart"),
  actualEnd: date("actualEnd"),
  assignedTo: varchar("assignedTo", { length: 255 }),
  costAmount: decimal("cost_amount", { precision: 14, scale: 2 }).notNull(),
  notes: text("notes"),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type WorkOrder = typeof workOrders.$inferSelect;
export type InsertWorkOrder = typeof workOrders.$inferInsert;

// ============= WORK ORDER OPERATIONS =============
export const workOrderOperations = pgTable("work_order_operations", {
  id: serial("id").primaryKey(),
  workOrderId: bigint("workOrderId", { mode: "number", unsigned: true }).notNull(),
  operation: pgEnum("operation", [
    "cutting_laser",
    "cutting_plasma",
    "bending",
    "welding_mig",
    "welding_tig",
    "grinding",
    "drilling",
    "painting",
    "assembly",
    "quality_control",
    "packaging",
  ]).notNull(),
  sequence: integer("sequence").notNull(),
  description: varchar("description", { length: 500 }),
  estimatedTime: decimal("estimatedTime", { precision: 8, scale: 2 }),
  actualTime: decimal("actualTime", { precision: 8, scale: 2 }),
  estimatedQty: decimal("estimated_qty", { precision: 12, scale: 3 }),
  actualQty: decimal("actual_qty", { precision: 12, scale: 3 }),
  qtyUnit: varchar("qty_unit", { length: 20 }), // m2, m_cut, bend, hour
  status: varchar.notNull(),
  operator: varchar("operator", { length: 255 }),
  costRate: decimal("cost_rate", { precision: 12, scale: 2 }).notNull(),
  costAmount: decimal("cost_amount", { precision: 12, scale: 2 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type WorkOrderOperation = typeof workOrderOperations.$inferSelect;
export type InsertWorkOrderOperation = typeof workOrderOperations.$inferInsert;

// ============= WORK ORDER MATERIALS =============
export const workOrderMaterials = pgTable("work_order_materials", {
  id: serial("id").primaryKey(),
  workOrderId: bigint("workOrderId", { mode: "number", unsigned: true }).notNull(),
  materialId: bigint("materialId", { mode: "number", unsigned: true }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  unitCost: decimal("unit_cost", { precision: 12, scale: 2 }).notNull(),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull(),
  isActual: varchar.notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type WorkOrderMaterial = typeof workOrderMaterials.$inferSelect;

// ============= MACHINES =============
export const machines = pgTable("machines", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  type: pgEnum("type", [
    "laser",
    "plasma",
    "bending",
    "welding",
    "painting",
    "grinding",
    "drilling",
    "cnc",
    "other",
  ]).notNull(),
  costPerHour: decimal("cost_per_hour", { precision: 12, scale: 2 }).notNull(),
  costPerMeter: decimal("cost_per_meter", { precision: 12, scale: 2 }).notNull(),
  annualAmortization: decimal("annual_amortization", { precision: 14, scale: 2 }).notNull(),
  annualElectricity: decimal("annual_electricity", { precision: 14, scale: 2 }).notNull(),
  annualGas: decimal("annual_gas", { precision: 14, scale: 2 }).notNull(),
  annualService: decimal("annual_service", { precision: 14, scale: 2 }).notNull(),
  annualHours: decimal("annual_hours", { precision: 8, scale: 2 }).notNull(),
  isActive: varchar.notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Machine = typeof machines.$inferSelect;

// ============= LABOR RATES =============
export const laborRates = pgTable("labor_rates", {
  id: serial("id").primaryKey(),
  role: varchar("role", { length: 255 }).notNull(),
  roleCode: varchar("role_code", { length: 50 }).notNull().unique(),
  costPerHour: decimal("cost_per_hour", { precision: 12, scale: 2 }).notNull(),
  grossSalary: decimal("gross_salary", { precision: 12, scale: 2 }).notNull(),
  contributionsPct: decimal("contributions_pct", { precision: 5, scale: 2 }).notNull(),
  description: text("description"),
  isActive: varchar.notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LaborRate = typeof laborRates.$inferSelect;

// ============= OVERHEAD =============
export const overhead = pgTable("overhead", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  rateType: varchar.notNull(),
  rateValue: decimal("rate_value", { precision: 12, scale: 4 }).notNull(),
  annualAmount: decimal("annual_amount", { precision: 14, scale: 2 }).notNull(),
  description: text("description"),
  isActive: varchar.notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Overhead = typeof overhead.$inferSelect;

// ============= SERVICES =============
export const services = pgTable("services", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  type: pgEnum("type", [
    "laser_cutting",
    "plasma_cutting",
    "bending",
    "mig_welding",
    "tig_welding",
    "grinding",
    "drilling",
    "electrostatic_paint",
    "wet_paint",
    "galvanizing",
    "cnc_machining",
    "labor",
    "design",
    "transport",
    "installation",
    "other",
  ]).notNull(),
  unit: varchar.notNull(),
  description: text("description"),
  costRate: decimal("cost_rate", { precision: 12, scale: 2 }).notNull(),
  saleRate: decimal("sale_rate", { precision: 12, scale: 2 }).notNull(),
  machineId: bigint("machine_id", { mode: "number", unsigned: true }),
  isActive: varchar.notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Service = typeof services.$inferSelect;
export type InsertService = typeof services.$inferInsert;

// ============= PRODUCTS =============
export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  category: pgEnum("category", [
    "laser_fence",
    "decorative_fence",
    "metal_fence",
    "balcony_railing",
    "stair_railing",
    "gate",
    "pergola",
    "canopy",
    "metal_door",
    "industrial_product",
    "custom_metalwork",
    "shelf",
    "worktable",
    "other",
  ]).notNull(),
  description: text("description"),
  unit: varchar.notNull(),
  basis: varchar.notNull(),
  defaultPrice: decimal("defaultPrice", { precision: 12, scale: 2 }).notNull(),
  materialCost: decimal("materialCost", { precision: 12, scale: 2 }).notNull(),
  laborCost: decimal("laborCost", { precision: 12, scale: 2 }).notNull(),
  machineCost: decimal("machine_cost", { precision: 12, scale: 2 }).notNull(),
  overheadCost: decimal("overhead_cost", { precision: 12, scale: 2 }).notNull(),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull(),
  isActive: varchar.notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

// ============= PRODUCT COMPONENTS (BOM / Normativi) =============
export const productComponents = pgTable("product_components", {
  id: serial("id").primaryKey(),
  productId: bigint("product_id", { mode: "number", unsigned: true }).notNull(),
  kind: varchar.notNull(),
  refId: bigint("ref_id", { mode: "number", unsigned: true }).notNull(),
  perUnit: decimal("per_unit", { precision: 12, scale: 6 }).notNull(),
  wastePct: decimal("waste_pct", { precision: 5, scale: 2 }).notNull(),
  scale: varchar.notNull(),
  notes: text("notes"),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ProductComponent = typeof productComponents.$inferSelect;

// ============= QUOTATIONS =============
export const quotations = pgTable("quotations", {
  id: serial("id").primaryKey(),
  quoteNumber: varchar("quoteNumber", { length: 50 }).notNull().unique(),
  customerId: bigint("customerId", { mode: "number", unsigned: true }).notNull(),
  status: pgEnum("status", [
    "draft",
    "sent",
    "accepted",
    "rejected",
    "expired",
    "converted",
  ]).notNull(),
  subtotal: decimal("subtotal", { precision: 14, scale: 2 }).notNull(),
  costAmount: decimal("cost_amount", { precision: 14, scale: 2 }).notNull(),
  marginAmount: decimal("margin_amount", { precision: 14, scale: 2 }).notNull(),
  marginPercent: decimal("margin_percent", { precision: 5, scale: 2 }).notNull(),
  vatRate: decimal("vatRate", { precision: 5, scale: 2 }).notNull(),
  vatAmount: decimal("vatAmount", { precision: 14, scale: 2 }).notNull(),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  validUntil: date("validUntil"),
  deliveryDays: integer("deliveryDays").default(14),
  paymentTerms: varchar("paymentTerms", { length: 255 }),
  notes: text("notes"),
  convertedOrderId: bigint("convertedOrderId", { mode: "number", unsigned: true }),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Quotation = typeof quotations.$inferSelect;
export type InsertQuotation = typeof quotations.$inferInsert;

// ============= QUOTATION ITEMS =============
export const quotationItems = pgTable("quotation_items", {
  id: serial("id").primaryKey(),
  quotationId: bigint("quotationId", { mode: "number", unsigned: true }).notNull(),
  itemType: varchar.notNull(),
  referenceId: bigint("referenceId", { mode: "number", unsigned: true }),
  description: varchar("description", { length: 500 }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  unit: varchar("unit", { length: 20 }).notNull(),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull(),
  unitCost: decimal("unit_cost", { precision: 12, scale: 2 }).notNull(),
  totalPrice: decimal("totalPrice", { precision: 12, scale: 2 }).notNull(),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull(),
  vatRate: decimal("vatRate", { precision: 5, scale: 2 }).notNull(),
  notes: text("notes"),
  sortOrder: integer("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type QuotationItem = typeof quotationItems.$inferSelect;
export type InsertQuotationItem = typeof quotationItems.$inferInsert;

// ============= OUTGOING INVOICES =============
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: varchar("invoiceNumber", { length: 50 }).notNull().unique(),
  customerId: bigint("customerId", { mode: "number", unsigned: true }).notNull(),
  orderId: bigint("orderId", { mode: "number", unsigned: true }),
  workOrderId: bigint("work_order_id", { mode: "number", unsigned: true }),
  status: pgEnum("status", [
    "draft",
    "issued",
    "sent",
    "paid",
    "overdue",
    "cancelled",
  ]).notNull(),
  invoiceType: pgEnum("invoiceType", [
    "standard",
    "proforma",
    "credit_note",
  ]).notNull(),
  issueDate: date("issueDate").notNull(),
  dueDate: date("dueDate"),
  subtotal: decimal("subtotal", { precision: 14, scale: 2 }).notNull(),
  vatRate: decimal("vatRate", { precision: 5, scale: 2 }).notNull(),
  vatAmount: decimal("vatAmount", { precision: 14, scale: 2 }).notNull(),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  notes: text("notes"),
  eInvoiceId: varchar("eInvoiceId", { length: 255 }),
  originalInvoiceId: bigint("original_invoice_id", { mode: "number", unsigned: true }), // for credit notes
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = typeof invoices.$inferInsert;

// ============= INCOMING INVOICES =============
export const incomingInvoices = pgTable("incoming_invoices", {
  id: serial("id").primaryKey(),
  supplierInvoiceNumber: varchar("supplierInvoiceNumber", { length: 50 }).notNull(),
  supplierId: bigint("supplierId", { mode: "number", unsigned: true }).notNull(),
  poId: bigint("poId", { mode: "number", unsigned: true }),
  receiptId: bigint("receipt_id", { mode: "number", unsigned: true }),
  status: pgEnum("status", [
    "received",
    "verified",
    "paid",
    "disputed",
    "cancelled",
  ]).notNull(),
  issueDate: date("issueDate"),
  receivedDate: date("receivedDate").notNull(),
  dueDate: date("dueDate"),
  subtotal: decimal("subtotal", { precision: 14, scale: 2 }).notNull(),
  vatRate: decimal("vatRate", { precision: 5, scale: 2 }).notNull(),
  vatAmount: decimal("vatAmount", { precision: 14, scale: 2 }).notNull(),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  notes: text("notes"),
  fileUrl: text("fileUrl"),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type IncomingInvoice = typeof incomingInvoices.$inferSelect;
export type InsertIncomingInvoice = typeof incomingInvoices.$inferInsert;

// ============= DOCUMENT ITEMS =============
export const documentItems = pgTable("document_items", {
  id: serial("id").primaryKey(),
  documentId: bigint("documentId", { mode: "number", unsigned: true }).notNull(),
  documentType: varchar.notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  unit: varchar("unit", { length: 20 }).notNull(),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull(),
  discount: decimal("discount", { precision: 5, scale: 2 }).notNull(),
  totalPrice: decimal("totalPrice", { precision: 12, scale: 2 }).notNull(),
  vatRate: decimal("vatRate", { precision: 5, scale: 2 }).notNull(),
  productId: bigint("product_id", { mode: "number", unsigned: true }),
  serviceId: bigint("service_id", { mode: "number", unsigned: true }),
  itemType: varchar.notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DocumentItem = typeof documentItems.$inferSelect;
export type InsertDocumentItem = typeof documentItems.$inferInsert;

// ============= RECEIPTS =============
export const receipts = pgTable("receipts", {
  id: serial("id").primaryKey(),
  receiptNumber: varchar("receiptNumber", { length: 50 }).notNull().unique(),
  supplierId: bigint("supplierId", { mode: "number", unsigned: true }),
  poId: bigint("poId", { mode: "number", unsigned: true }),
  warehouseId: bigint("warehouse_id", { mode: "number", unsigned: true }).notNull(),
  status: pgEnum("status", [
    "draft",
    "confirmed",
    "cancelled",
  ]).notNull(),
  receiptDate: date("receiptDate").notNull(),
  supplierDocNumber: varchar("supplier_doc_number", { length: 100 }),
  transportCost: decimal("transport_cost", { precision: 12, scale: 2 }).notNull(),
  customsCost: decimal("customs_cost", { precision: 12, scale: 2 }).notNull(),
  otherCost: decimal("other_cost", { precision: 12, scale: 2 }).notNull(),
  totalAmount: decimal("totalAmount", { precision: 14, scale: 2 }).notNull(),
  notes: text("notes"),
  fileUrl: text("file_url"),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Receipt = typeof receipts.$inferSelect;
export type InsertReceipt = typeof receipts.$inferInsert;

// ============= RECEIPT ITEMS =============
export const receiptItems = pgTable("receipt_items", {
  id: serial("id").primaryKey(),
  receiptId: bigint("receipt_id", { mode: "number", unsigned: true }).notNull(),
  materialId: bigint("materialId", { mode: "number", unsigned: true }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  unit: varchar("unit", { length: 20 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 12, scale: 2 }).notNull(),
  totalPrice: decimal("total_price", { precision: 12, scale: 2 }).notNull(),
  landedCostAlloc: decimal("landed_cost_alloc", { precision: 12, scale: 2 }).notNull(),
  vatRate: decimal("vat_rate", { precision: 5, scale: 2 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ReceiptItem = typeof receiptItems.$inferSelect;

// ============= DELIVERY NOTES =============
export const deliveryNotes = pgTable("delivery_notes", {
  id: serial("id").primaryKey(),
  dnNumber: varchar("dnNumber", { length: 50 }).notNull().unique(),
  customerId: bigint("customerId", { mode: "number", unsigned: true }).notNull(),
  orderId: bigint("orderId", { mode: "number", unsigned: true }),
  status: pgEnum("status", [
    "draft",
    "issued",
    "delivered",
    "cancelled",
  ]).notNull(),
  issueDate: date("issueDate").notNull(),
  deliveryDate: date("deliveryDate"),
  totalItems: integer("totalItems").default(0).notNull(),
  notes: text("notes"),
  createdBy: bigint("createdBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DeliveryNote = typeof deliveryNotes.$inferSelect;
export type InsertDeliveryNote = typeof deliveryNotes.$inferInsert;

// ============= E-INVOICES =============
export const eInvoices = pgTable("e_invoices", {
  id: serial("id").primaryKey(),
  invoiceId: bigint("invoiceId", { mode: "number", unsigned: true }).notNull(),
  ujpInvoiceId: varchar("ujpInvoiceId", { length: 255 }),
  status: pgEnum("status", [
    "pending",
    "sent_to_ujp",
    "approved",
    "rejected",
    "cancelled",
  ]).notNull(),
  xmlContent: text("xmlContent"),
  responseMessage: text("responseMessage"),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EInvoice = typeof eInvoices.$inferSelect;
export type InsertEInvoice = typeof eInvoices.$inferInsert;

// ============= PARSED INVOICES =============
export const parsedInvoices = pgTable("parsed_invoices", {
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
  fileUrl: text("fileUrl"),
  documentType: varchar.notNull(),
  status: varchar.notNull(),
  matchedInvoiceId: bigint("matchedInvoiceId", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ============= PARSED RECEIPT ITEMS (OCR results) =============
export const parsedReceiptItems = pgTable("parsed_receipt_items", {
  id: serial("id").primaryKey(),
  parsedInvoiceId: bigint("parsed_invoice_id", { mode: "number", unsigned: true }).notNull(),
  rawDescription: text("raw_description").notNull(),
  matchedMaterialId: bigint("matched_material_id", { mode: "number", unsigned: true }),
  matchedMaterialName: varchar("matched_material_name", { length: 255 }),
  matchConfidence: decimal("match_confidence", { precision: 5, scale: 2 }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }),
  unit: varchar("unit", { length: 20 }),
  unitPrice: decimal("unit_price", { precision: 12, scale: 2 }),
  totalPrice: decimal("total_price", { precision: 12, scale: 2 }),
  vatRate: decimal("vat_rate", { precision: 5, scale: 2 }),
  isConfirmed: varchar.notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ParsedReceiptItem = typeof parsedReceiptItems.$inferSelect;

// ============= FINISHED GOODS STOCK (for invoicing products)
export const finishedGoodsStock = pgTable("finished_goods_stock", {
  id: serial("id").primaryKey(),
  productId: bigint("product_id", { mode: "number", unsigned: true }).notNull(),
  warehouseId: bigint("warehouse_id", { mode: "number", unsigned: true }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 3 }).notNull(),
  unitCost: decimal("unit_cost", { precision: 12, scale: 2 }).notNull(),
  notes: text("notes"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type FinishedGoodsStock = typeof finishedGoodsStock.$inferSelect;

// ============= DIGITAL CERTIFICATES (for UJP e-Faktura signing) =============
export const digitalCertificates = pgTable("digital_certificates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  certType: varchar.notNull(),
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
  isActive: varchar.notNull(),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DigitalCertificate = typeof digitalCertificates.$inferSelect;

// ============= DOCUMENT COUNTERS =============
export const docCounters = pgTable("doc_counters", {
  id: serial("id").primaryKey(),
  kind: varchar("kind", { length: 10 }).notNull(), // PO, RN, IS, PF, VF, PR, FV, KN
  year: integer("year").notNull(),
  value: integer("value").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
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
  status: varchar.notNull(),
  rawText: text("raw_text"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EmailInvoice = typeof emailInvoices.$inferSelect;
