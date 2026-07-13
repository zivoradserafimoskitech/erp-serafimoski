import http from "http";

const port = parseInt(process.env.PORT || "3000");

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, time: Date.now(), port }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not Found" }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[BOOT] Server running on 0.0.0.0:${port}`);
});
