import http from 'http';
import pg from 'pg';

const { Pool } = pg;

const port = process.env.PORT || 10000;

// PostgreSQL pool
let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  console.log('[BOOT] PostgreSQL pool created');
} else {
  console.log('[BOOT] No DATABASE_URL - running without DB');
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end('{}');
    return;
  }

  // === HEALTH CHECK ===
  if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, port, env: process.env.NODE_ENV }));
    return;
  }

  // === DEBUG ===
  if (req.url === '/api/debug') {
    let dbStatus = 'no_pool';
    if (pool) {
      try {
        const result = await pool.query('SELECT NOW() as now');
        dbStatus = 'connected: ' + result.rows[0].now;
      } catch (e) {
        dbStatus = 'error: ' + e.message;
      }
    }
    res.writeHead(200);
    res.end(JSON.stringify({
      ok: true,
      message: 'Server is running (ESM)',
      db_url_set: !!process.env.DATABASE_URL,
      db_status: dbStatus,
      node_version: process.version
    }));
    return;
  }

  // === INIT DB ===
  if (req.url === '/api/init-db') {
    if (!pool) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'No DATABASE_URL' }));
      return;
    }
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS customers (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          address VARCHAR(500),
          city VARCHAR(100),
          phone VARCHAR(50),
          email VARCHAR(255),
          contact_person VARCHAR(255),
          tax_number VARCHAR(50),
          category VARCHAR(50) DEFAULT 'regular',
          status VARCHAR(20) DEFAULT 'active',
          notes TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          code VARCHAR(100) NOT NULL UNIQUE,
          name VARCHAR(500) NOT NULL,
          unit VARCHAR(50) DEFAULT 'pcs',
          price DECIMAL(12,2) DEFAULT 0,
          stock DECIMAL(12,2) DEFAULT 0,
          min_stock DECIMAL(12,2) DEFAULT 0,
          category VARCHAR(100),
          supplier VARCHAR(255),
          status VARCHAR(20) DEFAULT 'active',
          description TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS suppliers (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          address VARCHAR(500),
          city VARCHAR(100),
          phone VARCHAR(50),
          email VARCHAR(255),
          contact_person VARCHAR(255),
          tax_number VARCHAR(50),
          status VARCHAR(20) DEFAULT 'active',
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS purchase_orders (
          id SERIAL PRIMARY KEY,
          number VARCHAR(50) NOT NULL UNIQUE,
          supplier_id INTEGER,
          status VARCHAR(20) DEFAULT 'draft',
          total DECIMAL(12,2) DEFAULT 0,
          vat DECIMAL(12,2) DEFAULT 0,
          notes TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS purchase_order_items (
          id SERIAL PRIMARY KEY,
          order_id INTEGER REFERENCES purchase_orders(id) ON DELETE CASCADE,
          product_id INTEGER,
          quantity DECIMAL(12,2) DEFAULT 0,
          price DECIMAL(12,2) DEFAULT 0,
          total DECIMAL(12,2) DEFAULT 0
        )
      `);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, message: 'Tables created' }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // === CUSTOMERS ===
  if (req.url === '/api/customers' && req.method === 'GET') {
    if (!pool) { res.writeHead(500); res.end(JSON.stringify({ error: 'No DB' })); return; }
    try {
      const result = await pool.query('SELECT * FROM customers ORDER BY id DESC');
      res.writeHead(200);
      res.end(JSON.stringify(result.rows));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.url === '/api/customers' && req.method === 'POST') {
    if (!pool) { res.writeHead(500); res.end(JSON.stringify({ error: 'No DB' })); return; }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const result = await pool.query(
          'INSERT INTO customers (name, address, city, phone, email, contact_person, tax_number, category, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
          [data.name, data.address, data.city, data.phone, data.email, data.contact_person, data.tax_number, data.category || 'regular', data.notes]
        );
        res.writeHead(201);
        res.end(JSON.stringify(result.rows[0]));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // === PRODUCTS ===
  if (req.url === '/api/products' && req.method === 'GET') {
    if (!pool) { res.writeHead(500); res.end(JSON.stringify({ error: 'No DB' })); return; }
    try {
      const result = await pool.query('SELECT * FROM products ORDER BY id DESC');
      res.writeHead(200);
      res.end(JSON.stringify(result.rows));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.url === '/api/products' && req.method === 'POST') {
    if (!pool) { res.writeHead(500); res.end(JSON.stringify({ error: 'No DB' })); return; }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const result = await pool.query(
          'INSERT INTO products (code, name, unit, price, stock, min_stock, category, supplier, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
          [data.code, data.name, data.unit || 'pcs', data.price || 0, data.stock || 0, data.min_stock || 0, data.category, data.supplier, data.description]
        );
        res.writeHead(201);
        res.end(JSON.stringify(result.rows[0]));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // === SUPPLIERS ===
  if (req.url === '/api/suppliers' && req.method === 'GET') {
    if (!pool) { res.writeHead(500); res.end(JSON.stringify({ error: 'No DB' })); return; }
    try {
      const result = await pool.query('SELECT * FROM suppliers ORDER BY id DESC');
      res.writeHead(200);
      res.end(JSON.stringify(result.rows));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.url === '/api/suppliers' && req.method === 'POST') {
    if (!pool) { res.writeHead(500); res.end(JSON.stringify({ error: 'No DB' })); return; }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const result = await pool.query(
          'INSERT INTO suppliers (name, address, city, phone, email, contact_person, tax_number) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
          [data.name, data.address, data.city, data.phone, data.email, data.contact_person, data.tax_number]
        );
        res.writeHead(201);
        res.end(JSON.stringify(result.rows[0]));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // === TEST CUSTOMER ===
  if (req.url === '/api/test-customer') {
    if (!pool) { res.writeHead(500); res.end(JSON.stringify({ error: 'No DB' })); return; }
    try {
      const result = await pool.query(
        'INSERT INTO customers (name, address, city, phone, email, contact_person, tax_number, category) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        ['Тест Клиент', 'ул. Тест 123', 'Скопје', '070123456', 'test@test.com', 'Тест Контакт', 'MK12345678', 'regular']
      );
      res.writeHead(201);
      res.end(JSON.stringify({ ok: true, customer: result.rows[0] }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // === 404 ===
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not Found', url: req.url, method: req.method }));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[BOOT] Server on 0.0.0.0:${port}`);
});
