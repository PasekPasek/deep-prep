/**
 * Delete specific documents (and their sections) from the corpus — the targeted
 * sibling of reset-corpus. Refuses to touch a document whose sections are cited by
 * any saved card. Usage: pnpm exec tsx ... scripts/prune-doc.ts <path> [<path>...]
 */
import { db } from '../src/lib/db';

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error('usage: prune-doc.ts <document path> [...]');
    process.exit(1);
  }
  const s = db();

  const { data: cards } = await s.from('cards').select('id, provenance');
  const cited = new Set<string>();
  for (const card of cards ?? []) {
    for (const p of (card.provenance ?? []) as { ref?: string }[]) {
      if (p.ref) cited.add(p.ref);
    }
  }

  for (const path of paths) {
    const { data: doc } = await s
      .from('documents')
      .select('id, sections(id)')
      .eq('path', path)
      .maybeSingle();
    if (!doc) {
      console.log(`skip (not found): ${path}`);
      continue;
    }
    const sectionIds = (doc.sections as { id: string }[]).map((x) => x.id);
    const blocked = sectionIds.filter((id) => cited.has(id));
    if (blocked.length > 0) {
      console.log(`REFUSED (cited by saved cards): ${path}`);
      continue;
    }
    const { error } = await s.from('documents').delete().eq('id', doc.id);
    if (error) throw new Error(error.message);
    console.log(`deleted: ${path} (${sectionIds.length} sections)`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
