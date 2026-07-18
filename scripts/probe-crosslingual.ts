/**
 * Is the low similarity on ai-devs-4 material a cross-lingual penalty, or is the
 * content simply a poor match?
 *
 * Runs the same question in English and in Polish against the same corpus. If the
 * Polish query scores markedly higher on the same sections, the penalty is linguistic
 * and the fix belongs in retrieval, not in the corpus.
 */
import { describeHit, semanticSearch } from '../src/retrieval/semanticSearch';

const PAIRS: [string, string][] = [
  ['RAG systems: chunking strategies and embeddings', 'systemy RAG: strategie dzielenia dokumentów i embeddingi'],
  ['LLM evaluation, test sets and LLM-as-judge', 'ewaluacja modeli językowych, zestawy testowe i ocena przez model'],
  ['vector databases and pgvector', 'bazy wektorowe i pgvector'],
  ['agentic workflows and tool calling', 'workflow agentowe i wywoływanie narzędzi'],
];

async function main() {
  for (const [english, polish] of PAIRS) {
    const [en, pl] = await Promise.all([semanticSearch(english, 3), semanticSearch(polish, 3)]);
    const enTop = en[0];
    const plTop = pl[0];

    console.log(`\n── ${english}`);
    console.log(`   EN  ${enTop ? enTop.similarity.toFixed(3) : '  —  '}  ${enTop ? describeHit(enTop).slice(0, 80) : 'no hits'}`);
    console.log(`   PL  ${plTop ? plTop.similarity.toFixed(3) : '  —  '}  ${plTop ? describeHit(plTop).slice(0, 80) : 'no hits'}`);
    if (enTop && plTop) {
      const delta = plTop.similarity - enTop.similarity;
      console.log(`   delta ${delta >= 0 ? '+' : ''}${delta.toFixed(3)}  ${enTop.sectionId === plTop.sectionId ? '(same top section)' : '(different sections)'}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
