/**
 * Langfuse tracing, registered once at process start.
 *
 * AI SDK 7 replaced v6's per-call `experimental_telemetry: { isEnabled: true }` flag
 * with a telemetry registry: register the integration here and every generateText call
 * emits spans automatically. Individual calls still attach metadata (agent, runId,
 * topicSlug) so traces are filterable in the Langfuse UI.
 */
export async function register() {
  // Next.js also runs instrumentation in the edge runtime, where the Node OTel SDK
  // cannot load. The pipeline is Node-only, so skip anywhere else.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    console.warn('[langfuse] keys not set — LLM calls will run untraced');
    return;
  }

  const [{ registerTelemetry }, { LangfuseSpanProcessor }, { LangfuseVercelAiSdkIntegration }, { NodeSDK }] =
    await Promise.all([
      import('ai'),
      import('@langfuse/otel'),
      import('@langfuse/vercel-ai-sdk'),
      import('@opentelemetry/sdk-node'),
    ]);

  const sdk = new NodeSDK({ spanProcessors: [new LangfuseSpanProcessor()] });
  sdk.start();

  registerTelemetry(new LangfuseVercelAiSdkIntegration());
}
