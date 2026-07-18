import 'server-only';

import { z } from 'zod';

import { callAgent } from '@/agents/call';

import { semanticSearch, type SectionHit } from './semanticSearch';

/**
 * Cross-lingual retrieval over a mixed-language corpus.
 *
 * WHY THIS EXISTS — measured, not assumed. The corpus holds English material
 * (tech-interview-handbook) and Polish material (ai-devs-4 course notes). An English
 * query scores markedly lower against equally relevant Polish sections, because
 * embedding similarity carries a cross-lingual penalty:
 *
 *   query                            EN query   PL query   delta
 *   RAG chunking and embeddings        0.395      0.611    +0.216
 *   LLM evaluation / LLM-as-judge      0.326      0.618    +0.292
 *   vector databases and pgvector      0.310      0.493    +0.183
 *   agentic workflows / tool calling   0.436      0.638    +0.201
 *
 * The consequence was not subtle: "LLM evaluation" scored 0.326 and fell below the
 * similarity floor, so a topic the corpus covers thoroughly produced no cards at all.
 *
 * Lowering the floor was the wrong fix — it would have admitted genuine noise, since
 * an UNCOVERED English topic ("React hooks", absent from both sources) scores 0.298,
 * overlapping the depressed Polish band. Instead the query is issued in each corpus
 * language and the results merged, so every section is scored by a query in its own
 * language and the bands separate again.
 */

/** Languages present in the corpus. Extend when a source in a new language is added. */
export const CORPUS_LANGUAGES = ['English', 'Polish'] as const;

const Translation = z.object({
  translations: z.array(
    z.object({
      language: z.string(),
      query: z.string(),
    }),
  ),
});

/**
 * Translate a search query into each corpus language.
 *
 * Uses the cheap model: this is mechanical translation of a short phrase, and the
 * technical terms mostly pass through unchanged. Roughly $0.0005 per topic.
 */
async function translateQuery(query: string, runId?: string): Promise<string[]> {
  const targets = CORPUS_LANGUAGES.filter((l) => l !== 'English');

  try {
    const result = await callAgent({
      role: 'extractor',
      schema: Translation,
      system:
        'You translate short technical search queries for a document retrieval system.\n\n' +
        'Write the query the way a practitioner writing IN THAT LANGUAGE would naturally ' +
        'phrase it, because it is matched against documents written by such practitioners.\n\n' +
        'Translate descriptive technical phrases into their natural local form: "vector ' +
        'databases" becomes the local phrase for vector databases, not the English words.\n\n' +
        'Leave untranslated ONLY product names, acronyms and API identifiers that have no ' +
        'local equivalent and are written in English everywhere: pgvector, RAG, LLM, API, ' +
        'PostgreSQL, embedding.\n\n' +
        'Return only the translations requested.',
      prompt: `Translate this search query into: ${targets.join(', ')}.\n\nQuery: ${query}`,
      meta: runId ? { runId } : {},
    });

    return result.value.translations.map((t) => t.query).filter((q) => q.trim().length > 0);
  } catch (error) {
    // Retrieval must not fail because translation did. Degrade to the original query,
    // which still finds same-language material.
    console.warn('[retrieval] query translation failed, using original only:', error);
    return [];
  }
}

/**
 * Search the corpus in every corpus language and merge.
 *
 * A section is kept at its BEST similarity across the query variants — a Polish
 * section found by the Polish variant keeps that (higher, fairer) score rather than
 * the depressed cross-lingual one.
 */
export async function multilingualSearch(
  query: string,
  k = 8,
  meta: { runId?: string } = {},
): Promise<SectionHit[]> {
  const variants = [query, ...(await translateQuery(query, meta.runId))];

  const batches = await Promise.all(variants.map((variant) => semanticSearch(variant, k)));

  const best = new Map<string, SectionHit>();
  for (const batch of batches) {
    for (const hit of batch) {
      const existing = best.get(hit.sectionId);
      if (!existing || hit.similarity > existing.similarity) {
        best.set(hit.sectionId, hit);
      }
    }
  }

  return [...best.values()].sort((a, b) => b.similarity - a.similarity).slice(0, k);
}
