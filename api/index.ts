import http from "http";

const port = parseInt(process.env.PORT || "3000");

// Phase 1: Ultra-simple HTTP server that starts IMMEDIATELY
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, time: Date.now(), port }));
    return;
  }

  // If Hono app is loaded, proxy to it
  if ((globalThis as any).__honoApp) {
    return ((globalThis as any).__honoApp)(req, res);
  }

  res.writeHead(503);
  res.end(JSON.stringify({ error: "Server initializing, please wait..." }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[BOOT] HTTP server on 0.0.0.0:${port}`);
});

// Phase 2: Load Hono + API in background
try {
  const { Hono } = await import("hono");
  const { fetchRequestHandler } = await import("@trpc/server/adapters/fetch");
  const { appRouter } = await import("./router");
  const { createContext } = await import("./context");
  const { createOAuthCallbackHandler } = await import("./kimi/auth");
  const { Paths } = await import("@contracts/constants");
  const { serveStatic } = await import("@hono/node-server/serve-static");

  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, time: Date.now(), port, api: true }));
  app.get(Paths.oauthCallback, createOAuthCallbackHandler());
  app.use("/api/trpc/*", async (c) => {
    return fetchRequestHandler({
      endpoint: "/api/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext,
    });
  });
  app.use("*", serveStatic({ root: "./dist/public" }));
  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) return c.json({ error: "Not Found" }, 404);
    return c.redirect("/");
  });

  // Replace HTTP handler with Hono
  (globalThis as any).__honoApp = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = `http://${req.headers.host}${req.url}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined) headers.set(k, Array.isArray(v) ? v[0] : v);
    }

    const body = req.method !== "GET" && req.method !== "HEAD"
      ? await new Promise<Uint8Array>((resolve) => {
          const chunks: Buffer[] = [];
          req.on("data", c => chunks.push(c));
          req.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
        })
      : undefined;

    const request = new Request(url, { method: req.method, headers, body });
    const response = await app.fetch(request);

    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    const responseBody = await response.text();
    res.end(responseBody);
  };

  console.log("[BOOT] Hono API loaded successfully");
} catch (err) {
  console.error("[BOOT] Hono load failed:", (err as Error).message);
  console.error("[BOOT] Running in minimal mode (health only)");
}
