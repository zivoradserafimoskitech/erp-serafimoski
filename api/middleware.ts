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
const enforcePermissions = t.middleware(async ({ ctx, path, next }) => {
  // Ако нема поставена лозинка воопшто, системот работи отворено (како порано)
  if (!process.env.APP_PASSWORD) return next({ ctx });

  const actor = ctx.actor;
  if (!actor) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Најави се повторно" });
  }
  if (!canRun(actor.role, path)) {
    const roleLabel = ROLES[actor.role]?.label ?? actor.role;
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Немаш дозвола за ова (улога: ${roleLabel})`,
    });
  }
  return next({ ctx });
});

export const publicQuery = t.procedure.use(enforcePermissions);

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
