import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createAdAdapter } from '@/lib/hs/adapters/ad-remedies';
import { createAcftaAdapter } from '@/lib/hs/adapters/acfta';
import { createCustomsAdapter } from '@/lib/hs/adapters/customs';
import { parseDftMeasureListText } from '@/lib/trade-remedies/dft-parser';
import { InMemoryAcftaStore, InMemoryBlobStore } from '@/lib/acfta/memory-store';
import { pdfjsExtractor } from '@/lib/acfta/pdf-extract';
import type { Actor } from '@/lib/acfta/types';
import type { TradeRemedyRepository, TradeRemedySnapshot } from '@/lib/hs/types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const admin: Actor = { id: 'u-admin', roles: ['admin', 'reviewer'] };
export const reviewer: Actor = { id: 'u-rev', roles: ['reviewer'] };
export const member: Actor = { id: 'u-mem', roles: ['member'] };

/** Builds a text-layer PDF. Each page = list of rows, each row = list of [x, text] cells. A page may be `null` (blank, no text). */
export async function makePdf(pages: (([number, string][])[] | null)[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const rows of pages) {
    const page = pdf.addPage([595, 842]);
    if (!rows) continue;
    rows.forEach((cells, i) => cells.forEach(([x, t]) => page.drawText(t, { x, y: 780 - i * 18, size: 10, font })));
  }
  return new Uint8Array(await pdf.save());
}

export const sampleRows: [number, string][][] = [
  [[50, 'HS Code'], [150, 'Description'], [480, 'Rate']],
  [[50, '0101.21.00'], [150, 'Pure-bred breeding horses'], [480, '5']],
  [[50, '0101.29.00'], [150, 'Other live horses'], [480, '-']],
  [[50, '0102.21.00'], [150, 'Pure-bred breeding cattle'], [480, '0']],
];

export function dftSnapshot(retrievedAt = new Date().toISOString(), complete = true): TradeRemedySnapshot {
  const text = readFileSync(resolve(__dirname, 'fixtures/dft-sample.txt'), 'utf8');
  return { id: 'snap-1', sourceUrl: 'https://thaitr.dft.go.th/th/measure_use?orderBy=date_desc', retrievedAt, parserVersion: 'test', complete, cases: parseDftMeasureListText(text) };
}

export const adRepo = (snap: TradeRemedySnapshot | null): TradeRemedyRepository => ({ getLatestSnapshot: async () => snap });

export function newWorld() {
  const store = new InMemoryAcftaStore();
  const blobs = new InMemoryBlobStore();
  return { store, blobs, deps: { store, blobs, extractor: pdfjsExtractor } };
}

export function realAdapters(store: InMemoryAcftaStore, snap: TradeRemedySnapshot | null) {
  return { customs: createCustomsAdapter(), ad: createAdAdapter(adRepo(snap)), acfta: createAcftaAdapter(store) };
}
