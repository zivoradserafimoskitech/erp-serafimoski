// Улоги и дозволи — единствен извор на вистина.
// Серверот ја спроведува дозволата; интерфејсот само крие копчиња.

export type Role = "admin" | "manager" | "accountant" | "operator" | "viewer";

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
  accountant: {
    label: "Сметководител",
    description: "Фактури, финансии, банка, благајна, ДДВ, основни средства. Производството и складот ги гледа, но не ги менува.",
    rank: 2,
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

export const ROLE_ORDER: Role[] = ["viewer", "operator", "accountant", "manager", "admin"];

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
  finance: "manager",
  settle: "manager",
  // застои и мерења ги внесува и операторот; постапки, планови, инструменти — менаџер (подолу)
  mfg: "operator",
  ops: "operator",
  hr: "admin",
  mail: "manager",
  reminders: "admin",

  // Подесувања — само администратор
  settings: "admin",
  appUsers: "admin",
  backup: "admin",
};

/** Каде сметководителот смее да пишува. */
export const ACCOUNTANT_ROUTERS = ["accounting", "finance", "settle", "bank", "assets", "mail", "ocr", "email", "customers"];

/** Мени по улога: патеки што ги гледа секоја улога (администраторот гледа сè). */
export const MENU_BY_ROLE: Record<Role, string[] | "all"> = {
  admin: "all",
  manager: ["/", "/tek", "/sklad", "/proizvodstvo", "/kvalitet", "/klienti", "/nabavka", "/smetkovodstvo", "/finansii", "/ponudi", "/priemnici", "/katalog", "/sredstva"],
  accountant: ["/", "/tek", "/smetkovodstvo", "/finansii", "/klienti", "/sredstva"],
  operator: ["/", "/proizvodstvo", "/sklad", "/kvalitet", "/priemnici"],
  viewer: ["/", "/tek", "/sklad", "/proizvodstvo", "/kvalitet", "/klienti", "/nabavka", "/smetkovodstvo", "/finansii", "/ponudi", "/priemnici", "/katalog", "/sredstva"],
};

export function canSeeMenu(role: string | undefined | null, path: string): boolean {
  const m = MENU_BY_ROLE[(role ?? "viewer") as Role] ?? MENU_BY_ROLE.viewer;
  return m === "all" || m.includes(path);
}

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
    p.endsWith("formaterial") || p.endsWith("params") ||
    // предлог на следен број на документ -- секој што креира документ мора да може да го прочита
    p.endsWith("nextdocnumber") || p.endsWith("nextnumber") || p.endsWith("nextinvoicenumber") ||
    p.startsWith("estimate") || p.endsWith("forinvoice") || p.endsWith("byproduct") ||
    p.endsWith("formatching") || p.endsWith("bypartner") || p.endsWith("opendocs") ||
    p.endsWith("allocationsof") || p === "payablesreceivables" || p === "hasconfig"
  );
}

/**
 * Може ли улогата да ја изврши постапката `router.procedure`?
 * Ова е истата логика што ја користи и серверот и интерфејсот.
 */
export function canRun(role: string | undefined | null, path: string, type?: "query" | "mutation" | "subscription"): boolean {
  const [router, procedure = ""] = path.split(".");
  const r = rankOf(role);
  if (r === 0) return false;

  // „Кој сум јас“ мора да е достапно на секого — интерфејсот го чита при вчитување
  if (path === "appUsers.appUsersMe") return true;

  // Корисниците и платите се доверливи и за читање
  if (router === "appUsers" || router === "hr" || router === "backup") return atLeast(role, "admin");

  // Читањето е отворено за сите: секое tRPC query е читање (ниту едно не запишува),
  // а за повици без тип се препознава по името
  if (type === "query" || isReadOnlyProcedure(procedure)) return true;

  // Бришењето бара администратор
  if (isDestructive(procedure)) return atLeast(role, "admin");

  // Сметководителот пишува само во финансиските делови
  if (role === "accountant") return ACCOUNTANT_ROUTERS.includes(router);

  // во производството операторот смее само застои, мерења и издавање по нестинг
  if (router === "mfg" && !/^(downtime|inspectionRecord)/.test(procedure)) return atLeast(role, "manager");

  const min = WRITE_ROLE_BY_ROUTER[router] ?? "manager";
  return atLeast(role, min);
}
