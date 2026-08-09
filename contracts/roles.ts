// Улоги и дозволи — единствен извор на вистина.
// Серверот ја спроведува дозволата; интерфејсот само крие копчиња.

export type Role = "admin" | "manager" | "operator" | "viewer";

export const ROLES: Record<Role, { label: string; description: string; rank: number }> = {
  admin: {
    label: "Администратор",
    description: "Сè, вклучително корисници, подесувања и бришење документи.",
    rank: 4,
  },
  manager: {
    label: "Раководител",
    description: "Понуди, нарачки, фактури, набавка, производство. Не брише документи и не менува корисници.",
    rank: 3,
  },
  operator: {
    label: "Оператор",
    description: "Производство, склад, приемници, остатоци. Финансиите ги гледа, но не ги менува.",
    rank: 2,
  },
  viewer: {
    label: "Преглед",
    description: "Само чита. Ништо не менува.",
    rank: 1,
  },
};

export const ROLE_ORDER: Role[] = ["viewer", "operator", "manager", "admin"];

export function rankOf(role: string | undefined | null): number {
  return ROLES[(role ?? "viewer") as Role]?.rank ?? 0;
}

export function atLeast(role: string | undefined | null, min: Role): boolean {
  return rankOf(role) >= ROLES[min].rank;
}

/**
 * Минимална улога за пишување во даден рутер.
 * Читањето е дозволено на сите најавени (виш „viewer“).
 */
export const WRITE_ROLE_BY_ROUTER: Record<string, Role> = {
  // Производство и склад — операторот работи тука
  production: "operator",
  storage: "operator",
  warehouse: "operator",
  remnants: "operator",
  certificates: "operator",

  // Комерцијала и финансии — раководител
  quotation: "manager",
  customers: "manager",
  accounting: "manager",
  procurement: "manager",
  catalog: "manager",
  ocr: "manager",
  email: "manager",
  dashboard: "manager",
  bank: "manager",
  assets: "manager",

  // Подесувања — само администратор
  settings: "admin",
  appUsers: "admin",
};

/** Постапки што секогаш бараат администратор, без разлика на рутерот. */
export function isDestructive(procedure: string): boolean {
  const p = procedure.toLowerCase();
  return p.endsWith("delete") || p.includes("reset") || p.includes("wipe");
}

/** Постапки што се читање — препознаени по префикс/суфикс. */
export function isReadOnlyProcedure(procedure: string): boolean {
  const p = procedure.toLowerCase();
  return (
    p.endsWith("list") || p.endsWith("byid") || p.endsWith("bycode") ||
    p.endsWith("stats") || p.endsWith("get") || p.endsWith("search") ||
    p.endsWith("report") || p.endsWith("preview") || p.endsWith("suggest") ||
    p.endsWith("needs") || p.endsWith("logs") || p.endsWith("trace") ||
    p.endsWith("formaterial") || p.endsWith("params")
  );
}

/**
 * Може ли улогата да ја изврши постапката `router.procedure`?
 * Ова е истата логика што ја користи и серверот и интерфејсот.
 */
export function canRun(role: string | undefined | null, path: string): boolean {
  const [router, procedure = ""] = path.split(".");
  const r = rankOf(role);
  if (r === 0) return false;

  // „Кој сум јас“ мора да е достапно на секого — интерфејсот го чита при вчитување
  if (path === "appUsers.appUsersMe") return true;

  // Читањето е отворено за сите освен подесувањата и корисниците
  if (isReadOnlyProcedure(procedure)) {
    if (router === "appUsers") return atLeast(role, "admin");
    return true;
  }

  // Бришењето бара администратор
  if (isDestructive(procedure)) return atLeast(role, "admin");

  const min = WRITE_ROLE_BY_ROUTER[router] ?? "manager";
  return atLeast(role, min);
}
