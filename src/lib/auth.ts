// Најава: кодот се праќа еднаш, серверот враќа сесија (токен) што се чува наместо кодот.

export type LoginResult = { ok: boolean; gate?: boolean; needsSetup?: boolean; name?: string; role?: string; token?: string; wait?: number; message?: string };

export async function login(code: string): Promise<LoginResult> {
  const res = await fetch("/api/auth-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: code }),
  });
  const d: LoginResult = await res.json().catch(() => ({ ok: false }));
  if (d.ok) remember(d);
  return d;
}

export function remember(d: LoginResult) {
  if (d.token) window.localStorage.setItem("appKey", d.token);
  if (d.name) window.localStorage.setItem("appUserName", d.name);
  if (d.role) window.localStorage.setItem("appUserRole", d.role);
}

export async function logout() {
  const k = window.localStorage.getItem("appKey");
  try { if (k) await fetch("/api/logout", { method: "POST", headers: { "x-app-key": k } }); } catch { /* сервер недостапен — сепак одјави локално */ }
  window.localStorage.removeItem("appKey");
  window.localStorage.removeItem("appUserName");
  window.localStorage.removeItem("appUserRole");
  window.location.reload();
}

/** Заглавие за директни повици (преземање бекап и сл.). */
export const authHeaders = (): Record<string, string> => {
  const k = window.localStorage.getItem("appKey");
  return k ? { "x-app-key": k } : {};
};
