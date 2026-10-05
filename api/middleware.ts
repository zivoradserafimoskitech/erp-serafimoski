import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { gateActive, needsSetup, type TrpcContext } from "./context";
import { canRun, ROLES } from "@contracts/roles";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;

/** Патеки дозволени без најава додека системот чека прв администратор. */
const SETUP_ALLOW = new Set(["appUsers.appUsersCreate", "appUsers.appUsersMe", "ping"]);

// ── Спроведување на дозволи ──
// Ова е вистинската заштита. Криењето копчиња во интерфејсот е само удобност.
const enforcePermissions = t.middleware(async ({ ctx, path, type, next }) => {
  // Експлицитно отворен режим (тестови / локален развој): DISABLE_USER_GATE=true
  if (!(await gateActive())) return next({ ctx });

  // Прв старт: дозволи создавање на прв администратор
  if ((await needsSetup()) && SETUP_ALLOW.has(path)) {
    return next({ ctx });
  }

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
const LEDGER_ROUTERS = new Set(["accounting", "bank", "finance", "hr", "assets", "production", "quotation", "storage", "ops", "settle", "mfg"]);
let ledgerTimer: ReturnType<typeof setTimeout> | null = null;
let ledgerActor = "автоматски";
function scheduleLedgerSync(actor?: string) {
  if (actor) ledgerActor = actor;
  if (process.env.DISABLE_AUTO_LEDGER === "true") return;
  if (ledgerTimer) clearTimeout(ledgerTimer);
  ledgerTimer = setTimeout(() => {
    ledgerTimer = null;
    const who = ledgerActor; ledgerActor = "автоматски";
    import("./finance-router").then(m => m.syncLedgerIfChanged(who)).catch(e => console.error("[LEDGER]", e?.message ?? e));
  }, 1500);
}
const autoLedger = t.middleware(async ({ ctx, path, type, next }) => {
  const res = await next();
  if (type === "mutation" && res.ok && LEDGER_ROUTERS.has(path.split(".")[0]) && path !== "finance.ledgerSync") scheduleLedgerSync((ctx as any).actor?.name);
  return res;
});

export const publicQuery = t.procedure.use(enforcePermissions).use(autoLedger);

/** Најавена постапка — бара actor (x-app-key / сесија). */
const requireAuth = t.middleware(async ({ ctx, next }) => {
  if (!(await gateActive())) return next({ ctx });
  if (!ctx.actor) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Најави се повторно" });
  }
  return next({ ctx });
});

function requireRole(role: string) {
  return t.middleware(async ({ ctx, next }) => {
    if (!(await gateActive())) return next({ ctx: { ...ctx, user: ctx.user } });
    const actorRole = ctx.actor?.role ?? ctx.user?.role;
    if (!actorRole || actorRole !== role) {
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
