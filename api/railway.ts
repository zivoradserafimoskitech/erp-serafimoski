import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { createOAuthCallbackHandler } from "./kimi/auth";
import { Paths } from "@contracts/constants";
import { serveStatic } from "@hono/node-server/serve-static";

const app = new Hono();
const port = parseInt(process.env.PORT || "3000");

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
