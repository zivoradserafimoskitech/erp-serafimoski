import { useEffect, useState } from "react";
import { login, remember } from "@/lib/auth";

type AuthCheck = {
  ok: boolean;
  gate?: boolean;
  needsSetup?: boolean;
  message?: string;
  name?: string;
  role?: string;
  token?: string;
  wait?: number;
};

async function authCheck(password = ""): Promise<AuthCheck> {
  const res = await fetch("/api/auth-check", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(password ? {} : {}) },
    body: JSON.stringify({ password }),
  });
  return res.json().catch(() => ({ ok: false }));
}

async function createFirstAdmin(name: string, passcode: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch("/api/setup-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, passcode }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { ok: false, message: data.message ?? "Неуспешно создавање на администратор" };
    return { ok: true };
  } catch {
    return { ok: false, message: "Серверот не е достапен" };
  }
}

/**
 * Најава — fail-safe затворена по подразбирање.
 * Ако нема APP_PASSWORD ниту админ → setup екран за прв администратор.
 */
export function PasswordGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "locked" | "setup" | "open">("checking");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [setupName, setSetupName] = useState("Администратор");
  const [setupCode, setSetupCode] = useState("");
  const [setupCode2, setSetupCode2] = useState("");
  const [busy, setBusy] = useState(false);

  const verify = async (candidate: string | null) => {
    try {
      const d = await authCheck(candidate ?? "");
      if (d.needsSetup) {
        setState("setup");
        if (d.message) setErr(d.message);
        return false;
      }
      if (!d.gate || d.ok) {
        if (d.ok && d.token) remember(d);
        setState("open");
        return true;
      }
      if (d.message) setErr(d.message);
      return false;
    } catch {
      setErr("Серверот не е достапен — провери ја врската");
      setState("locked");
      return false;
    }
  };

  useEffect(() => {
    verify(window.localStorage.getItem("appKey")).then((ok) => {
      if (!ok) {
        // verify веќе стави setup или locked
        setState((s) => (s === "checking" ? "locked" : s));
      }
    });
  }, []);

  if (window.location.pathname.startsWith("/portal/")) return <>{children}</>;
  if (state === "checking") return null;
  if (state === "open") return <>{children}</>;

  if (state === "setup") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
        <form
          className="bg-white rounded-xl shadow-xl p-8 w-full max-w-md space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr("");
            if (setupCode.length < 4) {
              setErr("Кодот мора да има барем 4 знаци");
              return;
            }
            if (setupCode !== setupCode2) {
              setErr("Кодовите не се совпаѓаат");
              return;
            }
            setBusy(true);
            const r = await createFirstAdmin(setupName.trim() || "Администратор", setupCode);
            setBusy(false);
            if (!r.ok) {
              setErr(r.message ?? "Грешка");
              return;
            }
            const d = await login(setupCode);
            if (d.ok) {
              setState("open");
              return;
            }
            setErr(d.message ?? "Админот е создаден — најави се со новиот код");
            setState("locked");
            setPw(setupCode);
          }}
        >
          <div className="text-center space-y-1">
            <img src="/logo.png" alt="" className="h-12 mx-auto mb-2" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
            <h1 className="text-lg font-bold text-slate-800">Првично подесување</h1>
            <p className="text-xs text-slate-500 text-left leading-relaxed">
              Системот е затворен додека нема администратор. Создај прв администраторски профил,
              или постави <code className="bg-slate-100 px-1 rounded">APP_PASSWORD</code> во
              опкружувањето на серверот и рестартирај.
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Име</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" value={setupName} onChange={(e) => setSetupName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Личен код</label>
            <input type="password" className="w-full border rounded-lg px-3 py-2 text-sm" value={setupCode} onChange={(e) => setSetupCode(e.target.value)} required minLength={4} autoFocus />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Повтори код</label>
            <input type="password" className="w-full border rounded-lg px-3 py-2 text-sm" value={setupCode2} onChange={(e) => setSetupCode2(e.target.value)} required minLength={4} />
          </div>
          {err && <p className="text-xs text-red-500 text-center">{err}</p>}
          <button type="submit" disabled={busy} className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white rounded-lg py-2 text-sm font-medium">
            {busy ? "Се создава..." : "Создај администратор"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <form
        className="bg-white rounded-xl shadow-xl p-8 w-80 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr("");
          const d = await login(pw).catch(() => null);
          if (d?.needsSetup) {
            setState("setup");
            setErr(d.message ?? "");
            return;
          }
          if (d && (d.ok || !d.gate)) {
            setState("open");
            return;
          }
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
