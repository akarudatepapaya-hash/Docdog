export interface Cell { x: number; text: string }

export interface PdfPageText {
  pageNumber: number;
  charCount: number;
  rows: Cell[][]; // each row = cells split by horizontal gaps, left edge x kept for column mapping
}

export interface PdfTextExtractor {
  extract(bytes: Uint8Array): Promise<{ pageCount: number; pages: PdfPageText[] }>;
}

interface Item { str: string; x: number; y: number; w: number }

/** Text-layer extractor built on pdfjs-dist. It reads text only; it does NOT OCR. */
export const pdfjsExtractor: PdfTextExtractor = {
  async extract(bytes) {
    // Serverless bundles can't resolve pdfjs' worker file; preloading its handler makes pdfjs skip that lookup.
    const g = globalThis as { pdfjsWorker?: unknown };
    if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true, isEvalSupported: false,
    }).promise;
    const pages: PdfPageText[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items: Item[] = [];
      for (const it of content.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        items.push({ str: it.str, x: it.transform[4]!, y: it.transform[5]!, w: it.width });
      }
      pages.push({ pageNumber: n, charCount: items.reduce((s, i) => s + i.str.trim().length, 0), rows: toRows(items) });
    }
    const pageCount = doc.numPages;
    await doc.destroy();
    return { pageCount, pages };
  },
};

export function toRows(items: Item[], yTol = 2.5, gap = 8): Cell[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Item[][] = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l[0]!.y - it.y) <= yTol);
    if (line) line.push(it); else lines.push([it]);
  }
  return lines.map((l) => {
    l.sort((a, b) => a.x - b.x);
    const cells: Cell[] = [];
    let cur = l[0]!.str;
    let curX = l[0]!.x;
    let end = l[0]!.x + l[0]!.w;
    for (const it of l.slice(1)) {
      if (it.x - end > gap) { cells.push({ x: curX, text: cur.trim() }); cur = it.str; curX = it.x; } else cur += (it.x - end > 1 ? ' ' : '') + it.str;
      end = it.x + it.w;
    }
    cells.push({ x: curX, text: cur.trim() });
    return cells;
  });
}
