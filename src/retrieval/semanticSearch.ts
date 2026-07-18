import 'server-only';

import type { Provenance } from '@/agents/contracts';
import { db } from '@/lib/db';
import { embed, toVectorLiteral } from '@/lib/embeddings';

/**
 * Classic RAG over the corpus: embed the query, cosine-match section embeddings via
 * the match_sections RPC.
 *
 * Results are provenance-ready by construction — the RPC joins documents and sources
 * so every hit already knows where it came from. A Researcher can cite without a
 * second lookup, which is what makes the Critic's "no source, no card" rule cheap to
 * satisfy.
 */

export type SectionHit = {
  sectionId: string;
  content: string;
  headingPath: string[];
  documentPath: string;
  documentTitle: string | null;
  sourceName: string;
  similarity: number;
};

export async function semanticSearch(query: string, k = 8): Promise<SectionHit[]> {
  const embedding = await embed(query);

  const { data, error } = await db().rpc('match_sections', {
    query_embedding: toVectorLiteral(embedding),
    match_count: k,
  });

  if (error) {
    throw new Error(`semanticSearch failed: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    sectionId: row.section_id,
    content: row.content,
    headingPath: row.heading_path,
    documentPath: row.document_path,
    documentTitle: row.document_title,
    sourceName: row.source_name,
    similarity: row.similarity,
  }));
}

/** "tech-interview-handbook › React › Hooks › useEffect" — for citations and UI. */
export function describeHit(hit: SectionHit): string {
  return [hit.sourceName, ...hit.headingPath].join(' › ');
}

export function toProvenance(hit: SectionHit): Provenance {
  return {
    kind: 'corpus',
    ref: hit.sectionId,
    label: describeHit(hit),
  };
}

/** Compact rendering for an LLM prompt: citation header + section body. */
export function renderForPrompt(hits: SectionHit[]): string {
  return hits
    .map((hit, i) => `[${i + 1}] ${describeHit(hit)} (section:${hit.sectionId})\n${hit.content}`)
    .join('\n\n---\n\n');
}
