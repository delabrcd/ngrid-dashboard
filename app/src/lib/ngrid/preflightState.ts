// Pure helpers for the interactive NG-login pre-flight (step 3 of the NG-login
// epic). Kept browser/DB-free so the state machine and input validation are
// unit-testable in isolation — the live Playwright plumbing lives in
// `preflight.ts`, which imports these.
//
// A pre-flight is a single real headless login the operator kicks off from the
// UI to verify (and store) a National Grid credential. It can pause at the
// portal's MFA/OTP step, so its lifecycle is a small state machine:
//
//   RUNNING ──(MFA prompt)──▶ AWAITING_OTP ──(code submitted)──▶ RUNNING ──▶ SUCCESS
//      │                            │                                 │
//      └───────────────────────────┴─────────────────────────────────┴──▶ ERROR
//
// SUCCESS and ERROR are terminal: once reached, the browser is closed and no
// further transition is allowed.

export type PreflightStatus = 'RUNNING' | 'AWAITING_OTP' | 'SUCCESS' | 'ERROR';

export const TERMINAL_STATUSES: readonly PreflightStatus[] = ['SUCCESS', 'ERROR'];

export function isTerminal(status: PreflightStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

// Whether moving from `from` to `to` is a legal pre-flight transition. Terminal
// states are sinks (no exit); AWAITING_OTP returns to RUNNING once the code is
// submitted (then on to SUCCESS/ERROR). RUNNING may pause at AWAITING_OTP or go
// straight to a terminal state (e.g. a no-MFA login, or a credential failure).
export function canTransition(from: PreflightStatus, to: PreflightStatus): boolean {
  if (isTerminal(from)) return false;
  switch (from) {
    case 'RUNNING':
      return to === 'AWAITING_OTP' || to === 'SUCCESS' || to === 'ERROR';
    case 'AWAITING_OTP':
      // Resuming with a code returns to RUNNING; a timeout/abandon can error it.
      return to === 'RUNNING' || to === 'ERROR';
    default:
      return false;
  }
}

// Validate (and normalize) an operator-entered one-time code. NG's portal sends
// a short numeric passcode; we accept 4–8 digits after trimming and stripping
// internal spaces/dashes (codes are sometimes shown grouped). This is the only
// place the OTP shape is enforced; the code itself is never stored or logged.
export interface OtpValidation {
  ok: boolean;
  code?: string; // normalized, digits-only — only present when ok
  error?: string; // human-readable reason when !ok
}

export function validateOtp(raw: unknown): OtpValidation {
  if (typeof raw !== 'string') return { ok: false, error: 'A verification code is required.' };
  const code = raw.replace(/[\s-]/g, '');
  if (code.length === 0) return { ok: false, error: 'A verification code is required.' };
  if (!/^\d+$/.test(code)) return { ok: false, error: 'The code must be all digits.' };
  if (code.length < 4 || code.length > 8) {
    return { ok: false, error: 'The code must be 4–8 digits.' };
  }
  return { ok: true, code };
}

// Validate the add-login form body (label / username / password). Pure so the
// route and a unit test share one source of truth. The password is checked for
// presence only — never inspected, transformed, logged, or returned.
export interface AddLoginValidation {
  ok: boolean;
  value?: { label: string; username: string; password: string };
  error?: string;
}

export function validateAddLogin(body: unknown): AddLoginValidation {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Missing request body.' };
  const b = body as Record<string, unknown>;
  const label = typeof b.label === 'string' ? b.label.trim() : '';
  const username = typeof b.username === 'string' ? b.username.trim() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  if (!label) return { ok: false, error: 'A label is required.' };
  if (!username) return { ok: false, error: 'A username (email) is required.' };
  if (!password) return { ok: false, error: 'A password is required.' };
  return { ok: true, value: { label, username, password } };
}
