import { trpc } from "@/providers/trpc";
import { logout as appLogout } from "@/lib/auth";
import { ROLES, canSeeMenu, type Role } from "@contracts/roles";
import { useEffect, useState } from "react";
import GlobalSearch from "@/components/GlobalSearch";
import { Link, useLocation, useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import ThemeToggle from "@/components/ThemeToggle";
import NotificationBell from "@/components/NotificationBell";
import {
  LayoutDashboard, Warehouse, Factory, Users, ShoppingCart, LogOut, Menu, X,
  ShieldCheck, Calculator, FileText, ClipboardCheck, Settings, BookOpen,
  Building2, Landmark, Search, Workflow, Contact, Target, BarChart3, Truck,
  ShoppingBag, Tags, Inbox, Globe,
} from "lucide-react";

type NavItem = { path: string; label: string; icon: typeof LayoutDashboard };
type NavGroup = { id: string; label: string; items: NavItem[] };

/** Редослед според бизнис-тек: комерцијала → операции → финансии → админ. */
const navGroups: NavGroup[] = [
  {
    id: "home",
    label: "",
    items: [{ path: "/", label: "Контролна табла", icon: LayoutDashboard }],
  },
  {
    id: "sales",
    label: "Продажба",
    items: [
      { path: "/prodazba", label: "Продажба (hub)", icon: ShoppingBag },
      { path: "/crm", label: "Можности (CRM)", icon: Target },
      { path: "/ponudi", label: "Понуди", icon: FileText },
      { path: "/cenovnici", label: "Ценовници", icon: Tags },
      { path: "/klienti", label: "Клиенти и нарачки", icon: Users },
      { path: "/tek", label: "Тек на нарачки", icon: Workflow },
      { path: "/ispratnici", label: "Испратници", icon: Truck },
      { path: "/smetkovodstvo", label: "Фактури", icon: Calculator },
    ],
  },
  {
    id: "marketing",
    label: "Маркетинг",
    items: [
      { path: "/marketing/baranja", label: "Барања", icon: Inbox },
      { path: "/marketing/katalog", label: "Веб каталог", icon: Globe },
    ],
  },
  {
    id: "ops",
    label: "Операции",
    items: [
      { path: "/sklad", label: "Склад", icon: Warehouse },
      { path: "/proizvodstvo", label: "Производство", icon: Factory },
      { path: "/kvalitet", label: "Квалитет и одржување", icon: ShieldCheck },
      { path: "/nabavka", label: "Набавка", icon: ShoppingCart },
      { path: "/priemnici", label: "Приемници", icon: ClipboardCheck },
      { path: "/katalog", label: "Каталог", icon: BookOpen },
    ],
  },
  {
    id: "finance",
    label: "Финансии и извештаи",
    items: [
      { path: "/finansii", label: "Финансии", icon: Landmark },
      { path: "/izvestai", label: "Извештаи", icon: BarChart3 },
      { path: "/sredstva", label: "Основни средства", icon: Building2 },
      { path: "/vraboteni", label: "Вработени и плати", icon: Contact },
    ],
  },
  {
    id: "admin",
    label: "Систем",
    items: [{ path: "/podesuvanja", label: "Подесувања", icon: Settings }],
  },
];

const flatNav = navGroups.flatMap((g) => g.items);

export default function Layout({ children }: { children: React.ReactNode }) {
  const { data: me } = trpc.appUsers.appUsersMe.useQuery();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const { user, logout } = useAuth();
  const role = (me?.role ?? "admin") as string;

  return (
    <div className="flex h-screen bg-background">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          w-64 h-screen lg:h-full shrink-0 bg-sidebar text-sidebar-foreground flex flex-col
          transform transition-transform duration-200
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
      >
        <div className="flex items-center justify-between p-4 border-b border-sidebar-border shrink-0">
          <div className="flex items-center min-w-0 flex-1 mr-2">
            <img src="/logo.png?v=3" alt="Serafimoski Tech" className="w-full max-w-[180px] h-auto object-contain" />
          </div>
          <button className="lg:hidden text-sidebar-muted hover:text-sidebar-accent-foreground" onClick={() => setSidebarOpen(false)} aria-label="Затвори мени">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-sidebar-border shrink-0">
          <div className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-sidebar-primary" />
            <span className="text-sidebar-foreground/80">{me?.name || user?.name || "Корисник"}</span>
          </div>
          <div className="text-xs text-sidebar-muted mt-1 flex items-center justify-between gap-2">
            <span>Улога: {ROLES[(me?.role ?? "viewer") as Role]?.label ?? "Преглед"}</span>
            {me?.gate && (
              <button className="text-slate-400 hover:text-sidebar-primary underline" onClick={() => { void appLogout(); }}>
                одјави
              </button>
            )}
          </div>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-4 [scrollbar-width:thin] [scrollbar-color:#334155_transparent]">
          {navGroups.map((group) => {
            const items = group.items.filter((item) => canSeeMenu(role, item.path));
            if (!items.length) return null;
            return (
              <div key={group.id}>
                {group.label ? (
                  <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted">
                    {group.label}
                  </p>
                ) : null}
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const isActive = location.pathname === item.path;
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        ref={isActive ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                        onClick={() => setSidebarOpen(false)}
                        className={`
                          flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
                          ${isActive
                            ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-sm"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-white"}
                        `}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1 whitespace-nowrap">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t border-sidebar-border shrink-0">
          <Button
            variant="ghost"
            className="w-full justify-start text-sidebar-muted hover:text-sidebar-accent-foreground hover:bg-sidebar-accent"
            onClick={() => { if (me?.gate) void appLogout(); else logout(); }}
          >
            <LogOut className="h-5 w-5 mr-2" />
            Одјава
          </Button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <header className="bg-header text-header-foreground border-b border-border px-4 py-3 flex items-center gap-3">
          <button className="lg:hidden text-muted-foreground hover:text-foreground" onClick={() => setSidebarOpen(true)} aria-label="Отвори мени">
            <Menu className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-semibold text-foreground truncate">
            {flatNav.find((n) => n.path === location.pathname)?.label || "ERP Систем"}
          </h1>
          <button
            onClick={() => setSearchOpen(true)}
            className="ml-auto flex items-center gap-2 h-9 w-full max-w-xs rounded-lg border border-border bg-muted/60 px-3 text-sm text-muted-foreground hover:bg-muted"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left truncate">Пребарај сè...</span>
            <kbd className="hidden sm:inline text-[10px] font-mono border rounded px-1.5 py-0.5 bg-card text-muted-foreground">Ctrl K</kbd>
          </button>
          <NotificationBell className="shrink-0 text-muted-foreground" />
          <ThemeToggle className="shrink-0 text-muted-foreground" />
        </header>

        <main className="flex-1 overflow-auto p-4 lg:p-6">
          {me && me.gate === false && me.role === "admin" && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span className="flex-1 min-w-[12rem]">Апликацијата е <b>отворена за секој што ја има адресата</b> — без најава. Додај администратор со код.</span>
              <button className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-red-100" onClick={() => navigate("/podesuvanja?tab=users")}>Додај администратор</button>
            </div>
          )}
          {children}
        </main>
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
