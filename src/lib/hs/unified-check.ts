import { normalizeHsCode } from './normalize';
import type {
  AcftaResult, AdResult, CheckContext, CustomsResult, NormalizedHs, SourceKey, SourceResult,
} from './types';

type Adapter<R> = (hs: NormalizedHs, ctx: CheckContext) => Promise<R>;

export interface HistoryStore {
  save(entry: { userId?: string; result: UnifiedCheckResult }): Promise<void>;
}

export interface UnifiedCheckDeps {
  customs: Adapter<CustomsResult>;
  ad: Adapter<AdResult>;
  acfta: Adapter<AcftaResult>;
  history?: HistoryStore;
  now?: () => Date;
  timeoutMs?: number;
}

export interface UnifiedCheckResult {
  id: string;
  hs: NormalizedHs;
  context: CheckContext;
  checkedAt: string;
  customs: CustomsResult;
  ad: AdResult;
  acfta: AcftaResult;
  historySaved: boolean;
}

function sourceError<R extends SourceResult<string, unknown>>(source: SourceKey, message: string, at: string): R {
  return {
    source, status: 'SOURCE_ERROR', message, findings: [], provenance: [], checkedAt: at,
    warnings: ['การตรวจส่วนนี้ล้มเหลว ผลที่ว่างเปล่าไม่ได้แปลว่า "ไม่พบ" หรือ "ไม่มีมาตรการ"'],
    manualChecksRequired: ['ตรวจสอบส่วนนี้ด้วยตนเอง'],
  } as unknown as R;
}

async function safely<R extends SourceResult<string, unknown>>(
  source: SourceKey, run: () => Promise<R>, timeoutMs: number, at: string,
): Promise<R> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('TIMEOUT')), timeoutMs); }),
    ]);
  } catch (e) {
    const msg = e instanceof Error && e.message === 'TIMEOUT' ? 'หมดเวลาเชื่อมต่อแหล่งข้อมูล' : 'เกิดข้อผิดพลาดในการตรวจแหล่งข้อมูลนี้';
    return sourceError<R>(source, msg, at);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One HS code in → three independent checks out. Throws only for invalid input. */
export async function runUnifiedCheck(
  input: { hsCode: string; context?: CheckContext; userId?: string },
  deps: UnifiedCheckDeps,
): Promise<UnifiedCheckResult> {
  const hs = normalizeHsCode(input.hsCode); // InvalidHsCodeError propagates
  const ctx = input.context ?? {};
  const now = deps.now ?? (() => new Date());
  const at = now().toISOString();
  const t = deps.timeoutMs ?? 15_000;

  const [customs, ad, acfta] = await Promise.all([
    safely<CustomsResult>('OFFICIAL_CUSTOMS', () => deps.customs(hs, ctx), t, at),
    safely<AdResult>('AD_TRADE_REMEDIES', () => deps.ad(hs, ctx), t, at),
    safely<AcftaResult>('ACFTA_FORM_E', () => deps.acfta(hs, ctx), t, at),
  ]);

  const result: UnifiedCheckResult = {
    id: crypto.randomUUID(), hs, context: ctx, checkedAt: at, customs, ad, acfta, historySaved: false,
  };
  if (deps.history) {
    try {
      await deps.history.save({ userId: input.userId, result });
      result.historySaved = true;
    } catch {
      /* history failure must never hide results */
    }
  }
  return result;
}
