/** Swappable OCR provider. Nothing is configured by default — no key or service is assumed. */
export interface OcrProvider {
  readonly name: string;
  /** Returns text lines for one page (1-based). Columns should be separated by 2+ spaces or tabs. */
  recognizePage(pdf: Uint8Array, pageNumber: number): Promise<string[]>;
}

export class OcrNotConfiguredError extends Error {
  constructor() {
    super('OCR provider not configured');
    this.name = 'OcrNotConfiguredError';
  }
}

export const notConfiguredOcr: OcrProvider = {
  name: 'none',
  async recognizePage() {
    throw new OcrNotConfiguredError();
  },
};
