/**
 * Delete a source and everything under it — `pnpm reset:corpus <source-name>`.
 *
 * Ingest deliberately never deletes sections, because card provenance cites section
 * ids and a dangling citation is worse than a stale row. This script is the explicit
 * escape hatch for when the parser changes and the corpus should be rebuilt clean.
 *
 * It refuses to run while any card cites a section belonging to that source.
 */
import { db } from '../src/lib/db';

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error('usage: pnpm reset:corpus <source-name>');
    process.exit(1);
  }

  const s = db();

  const { data: source } = await s.from('sources').select('id').eq('name', name).maybeSingle();
  if (!source) {
    console.log(`no source named "${name}"`);
    return;
  }

  const { data: documents } = await s.from('documents').select('id').eq('source_id', source.id);
  const documentIds = (documents ?? []).map((d) => d.id);

  const { data: sections } = await s
    .from('sections')
    .select('id')
    .in('document_id', documentIds.length ? documentIds : ['00000000-0000-0000-0000-000000000000']);
  const sectionIds = new Set((sections ?? []).map((x) => x.id));

  // Refuse if any card cites one of these sections.
  const { data: cards } = await s.from('cards').select('id, provenance');
  const citing = (cards ?? []).filter((card) => {
    const provenance = (card.provenance ?? []) as { ref?: string }[];
    return provenance.some((p) => p.ref && sectionIds.has(p.ref));
  });

  if (citing.length > 0) {
    console.error(
      `refusing: ${citing.length} card(s) cite sections in "${name}". ` +
        'Deleting would leave those cards with dangling provenance.',
    );
    process.exit(1);
  }

  // sections and documents cascade from the source.
  const { error } = await s.from('sources').delete().eq('id', source.id);
  if (error) throw new Error(error.message);

  console.log(
    `deleted source "${name}": ${documentIds.length} document(s), ${sectionIds.size} section(s)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
