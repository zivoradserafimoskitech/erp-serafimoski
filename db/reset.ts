import { getDb } from "../api/queries/connection";

(async () => {
  const db = getDb();
  await db.execute("SET FOREIGN_KEY_CHECKS = 0");
  const tables = [
    "parsed_invoices", "e_invoices", "document_items", "delivery_notes",
    "receipts", "incoming_invoices", "invoices",
    "work_order_operations", "work_orders",
    "purchase_order_items", "purchase_orders",
    "order_items", "orders",
    "inventory_transactions", "materials",
    "customers", "suppliers", "users",
  ];
  for (const t of tables) {
    await db.execute(`DROP TABLE IF EXISTS \`${t}\``);
  }
  await db.execute("SET FOREIGN_KEY_CHECKS = 1");
  console.log("All tables dropped successfully");
  process.exit(0);
})();
