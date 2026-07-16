import { getDb } from "../../api/queries/connection";
import { sql } from "drizzle-orm";

async function applyMigration() {
  const db = getDb();

  // 1. Create finished_goods_stock table
  const tablesResult = await db.execute(sql`
    SELECT TABLE_NAME 
    FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'finished_goods_stock'
  `);

  if ((tablesResult[0] as any[]).length === 0) {
    console.log("Creating finished_goods_stock table...");
    await db.execute(sql`
      CREATE TABLE finished_goods_stock (
        id SERIAL AUTO_INCREMENT PRIMARY KEY,
        product_id BIGINT UNSIGNED NOT NULL,
        warehouse_id BIGINT UNSIGNED NOT NULL,
        quantity DECIMAL(12,3) NOT NULL DEFAULT '0',
        unit_cost DECIMAL(12,2) NOT NULL DEFAULT '0',
        notes TEXT,
        updatedAt TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log("OK");
  } else {
    console.log("finished_goods_stock table already exists");
  }

  // 2. Add columns to document_items
  const colsResult = await db.execute(sql`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'document_items' AND TABLE_SCHEMA = DATABASE()
  `);
  const columns = (colsResult[0] as any[]).map((r: any) => r.COLUMN_NAME);

  if (!columns.includes("product_id")) {
    console.log("Adding product_id to document_items...");
    await db.execute(sql`ALTER TABLE document_items ADD COLUMN product_id BIGINT UNSIGNED`);
  }
  if (!columns.includes("service_id")) {
    console.log("Adding service_id to document_items...");
    await db.execute(sql`ALTER TABLE document_items ADD COLUMN service_id BIGINT UNSIGNED`);
  }
  if (!columns.includes("item_type")) {
    console.log("Adding item_type to document_items...");
    await db.execute(sql`ALTER TABLE document_items ADD COLUMN item_type ENUM('product','service','manual') NOT NULL DEFAULT 'manual'`);
  }

  console.log("Migration complete!");
  process.exit(0);
}

applyMigration().catch(e => {
  console.error("Migration failed:", e);
  process.exit(1);
});
