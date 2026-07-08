import { getDb } from "../../api/queries/connection";
import { sql } from "drizzle-orm";

async function applyMigration() {
  const db = getDb();

  const tablesResult = await db.execute(sql`
    SELECT TABLE_NAME 
    FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'digital_certificates'
  `);

  if ((tablesResult[0] as any[]).length === 0) {
    console.log("Creating digital_certificates table...");
    await db.execute(sql`
      CREATE TABLE digital_certificates (
        id SERIAL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        cert_type ENUM('qualified', 'advanced', 'test') NOT NULL DEFAULT 'qualified',
        certificate_pem TEXT NOT NULL,
        private_key_encrypted TEXT,
        encryption_iv VARCHAR(100),
        encryption_auth_tag VARCHAR(100),
        issuer VARCHAR(255),
        serial_number VARCHAR(100),
        valid_from DATE,
        valid_to DATE,
        edb VARCHAR(20),
        isActive ENUM('active', 'inactive', 'expired') NOT NULL DEFAULT 'active',
        last_used_at TIMESTAMP NULL,
        createdAt TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    console.log("OK");
  } else {
    console.log("digital_certificates table already exists");
  }

  console.log("Migration complete!");
  process.exit(0);
}

applyMigration().catch(e => {
  console.error("Migration failed:", e);
  process.exit(1);
});
