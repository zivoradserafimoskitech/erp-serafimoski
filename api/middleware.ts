import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { canRun, ROLES } from "@contracts/roles";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;

// ── Спроведување на дозволи ──
// Ова е вистинската заштита. Криењето копчиња во интерфејсот е само удобност.
const enforcePermissions = t.middleware(async ({ ctx, path, type, next }) => {
  // Ако нема поставена лозинка воопшто, системот работи отворено (како порано)
  if (!process.env.APP_PASSWORD) return next({ ctx });

  const actor = ctx.actor;
  if (!actor) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Најави се повторно" });
  }
  if (!canRun(actor.role, path, type)) {
    const roleLabel = ROLES[actor.role]?.label ?? actor.role;
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Немаш дозвола за ова (улога: ${roleLabel})`,
    });
  }
  return next({ ctx });
});

// ── Главната книга се ажурира сама ──
// По секое успешно зачувување што може да ги смени документите/плаќањата, во позадина (со мала пауза,
// за повеќе брзи зачувувања да се спојат во едно) се повикува синхронизацијата. Таа е идемпотентна.
const LEDGER_ROUTERS = new Set(["accounting", "bank", "finance", "hr", "assets", "production", "quotation", "storage", "ops"]);
let ledgerTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleLedgerSync() {
  if (process.env.DISABLE_AUTO_LEDGER === "true") return;
  if (ledgerTimer) clearTimeout(ledgerTimer);
  ledgerTimer = setTimeout(() => {
    ledgerTimer = null;
    import("./finance-router").then(m => m.syncLedger()).catch(e => console.error("[LEDGER]", e?.message ?? e));
  }, 1500);
}
const autoLedger = t.middleware(async ({ path, type, next }) => {
  const res = await next();
  if (type === "mutation" && res.ok && LEDGER_ROUTERS.has(path.split(".")[0]) && path !== "finance.ledgerSync") scheduleLedgerSync();
  return res;
});

export const publicQuery = t.procedure.use(enforcePermissions).use(autoLedger);

const requireAuth = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  // TEMPORARY: Allow all requests without authentication
  // until OAuth is configured
  return next({ ctx });
});

function requireRole(role: string) {
  return t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== role) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ErrorMessages.insufficientRole,
      });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

export const authedQuery = t.procedure.use(requireAuth);
export const adminQuery = authedQuery.use(requireRole("admin"));
