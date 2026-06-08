import { describe, expect, it } from 'vitest';
import { buildNotifications, type NotificationsOverview } from '../src/lib/notifications';
import type { AnomalyFlag, AnomalyResult } from '../src/lib/anomaly';

// Minimal AnomalyFlag factory — only the fields the notification key + message use
// matter here (ym/fuel/metric/message); the statistical fields are filler.
const mkFlag = (over: Partial<AnomalyFlag>): AnomalyFlag => ({
  fuel: 'elec', metric: 'usage', direction: 'above',
  ym: 202406, latest: 0, median: 0, pct: 0, deviations: 0,
  message: 'electric usage ~30% above weather-normalized expectation',
  ...over,
});

const mkAnomalies = (flags: AnomalyFlag[]): AnomalyResult => ({
  flags,
  ym: flags.length ? Math.max(...flags.map((f) => f.ym)) : null,
});

// An overview with two anomaly flags (electric usage + gas rate) and a latest bill.
const fullOverview: NotificationsOverview = {
  anomalies: mkAnomalies([
    mkFlag({ ym: 202406, fuel: 'elec', metric: 'usage', message: 'electric usage ~30% above weather-normalized expectation' }),
    mkFlag({ ym: 202406, fuel: 'gas', metric: 'rate', direction: 'above', message: 'gas rate ~12% above recent rate band' }),
  ]),
  latestBill: { statementDate: '2026-06-03', totalDueAmount: 192.24 },
};

describe('buildNotifications', () => {
  it('returns [] for a null/undefined overview', () => {
    expect(buildNotifications(null, [])).toEqual([]);
    expect(buildNotifications(undefined, [])).toEqual([]);
  });

  // Two anomaly flags + one bill => 3 items, with the new-bill item pinned first.
  it('produces one item per flag plus one new-bill item, bill first', () => {
    const items = buildNotifications(fullOverview, []);
    expect(items).toHaveLength(3);
    // New-bill item is pinned to the top.
    expect(items[0].kind).toBe('bill');
    expect(items[0].key).toBe('bill:2026-06-03');
    expect(items[0].tone).toBe('info');
    expect(items[0].message).toBe('New bill: $192 (Jun)');
    // The remaining two are the anomaly items, warning-toned, with stable keys.
    expect(items.slice(1).every((n) => n.kind === 'anomaly' && n.tone === 'warning')).toBe(true);
    expect(items.map((n) => n.key)).toEqual([
      'bill:2026-06-03',
      'anomaly:202406:elec:usage',
      'anomaly:202406:gas:rate',
    ]);
    // Anomaly messages come straight from the flag (shared wording with the email).
    expect(items[1].message).toBe('electric usage ~30% above weather-normalized expectation');
  });

  // A dismissed key never reappears; the rest survive.
  it('excludes dismissed keys', () => {
    const items = buildNotifications(fullOverview, ['anomaly:202406:elec:usage']);
    expect(items).toHaveLength(2);
    expect(items.find((n) => n.key === 'anomaly:202406:elec:usage')).toBeUndefined();
    expect(items.map((n) => n.key)).toEqual(['bill:2026-06-03', 'anomaly:202406:gas:rate']);
  });

  // When every key is dismissed the list is empty (drives the empty state + a 0
  // badge that hides).
  it('is empty when all keys are dismissed', () => {
    const items = buildNotifications(fullOverview, [
      'bill:2026-06-03',
      'anomaly:202406:elec:usage',
      'anomaly:202406:gas:rate',
    ]);
    expect(items).toEqual([]);
  });

  // The seeded-data case: no anomalies flagged, but a latest bill exists -> exactly
  // one (new-bill) item, so the bell still shows a badge of 1.
  it('shows just the new-bill item when there are no anomalies', () => {
    const items = buildNotifications(
      { anomalies: mkAnomalies([]), latestBill: { statementDate: '2026-06-03', totalDueAmount: 88.5 } },
      []
    );
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('bill');
    expect(items[0].message).toBe('New bill: $89 (Jun)');
  });

  // No latest bill and no anomalies -> nothing.
  it('is empty with neither a bill nor anomalies', () => {
    expect(buildNotifications({ anomalies: mkAnomalies([]), latestBill: null }, [])).toEqual([]);
    expect(buildNotifications({}, [])).toEqual([]);
  });

  // A null amount still renders a (dash) bill item rather than crashing.
  it('handles a null bill amount', () => {
    const items = buildNotifications({ latestBill: { statementDate: '2026-01-15', totalDueAmount: null } }, []);
    expect(items).toHaveLength(1);
    expect(items[0].message).toBe('New bill: — (Jan)');
  });
});
