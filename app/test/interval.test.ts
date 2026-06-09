import { describe, expect, it } from 'vitest';
import {
  parseIntervalReads,
  extractAmiMeters,
  amiIntervalUrl,
  backfillStartFor,
  normalizeFuel,
  unitForFuel,
} from '../src/lib/ngrid/interval';

const BASE = 'https://myaccount.nationalgrid.com';

describe('parseIntervalReads (hand-calculated)', () => {
  it('parses a 15-minute electric read: 900s and correct UTC instant', () => {
    const rows = parseIntervalReads(
      [{ startTime: '2026-06-08T23:30:00-04:00', endTime: '2026-06-08T23:45:00-04:00', value: 0.247259 }],
      'Electric',
      'kWh'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].intervalSeconds).toBe(900);
    expect(rows[0].quantity).toBeCloseTo(0.247259, 6);
    expect(rows[0].fuelType).toBe('ELECTRIC');
    expect(rows[0].unit).toBe('kWh');
    expect(rows[0].source).toBe('portal');
    // 23:30 at -04:00 == 03:30 next day UTC.
    expect(rows[0].intervalStart.toISOString()).toBe('2026-06-09T03:30:00.000Z');
  });

  it('parses an hourly read as 3600s', () => {
    const rows = parseIntervalReads(
      [{ startTime: '2026-06-08T01:00:00-04:00', endTime: '2026-06-08T02:00:00-04:00', value: 1.5 }],
      'Gas',
      'therms'
    );
    expect(rows[0].intervalSeconds).toBe(3600);
    expect(rows[0].fuelType).toBe('GAS');
    expect(rows[0].unit).toBe('therms');
  });

  it('keeps both DST fall-back 01:00 locals as distinct UTC instants', () => {
    // Nov 1 2026 02:00 EDT → 01:00 EST. The 01:00–01:15 local interval occurs
    // twice: first at -04:00 (EDT), then at -05:00 (EST). Different UTC instants.
    const rows = parseIntervalReads(
      [
        { startTime: '2026-11-01T01:00:00-04:00', endTime: '2026-11-01T01:15:00-04:00', value: 0.1 },
        { startTime: '2026-11-01T01:00:00-05:00', endTime: '2026-11-01T01:15:00-05:00', value: 0.2 },
      ],
      'Electric',
      'kWh'
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].intervalStart.toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(rows[1].intervalStart.toISOString()).toBe('2026-11-01T06:00:00.000Z');
    // Distinct storage keys → no unique collision.
    const keys = new Set(rows.map((r) => `${r.intervalStart.getTime()}:${r.intervalSeconds}`));
    expect(keys.size).toBe(2);
  });

  it('dedups a repeated read, keeping the last value', () => {
    const rows = parseIntervalReads(
      [
        { startTime: '2026-06-08T00:00:00-04:00', endTime: '2026-06-08T00:15:00-04:00', value: 0.1 },
        { startTime: '2026-06-08T00:00:00-04:00', endTime: '2026-06-08T00:15:00-04:00', value: 0.9 },
      ],
      'Electric',
      'kWh'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(0.9);
  });

  it('drops non-finite values, zero-length and unparseable intervals', () => {
    const rows = parseIntervalReads(
      [
        { startTime: '2026-06-08T00:00:00-04:00', endTime: '2026-06-08T00:15:00-04:00', value: NaN },
        { startTime: '2026-06-08T00:00:00-04:00', endTime: '2026-06-08T00:00:00-04:00', value: 1 }, // zero length
        { startTime: 'not-a-date', endTime: '2026-06-08T00:15:00-04:00', value: 1 },
        { startTime: '2026-06-08T01:00:00-04:00', endTime: '2026-06-08T01:15:00-04:00', value: 0.5 }, // good
      ],
      'Electric',
      'kWh'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(0.5);
  });

  it('sorts out-of-order reads by intervalStart', () => {
    const rows = parseIntervalReads(
      [
        { startTime: '2026-06-08T02:00:00-04:00', endTime: '2026-06-08T02:15:00-04:00', value: 2 },
        { startTime: '2026-06-08T01:00:00-04:00', endTime: '2026-06-08T01:15:00-04:00', value: 1 },
      ],
      'Electric',
      'kWh'
    );
    expect(rows.map((r) => r.quantity)).toEqual([1, 2]);
  });
});

describe('extractAmiMeters', () => {
  it('keeps only hasAmiSmartMeter nodes and normalizes fuel + servicePointNumber', () => {
    const ba = {
      meter: {
        nodes: [
          { fuelType: 'Electric', servicePointNumber: 12345, meterNumber: 'M1', hasAmiSmartMeter: true },
          { fuelType: 'Gas', servicePointNumber: '67890', hasAmiSmartMeter: false },
          { fuelType: 'Gas', servicePointNumber: '99999', isSmartMeter: true }, // no hasAmiSmartMeter
        ],
      },
    };
    const meters = extractAmiMeters(ba);
    expect(meters).toHaveLength(1);
    expect(meters[0]).toEqual({ fuelType: 'ELECTRIC', servicePointNumber: '12345', meterNumber: 'M1' });
  });

  it('drops AMI nodes missing a servicePointNumber', () => {
    const ba = { meter: { nodes: [{ fuelType: 'Gas', hasAmiSmartMeter: true }] } };
    expect(extractAmiMeters(ba)).toEqual([]);
  });

  it('tolerates garbage / missing shapes', () => {
    expect(extractAmiMeters(undefined)).toEqual([]);
    expect(extractAmiMeters(null)).toEqual([]);
    expect(extractAmiMeters({})).toEqual([]);
    expect(extractAmiMeters({ meter: {} })).toEqual([]);
    expect(extractAmiMeters({ meter: { nodes: 'nope' } })).toEqual([]);
    expect(extractAmiMeters({ meter: { nodes: [null, 42, 'x'] } })).toEqual([]);
  });
});

describe('amiIntervalUrl', () => {
  it('builds the endpoint and encodes the startDateTime space', () => {
    expect(amiIntervalUrl(BASE, '111', '222', '2026-05-01 00:00:00')).toBe(
      'https://myaccount.nationalgrid.com/api/amiadapter-cu-uwp-sys/v1/interval/reads/111/222?startDateTime=2026-05-01%2000:00:00'
    );
  });

  it('strips a trailing slash on base', () => {
    expect(amiIntervalUrl(BASE + '/', '1', '2', '2026-01-01 00:00:00')).toContain(
      '.com/api/amiadapter-cu-uwp-sys'
    );
  });
});

describe('backfillStartFor', () => {
  const now = new Date('2026-06-09T12:00:00Z');

  it('uses the explicit backfillFromIso override', () => {
    expect(backfillStartFor(now, null, '2025-01-01', 35)).toBe('2025-01-01 00:00:00');
  });

  it('uses lastStored minus a 1-day overlap', () => {
    expect(backfillStartFor(now, new Date('2026-06-08T03:30:00Z'), undefined, 35)).toBe(
      '2026-06-07 03:30:00'
    );
  });

  it('falls back to now minus windowDays', () => {
    expect(backfillStartFor(now, null, undefined, 35)).toBe('2026-05-05 12:00:00');
  });

  it('ignores an unparseable override and falls through', () => {
    expect(backfillStartFor(now, null, 'garbage', 35)).toBe('2026-05-05 12:00:00');
  });
});

describe('fuel helpers', () => {
  it('normalizeFuel maps portal labels', () => {
    expect(normalizeFuel('Electric')).toBe('ELECTRIC');
    expect(normalizeFuel('ELECTRIC')).toBe('ELECTRIC');
    expect(normalizeFuel('Electricity')).toBe('ELECTRIC');
    expect(normalizeFuel('Gas')).toBe('GAS');
    expect(normalizeFuel('Steam')).toBe('STEAM');
  });

  it('unitForFuel maps fuel → unit', () => {
    expect(unitForFuel('Electric')).toBe('kWh');
    expect(unitForFuel('Gas')).toBe('therms');
    expect(unitForFuel('Steam')).toBe('');
  });
});
