// По ново објавување на Render старите делови од апликацијата (assets/*-ХАШ.js) веќе ги нема.
// Страница отворена од порано тогаш паѓа при вчитување дел („Failed to fetch dynamically imported module“).
// Решение: страницата се освежува сама (еднаш) и ја зема новата верзија.
const KEY = "staleChunkReload";

export function isStaleChunkError(e: unknown): boolean {
  const m = String((e as any)?.message ?? e ?? "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk .* failed|Unable to preload CSS/i.test(m);
}

/** Освежи ја страницата; не повторно ако веќе е освежено пред помалку од 30 секунди (без вртење во круг). */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* приватен режим — сепак освежи */ }
  window.location.reload();
  return true;
}

export function installStaleChunkGuard() {
  // Vite го праќа ова кога не може да вчита дел за кој веќе знае
  window.addEventListener("vite:preloadError", (ev) => { if (reloadForNewVersion()) ev.preventDefault(); });
  window.addEventListener("unhandledrejection", (ev) => { if (isStaleChunkError(ev.reason)) reloadForNewVersion(); });
}
