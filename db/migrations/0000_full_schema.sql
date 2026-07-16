CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" bigint,
	"user_name" varchar(255),
	"action" varchar(50) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" bigint,
	"old_value" text,
	"new_value" text,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"address" text,
	"edb" varchar(20) NOT NULL,
	"embs" varchar(20),
	"bank_name" varchar(255),
	"bank_account" varchar(50),
	"phone" varchar(50),
	"email" varchar(320),
	"logo_url" text,
	"default_vat_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"valuation_method" varchar(50) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"timezone" varchar(50) NOT NULL,
	"email_imap_host" varchar(255),
	"email_imap_port" integer DEFAULT 993,
	"email_imap_secure" integer DEFAULT 1,
	"email_username" varchar(255),
	"email_password" varchar(255),
	"email_check_interval" integer DEFAULT 60,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"company" varchar(255),
	"contact_person" varchar(255),
	"email" varchar(320),
	"phone" varchar(50),
	"address" text,
	"city" varchar(100),
	"country" varchar(100),
	"tax_number" varchar(50),
	"edb" varchar(20),
	"notes" text,
	"is_active" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"dn_number" varchar(50) NOT NULL,
	"customer_id" bigint NOT NULL,
	"order_id" bigint,
	"status" varchar(50) NOT NULL,
	"issue_date" date NOT NULL,
	"delivery_date" date,
	"total_items" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_by" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_notes_dn_number_unique" UNIQUE("dn_number")
);
--> statement-breakpoint
CREATE TABLE "digital_certificates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"cert_type" varchar(50) NOT NULL,
	"certificate_pem" text NOT NULL,
	"private_key_encrypted" text,
	"encryption_iv" varchar(100),
	"encryption_auth_tag" varchar(100),
	"issuer" varchar(255),
	"serial_number" varchar(100),
	"valid_from" date,
	"valid_to" date,
	"edb" varchar(20),
	"is_active" varchar(50) DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_counters" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" varchar(10) NOT NULL,
	"year" integer NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" bigint NOT NULL,
	"document_type" varchar(50) NOT NULL,
	"description" varchar(500) NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unit" varchar(20) NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(5, 2) DEFAULT '0' NOT NULL,
	"total_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"product_id" bigint,
	"service_id" bigint,
	"item_type" varchar(50) NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "e_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" bigint NOT NULL,
	"ujp_invoice_id" varchar(255),
	"status" varchar(50) NOT NULL,
	"xml_content" text,
	"response_message" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject" varchar(500),
	"sender_email" varchar(255),
	"sender_name" varchar(255),
	"received_at" timestamp DEFAULT now() NOT NULL,
	"pdf_base64" text,
	"pdf_filename" varchar(255),
	"parsed_supplier_name" varchar(255),
	"parsed_invoice_number" varchar(100),
	"parsed_total_amount" varchar(50),
	"parsed_issue_date" varchar(20),
	"matched_supplier_id" bigint,
	"status" varchar(50) NOT NULL,
	"raw_text" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finished_goods_stock" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" bigint NOT NULL,
	"warehouse_id" bigint NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incoming_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"supplier_invoice_number" varchar(50) NOT NULL,
	"supplier_id" bigint NOT NULL,
	"po_id" bigint,
	"receipt_id" bigint,
	"status" varchar(50) NOT NULL,
	"issue_date" date,
	"received_date" date NOT NULL,
	"due_date" date,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(10) NOT NULL,
	"notes" text,
	"file_url" text,
	"created_by" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_count_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"count_id" bigint NOT NULL,
	"material_id" bigint NOT NULL,
	"system_qty" numeric(12, 3) DEFAULT '0' NOT NULL,
	"counted_qty" numeric(12, 3),
	"difference" numeric(12, 3),
	"unit_cost" numeric(12, 2),
	"total_difference" numeric(12, 2),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_counts" (
	"id" serial PRIMARY KEY NOT NULL,
	"count_number" varchar(50) NOT NULL,
	"warehouse_id" bigint NOT NULL,
	"status" varchar(50) NOT NULL,
	"count_date" date NOT NULL,
	"notes" text,
	"created_by" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_counts_count_number_unique" UNIQUE("count_number")
);
--> statement-breakpoint
CREATE TABLE "inventory_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"material_id" bigint NOT NULL,
	"warehouse_id" bigint NOT NULL,
	"type" varchar(50) NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(12, 2),
	"total_cost" numeric(12, 2),
	"reference" varchar(255),
	"source_doc_type" varchar(50),
	"source_doc_id" bigint,
	"notes" text,
	"created_by" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_number" varchar(50) NOT NULL,
	"customer_id" bigint NOT NULL,
	"order_id" bigint,
	"work_order_id" bigint,
	"status" varchar(50) NOT NULL,
	"invoice_type" varchar(50) NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(10) NOT NULL,
	"notes" text,
	"e_invoice_id" varchar(255),
	"original_invoice_id" bigint,
	"created_by" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "labor_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" varchar(255) NOT NULL,
	"role_code" varchar(50) NOT NULL,
	"cost_per_hour" numeric(12, 2) DEFAULT '0' NOT NULL,
	"gross_salary" numeric(12, 2) DEFAULT '0' NOT NULL,
	"contributions_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"description" text,
	"is_active" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "labor_rates_role_code_unique" UNIQUE("role_code")
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(50) NOT NULL,
	"type" varchar(50) NOT NULL,
	"cost_per_hour" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cost_per_meter" numeric(12, 2) DEFAULT '0' NOT NULL,
	"annual_amortization" numeric(14, 2) DEFAULT '0' NOT NULL,
	"annual_electricity" numeric(14, 2) DEFAULT '0' NOT NULL,
	"annual_gas" numeric(14, 2) DEFAULT '0' NOT NULL,
	"annual_service" numeric(14, 2) DEFAULT '0' NOT NULL,
	"annual_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
	"is_active" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "machines_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "material_lots" (
	"id" serial PRIMARY KEY NOT NULL,
	"material_id" bigint NOT NULL,
	"warehouse_id" bigint NOT NULL,
	"receipt_id" bigint,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"remaining_qty" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"landed_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_stock" (
	"id" serial PRIMARY KEY NOT NULL,
	"material_id" bigint NOT NULL,
	"warehouse_id" bigint NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"avg_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(100) NOT NULL,
	"type" varchar(50) NOT NULL,
	"unit" varchar(50) NOT NULL,
	"description" text,
	"min_stock" numeric(12, 3) DEFAULT '0' NOT NULL,
	"current_stock" numeric(12, 3) DEFAULT '0' NOT NULL,
	"avg_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"last_purchase_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"location" varchar(100),
	"is_active" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "materials_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" bigint NOT NULL,
	"description" varchar(500) NOT NULL,
	"drawing_number" varchar(100),
	"quantity" integer NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cost_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"margin_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"material" varchar(255),
	"dimensions" varchar(255),
	"product_id" bigint,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" varchar(50) NOT NULL,
	"customer_id" bigint NOT NULL,
	"quote_id" bigint,
	"status" varchar(50) NOT NULL,
	"priority" varchar(50) NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cost_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"margin_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"margin_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"delivery_date" date,
	"notes" text,
	"created_by" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "overhead" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"rate_type" varchar(50) NOT NULL,
	"rate_value" numeric(12, 4) DEFAULT '0' NOT NULL,
	"annual_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"description" text,
	"is_active" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parsed_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"original_file_name" varchar(500) NOT NULL,
	"supplier_name" varchar(255),
	"invoice_number" varchar(100),
	"issue_date" date,
	"due_date" date,
	"total_amount" numeric(14, 2),
	"vat_amount" numeric(14, 2),
	"currency" varchar(10),
	"raw_text" text,
	"file_url" text,
	"document_type" varchar(50) NOT NULL,
	"status" varchar(50) NOT NULL,
	"matched_invoice_id" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parsed_receipt_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"parsed_invoice_id" bigint NOT NULL,
	"raw_description" text NOT NULL,
	"matched_material_id" bigint,
	"matched_material_name" varchar(255),
	"match_confidence" numeric(5, 2) DEFAULT '0' NOT NULL,
	"quantity" numeric(12, 3),
	"unit" varchar(20),
	"unit_price" numeric(12, 2),
	"total_price" numeric(12, 2),
	"vat_rate" numeric(5, 2),
	"is_confirmed" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_components" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" bigint NOT NULL,
	"kind" varchar(50) NOT NULL,
	"ref_id" bigint NOT NULL,
	"per_unit" numeric(12, 6) DEFAULT '0' NOT NULL,
	"waste_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"scale" varchar(50) NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(100) NOT NULL,
	"category" varchar(50) NOT NULL,
	"description" text,
	"unit" varchar(50) NOT NULL,
	"basis" varchar(50) NOT NULL,
	"default_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"material_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"labor_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"machine_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"overhead_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"is_active" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "products_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"purchase_order_id" bigint NOT NULL,
	"material_id" bigint NOT NULL,
	"description" varchar(500) NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"received_quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"po_number" varchar(50) NOT NULL,
	"supplier_id" bigint NOT NULL,
	"status" varchar(50) NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"expected_date" date,
	"notes" text,
	"created_by" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_po_number_unique" UNIQUE("po_number")
);
--> statement-breakpoint
CREATE TABLE "quotation_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"quotation_id" bigint NOT NULL,
	"item_type" varchar(50) NOT NULL,
	"reference_id" bigint,
	"description" varchar(500) NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unit" varchar(20) NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_number" varchar(50) NOT NULL,
	"customer_id" bigint NOT NULL,
	"status" varchar(50) NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cost_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"margin_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"margin_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(10) NOT NULL,
	"valid_until" date,
	"delivery_days" integer DEFAULT 14,
	"payment_terms" varchar(255),
	"notes" text,
	"converted_order_id" bigint,
	"created_by" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quotations_quote_number_unique" UNIQUE("quote_number")
);
--> statement-breakpoint
CREATE TABLE "receipt_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_id" bigint NOT NULL,
	"material_id" bigint NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unit" varchar(20) NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"landed_cost_alloc" numeric(12, 2) DEFAULT '0' NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"receipt_number" varchar(50) NOT NULL,
	"supplier_id" bigint,
	"po_id" bigint,
	"warehouse_id" bigint NOT NULL,
	"status" varchar(50) NOT NULL,
	"receipt_date" date NOT NULL,
	"supplier_doc_number" varchar(100),
	"transport_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"customs_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"other_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"file_url" text,
	"created_by" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_receipt_number_unique" UNIQUE("receipt_number")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(100) NOT NULL,
	"type" varchar(50) NOT NULL,
	"unit" varchar(50) NOT NULL,
	"description" text,
	"cost_rate" numeric(12, 2) DEFAULT '0' NOT NULL,
	"sale_rate" numeric(12, 2) DEFAULT '0' NOT NULL,
	"machine_id" bigint,
	"is_active" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "services_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "stock_transfer_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_id" bigint NOT NULL,
	"material_id" bigint NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(12, 2),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_number" varchar(50) NOT NULL,
	"from_warehouse_id" bigint NOT NULL,
	"to_warehouse_id" bigint NOT NULL,
	"status" varchar(50) NOT NULL,
	"transfer_date" date NOT NULL,
	"notes" text,
	"created_by" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfers_transfer_number_unique" UNIQUE("transfer_number")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"edb" varchar(20),
	"contact_person" varchar(255),
	"email" varchar(320),
	"phone" varchar(50),
	"address" text,
	"city" varchar(100),
	"country" varchar(100),
	"payment_terms" varchar(100),
	"default_currency" varchar(10),
	"materials" text,
	"is_active" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_conversions" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_unit_id" bigint NOT NULL,
	"to_unit_id" bigint NOT NULL,
	"factor" numeric(18, 8) DEFAULT '0' NOT NULL,
	"material_type" varchar(50),
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"name_mk" varchar(100),
	"category" varchar(50) NOT NULL,
	"is_active" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "units_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"union_id" varchar(255) NOT NULL,
	"name" varchar(255),
	"email" varchar(320),
	"avatar" text,
	"role" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_sign_in_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_union_id_unique" UNIQUE("union_id")
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"address" text,
	"is_active" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "work_order_materials" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" bigint NOT NULL,
	"material_id" bigint NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"is_actual" varchar(50) NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_order_operations" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" bigint NOT NULL,
	"operation" varchar(50) NOT NULL,
	"sequence" integer NOT NULL,
	"description" varchar(500),
	"estimated_time" numeric(8, 2),
	"actual_time" numeric(8, 2),
	"estimated_qty" numeric(12, 3),
	"actual_qty" numeric(12, 3),
	"qty_unit" varchar(20),
	"status" varchar(50) NOT NULL,
	"operator" varchar(255),
	"cost_rate" numeric(12, 2) DEFAULT '0' NOT NULL,
	"cost_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"wo_number" varchar(50) NOT NULL,
	"order_id" bigint,
	"description" varchar(500) NOT NULL,
	"status" varchar(50) NOT NULL,
	"priority" varchar(50) NOT NULL,
	"planned_start" date,
	"planned_end" date,
	"actual_start" date,
	"actual_end" date,
	"assigned_to" varchar(255),
	"cost_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_by" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_orders_wo_number_unique" UNIQUE("wo_number")
);
