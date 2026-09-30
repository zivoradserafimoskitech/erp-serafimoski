// Текст од PDF (извод од банка и сл.) со pdf.js.
// Читачот (pdf.worker) се вчитува директно во страницата како обичен дел од апликацијата, наместо како
// посебен „worker“ од /assets/*.mjs: порано серверот ја праќаше таа датотека со погрешен тип, а прелистувачите
// ја зачувуваат за цела година — па PDF изводите паѓаа и по поправката. За изводи од неколку страници е доволно брзо.
//
// Текстот се враќа ред по ред како на хартија (парчињата со иста висина на страницата се еден ред, од лево кон десно),
// за да може читачот на изводи да ги препознае ставките.
export async function pdfToText(data: ArrayBuffer): Promise<string> {
  const g = globalThis as any;
  if (!g.pdfjsWorker) g.pdfjsWorker = await import("pdfjs-dist/build/pdf.worker.min.mjs");
  const pdfjs: any = await import("pdfjs-dist");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const c = await page.getTextContent();
    const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
    for (const it of c.items as any[]) {
      const s = String(it.str ?? "");
      if (!s.trim()) continue;
      const x = it.transform?.[4] ?? 0, y = it.transform?.[5] ?? 0;
      // иста линија = разлика во висина помала од половина од висината на буквите
      const tol = Math.max(2, (it.height || 10) / 2);
      let row = rows.find(r => Math.abs(r.y - y) <= tol);
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x, s });
    }
    rows.sort((a, b) => b.y - a.y); // одозгора надолу
    pages.push(rows.map(r => r.parts.sort((a, b) => a.x - b.x).map(p => p.s.trim()).join("  ")).join("\n"));
  }
  await doc.destroy?.();
  return pages.join("\n");
}
