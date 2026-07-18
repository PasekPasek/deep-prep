/**
 * Retrieval smoke check — `pnpm verify:retrieval`.
 *
 * Runs real queries against the ingested corpus and prints what comes back, so
 * retrieval quality is inspected rather than assumed. Costs one embedding per query
 * (fractions of a cent).
 */
import { db } from '../src/lib/db';
import { describeHit, semanticSearch } from '../src/retrieval/semanticSearch';

const QUERIES = [
  // Interview-process topics — covered by tech-interview-handbook.
  'system design interview: designing a URL shortener',
  'behavioural interview: tell me about a conflict with a teammate',
  'negotiating a software engineering job offer',
  'dynamic programming interview questions',
  // AI/LLM topics — these returned nothing until the ai-devs-4 notes were ingested,
  // which is what made the corpus gap concrete rather than theoretical.
  'RAG systems: chunking strategies and embeddings',
  'agentic workflows and tool calling patterns',
  'LLM evaluation, test sets and LLM-as-judge',
  'vector databases and pgvector',
  // Still uncovered by either source — the control case for the similarity floor.
  'React hooks and useEffect cleanup',
];

async function main() {
  const { count } = await db().from('sections').select('id', { count: 'exact', head: true });
  console.log(`corpus: ${count} sections\n`);

  for (const query of QUERIES) {
    const hits = await semanticSearch(query, 3);
    console.log(`── "${query}"`);
    if (hits.length === 0) {
      console.log('   (no hits)\n');
      continue;
    }
    for (const hit of hits) {
      const preview = hit.content.replace(/\s+/g, ' ').slice(0, 90);
      console.log(`   ${hit.similarity.toFixed(3)}  ${describeHit(hit)}`);
      console.log(`          ${preview}…`);
    }
    console.log();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
