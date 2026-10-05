import { useEffect, useState } from "react";
import { login } from "@/lib/auth";

// Најава — активна ако серверот има APP_PASSWORD или постои администратор со код.
// Кодот се праќа само при најава; во localStorage се чува сесијата (токен со рок), што се праќа
// како x-app-key header (види providers/trpc.tsx). Стар зачуван код се заменува со сесија сам.
export function PasswordGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "locked" | "open">("checking");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");

  const verify = async (candidate: string | null) => {
    try {
      const d = await login(candidate ?? "");
      if (!d.gate || d.ok) { setState("open"); return true; }
      if (d.message) setErr(d.message);
      return false;
    } catch {
      // сервер недостапен — не заклучувај, апликацијата ионака нема да работи
      setState("open");
      return true;
    }
  };

  useEffect(() => {
    verify(window.localStorage.getItem("appKey")).then((ok) => {
      if (!ok) setState("locked");
    });
  }, []);

  // порталот за клиенти има свој таен линк — без најава во програмата
  if (window.location.pathname.startsWith("/portal/")) return <>{children}</>;
  if (state === "checking") return null;
  if (state === "open") return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <form
        className="bg-white rounded-xl shadow-xl p-8 w-80 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr("");
          const d = await login(pw).catch(() => null);
          if (d && (d.ok || !d.gate)) { setState("open"); return; }
          setErr(d?.message ?? "Погрешен код — провери со администраторот");
        }}
      >
        <div className="text-center">
          <img src="/logo.png" alt="" className="h-12 mx-auto mb-2" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          <h1 className="text-lg font-bold text-slate-800">Serafimoski Tech ERP</h1>
          <p className="text-xs text-slate-500">Внеси го својот код за пристап</p>
        </div>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm"
          placeholder="Личен код или лозинка"
          autoFocus
        />
        {err && <p className="text-xs text-red-500 text-center">{err}</p>}
        <button type="submit" className="w-full bg-amber-500 hover:bg-amber-600 text-white rounded-lg py-2 text-sm font-medium">
          Влези
        </button>
      </form>
    </div>
  );
}
