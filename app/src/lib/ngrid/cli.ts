// Local test entrypoint: `npm run scrape` (inside the container).
// Runs a full collect + persist and prints a summary.
import { collect } from './collect';
import { persist } from './persist';

(async () => {
  const result = await collect((m) => console.log('[scrape]', m));
  const summary = await persist(result);
  console.log('\n=== summary ===');
  console.log('account:', result.account.accountNumber, result.account.companyCode, result.account.region);
  console.log('bills:', result.bills.length, '| usage:', result.usage.length, '| costs:', result.costs.length, '| weather:', result.weather.length);
  console.log('PDFs downloaded this run:', result.pdfsDownloaded);
  console.log('DB:', summary.billsTotal, 'bills total,', summary.billsAdded, 'new');
  process.exit(0);
})().catch((e) => {
  console.error('scrape failed:', e);
  process.exit(1);
});
