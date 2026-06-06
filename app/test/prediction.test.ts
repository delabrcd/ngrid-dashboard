import { describe, expect, it } from 'vitest';
import { computeNextCheck, medianIntervalDays, predictNextBill } from '../src/lib/prediction';

const D = (s: string) => new Date(s + 'T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('medianIntervalDays (hand-calculated)', () => {
  it('takes the median of consecutive gaps', () => {
    // gaps: 01-01->01-31 = 30, 01-31->03-03 = 31, 03-03->04-01 = 29
    // sorted [29,30,31] -> median 30
    expect(medianIntervalDays([D('2026-01-01'), D('2026-01-31'), D('2026-03-03'), D('2026-04-01')])).toBe(30);
  });
  it('averages the two middle gaps for an even count', () => {
    // dates a..d give 3 gaps... use 5 dates for 4 gaps: 10,20,30,40 -> median (20+30)/2 = 25
    expect(
      medianIntervalDays([D('2026-01-01'), D('2026-01-11'), D('2026-01-31'), D('2026-03-02'), D('2026-04-11')])
    ).toBe(25);
  });
  it('defaults to ~30 days with fewer than two dates', () => {
    expect(medianIntervalDays([D('2026-01-01')])).toBe(30);
  });
});

describe('predictNextBill (hand-calculated)', () => {
  it('predicts last statement + median interval', () => {
    // gaps 30, 30 -> median 30; last = 03-02; +30d = 04-01
    const { predicted, medianDays } = predictNextBill([D('2026-01-01'), D('2026-01-31'), D('2026-03-02')]);
    expect(medianDays).toBe(30);
    expect(iso(predicted!)).toBe('2026-04-01');
  });
  it('returns null with no history', () => {
    expect(predictNextBill([]).predicted).toBeNull();
  });
});

describe('computeNextCheck (hand-calculated)', () => {
  it('weekly heartbeat far from the prediction', () => {
    // watchStart = 06-10 - 3d = 06-07; now+7d = 05-08 < watchStart -> 05-08
    expect(iso(computeNextCheck(D('2026-05-01'), D('2026-06-10')))).toBe('2026-05-08');
  });
  it('snaps to the watch-window start when within a week of it', () => {
    // watchStart 06-07; now 06-05, now+7d = 06-12 > watchStart -> watchStart 06-07
    expect(iso(computeNextCheck(D('2026-06-05'), D('2026-06-10')))).toBe('2026-06-07');
  });
  it('daily once inside the watch window', () => {
    // watchStart 06-07; now 06-08 >= watchStart -> now + 1 day
    const now = D('2026-06-08');
    expect(computeNextCheck(now, D('2026-06-10')).getTime()).toBe(now.getTime() + DAY);
  });
  it('weekly when there is no prediction', () => {
    const now = D('2026-06-08');
    expect(computeNextCheck(now, null).getTime()).toBe(now.getTime() + 7 * DAY);
  });
});
