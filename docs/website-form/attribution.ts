// Зачувување на изворот на посетата (UTM / gclid / fbclid / landing / referrer) на веб-страницата.
// Работи и со hash рутирање (#/kontakt?utm_source=...) и со обични параметри (?utm_source=...#/kontakt).
// Правило: „последен недиректен допир“ — нова посета со UTM/клик-ID го заменува стариот извор; директна посета не го брише.
const KEY = "srf_attribution";
const TTL_DAYS = 90;
const PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"] as const;

export type Attribution = Partial<Record<(typeof PARAMS)[number] | "landing_page" | "referrer", string>> & { at?: number };

function currentParams(): URLSearchParams {
  const out = new URLSearchParams(window.location.search);
  const h = window.location.hash;
  const qi = h.indexOf("?");
  if (qi >= 0) new URLSearchParams(h.slice(qi + 1)).forEach((v, k) => { if (!out.has(k)) out.set(k, v); });
  return out;
}

function read(): Attribution | null {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) ?? "null") as Attribution | null;
    if (a?.at && Date.now() - a.at < TTL_DAYS * 86_400_000) return a;
  } catch { /* приватен режим */ }
  return null;
}

/** Повикај еднаш при вчитување на страницата (на пр. во main.tsx). */
export function captureAttribution(): Attribution {
  const p = currentParams();
  const fresh: Attribution = {};
  for (const k of PARAMS) { const v = p.get(k); if (v) fresh[k] = v.slice(0, 255); }
  const ownReferrer = document.referrer && new URL(document.referrer).hostname.replace(/^www\./, "") === window.location.hostname.replace(/^www\./, "");
  const stored = read();
  const external = Object.keys(fresh).length > 0 || (!!document.referrer && !ownReferrer);
  if (stored && !external) return stored;
  const a: Attribution = { ...fresh, landing_page: window.location.href.slice(0, 1000), referrer: ownReferrer ? "" : document.referrer.slice(0, 1000), at: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* ignore */ }
  return a;
}

export function getAttribution(): Attribution {
  return read() ?? captureAttribution();
}
