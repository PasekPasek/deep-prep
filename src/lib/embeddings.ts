import 'server-only';

import OpenAI from 'openai';

import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from './models';

/**
 * Embeddings go straight to OpenAI: OpenRouter's catalogue contains no embedding
 * models, so routing them through it is not an option.
 *
 * One embedding per corpus section at ingest, one per card at save. The same vector
 * space serves retrieval (match_sections) and dedup (match_cards), so every caller
 * must use this module rather than embedding ad hoc with different settings.
 */

let client: OpenAI | undefined;

function openai(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Missing OPENAI_API_KEY. Embeddings require a direct OpenAI key — OpenRouter serves no embedding models.',
      );
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

/** Embed a batch of texts. Order of the returned vectors matches the input. */
export async function embedMany(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const response = await openai().embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  // The API documents index ordering, but sorting makes the guarantee local.
  return response.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
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
