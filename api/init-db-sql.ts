// Рачно креирање на табели за PostgreSQL

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS materials (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) DEFAULT 'raw_material',
  unit VARCHAR(20) DEFAULT 'kg',
  quantity DECIMAL(12,3) DEFAULT 0,
  avg_cost DECIMAL(12,2) DEFAULT 0,
  last_purchase_price DECIMAL(12,2) DEFAULT 0,
  min_stock DECIMAL(12,3) DEFAULT 0,
  warehouse VARCHAR(50) DEFAULT 'main',
  description TEXT,
  supplier_id BIGINT,
  is_active VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  company VARCHAR(255),
  contact_person VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  address TEXT,
  city VARCHAR(100),
  country VARCHAR(100) DEFAULT 'Македонија',
  tax_number VARCHAR(50),
  edb VARCHAR(50),
  notes TEXT,
  is_active VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  edb VARCHAR(50),
  contact_person VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  address TEXT,
  city VARCHAR(100),
  country VARCHAR(100) DEFAULT 'Македонија',
  payment_terms VARCHAR(100),
  default_currency VARCHAR(10) DEFAULT 'MKD',
  materials TEXT,
  is_active VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_number VARCHAR(50) UNIQUE,
  customer_id BIGINT,
  status VARCHAR(50) DEFAULT 'pending',
  total_amount DECIMAL(12,2) DEFAULT 0,
  delivery_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL,
  material_id BIGINT,
  description TEXT,
  quantity DECIMAL(12,3) DEFAULT 1,
  unit VARCHAR(20) DEFAULT 'pieces',
  unit_price DECIMAL(12,2) DEFAULT 0,
  total_price DECIMAL(12,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  po_number VARCHAR(50) UNIQUE,
  supplier_id BIGINT,
  status VARCHAR(50) DEFAULT 'draft',
  total_amount DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  invoice_number VARCHAR(50) UNIQUE,
  type VARCHAR(20) DEFAULT 'outgoing',
  customer_id BIGINT,
  supplier_id BIGINT,
  order_id BIGINT,
  amount DECIMAL(12,2) DEFAULT 0,
  vat_amount DECIMAL(12,2) DEFAULT 0,
  total_amount DECIMAL(12,2) DEFAULT 0,
  status VARCHAR(50) DEFAULT 'draft',
  due_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_orders (
  id SERIAL PRIMARY KEY,
  wo_number VARCHAR(50) UNIQUE,
  order_id BIGINT,
  product_name VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending',
  start_date DATE,
  end_date DATE,
  estimated_cost DECIMAL(12,2) DEFAULT 0,
  actual_cost DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quotations (
  id SERIAL PRIMARY KEY,
  quote_number VARCHAR(50) UNIQUE,
  customer_id BIGINT,
  status VARCHAR(50) DEFAULT 'draft',
  total_amount DECIMAL(12,2) DEFAULT 0,
  valid_until DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id SERIAL PRIMARY KEY,
  material_id BIGINT,
  type VARCHAR(50) DEFAULT 'receipt',
  quantity DECIMAL(12,3) DEFAULT 0,
  unit_price DECIMAL(12,2) DEFAULT 0,
  total_price DECIMAL(12,2) DEFAULT 0,
  reference VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

export function getInitSql(): string {
  return CREATE_TABLES_SQL;
}
