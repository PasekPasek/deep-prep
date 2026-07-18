/**
 * Corpus ingestion CLI. Run locally; writes to the remote Supabase project.
 *
 *   pnpm ingest --source github:yangshun/tech-interview-handbook
 *   pnpm ingest --dir ./my-notes --name "ai-devs-4" --license proprietary-personal
 *   pnpm ingest --source github:org/repo --dry-run     # parse only, no embedding spend
 *
 * Idempotent: re-ingesting updates in place on (source.name), (source_id, path) and
 * (document_id, heading_path, part).
 *
 * Sections that disappear from a source are deliberately NOT deleted. Card provenance
 * references section ids, so deleting a section would dangle citations on cards that
 * were built from it. Stale rows are reported instead, to be pruned by hand once a
 * provenance-aware cleanup exists.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { db } from '../src/lib/db';
import { embedMany, toVectorLiteral } from '../src/lib/embeddings';
import { documentTitle, normalizeSections, parseMarkdownSections, type Section } from '../src/lib/markdown';

const EMBED_BATCH = 96;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.github', 'dist', 'build', '.next']);

/**
 * Repository boilerplate. These files are pure noise in an interview corpus — a
 * semanticSearch for "code review process" should not surface a CONTRIBUTING guide —
 * and they embed at real cost. Override with --include-meta.
 */
const SKIP_FILES = [
  /^code_of_conduct\.mdx?$/i,
  /^contributing\.mdx?$/i,
  /^license\.mdx?$/i,
  /^changelog\.mdx?$/i,
  /^security\.mdx?$/i,
  /^agents\.mdx?$/i,
  /^claude\.mdx?$/i,
  /^pull_request_template\.mdx?$/i,
  /^issue_template\.mdx?$/i,
];

type Args = {
  source?: string;
  dir?: string;
  name?: string;
  license: string;
  dryRun: boolean;
  includeMeta: boolean;
  limit?: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { license: 'mit', dryRun: false, includeMeta: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${flag} requires a value`);
      return v;
    };
    switch (flag) {
      case '--source': args.source = value(); break;
      case '--dir': args.dir = value(); break;
      case '--name': args.name = value(); break;
      case '--license': args.license = value(); break;
      case '--limit': args.limit = Number(value()); break;
      case '--dry-run': args.dryRun = true; break;
      case '--include-meta': args.includeMeta = true; break;
      default: throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!args.source && !args.dir) {
    throw new Error('Provide --source github:<org>/<repo> or --dir <path>');
  }
  if (args.dir && !args.name) {
    throw new Error('--dir requires --name to identify the source');
  }
  return args;
}

function listMarkdown(root: string, includeMeta: boolean): { files: string[]; skipped: string[] } {
  const files: string[] = [];
  const skipped: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
      } else if (/\.mdx?$/i.test(entry.name)) {
        const full = join(dir, entry.name);
        if (!includeMeta && SKIP_FILES.some((re) => re.test(entry.name))) {
          skipped.push(full);
        } else {
          files.push(full);
        }
      }
    }
  };
  walk(root);
  // Stable order so `ord` is reproducible between runs.
  return { files: files.sort(), skipped: skipped.sort() };
}

function cloneRepo(spec: string): { root: string; url: string; cleanup: () => void } {
  const repo = spec.slice('github:'.length);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new Error(`Expected --source github:<org>/<repo>, got "${spec}"`);
  }
  const url = `https://github.com/${repo}.git`;
  const root = mkdtempSync(join(tmpdir(), 'deep-prep-ingest-'));
  console.log(`Cloning ${url} (shallow)...`);
  execFileSync('git', ['clone', '--depth', '1', '--quiet', url, root], { stdio: 'inherit' });
  return { root, url, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let root: string;
  let url: string | null = null;
  let name: string;
  let kind: string;
  let cleanup = () => {};

  if (args.source) {
    const cloned = cloneRepo(args.source);
    root = cloned.root;
    url = cloned.url;
    cleanup = cloned.cleanup;
    name = args.name ?? args.source.slice('github:'.length).split('/')[1];
    kind = 'github_repo';
  } else {
    root = args.dir!;
    if (!statSync(root).isDirectory()) throw new Error(`${root} is not a directory`);
    name = args.name!;
    kind = 'own_notes';
  }

  try {
    const listed = listMarkdown(root, args.includeMeta);
    let files = listed.files;
    if (args.limit) files = files.slice(0, args.limit);
    console.log(`Found ${files.length} markdown file(s) under ${root}`);
    if (listed.skipped.length > 0) {
      const names = listed.skipped.map((f) => relative(root, f).split(sep).join('/'));
      console.log(`Skipped ${names.length} boilerplate file(s): ${names.join(', ')} (use --include-meta to keep)`);
    }

    // ---- parse ----
    type Parsed = { path: string; title: string; sections: Section[] };
    const parsed: Parsed[] = [];
    for (const file of files) {
      const markdown = readFileSync(file, 'utf8');
      const path = relative(root, file).split(sep).join('/');
      const sections = normalizeSections(parseMarkdownSections(markdown));
      if (sections.length > 0) {
        parsed.push({ path, title: documentTitle(markdown, path), sections });
      }
    }

    const totalSections = parsed.reduce((n, d) => n + d.sections.length, 0);
    const totalChars = parsed.reduce(
      (n, d) => n + d.sections.reduce((m, s) => m + s.content.length, 0),
      0,
    );
    const approxTokens = Math.ceil(totalChars / 4);
    // text-embedding-3-small list price, for a sanity check before spending.
    const estCost = (approxTokens / 1_000_000) * 0.02;

    console.log(
      `Parsed ${parsed.length} document(s), ${totalSections} section(s), ~${approxTokens.toLocaleString()} tokens ` +
        `(embedding ≈ $${estCost.toFixed(4)})`,
    );

    if (args.dryRun) {
      console.log('\n--dry-run: nothing embedded or written. Sample:');
      for (const doc of parsed.slice(0, 3)) {
        console.log(`\n  ${doc.path} — "${doc.title}" (${doc.sections.length} sections)`);
        for (const s of doc.sections.slice(0, 3)) {
          console.log(`    [${s.ord}.${s.part}] ${s.headingPath.join(' › ') || '(root)'} — ${s.content.length} chars`);
        }
      }
      return;
    }

    // ---- source ----
    const supabase = db();
    const { data: source, error: sourceError } = await supabase
      .from('sources')
      .upsert({ name, kind, url, license: args.license }, { onConflict: 'name' })
      .select('id')
      .single();
    if (sourceError) throw new Error(`source upsert failed: ${sourceError.message}`);
    console.log(`Source "${name}" -> ${source.id}`);

    // ---- documents + sections ----
    let written = 0;
    for (const [index, doc] of parsed.entries()) {
      const { data: document, error: docError } = await supabase
        .from('documents')
        .upsert(
          { source_id: source.id, path: doc.path, title: doc.title, ord: index },
          { onConflict: 'source_id,path' },
        )
        .select('id')
        .single();
      if (docError) throw new Error(`document upsert failed (${doc.path}): ${docError.message}`);

      for (let i = 0; i < doc.sections.length; i += EMBED_BATCH) {
        const batch = doc.sections.slice(i, i + EMBED_BATCH);
        const vectors = await embedMany(batch.map((s) => s.content));

        const rows = batch.map((s, j) => ({
          document_id: document.id,
          heading_path: s.headingPath,
          part: s.part,
          content: s.content,
          ord: s.ord,
          embedding: toVectorLiteral(vectors[j]),
        }));

        const { error: sectionError } = await supabase
          .from('sections')
          .upsert(rows, { onConflict: 'document_id,heading_path,part' });
        if (sectionError) throw new Error(`section upsert failed (${doc.path}): ${sectionError.message}`);

        written += rows.length;
      }

      process.stdout.write(`\r  ${index + 1}/${parsed.length} documents, ${written}/${totalSections} sections`);
    }
    console.log('\nDone.');

    // ---- stale check ----
    const { data: docIds } = await supabase.from('documents').select('id').eq('source_id', source.id);
    if (docIds) {
      const { count: liveCount } = await supabase
        .from('sections')
        .select('id', { count: 'exact', head: true })
        .in('document_id', docIds.map((d) => d.id));
      if (liveCount != null && liveCount > totalSections) {
        console.warn(
          `\nNote: ${liveCount - totalSections} section(s) in this source no longer appear in the input. ` +
            'They were left in place because card provenance may cite them.',
        );
      }
    }
  } finally {
    cleanup();
  }
}

main().catch((error) => {
  console.error(`\ningest failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
