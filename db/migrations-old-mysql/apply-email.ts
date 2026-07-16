import { getDb } from "../../api/queries/connection";
import { sql } from "drizzle-orm";

async function applyMigration() {
  const db = getDb();

  // 1. Add email columns to company_settings
  const colsResult = await db.execute(sql`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'company_settings' AND TABLE_SCHEMA = DATABASE()
  `);
  const columns = (colsResult[0] as any[]).map((r: any) => r.COLUMN_NAME);

  const emailCols = [
    { name: "emailImapHost", type: "VARCHAR(255)" },
    { name: "emailImapPort", type: "INT" },
    { name: "emailImapSecure", type: "TINYINT", default: "1" },
    { name: "emailUsername", type: "VARCHAR(255)" },
    { name: "emailPassword", type: "VARCHAR(255)" },
    { name: "emailCheckInterval", type: "INT", default: "60" },
  ];

  for (const col of emailCols) {
    if (!columns.includes(col.name)) {
      console.log(`Adding ${col.name} to company_settings...`);
      const def = col.default ? ` DEFAULT ${col.default}` : "";
      await db.execute(sql.raw(`ALTER TABLE company_settings ADD COLUMN ${col.name} ${col.type}${def}`));
    }
  }

  // 2. Create email_invoices table
  const tablesResult = await db.execute(sql`
    SELECT TABLE_NAME 
    FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_invoices'
  `);

  if ((tablesResult[0] as any[]).length === 0) {
    console.log("Creating email_invoices table...");
    await db.execute(sql`
      CREATE TABLE email_invoices (
        id SERIAL AUTO_INCREMENT PRIMARY KEY,
        subject VARCHAR(500),
        sender_email VARCHAR(255),
        sender_name VARCHAR(255),
        received_at TIMESTAMP NOT NULL DEFAULT NOW(),
        pdf_base64 LONGTEXT,
        pdf_filename VARCHAR(255),
        parsed_supplier_name VARCHAR(255),
        parsed_invoice_number VARCHAR(100),
        parsed_total_amount VARCHAR(50),
        parsed_issue_date VARCHAR(20),
        matched_supplier_id BIGINT UNSIGNED,
        status ENUM('new','parsed','reviewed','imported','rejected') NOT NULL DEFAULT 'new',
        raw_text TEXT,
        createdAt TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log("OK");
  } else {
    console.log("email_invoices table already exists");
  }

  console.log("Migration complete!");
  process.exit(0);
}

applyMigration().catch(e => {
  console.error("Migration failed:", e);
  process.exit(1);
});
