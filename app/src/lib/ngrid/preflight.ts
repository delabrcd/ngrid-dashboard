// Server-side registry for interactive NG-login pre-flights (step 3 of the
// NG-login epic). A pre-flight is a single real headless Playwright login the
// operator starts from the UI to verify (and store) a National Grid credential.
// If the portal demands an OTP, the login PAUSES here and the UI prompts for the
// code; once submitted, the same live page resumes and — on success — the
// credential is encrypted and stored.
//
// The Node process persists across API requests, so a module-level Map of live
// Browser/Context/Page is the simplest correct design. Each entry carries:
//   - status (RUNNING | AWAITING_OTP | SUCCESS | ERROR) + a human message,
//   - a one-shot OTP "deferred": the parked login awaits `otp.promise`, and the
//     OTP route resolves it with the operator's code,
//   - timestamps for the idle-timeout sweeper.
//
// Good-guest guarantees: a pre-flight is ONE real login, no polling loops, no
// parallel logins (we only ever start one per operator action). Resources are
// closed on every terminal state and by an idle-timeout sweeper, so an abandoned
// OTP prompt can't leak a browser. The password is encrypted just before storage
// and never returned; the OTP is used once and never stored or logged.
import { randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';
import { prisma } from '@/lib/db';
import { encryptSecret } from '@/lib/crypto';
import { contextOptions, loginInteractive, saveState } from './auth';
import type { Creds } from './auth';
import { canTransition, isTerminal } from './preflightState';
import type { PreflightStatus } from './preflightState';

// Abandon + tear down a pre-flight that's been idle this long (e.g. the operator
// closed the tab at the OTP step). Bounds how long a live browser can linger.
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
// How often the sweeper checks for idle entries.
const SWEEP_INTERVAL_MS = 60 * 1000;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface PreflightEntry {
  id: string;
  status: PreflightStatus;
  message: string;
  createdAt: number;
  updatedAt: number;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  // Resolved by submitOtp() with the operator's one-time code; the parked
  // interactive login awaits this. One-shot.
  otp: Deferred<string>;
  // True once a code has been accepted into the otp deferred, so a duplicate
  // OTP submission is rejected (the code is one-shot).
  otpSubmitted: boolean;
}

// Module-level registry. Survives across API requests within one Node process.
const registry = new Map<string, PreflightEntry>();

let sweeper: ReturnType<typeof setInterval> | null = null;
function ensureSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const entry of registry.values()) {
      if (isTerminal(entry.status)) continue;
      if (now - entry.updatedAt > IDLE_TIMEOUT_MS) {
        void fail(entry, 'Timed out waiting for the login to complete (the browser was closed).');
      }
    }
  }, SWEEP_INTERVAL_MS);
  // Don't keep the event loop alive just for the sweeper.
  if (typeof sweeper.unref === 'function') sweeper.unref();
}

function touch(entry: PreflightEntry): void {
  entry.updatedAt = Date.now();
}

// Move an entry to a new state if the transition is legal. Refuses illegal/
// terminal-from transitions (defensive: a stray resume after success is a no-op).
function setStatus(entry: PreflightEntry, status: PreflightStatus, message: string): void {
  if (entry.status === status) {
    entry.message = message;
    touch(entry);
    return;
  }
  if (!canTransition(entry.status, status)) return;
  entry.status = status;
  entry.message = message;
  touch(entry);
}

async function closeResources(entry: PreflightEntry): Promise<void> {
  try {
    await entry.browser.close();
  } catch {
    /* already gone */
  }
}

// Drive an entry to ERROR, reject any pending OTP waiter, and close the browser.
async function fail(entry: PreflightEntry, message: string): Promise<void> {
  setStatus(entry, 'ERROR', message);
  // Unblock a parked login (e.g. on idle timeout) so its promise chain settles.
  if (!entry.otpSubmitted) {
    entry.otpSubmitted = true;
    entry.otp.reject(new Error(message));
  }
  await closeResources(entry);
}

export interface PreflightView {
  status: PreflightStatus;
  message: string;
}

export function getPreflight(id: string): PreflightView | null {
  const entry = registry.get(id);
  if (!entry) return null;
  return { status: entry.status, message: entry.message };
}

// Submit the one-time code for a parked pre-flight. Returns the post-submit view
// (which may still be RUNNING — poll for the terminal state). Rejects a missing
// entry, a non-AWAITING_OTP state, or a duplicate (one-shot) submission. The
// code is passed straight to the login and never stored or logged here.
export function submitOtp(id: string, code: string): { ok: boolean; error?: string; view?: PreflightView } {
  const entry = registry.get(id);
  if (!entry) return { ok: false, error: 'This login attempt has expired. Start again.' };
  if (entry.status !== 'AWAITING_OTP') {
    return { ok: false, error: `Not waiting for a code (status: ${entry.status}).` };
  }
  if (entry.otpSubmitted) return { ok: false, error: 'A code was already submitted for this attempt.' };
  entry.otpSubmitted = true;
  setStatus(entry, 'RUNNING', 'Verifying the one-time code…');
  entry.otp.resolve(code);
  return { ok: true, view: { status: entry.status, message: entry.message } };
}

// Start a pre-flight: launch a fresh headless browser, run the interactive
// login, and on success encrypt+store the credential as a verified NgLogin.
// Returns the generated id immediately; the login proceeds in the background and
// the caller polls getPreflight(). `creds.pass` is encrypted only on success and
// never returned or logged.
export function startPreflight(input: { label: string; username: string; password: string }): { id: string } {
  ensureSweeper();
  const id = randomUUID();

  // The entry is populated asynchronously (the browser launch is async), but we
  // need the id now. Stage a placeholder so a poll between start and launch sees
  // a sane RUNNING state.
  const otp = deferred<string>();
  const pending: Partial<PreflightEntry> & Pick<PreflightEntry, 'id' | 'status' | 'message' | 'createdAt' | 'updatedAt' | 'otp' | 'otpSubmitted'> = {
    id,
    status: 'RUNNING',
    message: 'Starting a login with National Grid…',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    otp,
    otpSubmitted: false,
  };
  // Park a partially-built entry so polls resolve; browser fields fill in below.
  registry.set(id, pending as PreflightEntry);

  void runPreflight(id, input).catch(() => {
    // runPreflight already records ERROR on the entry; swallow so an unhandled
    // rejection never crashes the process.
  });

  return { id };
}

async function runPreflight(id: string, input: { label: string; username: string; password: string }): Promise<void> {
  const placeholder = registry.get(id);
  if (!placeholder) return; // swept already

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    // A brand-new login: no stored session to reuse (loginId omitted), so we get
    // a clean context and must authenticate from scratch.
    const context = await browser.newContext(contextOptions());
    const page = await context.newPage();

    const entry = registry.get(id);
    if (!entry) {
      // Swept (idle timeout) between start and launch — tear down and bail.
      await browser.close().catch(() => {});
      return;
    }
    entry.browser = browser;
    entry.context = context;
    entry.page = page;
    touch(entry);

    const creds: Creds = { user: input.username, pass: input.password };
    await loginInteractive(
      page,
      creds,
      {
        onOtpNeeded: async () => {
          // Park: the UI's poll will see AWAITING_OTP and reveal the code input.
          setStatus(entry, 'AWAITING_OTP', 'National Grid sent a one-time code. Enter it to finish signing in.');
          return entry.otp.promise; // resolved by submitOtp()
        },
      },
      (m) => setStatus(entry, entry.status, m)
    );

    // Success — encrypt and store the credential as a verified login. The
    // password is encrypted here and the plaintext is dropped; it is never
    // returned to the client.
    const enc = encryptSecret(input.password);
    const login = await prisma.ngLogin.create({
      data: {
        label: input.label,
        username: input.username,
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        status: 'verified',
        lastVerifiedAt: new Date(),
      },
    });

    // Save the freshly-authenticated session under the new login's id so the
    // next scheduled scrape reuses it instead of re-logging-in (good-guest).
    await saveState(context, login.id).catch(() => {});

    setStatus(entry, 'SUCCESS', 'Login verified and saved.');
    await closeResources(entry);
  } catch (err: unknown) {
    const message = String((err as Error)?.message || err).slice(0, 300);
    const entry = registry.get(id);
    if (entry) {
      // The interactive login may have rejected because the entry was swept; if
      // so it's already ERROR. Otherwise record the failure cleanly.
      if (!isTerminal(entry.status)) await fail(entry, message);
      else await closeResources(entry);
    } else if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

// Test/maintenance hook: drop every entry and stop the sweeper. Not used in the
// request path; exported so a future test can reset module state.
export async function _resetPreflights(): Promise<void> {
  for (const entry of registry.values()) {
    if (entry.browser) await closeResources(entry);
  }
  registry.clear();
  if (sweeper) {
    clearInterval(sweeper);
    sweeper = null;
  }
}
