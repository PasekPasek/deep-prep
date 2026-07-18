import 'server-only';

import { NextResponse } from 'next/server';

/**
 * Shared helpers for API routes.
 *
 * Internal pipeline routes are triggered by the app itself (a step re-triggering the
 * next one), not by a browser session, so they authenticate with CRON_SECRET instead.
 */

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function serverError(message: string) {
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Timing-safe-ish comparison; secrets here are compared as whole strings. */
export function hasCronSecret(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const provided =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    '';

  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

/**
 * Fire the next pipeline step without awaiting its completion.
 *
 * One invocation must not block on the next, or the chain collapses back into a single
 * long request — the exact thing the step machine exists to avoid. Errors are logged
 * and swallowed: the run is already checkpointed, so a lost trigger costs a resume,
 * not data.
 */
export function triggerNextStep(runId: string, origin: string): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('[pipeline] CRON_SECRET unset — not self-triggering');
    return;
  }

  void fetch(`${origin}/api/pipeline/step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
    body: JSON.stringify({ runId }),
  }).catch((error) => {
    console.error(`[pipeline] failed to trigger next step for ${runId}:`, error);
  });
}
