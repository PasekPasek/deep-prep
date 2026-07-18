import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

/**
 * Langfuse tracing setup, shared by the Next.js app (via instrumentation.ts) and the
 * CLI scripts.
 *
 * The CLI needs this as much as the server does: prompt iteration without traces means
 * tuning blind, and the eval harness in Layer 5 reads its scores from Langfuse.
 */

let provider: NodeTracerProvider | undefined;
let processor: { forceFlush: () => Promise<void>; shutdown: () => Promise<void> } | undefined;

export async function initTelemetry(): Promise<boolean> {
  if (provider) return true;

  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    console.warn('[langfuse] keys not set — LLM calls will run untraced');
    return false;
  }

  const [{ LangfuseSpanProcessor }, { registerTelemetry }, { LangfuseVercelAiSdkIntegration }] =
    await Promise.all([
      import('@langfuse/otel'),
      import('ai'),
      import('@langfuse/vercel-ai-sdk'),
    ]);

  const spanProcessor = new LangfuseSpanProcessor();
  processor = spanProcessor;

  provider = new NodeTracerProvider({ spanProcessors: [spanProcessor] });
  provider.register();

  registerTelemetry(new LangfuseVercelAiSdkIntegration());
  return true;
}

/**
 * Flush pending spans before the process exits.
 *
 * OpenTelemetry batches, so a short-lived CLI run would otherwise exit with its
 * traces still in the buffer — the run would simply never appear in Langfuse.
 * Long-running servers do not need this; scripts always do.
 */
export async function flushTelemetry(): Promise<void> {
  if (!processor) return;
  try {
    await processor.forceFlush();
  } catch (error) {
    console.warn('[langfuse] flush failed:', error);
  }
}
