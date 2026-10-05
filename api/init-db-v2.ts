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
    // Терк: зачувана шема на книжење (конта и страна, без износи) — се избира при нов налог
    `CREATE TABLE IF NOT EXISTS "gl_templates" (
      "id" serial PRIMARY KEY NOT NULL,
      "name" varchar(120) NOT NULL,
      "description" text,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "gl_templates_name_uq" ON "gl_templates" (lower("name"))`,
    `CREATE TABLE IF NOT EXISTS "gl_template_lines" (
      "id" serial PRIMARY KEY NOT NULL,
      "template_id" integer NOT NULL REFERENCES "gl_templates"("id") ON DELETE CASCADE,
      "position" integer DEFAULT 0 NOT NULL,
      "account_code" varchar(10) NOT NULL,
      "side" char(1) NOT NULL CHECK ("side" IN ('D', 'P')),
      "note" varchar(200)
    )`,
    `CREATE INDEX IF NOT EXISTS "gl_template_lines_tpl_idx" ON "gl_template_lines" ("template_id")`,
    `ALTER TABLE "gl_entries" ADD COLUMN IF NOT EXISTS "template_name" varchar(120)`,
    // Заклучување на период и дневник на измени во главната книга
    `CREATE TABLE IF NOT EXISTS "period_lock" ("id" integer PRIMARY KEY DEFAULT 1, "locked_until" date, "updated_at" timestamp DEFAULT now() NOT NULL, CHECK ("id" = 1))`,
    `ALTER TABLE "gl_entries" ADD COLUMN IF NOT EXISTS "storno_of" integer`,
    `CREATE TABLE IF NOT EXISTS "gl_audit" (
      "id" serial PRIMARY KEY NOT NULL,
      "at" timestamp DEFAULT now() NOT NULL,
      "actor" varchar(160) NOT NULL,
      "action" varchar(20) NOT NULL,
      "entry_number" varchar(30),
      "entry_date" date,
      "source_type" varchar(30),
      "description" text,
      "detail" jsonb
    )`,
    `CREATE INDEX IF NOT EXISTS "gl_audit_at_idx" ON "gl_audit" ("at" DESC)`,
    // ДДВ период на влезна фактура (кога е примена) и обратно оданочување (услуга од странство)
    `ALTER TABLE "incoming_invoices" ADD COLUMN IF NOT EXISTS "vat_date" date`,
    `ALTER TABLE "incoming_invoices" ADD COLUMN IF NOT EXISTS "reverse_charge" boolean DEFAULT false NOT NULL`,
    // постојните остануваат во периодот во кој веќе се пријавени (по датумот на издавање)
    `UPDATE "incoming_invoices" SET "vat_date" = COALESCE("issue_date", "received_date") WHERE "vat_date" IS NULL`,
    // Ставка од извод без фактура: се книжи на избрано конто (плати, ДДВ, провизии, кредити...)
    `ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "account_code" varchar(10)`,
    // Крај на период: залихи на недовршено производство и готови производи; затворање на година; ЕЦД за извоз
    `CREATE TABLE IF NOT EXISTS "inventory_valuations" (
      "id" serial PRIMARY KEY NOT NULL,
      "period_end" date NOT NULL UNIQUE,
      "wip" numeric(16, 2) DEFAULT '0' NOT NULL,
      "fg" numeric(16, 2) DEFAULT '0' NOT NULL,
      "note" text,
      "created_by" varchar(160),
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "year_closes" ("year" integer PRIMARY KEY, "closed_by" varchar(160), "closed_at" timestamp DEFAULT now() NOT NULL)`,
    `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "customs_declaration" varchar(60)`,
    `ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "customs_date" date`,
    // Најава: кодот само како хеш (+ последните две цифри за препознавање), сесии со рок
    `ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "passcode_hint" varchar(8)`,
    `CREATE TABLE IF NOT EXISTS "app_sessions" (
      "id" serial PRIMARY KEY NOT NULL,
      "token_hash" char(64) NOT NULL UNIQUE,
      "user_id" integer,
      "name" varchar(255) NOT NULL,
      "role" varchar(20) NOT NULL,
      "ip" varchar(64),
      "user_agent" varchar(300),
      "created_at" timestamp DEFAULT now() NOT NULL,
      "last_seen_at" timestamp DEFAULT now() NOT NULL,
      "expires_at" timestamp NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "app_sessions_user_idx" ON "app_sessions" ("user_id")`,
    // Компензации, ИОС, налози за плаќање
    `ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "bank_account" varchar(40)`,
    `CREATE TABLE IF NOT EXISTS "compensations" (
      "id" serial PRIMARY KEY NOT NULL,
      "number" varchar(30) NOT NULL UNIQUE,
      "comp_date" date NOT NULL,
      "customer_id" integer,
      "supplier_id" integer,
      "amount" numeric(16, 2) NOT NULL,
      "status" varchar(20) DEFAULT 'active' NOT NULL,
      "note" text,
      "created_by" varchar(160),
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "compensation_items" (
      "id" serial PRIMARY KEY NOT NULL,
      "compensation_id" integer NOT NULL REFERENCES "compensations"("id") ON DELETE CASCADE,
      "doc_type" varchar(20) NOT NULL,
      "doc_id" integer NOT NULL,
      "amount" numeric(16, 2) NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "compensation_items_doc_idx" ON "compensation_items" ("doc_type", "doc_id")`,
    `CREATE TABLE IF NOT EXISTS "ios_log" (
      "id" serial PRIMARY KEY NOT NULL,
      "partner_type" varchar(10) NOT NULL,
      "partner_id" integer NOT NULL,
      "as_of" date NOT NULL,
      "balance" numeric(16, 2) NOT NULL,
      "sent_to" text,
      "status" varchar(20) DEFAULT 'sent' NOT NULL,
      "note" text,
      "created_by" varchar(160),
      "created_at" timestamp DEFAULT now() NOT NULL,
      "answered_at" timestamp
    )`,
    `CREATE TABLE IF NOT EXISTS "payment_order_batches" (
      "id" serial PRIMARY KEY NOT NULL,
      "pay_date" date NOT NULL,
      "total" numeric(16, 2) NOT NULL,
      "count" integer NOT NULL,
      "created_by" varchar(160),
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "payment_order_items" (
      "id" serial PRIMARY KEY NOT NULL,
      "batch_id" integer NOT NULL REFERENCES "payment_order_batches"("id") ON DELETE CASCADE,
      "incoming_invoice_id" integer,
      "supplier_id" integer,
      "payee" varchar(255) NOT NULL,
      "payee_account" varchar(40),
      "amount" numeric(16, 2) NOT NULL,
      "purpose" varchar(140),
      "reference" varchar(40),
      "payment_code" varchar(10)
    )`,
    `CREATE INDEX IF NOT EXISTS "payment_order_items_inc_idx" ON "payment_order_items" ("incoming_invoice_id")`,
    // Технолошка постапка по производ, рок на испорака кај добавувач
    `CREATE TABLE IF NOT EXISTS "product_routings" (
      "id" serial PRIMARY KEY NOT NULL,
      "product_id" integer NOT NULL,
      "sequence" integer NOT NULL,
      "operation" varchar(50) NOT NULL,
      "description" varchar(500),
      "machine_id" integer,
      "setup_min" numeric(10, 2) DEFAULT '0' NOT NULL,
      "run_min" numeric(10, 3) DEFAULT '0' NOT NULL,
      "notes" text
    )`,
    `CREATE INDEX IF NOT EXISTS "product_routings_product_idx" ON "product_routings" ("product_id")`,
    `ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "lead_time_days" integer`,
    // Застои на машини (за OEE)
    `CREATE TABLE IF NOT EXISTS "machine_downtime" (
      "id" serial PRIMARY KEY NOT NULL,
      "machine_id" integer NOT NULL,
      "start_at" timestamp NOT NULL,
      "end_at" timestamp,
      "reason" varchar(30) NOT NULL,
      "note" text,
      "created_by" varchar(160),
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "machine_downtime_machine_idx" ON "machine_downtime" ("machine_id", "start_at")`,
    // Квалитет: план на контрола, записи од мерење, мерни инструменти и калибрации, 8D
    `CREATE TABLE IF NOT EXISTS "instruments" (
      "id" serial PRIMARY KEY NOT NULL,
      "name" varchar(255) NOT NULL,
      "code" varchar(60),
      "serial_no" varchar(120),
      "range_text" varchar(120),
      "location" varchar(160),
      "interval_months" integer DEFAULT 12 NOT NULL,
      "last_calibration" date,
      "next_due" date,
      "status" varchar(20) DEFAULT 'active' NOT NULL,
      "notes" text,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "instrument_calibrations" (
      "id" serial PRIMARY KEY NOT NULL,
      "instrument_id" integer NOT NULL REFERENCES "instruments"("id") ON DELETE CASCADE,
      "cal_date" date NOT NULL,
      "result" varchar(10) NOT NULL,
      "certificate_no" varchar(120),
      "provider" varchar(255),
      "next_due" date,
      "notes" text,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "inspection_plans" (
      "id" serial PRIMARY KEY NOT NULL,
      "product_id" integer,
      "operation" varchar(50),
      "characteristic" varchar(255) NOT NULL,
      "nominal" numeric(14, 4),
      "tol_plus" numeric(14, 4),
      "tol_minus" numeric(14, 4),
      "unit" varchar(20) DEFAULT 'mm',
      "instrument_id" integer,
      "frequency" varchar(120),
      "sort_order" integer DEFAULT 0 NOT NULL,
      "notes" text
    )`,
    `CREATE TABLE IF NOT EXISTS "inspection_records" (
      "id" serial PRIMARY KEY NOT NULL,
      "work_order_id" integer NOT NULL,
      "plan_id" integer,
      "characteristic" varchar(255) NOT NULL,
      "nominal" numeric(14, 4),
      "tol_plus" numeric(14, 4),
      "tol_minus" numeric(14, 4),
      "measured" numeric(14, 4),
      "result" varchar(10) NOT NULL,
      "sample_no" integer DEFAULT 1 NOT NULL,
      "instrument_id" integer,
      "inspector" varchar(160),
      "inspected_at" timestamp DEFAULT now() NOT NULL,
      "notes" text
    )`,
    `CREATE INDEX IF NOT EXISTS "inspection_records_wo_idx" ON "inspection_records" ("work_order_id")`,
    // Нестинг: извоз на делови и увоз на резултат (табли, искористеност, остатоци)
    `CREATE TABLE IF NOT EXISTS "nesting_jobs" (
      "id" serial PRIMARY KEY NOT NULL,
      "work_order_ids" integer[] NOT NULL,
      "parts" jsonb,
      "result" jsonb,
      "status" varchar(20) DEFAULT 'exported' NOT NULL,
      "created_by" varchar(160),
      "created_at" timestamp DEFAULT now() NOT NULL,
      "imported_at" timestamp
    )`,
    // DXF цртежи од калкулацијата за сечење (оригиналот се чува за налогот/машината)
    `CREATE TABLE IF NOT EXISTS "cad_drawings" (
      "id" serial PRIMARY KEY NOT NULL,
      "file_name" varchar(255) NOT NULL,
      "dxf" text NOT NULL,
      "stats" jsonb,
      "calc" jsonb,
      "quotation_id" integer,
      "created_by" varchar(160),
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,

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
    `ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "accountant_email" varchar(320)`,

    // ===== ПОТСЕТНИЦИ =====
    `CREATE TABLE IF NOT EXISTS "app_kv" ("key" varchar(80) PRIMARY KEY NOT NULL, "value" text, "updated_at" timestamp DEFAULT now() NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS "reminder_log" (
      "id" serial PRIMARY KEY NOT NULL,
      "kind" varchar(30) NOT NULL,
      "doc_type" varchar(30),
      "doc_id" bigint,
      "sent_to" text,
      "sent_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "reminder_log_doc_idx" ON "reminder_log" ("kind", "doc_type", "doc_id")`,

    // ===== Конто на влезна фактура (трошок / залиха) =====
    `ALTER TABLE "incoming_invoices" ADD COLUMN IF NOT EXISTS "expense_account" varchar(10)`,
    `ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "default_expense_account" varchar(10)`,
    `ALTER TABLE "incoming_invoices" ADD COLUMN IF NOT EXISTS "account_confirmed" boolean DEFAULT false`,
    `ALTER TABLE "quality_issues" ADD COLUMN IF NOT EXISTS "rework_wo_id" bigint`,

    // ===== Индекси за побрзи листи =====
    `CREATE INDEX IF NOT EXISTS "invoices_created_idx" ON "invoices" ("created_at")`,
    `CREATE INDEX IF NOT EXISTS "invoices_issue_idx" ON "invoices" ("issue_date")`,
    `CREATE INDEX IF NOT EXISTS "incoming_invoices_received_idx" ON "incoming_invoices" ("received_date")`,
    `CREATE INDEX IF NOT EXISTS "inventory_tx_created_idx" ON "inventory_transactions" ("created_at")`,
    `CREATE INDEX IF NOT EXISTS "wo_materials_wo_idx" ON "work_order_materials" ("work_order_id")`,
    `CREATE INDEX IF NOT EXISTS "wo_ops_wo_idx" ON "work_order_operations" ("work_order_id")`,
    `CREATE INDEX IF NOT EXISTS "document_items_doc_idx" ON "document_items" ("document_type", "document_id")`,
    // по табелите на квалитет и остатоци (се создаваат погоре)
    `ALTER TABLE "quality_issues" ADD COLUMN IF NOT EXISTS "eight_d" jsonb`,
    `ALTER TABLE "material_remnants" ADD COLUMN IF NOT EXISTS "width_mm" numeric(12, 1)`,
    // ===== Ф3: CRM, портал, отсуства, набавка, продажни услови, буџет =====
    `CREATE TABLE IF NOT EXISTS "crm_opportunities" (
      "id" serial PRIMARY KEY NOT NULL,
      "customer_id" integer,
      "company" varchar(255),
      "contact_name" varchar(255),
      "email" varchar(320),
      "phone" varchar(60),
      "title" varchar(300) NOT NULL,
      "value" numeric(16, 2) DEFAULT '0' NOT NULL,
      "currency" varchar(10) DEFAULT 'MKD' NOT NULL,
      "probability" integer DEFAULT 30 NOT NULL,
      "stage" varchar(20) DEFAULT 'new' NOT NULL,
      "expected_close" date,
      "source" varchar(30),
      "lost_reason" varchar(40),
      "quotation_id" integer,
      "owner" varchar(160),
      "notes" text,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "crm_activities" (
      "id" serial PRIMARY KEY NOT NULL,
      "customer_id" integer,
      "opportunity_id" integer,
      "quotation_id" integer,
      "kind" varchar(20) NOT NULL,
      "subject" varchar(300) NOT NULL,
      "notes" text,
      "due_date" date,
      "done_at" timestamp,
      "created_by" varchar(160),
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "crm_activities_customer_idx" ON "crm_activities" ("customer_id")`,
    `CREATE TABLE IF NOT EXISTS "crm_files" (
      "id" serial PRIMARY KEY NOT NULL,
      "opportunity_id" integer NOT NULL REFERENCES "crm_opportunities"("id") ON DELETE CASCADE,
      "file_name" varchar(255) NOT NULL,
      "mime" varchar(120),
      "data" text NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "lost_reason" varchar(40)`,
    `ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "lost_note" text`,
    `CREATE TABLE IF NOT EXISTS "customer_portal_tokens" (
      "id" serial PRIMARY KEY NOT NULL,
      "customer_id" integer NOT NULL,
      "token_hash" char(64) NOT NULL UNIQUE,
      "created_by" varchar(160),
      "created_at" timestamp DEFAULT now() NOT NULL,
      "expires_at" timestamp,
      "revoked_at" timestamp,
      "last_used_at" timestamp
    )`,
    `ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "embg" varchar(13)`,
    `ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "annual_leave_days" integer DEFAULT 20`,
    `CREATE TABLE IF NOT EXISTS "employee_absences" (
      "id" serial PRIMARY KEY NOT NULL,
      "employee_id" integer NOT NULL,
      "kind" varchar(20) NOT NULL,
      "date_from" date NOT NULL,
      "date_to" date NOT NULL,
      "days" numeric(6, 1) NOT NULL,
      "note" text,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "rfqs" (
      "id" serial PRIMARY KEY NOT NULL,
      "number" varchar(30) NOT NULL UNIQUE,
      "title" varchar(300) NOT NULL,
      "needed_by" date,
      "status" varchar(20) DEFAULT 'draft' NOT NULL,
      "notes" text,
      "po_id" integer,
      "created_by" varchar(160),
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "rfq_items" (
      "id" serial PRIMARY KEY NOT NULL,
      "rfq_id" integer NOT NULL REFERENCES "rfqs"("id") ON DELETE CASCADE,
      "material_id" integer,
      "description" varchar(500) NOT NULL,
      "quantity" numeric(14, 3) NOT NULL,
      "unit" varchar(20)
    )`,
    `CREATE TABLE IF NOT EXISTS "rfq_suppliers" (
      "id" serial PRIMARY KEY NOT NULL,
      "rfq_id" integer NOT NULL REFERENCES "rfqs"("id") ON DELETE CASCADE,
      "supplier_id" integer NOT NULL,
      "sent_at" timestamp,
      "responded_at" timestamp,
      "prices" jsonb,
      "delivery_days" integer,
      "valid_until" date,
      "note" text,
      "chosen" boolean DEFAULT false NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "supplier_prices" (
      "id" serial PRIMARY KEY NOT NULL,
      "supplier_id" integer NOT NULL,
      "material_id" integer NOT NULL,
      "price" numeric(14, 4) NOT NULL,
      "currency" varchar(10) DEFAULT 'MKD' NOT NULL,
      "min_qty" numeric(14, 3),
      "lead_days" integer,
      "valid_from" date,
      "source" varchar(30),
      "updated_at" timestamp DEFAULT now() NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "supplier_prices_uq" ON "supplier_prices" ("supplier_id", "material_id")`,
    `ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "approved_by" varchar(160)`,
    `ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "approved_at" timestamp`,
    `ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "discount_pct" numeric(5, 2) DEFAULT '0'`,
    `ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "credit_limit" numeric(16, 2)`,
    `ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "payment_days" integer`,
    `CREATE TABLE IF NOT EXISTS "customer_prices" (
      "id" serial PRIMARY KEY NOT NULL,
      "customer_id" integer NOT NULL,
      "item_type" varchar(20) NOT NULL,
      "ref_id" integer NOT NULL,
      "price" numeric(14, 2),
      "discount_pct" numeric(5, 2),
      "note" varchar(300)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "customer_prices_uq" ON "customer_prices" ("customer_id", "item_type", "ref_id")`,
    `CREATE TABLE IF NOT EXISTS "budgets" (
      "id" serial PRIMARY KEY NOT NULL,
      "year" integer NOT NULL,
      "line" varchar(40) NOT NULL,
      "month" integer DEFAULT 0 NOT NULL,
      "amount" numeric(16, 2) NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "budgets_uq" ON "budgets" ("year", "line", "month")`,
    // безбедна миграција: количините на нарачка усогласени со понудите (decimal)
    `ALTER TABLE "order_items" ALTER COLUMN "quantity" TYPE numeric(12, 3) USING ("quantity"::numeric(12, 3))`,
    `ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "salesperson" varchar(160)`,
    `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "salesperson" varchar(160)`,
    `ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "delivered_qty" numeric(12, 3) DEFAULT 0`,
    `ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "reserved_qty" numeric(12, 3) DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS "sales_returns" (
      "id" serial PRIMARY KEY NOT NULL,
      "number" varchar(50) NOT NULL UNIQUE,
      "customer_id" integer NOT NULL,
      "order_id" integer,
      "invoice_id" integer,
      "status" varchar(20) DEFAULT 'draft' NOT NULL,
      "reason" varchar(40),
      "notes" text,
      "issue_date" date,
      "created_at" timestamp DEFAULT now() NOT NULL
    )`,
  ];
}
