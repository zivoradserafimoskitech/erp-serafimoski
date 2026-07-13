import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { HttpBindings } from "@hono/node-server";

const app = new Hono<{ Bindings: HttpBindings }>();
const port = parseInt(process.env.PORT || "3000");

// Health check — мора да биде прв и сигурен
app.get("/health", (c) => c.json({ ok: true, time: Date.now(), port }));

// Пушти го серверот ВЕДНАШ
serve({ fetch: app.fetch, port }, () => {
  console.log(`[BOOT] Server running on port ${port}`);
});

// Остатокот од иницијализацијата во позадина
try {
  const { bodyLimit } = await import("hono/body-limit");
  const { fetchRequestHandler } = await import("@trpc/server/adapters/fetch");
  const { appRouter } = await import("./router");
  const { createContext } = await import("./context");
  const { createOAuthCallbackHandler } = await import("./kimi/auth");
  const { Paths } = await import("@contracts/constants");

  app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));

  app.get(Paths.oauthCallback, createOAuthCallbackHandler());
  app.use("/api/trpc/*", async (c) => {
    return fetchRequestHandler({
      endpoint: "/api/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext,
    });
  });
  app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

  // Static files
  try {
    const { serveStaticFiles } = await import("./lib/vite");
    serveStaticFiles(app);
    console.log("[BOOT] Static files serving enabled");
  } catch (e) {
    console.warn("[BOOT] Static files not available:", (e as Error).message);
  }

  console.log("[BOOT] Full initialization complete");
} catch (err) {
  console.error("[BOOT] Initialization error:", (err as Error).message);
  console.error("[BOOT] Server is running but API routes may not work");
}

export default app;
