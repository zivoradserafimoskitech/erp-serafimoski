import { getDb } from "./queries/connection";
import { auditLog } from "@db/schema";

export async function logAudit(opts: {
  userId?: number;
  userName?: string;
  action: "CREATE" | "UPDATE" | "DELETE" | "CONFIRM" | "CANCEL" | "CONVERT";
  entityType: string;
  entityId?: number;
  oldValue?: any;
  newValue?: any;
  description?: string;
}) {
  try {
    const db = getDb();
    await db.insert(auditLog).values({
      userId: opts.userId ?? null,
      userName: opts.userName ?? null,
      action: opts.action,
      entityType: opts.entityType,
      entityId: opts.entityId ?? null,
      oldValue: opts.oldValue ? JSON.stringify(opts.oldValue) : null,
      newValue: opts.newValue ? JSON.stringify(opts.newValue) : null,
      description: opts.description ?? null,
    });
  } catch {
    // Silently fail - audit should never break business logic
  }
}
