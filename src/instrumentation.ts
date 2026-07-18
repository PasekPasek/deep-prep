/**
 * Next.js telemetry hook — runs once at server start.
 *
 * The actual setup lives in src/lib/telemetry.ts so CLI scripts get identical tracing;
 * iterating on prompts from the terminal is exactly when traces are most useful.
 */
export async function register() {
  // Also invoked for the edge runtime, where the Node OTel SDK cannot load. The
  // pipeline is Node-only, so skip anywhere else.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { initTelemetry } = await import('./lib/telemetry');
  await initTelemetry();
}
