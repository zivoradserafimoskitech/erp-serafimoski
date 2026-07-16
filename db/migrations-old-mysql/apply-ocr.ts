import { getDb } from "../../api/queries/connection";
import { sql } from "drizzle-orm";

async function applyMigration() {
  const db = getDb();

  // Check if document_type column exists
  const colsResult = await db.execute(sql`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'parsed_invoices' AND TABLE_SCHEMA = DATABASE()
  `);
  const columns = (colsResult[0] as any[]).map((r: any) => r.COLUMN_NAME);

  if (!columns.includes("document_type")) {
    console.log("Adding document_type column to parsed_invoices...");
    await db.execute(sql`
      ALTER TABLE parsed_invoices 
      ADD COLUMN document_type ENUM('invoice','receipt','delivery_note','other') 
      NOT NULL DEFAULT 'invoice'
    `);
    console.log("OK");
  } else {
    console.log("document_type column already exists");
  }

  if (!columns.includes("fileUrl")) {
    console.log("Adding fileUrl column to parsed_invoices...");
    await db.execute(sql`
      ALTER TABLE parsed_invoices 
      ADD COLUMN fileUrl TEXT
    `);
    console.log("OK");
  } else {
    console.log("fileUrl column already exists");
  }

  // Check if parsed_receipt_items table exists
  const tablesResult = await db.execute(sql`
    SELECT TABLE_NAME 
    FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'parsed_receipt_items'
  `);

  if ((tablesResult[0] as any[]).length === 0) {
    console.log("Creating parsed_receipt_items table...");
    await db.execute(sql`
      CREATE TABLE parsed_receipt_items (
        id SERIAL AUTO_INCREMENT PRIMARY KEY,
        parsed_invoice_id BIGINT UNSIGNED NOT NULL,
        raw_description TEXT NOT NULL,
        matched_material_id BIGINT UNSIGNED,
        matched_material_name VARCHAR(255),
        match_confidence DECIMAL(5,2) NOT NULL DEFAULT '0',
        quantity DECIMAL(12,3),
        unit VARCHAR(20),
        unit_price DECIMAL(12,2),
        total_price DECIMAL(12,2),
        vat_rate DECIMAL(5,2) DEFAULT '18',
        is_confirmed ENUM('pending','confirmed','rejected') NOT NULL DEFAULT 'pending',
        createdAt TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log("OK");
  } else {
    console.log("parsed_receipt_items table already exists");
  }

  console.log("Migration complete!");
  process.exit(0);
}

applyMigration().catch(e => {
  console.error("Migration failed:", e);
  process.exit(1);
});
