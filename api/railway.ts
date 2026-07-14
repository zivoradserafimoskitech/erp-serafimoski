import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { createOAuthCallbackHandler } from "./kimi/auth";
import { Paths } from "@contracts/constants";
import { serveStatic } from "@hono/node-server/serve-static";
import { cors } from "hono/cors";

const app = new Hono();
const port = parseInt(process.env.PORT || "3000");

// CORS for cross-domain API calls
app.use("/api/*", cors({
  origin: ["https://inycxs6rg5wyq.kimi.page", "https://web-production-dceb8.up.railway.app", "http://localhost:5173"],
  credentials: true,
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
}));

app.get("/health", (c) => c.json({ ok: true, time: Date.now(), port }));
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
  if (accept.includes("text/html")) {
    return c.redirect("/");
  }
  return c.json({ error: "Not Found" }, 404);
});

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`[BOOT] Server on 0.0.0.0:${port}`);
});
