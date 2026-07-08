import { getDb } from "../api/queries/connection";

(async () => {
  const db = getDb();
  await db.execute("SET FOREIGN_KEY_CHECKS = 0");
  const tables = [
    "audit_log", "doc_counters", "unit_conversions", "units",
    "overhead", "labor_rates", "machines", "work_order_materials",
    "product_components", "products", "services",
    "inventory_count_items", "inventory_counts",
    "stock_transfer_items", "stock_transfers",
    "material_lots", "material_stock",
    "parsed_invoices", "e_invoices", "document_items", "delivery_notes",
    "receipt_items", "receipts", "incoming_invoices", "invoices",
    "quotation_items", "quotations",
    "work_order_operations", "work_orders",
    "purchase_order_items", "purchase_orders",
    "order_items", "orders",
    "inventory_transactions", "materials",
    "warehouses", "company_settings",
    "customers", "suppliers", "users",
  ];
  for (const t of tables) {
    await db.execute(`DROP TABLE IF EXISTS \`${t}\``);
  }
  await db.execute("SET FOREIGN_KEY_CHECKS = 1");
  console.log("All tables dropped successfully");
  process.exit(0);
})();
