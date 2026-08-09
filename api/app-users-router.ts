import { z } from "zod";
import { eq } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { appUsers } from "@db/schema";
import { clearActorCache } from "./context";
import { logAudit } from "./audit-helper";

const roleEnum = z.enum(["admin", "manager", "operator", "viewer"]);

export const appUsersRouter = createRouter({
  /** Кој сум јас — интерфејсот го користи за да знае што да покаже */
  appUsersMe: publicQuery.query(async ({ ctx }) => {
    const a = (ctx as any).actor;
    return a
      ? { name: a.name, role: a.role, id: a.id, gate: !!process.env.APP_PASSWORD }
      : { name: "Непознат", role: "viewer", id: null, gate: !!process.env.APP_PASSWORD };
  }),

  appUsersList: publicQuery.query(async () => {
    const db = getDb();
    const rows = await db.select().from(appUsers).orderBy(appUsers.name);
    // Кодот не се враќа цел — само крајот, за препознавање
    return (rows as any[]).map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      isActive: u.isActive,
      note: u.note,
      lastSeenAt: u.lastSeenAt,
      passcodeHint: u.passcode ? `••••${String(u.passcode).slice(-2)}` : "",
    }));
  }),

  /** Целиот код — само кога администратор свесно бара да го види */
  appUsersRevealCode: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db.select().from(appUsers).where(eq(appUsers.id, input.id));
      return { passcode: (rows[0] as any)?.passcode ?? null };
    }),

  appUsersCreate: publicQuery
    .input(
      z.object({
        name: z.string().min(2),
        passcode: z.string().min(4).max(120),
        role: roleEnum.default("operator"),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const existing = await db.select().from(appUsers).where(eq(appUsers.passcode, input.passcode));
      if (existing.length > 0) throw new Error("Овој код веќе го користи друг корисник");
      const res = await db.insert(appUsers).values({
        name: input.name,
        passcode: input.passcode,
        role: input.role,
        note: input.note ?? null,
        isActive: "active",
      } as any).returning();
      clearActorCache();
      await logAudit({
        action: "CREATE", entityType: "app_user", entityId: res[0]?.id,
        description: `Нов корисник ${input.name} (${input.role})`,
      }).catch(() => {});
      return { success: true, id: res[0]?.id };
    }),

  appUsersUpdate: publicQuery
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(2).optional(),
        passcode: z.string().min(4).max(120).optional(),
        role: roleEnum.optional(),
        isActive: z.enum(["active", "inactive"]).optional(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...rest } = input;

      if (rest.passcode) {
        const clash = await db.select().from(appUsers).where(eq(appUsers.passcode, rest.passcode));
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
      await db.update(appUsers).set(patch).where(eq(appUsers.id, id));
      clearActorCache();
      return { success: true };
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
      clearActorCache();
      return { success: true };
    }),
});
