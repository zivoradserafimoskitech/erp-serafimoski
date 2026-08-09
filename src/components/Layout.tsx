import { trpc } from "@/providers/trpc";
import { ROLES, type Role } from "@contracts/roles";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Warehouse,
  Factory,
  Users,
  ShoppingCart,
  LogOut,
  Menu,
  X,
  ChevronRight,
  ShieldCheck,
  Calculator,
  FileText,
  ClipboardCheck,
  Settings,
  BookOpen,
  Building2,
} from "lucide-react";

const navItems = [
  { path: "/", label: "Контролна табла", icon: LayoutDashboard },
  { path: "/sklad", label: "Склад", icon: Warehouse },
  { path: "/proizvodstvo", label: "Производство", icon: Factory },
  { path: "/klienti", label: "Клиенти и нарачки", icon: Users },
  { path: "/nabavka", label: "Набавка", icon: ShoppingCart },
  { path: "/smetkovodstvo", label: "Сметководство", icon: Calculator },
  { path: "/ponudi", label: "Понуди", icon: FileText },
  { path: "/priemnici", label: "Приемници", icon: ClipboardCheck },
  { path: "/katalog", label: "Каталог", icon: BookOpen },
  { path: "/sredstva", label: "Основни средства", icon: Building2 },
  { path: "/podesuvanja", label: "Подесувања", icon: Settings },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { data: me } = trpc.appUsers.appUsersMe.useQuery();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          w-64 bg-slate-900 text-white flex flex-col
          transform transition-transform duration-200
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <div className="flex items-center">
            <img src="/logo.png?v=3" alt="Serafimoski Tech" className="h-10 w-auto object-contain" />
          </div>
          <button
            className="lg:hidden text-slate-400 hover:text-white"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* User info */}
        <div className="px-4 py-3 border-b border-slate-700">
          <div className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-amber-400" />
            <span className="text-slate-300">{me?.name || user?.name || "Корисник"}</span>
          </div>
          <div className="text-xs text-slate-500 mt-1 flex items-center justify-between gap-2">
            <span>Улога: {ROLES[(me?.role ?? "viewer") as Role]?.label ?? "Преглед"}</span>
            {me?.gate && (
              <button
                className="text-slate-400 hover:text-amber-400 underline"
                onClick={() => {
                  window.localStorage.removeItem("appKey");
                  window.localStorage.removeItem("appUserName");
                  window.localStorage.removeItem("appUserRole");
                  window.location.reload();
                }}
              >
                одјави
              </button>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm
                  transition-colors
                  ${isActive
                    ? "bg-amber-500 text-slate-900 font-medium"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                  }
                `}
              >
                <Icon className="h-5 w-5" />
                <span className="flex-1">{item.label}</span>
                {isActive && <ChevronRight className="h-4 w-4" />}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="p-3 border-t border-slate-700">
          <Button
            variant="ghost"
            className="w-full justify-start text-slate-400 hover:text-white hover:bg-slate-800"
            onClick={logout}
          >
            <LogOut className="h-5 w-5 mr-2" />
            Одјава
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <button
            className="lg:hidden text-gray-600 hover:text-gray-900"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-semibold text-gray-800">
            {navItems.find((n) => n.path === location.pathname)?.label || "ERP Систем"}
          </h1>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
