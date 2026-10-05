import { z } from "zod";
import { eq } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { appUsers } from "@db/schema";
import { clearActorCache, gateActive } from "./context";
import { logAudit } from "./audit-helper";
import { ensureAuthReady, hashCode, hintOf, revokeUserSessions, sessionCounts } from "./auth";
import { randomInt } from "crypto";

const codeSchema = z.string().min(4).max(120).refine((c) => !c.includes("$") && !c.startsWith("st_"), "Кодот не смее да содржи „$“ ни да почнува со „st_“");
/** Нов случаен код од 6 цифри. */
const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

const roleEnum = z.enum(["admin", "manager", "accountant", "operator", "viewer"]);

export const appUsersRouter = createRouter({
  /** Кој сум јас — интерфејсот го користи за да знае што да покаже */
  appUsersMe: publicQuery.query(async ({ ctx }) => {
    const a = (ctx as any).actor;
    const gate = await gateActive();
    return a
      ? { name: a.name, role: a.role, id: a.id, gate }
      : { name: "Непознат", role: "viewer", id: null, gate };
  }),

  appUsersList: publicQuery.query(async () => {
    await ensureAuthReady();
    const db = getDb();
    const rows = await db.select().from(appUsers).orderBy(appUsers.name);
    const sessions = await sessionCounts();
    // Кодот се чува само како хеш — се враќаат последните две цифри за препознавање
    return (rows as any[]).map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      isActive: u.isActive,
      note: u.note,
      lastSeenAt: u.lastSeenAt,
      passcodeHint: u.passcodeHint ?? "••••",
      sessions: sessions.get(u.id)?.count ?? 0,
    }));
  }),

  /** Кодот не може да се прочита (чува се само хеш) — може само да се постави нов. Се прикажува еднаш. */
  appUsersResetCode: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await ensureAuthReady();
      const db = getDb();
      let code = newCode();
      for (let i = 0; i < 20; i++) {
        const clash = await db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.passcode, hashCode(code)));
        if (!clash.length) break;
        code = newCode();
      }
      const res = await db.update(appUsers).set({ passcode: hashCode(code), passcodeHint: hintOf(code), updatedAt: new Date() } as any).where(eq(appUsers.id, input.id)).returning();
      if (!res.length) throw new Error("Корисникот не постои");
      await revokeUserSessions(input.id, ctx.req.headers.get("x-app-key"));
      clearActorCache();
      await logAudit({ action: "UPDATE", entityType: "app_user", entityId: input.id, description: `Нов код за ${(res[0] as any).name}` }).catch(() => {});
      return { code };
    }),

  /** Одјава од сите уреди (на пр. изгубен телефон). */
  appUsersRevokeSessions: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const n = await revokeUserSessions(input.id, ctx.req.headers.get("x-app-key"));
      clearActorCache();
      return { revoked: n };
    }),

  appUsersCreate: publicQuery
    .input(
      z.object({
        name: z.string().min(2),
        passcode: codeSchema,
        role: roleEnum.default("operator"),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await ensureAuthReady();
      const db = getDb();
      const gateBefore = await gateActive();
      const existing = await db.select().from(appUsers).where(eq(appUsers.passcode, hashCode(input.passcode)));
      if (existing.length > 0) throw new Error("Овој код веќе го користи друг корисник");
      const res = await db.insert(appUsers).values({
        name: input.name,
        passcode: hashCode(input.passcode),
        passcodeHint: hintOf(input.passcode),
        role: input.role,
        note: input.note ?? null,
        isActive: "active",
      } as any).returning();
      clearActorCache();
      await logAudit({
        action: "CREATE", entityType: "app_user", entityId: res[0]?.id,
        description: `Нов корисник ${input.name} (${input.role})`,
      }).catch(() => {});
      // првиот администратор со код ја затвора апликацијата — интерфејсот го најавува креаторот со тој код
      return { success: true, id: res[0]?.id, gateActivated: !gateBefore && (await gateActive()) };
    }),

  appUsersUpdate: publicQuery
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(2).optional(),
        passcode: codeSchema.optional(),
        role: roleEnum.optional(),
        isActive: z.enum(["active", "inactive"]).optional(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await ensureAuthReady();
      const db = getDb();
      const { id, ...rest } = input;
      const gateBefore = await gateActive();

      if (rest.passcode) {
        const clash = await db.select().from(appUsers).where(eq(appUsers.passcode, hashCode(rest.passcode)));
        if (clash.length > 0 && (clash[0] as any).id !== id) {
          throw new Error("Овој код веќе го користи друг корисник");
        }
      }

      // Не смее да остане системот без ниту еден активен администратор
      if (rest.role && rest.role !== "admin") {
        const all = await db.select().from(appUsers);
        const admins = (all as any[]).filter(
          (u) => u.role === "admin" && u.isActive === "active" && u.id !== id
        );
        const current: any = (all as any[]).find((u) => u.id === id);
        if (current?.role === "admin" && admins.length === 0) {
          throw new Error("Мора да остане барем еден активен администратор");
        }
      }

      const patch: any = { updatedAt: new Date() };
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) patch[k] = v;
      if (rest.passcode) { patch.passcode = hashCode(rest.passcode); patch.passcodeHint = hintOf(rest.passcode); }
      await db.update(appUsers).set(patch).where(eq(appUsers.id, id));
      // нов код или исклучен корисник → одјава од сите уреди
      if (rest.isActive === "inactive") await revokeUserSessions(id);
      else if (rest.passcode) await revokeUserSessions(id, ctx.req.headers.get("x-app-key"));
      clearActorCache();
      return { success: true, gateActivated: !gateBefore && (await gateActive()) };
    }),

  appUsersDelete: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const all = await db.select().from(appUsers);
      const target: any = (all as any[]).find((u) => u.id === input.id);
      if (target?.role === "admin") {
        const others = (all as any[]).filter(
          (u) => u.role === "admin" && u.isActive === "active" && u.id !== input.id
        );
        if (others.length === 0) throw new Error("Мора да остане барем еден активен администратор");
      }
      await db.delete(appUsers).where(eq(appUsers.id, input.id));
      await revokeUserSessions(input.id);
      clearActorCache();
      return { success: true };
    }),
});
