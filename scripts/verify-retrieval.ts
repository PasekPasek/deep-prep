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
  'React hooks and useEffect cleanup',
  'system design interview: designing a URL shortener',
  'behavioural interview: tell me about a conflict with a teammate',
  'negotiating a software engineering job offer',
  'dynamic programming interview questions',
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
