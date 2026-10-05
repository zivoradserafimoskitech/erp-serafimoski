// Отворање на прикачена датотека (оригинал на фактура, приемница...) — се презема дури кога се бара.

export function openBase64(base64: string, mime = "application/pdf") {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

type Fetch = (i: { kind: "incoming_invoice" | "receipt" | "email_invoice" | "parsed_invoice"; id: number }) => Promise<{ mime: string; base64: string } | null>;
export async function openStoredFile(fetch: Fetch, kind: Parameters<Fetch>[0]["kind"], id: number) {
  const f = await fetch({ kind, id });
  if (!f) throw new Error("Датотеката ја нема");
  openBase64(f.base64, f.mime);
}
