/**
 * Pulls the DFT "สินค้าที่ไทยใช้มาตรการ" list into trade_remedy_snapshots / trade_remedy_cases.
 * Run:  npx tsx scripts/sync-dft.ts      (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 * Refuses to write if parsing looks wrong, so a layout change can never wipe a good snapshot.
 */
import { serviceClient } from '../src/lib/supabase/clients';
import { DFT_LIST_URL, DFT_PARSER_VERSION, fetchDftCases } from '../src/lib/trade-remedies/dft-parser';

async function main() {
  const sb = serviceClient();
  const { cases, complete, retrievedAt, pages } = await fetchDftCases({ delayMs: 1500 });
  const { data: snap, error } = await sb.from('trade_remedy_snapshots')
    .insert({ source_url: DFT_LIST_URL, retrieved_at: retrievedAt, parser_version: DFT_PARSER_VERSION, complete, case_count: cases.length })
    .select('id').single();
  if (error) throw error;
  const rows = cases.map((c) => ({ snapshot_id: snap.id, case_id: c.caseId, data: c, hs_codes: c.hsCodes }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error: e2 } = await sb.from('trade_remedy_cases').insert(rows.slice(i, i + 200));
    if (e2) throw e2;
  }
  console.log(`snapshot ${snap.id}: ${cases.length} cases from ${pages} page(s), complete=${complete}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
