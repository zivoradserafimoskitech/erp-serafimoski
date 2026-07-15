// Едноставен HTTP сервер за Render — за тестирање дали backend стартува
const http = require('http');
const { Pool } = require('pg');

const port = process.env.PORT || 10000;

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const url = req.url;

  console.log(`[${new Date().toISOString()}] ${req.method} ${url}`);

  if (url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, time: Date.now() }));
    return;
  }

  if (url === '/api/debug') {
    try {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      });
      const t1 = await pool.query('SELECT 1 as test');
      const t2 = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
      const t3 = await pool.query('SELECT count(*) as cnt FROM customers');
      await pool.end();
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        db_url_set: !!process.env.DATABASE_URL,
        test1: t1.rows[0],
        tables: t2.rows.map(r => r.tablename),
        customer_count: t3.rows[0]?.cnt
      }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (url === '/api/test-customer') {
    try {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      });
      const result = await pool.query(
        'INSERT INTO customers (name, company, email, phone, address, city, country, is_active, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING *',
        ['Тест ' + Date.now(), 'Тест ДООЕЛ', 'test@test.mk', '070123456', 'Улица 1', 'Скопје', 'Македонија', 'active']
      );
      await pool.end();
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, customer: result.rows[0] }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
    return;
  }

  // Serve static files from dist/public
  if (url === '/' || url === '/index.html') {
    const fs = require('fs');
    const path = require('path');
    const indexPath = path.join(__dirname, 'dist/public/index.html');
    if (fs.existsSync(indexPath)) {
      res.setHeader('Content-Type', 'text/html');
      res.writeHead(200);
      res.end(fs.readFileSync(indexPath));
    } else {
      res.writeHead(200);
      res.end(JSON.stringify({ message: 'ERP Серафимоски Тек — Server is running', endpoints: ['/health', '/api/debug', '/api/test-customer'] }));
    }
    return;
  }

  // SPA fallback
  if (!url.startsWith('/api/')) {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, 'dist/public', url);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath);
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
      res.setHeader('Content-Type', types[ext] || 'text/plain');
      res.writeHead(200);
      res.end(fs.readFileSync(filePath));
    } else {
      const indexPath = path.join(__dirname, 'dist/public/index.html');
      if (fs.existsSync(indexPath)) {
        res.setHeader('Content-Type', 'text/html');
        res.writeHead(200);
        res.end(fs.readFileSync(indexPath));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not Found' }));
      }
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not Found', url }));
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[BOOT] Server running on 0.0.0.0:${port}`);
});
