import { useEffect, useState } from "react";

// Заштита со лозинка — активна само ако серверот има APP_PASSWORD поставена.
// Клучот се чува во localStorage и се праќа како x-app-key header (види providers/trpc.tsx).
export function PasswordGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "locked" | "open">("checking");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");

  const verify = async (candidate: string | null) => {
    try {
      const res = await fetch("/api/auth-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: candidate ?? "" }),
      });
      const d = await res.json();
      if (!d.gate || d.ok) {
        if (candidate) window.localStorage.setItem("appKey", candidate);
        setState("open");
        return true;
      }
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

  if (state === "checking") return null;
  if (state === "open") return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <form
        className="bg-white rounded-xl shadow-xl p-8 w-80 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr("");
          const ok = await verify(pw);
          if (!ok) setErr("Погрешна лозинка");
        }}
      >
        <div className="text-center">
          <img src="/logo.png" alt="" className="h-12 mx-auto mb-2" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          <h1 className="text-lg font-bold text-slate-800">Serafimoski Tech ERP</h1>
          <p className="text-xs text-slate-500">Внеси лозинка за пристап</p>
        </div>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm"
          placeholder="Лозинка"
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
