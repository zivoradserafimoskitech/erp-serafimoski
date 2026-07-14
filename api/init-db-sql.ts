// Рачно креирање на табели за Railway (drizzle-kit не работи во runtime)

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS materials (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
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
  supplier_id BIGINT UNSIGNED,
  is_active ENUM('active','inactive') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
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
  is_active ENUM('active','inactive') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS suppliers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
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
  is_active ENUM('active','inactive') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_number VARCHAR(50) UNIQUE,
  customer_id BIGINT UNSIGNED,
  status ENUM('pending','confirmed','in_production','ready','delivered','cancelled') DEFAULT 'pending',
  total_amount DECIMAL(12,2) DEFAULT 0,
  delivery_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  material_id BIGINT UNSIGNED,
  description TEXT,
  quantity DECIMAL(12,3) DEFAULT 1,
  unit VARCHAR(20) DEFAULT 'pieces',
  unit_price DECIMAL(12,2) DEFAULT 0,
  total_price DECIMAL(12,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  po_number VARCHAR(50) UNIQUE,
  supplier_id BIGINT UNSIGNED,
  status ENUM('draft','sent','partial','received','cancelled') DEFAULT 'draft',
  total_amount DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoices (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_number VARCHAR(50) UNIQUE,
  type ENUM('outgoing','incoming') DEFAULT 'outgoing',
  customer_id BIGINT UNSIGNED,
  supplier_id BIGINT UNSIGNED,
  order_id BIGINT UNSIGNED,
  amount DECIMAL(12,2) DEFAULT 0,
  vat_amount DECIMAL(12,2) DEFAULT 0,
  total_amount DECIMAL(12,2) DEFAULT 0,
  status ENUM('draft','issued','paid','overdue','cancelled') DEFAULT 'draft',
  due_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  wo_number VARCHAR(50) UNIQUE,
  order_id BIGINT UNSIGNED,
  product_name VARCHAR(255),
  status ENUM('pending','in_progress','completed','cancelled') DEFAULT 'pending',
  start_date DATE,
  end_date DATE,
  estimated_cost DECIMAL(12,2) DEFAULT 0,
  actual_cost DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quotations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  quote_number VARCHAR(50) UNIQUE,
  customer_id BIGINT UNSIGNED,
  status ENUM('draft','sent','accepted','rejected','expired') DEFAULT 'draft',
  total_amount DECIMAL(12,2) DEFAULT 0,
  valid_until DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  material_id BIGINT UNSIGNED,
  type ENUM('receipt','issue','adjustment','transfer') DEFAULT 'receipt',
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
