// Predict the next statement date from historical cadence, and decide when to
// next poll the portal (tightening to daily as the prediction approaches).

const DAY = 24 * 60 * 60 * 1000;

export function medianIntervalDays(sortedAsc: Date[]): number {
  if (sortedAsc.length < 2) return 30; // sensible default ~monthly
  const gaps: number[] = [];
  for (let i = 1; i < sortedAsc.length; i++) {
    gaps.push((sortedAsc[i].getTime() - sortedAsc[i - 1].getTime()) / DAY);
  }
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

export function predictNextBill(statementDates: Date[]): { predicted: Date | null; medianDays: number } {
  if (!statementDates.length) return { predicted: null, medianDays: 30 };
  const sorted = [...statementDates].sort((a, b) => a.getTime() - b.getTime());
  const medianDays = medianIntervalDays(sorted);
  const last = sorted[sorted.length - 1];
  const predicted = new Date(last.getTime() + Math.round(medianDays) * DAY);
  return { predicted, medianDays };
}

// Cadence: weekly heartbeat far out; daily once inside the watch window
// (predicted - 3 days) and until a new bill arrives.
export function computeNextCheck(now: Date, predicted: Date | null): Date {
  if (!predicted) return new Date(now.getTime() + 7 * DAY);
  const watchStart = new Date(predicted.getTime() - 3 * DAY);
  if (now < watchStart) {
    const weekly = new Date(now.getTime() + 7 * DAY);
    return weekly < watchStart ? weekly : watchStart;
  }
  return new Date(now.getTime() + 1 * DAY);
}
