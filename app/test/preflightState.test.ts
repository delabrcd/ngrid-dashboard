import { describe, expect, it } from 'vitest';
import {
  canTransition,
  isTerminal,
  validateAddLogin,
  validateOtp,
} from '../src/lib/ngrid/preflightState';
import type { PreflightStatus } from '../src/lib/ngrid/preflightState';

describe('preflight state machine (pure)', () => {
  it('marks SUCCESS and ERROR as terminal, others as live', () => {
    expect(isTerminal('SUCCESS')).toBe(true);
    expect(isTerminal('ERROR')).toBe(true);
    expect(isTerminal('RUNNING')).toBe(false);
    expect(isTerminal('AWAITING_OTP')).toBe(false);
  });

  it('allows the happy-path transitions', () => {
    expect(canTransition('RUNNING', 'AWAITING_OTP')).toBe(true); // MFA prompt
    expect(canTransition('AWAITING_OTP', 'RUNNING')).toBe(true); // code submitted
    expect(canTransition('RUNNING', 'SUCCESS')).toBe(true); // login done
    expect(canTransition('RUNNING', 'ERROR')).toBe(true); // bad creds
    expect(canTransition('AWAITING_OTP', 'ERROR')).toBe(true); // OTP timeout
  });

  it('refuses to leave a terminal state (sinks)', () => {
    const terminals: PreflightStatus[] = ['SUCCESS', 'ERROR'];
    const all: PreflightStatus[] = ['RUNNING', 'AWAITING_OTP', 'SUCCESS', 'ERROR'];
    for (const from of terminals) {
      for (const to of all) expect(canTransition(from, to)).toBe(false);
    }
  });

  it('refuses to jump straight from AWAITING_OTP to SUCCESS', () => {
    // Success can only be reached via RUNNING (after the code is verified).
    expect(canTransition('AWAITING_OTP', 'SUCCESS')).toBe(false);
    expect(canTransition('AWAITING_OTP', 'AWAITING_OTP')).toBe(false);
  });
});

describe('validateOtp (pure)', () => {
  it('accepts a plain 6-digit code', () => {
    expect(validateOtp('123456')).toEqual({ ok: true, code: '123456' });
  });

  it('normalizes spaces and dashes out of grouped codes', () => {
    expect(validateOtp('123 456')).toEqual({ ok: true, code: '123456' });
    expect(validateOtp(' 12-34 ')).toEqual({ ok: true, code: '1234' });
  });

  it('accepts the 4–8 digit boundaries', () => {
    expect(validateOtp('1234').ok).toBe(true);
    expect(validateOtp('12345678').ok).toBe(true);
  });

  it('rejects too-short / too-long codes', () => {
    expect(validateOtp('123').ok).toBe(false);
    expect(validateOtp('123456789').ok).toBe(false);
  });

  it('rejects non-digits and empty / non-string input', () => {
    expect(validateOtp('12ab56').ok).toBe(false);
    expect(validateOtp('').ok).toBe(false);
    expect(validateOtp('   ').ok).toBe(false);
    expect(validateOtp(undefined).ok).toBe(false);
    expect(validateOtp(123456 as unknown).ok).toBe(false);
  });

  it('never echoes a rejected code back', () => {
    const r = validateOtp('nope');
    expect(r.ok).toBe(false);
    expect(r.code).toBeUndefined();
  });
});

describe('validateAddLogin (pure)', () => {
  it('accepts a complete body and trims label/username (not password)', () => {
    const r = validateAddLogin({ label: '  Home ', username: ' you@example.com ', password: '  p@ss  ' });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ label: 'Home', username: 'you@example.com', password: '  p@ss  ' });
  });

  it('rejects a missing or blank label / username / password', () => {
    expect(validateAddLogin({ username: 'u', password: 'p' }).ok).toBe(false);
    expect(validateAddLogin({ label: '  ', username: 'u', password: 'p' }).ok).toBe(false);
    expect(validateAddLogin({ label: 'L', password: 'p' }).ok).toBe(false);
    expect(validateAddLogin({ label: 'L', username: 'u' }).ok).toBe(false);
    expect(validateAddLogin({ label: 'L', username: 'u', password: '' }).ok).toBe(false);
  });

  it('rejects a non-object body', () => {
    expect(validateAddLogin(null).ok).toBe(false);
    expect(validateAddLogin('nope').ok).toBe(false);
    expect(validateAddLogin(undefined).ok).toBe(false);
  });

  it('never returns a value object on failure (no partial leak)', () => {
    expect(validateAddLogin({ label: 'L', username: 'u' }).value).toBeUndefined();
  });
});
