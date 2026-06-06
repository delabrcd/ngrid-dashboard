// One scheduler "tick": run a SCHEDULED scrape if any account is due (or if we
// have never scraped yet). Driven by a lightweight loop in docker-entrypoint.sh
// hitting /api/cron/tick — no in-process cron daemon (keeps the build edge-safe
// and the trigger reliable on the Node runtime).
import { prisma } from '@/lib/db';
import { ScrapeBusyError, ScrapeThrottledError, runScrape } from '@/lib/ngrid/run';
import { isSchedulerEnabled } from '@/lib/settings';

export async function tickOnce(): Promise<{ ran: boolean; reason: string }> {
  if (!(await isSchedulerEnabled())) return { ran: false, reason: 'disabled' };
  const states = await prisma.scheduleState.findMany();
  const now = new Date();
  const due = states.some((s) => s.nextCheckAt != null && s.nextCheckAt <= now);
  if (states.length === 0 || due) {
    try {
      await runScrape('SCHEDULED', (m) => console.log('[scheduler]', m));
      return { ran: true, reason: states.length === 0 ? 'initial' : 'due' };
    } catch (e) {
      if (e instanceof ScrapeBusyError) return { ran: false, reason: 'busy' };
      if (e instanceof ScrapeThrottledError) return { ran: false, reason: 'throttled' };
      throw e;
    }
  }
  return { ran: false, reason: 'not-due' };
}
