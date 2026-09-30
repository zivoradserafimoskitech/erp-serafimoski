// Текст од PDF (извод од банка и сл.) со pdf.js.
// Читачот (pdf.worker) се вчитува директно во страницата како обичен дел од апликацијата, наместо како
// посебен „worker“ од /assets/*.mjs: порано серверот ја праќаше таа датотека со погрешен тип, а прелистувачите
// ја зачувуваат за цела година — па PDF изводите паѓаа и по поправката. За изводи од неколку страници е доволно брзо.
export async function pdfToText(data: ArrayBuffer): Promise<string> {
  const g = globalThis as any;
  if (!g.pdfjsWorker) g.pdfjsWorker = await import("pdfjs-dist/build/pdf.worker.min.mjs");
  const pdfjs: any = await import("pdfjs-dist");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const c = await page.getTextContent();
    text += c.items.map((it: any) => it.str).join(" ") + "\n";
  }
  await doc.destroy?.();
  return text;
}
