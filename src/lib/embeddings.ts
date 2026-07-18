import 'server-only';

import { embedMany as aiEmbedMany } from 'ai';

import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from './models';
import { embeddingModel } from './openrouter';

/**
 * Embeddings, routed through OpenRouter like every other model call.
 *
 * OpenRouter's embeddings live at /api/v1/embeddings and are absent from
 * /api/v1/models (which lists generation models only) — so the model catalogue is not
 * evidence of what the embeddings endpoint supports. Price matches OpenAI direct
 * ($0.02/M tokens), so routing through OpenRouter costs nothing extra and keeps the
 * project on a single API key with unified spend tracking.
 *
 * One embedding per corpus section at ingest, one per card at save. The same vector
 * space serves retrieval (match_sections) and dedup (match_cards), so every caller
 * must come through here rather than embedding ad hoc with different settings.
 */

/**
 * Neither OpenRouter's embeddings API nor the provider's settings expose a
 * `dimensions` parameter, so we take the model's native width. For
 * text-embedding-3-small that is 1536, matching vector(1536) in the schema.
 *
 * That is an assumption about a remote service, so it is checked on every call: a
 * mismatch fails loudly at ingest instead of silently writing wrong-width vectors
 * that would surface much later as nonsense similarity scores.
 */
function assertDimensions(embeddings: number[][]): void {
  const wrong = embeddings.find((e) => e.length !== EMBEDDING_DIMENSIONS);
  if (wrong) {
    throw new Error(
      `Embedding model "${EMBEDDING_MODEL}" returned ${wrong.length} dimensions, ` +
        `but the schema declares vector(${EMBEDDING_DIMENSIONS}). ` +
        'Change EMBEDDING_DIMENSIONS and migrate the vector columns, or pick a model of matching width.',
    );
  }
}

/** Embed a batch of texts. Order of the returned vectors matches the input. */
export async function embedMany(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const { embeddings } = await aiEmbedMany({
    model: embeddingModel(),
    values: texts,
  });

  assertDimensions(embeddings);
  return embeddings;
}

export async function embed(text: string): Promise<number[]> {
  const [vector] = await embedMany([text]);
  return vector;
}

/**
 * pgvector over PostgREST accepts a vector as its text literal, not a JSON array —
 * supabase-js types `query_embedding` as `string` for exactly this reason.
 */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
