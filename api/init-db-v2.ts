// Табели за: курсна листа, благајна, главна книга, распоред, квалитет, одржување, вработени/плати.
// Сите се идемпотентни (IF NOT EXISTS) и се извршуваат при секое стартување.

export function getExtraSql(): string[] {
  return [
    // ===== КУРСНА ЛИСТА =====
    `CREATE TABLE IF NOT EXISTS "exchange_rates" (
      "id" serial PRIMARY KEY NOT NULL,
      "rate_date" date NOT NULL,
      "currency" varchar(3) NOT NULL,
      "rate" numeric(14, 6) NOT NULL,
      "source" varchar(20) DEFAULT 'manual' NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "exchange_rates_day_cur_uq" ON "exchange_rates" ("rate_date", "currency")`,

    // ===== БЛАГАЈНА =====
    `CREATE TABLE IF NOT EXISTS "cash_transactions" (
      "id" serial PRIMARY KEY NOT NULL,
      "doc_number" varchar(30) NOT NULL,
      "tx_date" date NOT NULL,
      "direction" varchar(3) NOT NULL,
      "amount" numeric(14, 2) NOT NULL,
      "description" text,
      "partner_name" varchar(255),
      "customer_id" bigint,
      "supplier_id" bigint,
      "invoice_id" bigint,
      "incoming_invoice_id" bigint,
      "account_code" varchar(10),
      "created_by" varchar(255),
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "cash_tx_doc_uq" ON "cash_transactions" ("doc_number")`,
    `CREATE INDEX IF NOT EXISTS "cash_tx_date_idx" ON "cash_transactions" ("tx_date")`,

    // ===== ГЛАВНА КНИГА =====
    `CREATE TABLE IF NOT EXISTS "gl_accounts" (
      "code" varchar(10) PRIMARY KEY NOT NULL,
      "name" varchar(255) NOT NULL,
      "type" varchar(20) NOT NULL,
      "is_active" varchar(10) DEFAULT 'active' NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "gl_posting_rules" (
      "key" varchar(40) PRIMARY KEY NOT NULL,
      "account_code" varchar(10) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "gl_entries" (
      "id" serial PRIMARY KEY NOT NULL,
      "entry_number" varchar(30) NOT NULL,
      "entry_date" date NOT NULL,
      "description" text,
      "source_type" varchar(30) NOT NULL,
      "source_id" bigint,
      "signature" text,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "gl_entries_source_uq" ON "gl_entries" ("source_type", "source_id") WHERE "source_type" <> 'manual'`,
    `CREATE INDEX IF NOT EXISTS "gl_entries_date_idx" ON "gl_entries" ("entry_date")`,
    `CREATE TABLE IF NOT EXISTS "gl_lines" (
      "id" serial PRIMARY KEY NOT NULL,
      "entry_id" bigint NOT NULL,
      "account_code" varchar(10) NOT NULL,
      "debit" numeric(16, 2) DEFAULT '0' NOT NULL,
      "credit" numeric(16, 2) DEFAULT '0' NOT NULL,
      "partner_type" varchar(20),
      "partner_id" bigint,
      "description" text
    )`,
    `CREATE INDEX IF NOT EXISTS "gl_lines_entry_idx" ON "gl_lines" ("entry_id")`,
    `CREATE INDEX IF NOT EXISTS "gl_lines_account_idx" ON "gl_lines" ("account_code")`,

    // ===== РАСПОРЕД НА ПРОИЗВОДСТВО =====
    `ALTER TABLE "work_order_operations" ADD COLUMN IF NOT EXISTS "machine_id" bigint`,
    `ALTER TABLE "work_order_operations" ADD COLUMN IF NOT EXISTS "planned_date" date`,
    `ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "hours_per_day" numeric(5, 2) DEFAULT '8'`,
    `ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "operations" text`,

    // ===== КВАЛИТЕТ =====
    `CREATE TABLE IF NOT EXISTS "quality_issues" (
      "id" serial PRIMARY KEY NOT NULL,
      "issue_number" varchar(30) NOT NULL,
      "issue_date" date NOT NULL,
      "kind" varchar(20) NOT NULL,
      "status" varchar(20) DEFAULT 'open' NOT NULL,
      "work_order_id" bigint,
      "customer_id" bigint,
      "supplier_id" bigint,
      "material_id" bigint,
      "title" varchar(255) NOT NULL,
      "description" text,
      "root_cause" text,
      "action" text,
      "cost" numeric(14, 2) DEFAULT '0' NOT NULL,
      "responsible" varchar(255),
      "closed_at" date,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,

    // ===== ОДРЖУВАЊЕ МАШИНИ =====
    `CREATE TABLE IF NOT EXISTS "maintenance_plans" (
      "id" serial PRIMARY KEY NOT NULL,
      "machine_id" bigint NOT NULL,
      "title" varchar(255) NOT NULL,
      "interval_days" integer DEFAULT 90 NOT NULL,
      "last_done" date,
      "notes" text,
      "is_active" varchar(10) DEFAULT 'active' NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "maintenance_logs" (
      "id" serial PRIMARY KEY NOT NULL,
      "machine_id" bigint NOT NULL,
      "plan_id" bigint,
      "done_date" date NOT NULL,
      "kind" varchar(20) DEFAULT 'planned' NOT NULL,
      "description" text,
      "cost" numeric(14, 2) DEFAULT '0' NOT NULL,
      "downtime_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
      "performed_by" varchar(255),
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,

    // ===== ВРАБОТЕНИ И ПЛАТИ =====
    `CREATE TABLE IF NOT EXISTS "employees" (
      "id" serial PRIMARY KEY NOT NULL,
      "full_name" varchar(255) NOT NULL,
      "position" varchar(255),
      "scan_name" varchar(255),
      "gross_salary" numeric(14, 2) DEFAULT '0' NOT NULL,
      "hourly_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
      "start_date" date,
      "end_date" date,
      "bank_account" varchar(40),
      "notes" text,
      "is_active" varchar(10) DEFAULT 'active' NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "payroll_runs" (
      "id" serial PRIMARY KEY NOT NULL,
      "period" varchar(7) NOT NULL,
      "status" varchar(20) DEFAULT 'draft' NOT NULL,
      "params" text,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "payroll_runs_period_uq" ON "payroll_runs" ("period")`,
    `CREATE TABLE IF NOT EXISTS "payroll_lines" (
      "id" serial PRIMARY KEY NOT NULL,
      "run_id" bigint NOT NULL,
      "employee_id" bigint NOT NULL,
      "gross" numeric(14, 2) NOT NULL,
      "contributions" numeric(14, 2) NOT NULL,
      "tax_base" numeric(14, 2) NOT NULL,
      "income_tax" numeric(14, 2) NOT NULL,
      "net" numeric(14, 2) NOT NULL,
      "hours" numeric(10, 2) DEFAULT '0' NOT NULL,
      "detail" text
    )`,

    // ===== Е-ПОШТА (праќање) =====
    `ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "smtp_host" varchar(255)`,
    `ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "smtp_port" integer DEFAULT 587`,
    `ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "smtp_secure" integer DEFAULT 0`,
    `ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "smtp_user" varchar(255)`,
    `ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "smtp_password" varchar(255)`,
    `ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "smtp_from" varchar(320)`,

    // ===== Индекси за побрзи листи =====
    `CREATE INDEX IF NOT EXISTS "invoices_created_idx" ON "invoices" ("created_at")`,
    `CREATE INDEX IF NOT EXISTS "invoices_issue_idx" ON "invoices" ("issue_date")`,
    `CREATE INDEX IF NOT EXISTS "incoming_invoices_received_idx" ON "incoming_invoices" ("received_date")`,
    `CREATE INDEX IF NOT EXISTS "inventory_tx_created_idx" ON "inventory_transactions" ("created_at")`,
    `CREATE INDEX IF NOT EXISTS "wo_materials_wo_idx" ON "work_order_materials" ("work_order_id")`,
    `CREATE INDEX IF NOT EXISTS "wo_ops_wo_idx" ON "work_order_operations" ("work_order_id")`,
    `CREATE INDEX IF NOT EXISTS "document_items_doc_idx" ON "document_items" ("document_type", "document_id")`,
  ];
}
