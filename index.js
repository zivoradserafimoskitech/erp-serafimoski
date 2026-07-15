const http = require('http');
const port = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  if (req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, port, env: process.env.NODE_ENV }));
    return;
  }
  
  if (req.url === '/api/debug') {
    res.writeHead(200);
    res.end(JSON.stringify({ 
      ok: true, 
      message: "Server is running",
      db_url_set: !!process.env.DATABASE_URL,
      database_url_prefix: process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 20) : null
    }));
    return;
  }
  
  // SPA fallback — redirect everything else to /
  res.setHeader('Content-Type', 'text/html');
  res.writeHead(200);
  res.end(`<html><body><h1>ERP Серафимоски Тек</h1><p>Server is running on port ${port}</p><a href="/api/debug">Test API</a></body></html>`);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[BOOT] Server on 0.0.0.0:${port}`);
});
