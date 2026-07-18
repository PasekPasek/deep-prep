/**
 * Role -> OpenRouter model, and the price table the orchestrator bills against.
 *
 * Model strings live ONLY here. Agents take a role, never a model id, so swapping a
 * model is a one-line change and the eval harness (Layer 5) can diff roles across runs.
 */

export type AgentRole =
  | 'extractor'
  | 'planner'
  | 'researcher'
  | 'writer'
  | 'critic'
  | 'judge';

export const MODELS: Record<AgentRole, string> = {
  // Mechanical schema extraction — the hard part is the Zod contract, not reasoning.
  extractor: 'anthropic/claude-haiku-4.5',
  // Reasoning and synthesis quality drive card quality, so these get the strong model.
  planner: 'anthropic/claude-sonnet-5',
  researcher: 'anthropic/claude-sonnet-5',
  writer: 'anthropic/claude-sonnet-5',
  // Narrow classification against a rubric; dedup is done in code, not by the LLM.
  critic: 'anthropic/claude-haiku-4.5',
  // LLM-as-judge for evals (Layer 5).
  judge: 'anthropic/claude-haiku-4.5',
};

/**
 * Embeddings run through OpenRouter like everything else. Note the provider prefix:
 * OpenRouter ids are "openai/text-embedding-3-small", not the bare OpenAI name.
 * Native width is 1536, matching vector(1536) in the schema.
 */
export const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

/** USD per token. Verified against the OpenRouter models API. */
type Price = { prompt: number; completion: number };

const PER_MILLION = 1_000_000;

export const PRICES: Record<string, Price> = {
  'anthropic/claude-sonnet-5': { prompt: 2.0 / PER_MILLION, completion: 10.0 / PER_MILLION },
  'anthropic/claude-sonnet-4.6': { prompt: 3.0 / PER_MILLION, completion: 15.0 / PER_MILLION },
  'anthropic/claude-haiku-4.5': { prompt: 1.0 / PER_MILLION, completion: 5.0 / PER_MILLION },
};

/**
 * Cost of one call in USD. Unknown models cost 0 rather than throwing: a missing
 * price entry must not kill a run mid-pipeline, but it is logged so the table can be
 * corrected. Under-reporting is caught by the budget guard's own ceiling.
 */
export function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES[model];
  if (!price) {
    console.warn(`[models] no price entry for "${model}" — billing this call as $0`);
    return 0;
  }
  return inputTokens * price.prompt + outputTokens * price.completion;
}
