/**
 * Smoke check for src/lib/markdown.ts — run with `pnpm verify:markdown`.
 *
 * Focuses on the cases that silently corrupt a corpus: headings inside code fences,
 * skipped heading levels, and the merge/split band.
 */
import {
  estimateTokens,
  MAX_TOKENS,
  normalizeSections,
  parseMarkdownSections,
  documentTitle,
} from '../src/lib/markdown';

let failures = 0;
function check(label: string, condition: boolean, detail = '') {
  if (!condition) failures++;
  console.log(`${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('\n== headings inside code fences are not headings ==');
const fenced = `# React

Intro text.

\`\`\`bash
# install deps
npm install
### not a heading
\`\`\`

## Hooks

Hook content.
`;
const fencedSections = parseMarkdownSections(fenced);
console.log(`  paths: ${fencedSections.map((s) => s.headingPath.join('>')).join(' | ')}`);
check('exactly 2 sections', fencedSections.length === 2, `got ${fencedSections.length}`);
check('code comment did not become a section', !fencedSections.some((s) => s.headingPath.join().includes('install deps')));
check('fenced content stays with its section', fencedSections[0].content.includes('npm install'));
check('nested path built', fencedSections[1].headingPath.join('>') === 'React>Hooks', fencedSections[1].headingPath.join('>'));

console.log('\n== skipped heading levels ==');
const skipped = parseMarkdownSections(`# A

body a

### C

body c
`);
console.log(`  paths: ${skipped.map((s) => s.headingPath.join('>')).join(' | ')}`);
check('h1 -> h3 does not crash or leave gaps', skipped[1].headingPath.join('>') === 'A>C', skipped[1].headingPath.join('>'));

console.log('\n== tiny sections merge, heading preserved in body ==');
const tiny = normalizeSections(parseMarkdownSections(`# Title

Short intro.

## Sub

Also short.
`));
check('merged into one section', tiny.length === 1, `got ${tiny.length}`);
check('merged body keeps the sub heading', tiny[0].content.includes('## Sub') || tiny[0].content.includes('# Sub'));
check('merged body keeps both texts', tiny[0].content.includes('Short intro') && tiny[0].content.includes('Also short'));

console.log('\n== oversized sections split at paragraph boundaries ==');
const para = 'word '.repeat(200); // ~250 tokens per paragraph
const big = normalizeSections(parseMarkdownSections(`# Big\n\n${[para, para, para, para, para].join('\n\n')}`));
console.log(`  parts: ${big.length}, tokens: [${big.map((s) => estimateTokens(s.content)).join(', ')}]`);
check('split into multiple parts', big.length > 1, `got ${big.length}`);
check('parts numbered from 0', big[0].part === 0 && big[1].part === 1);
check('every part under ceiling', big.every((s) => estimateTokens(s.content) <= MAX_TOKENS));
check('all parts share heading path', big.every((s) => s.headingPath.join('>') === 'Big'));

console.log('\n== single huge paragraph is left intact, not cut ==');
const huge = normalizeSections(parseMarkdownSections(`# Code\n\n${'x'.repeat(MAX_TOKENS * 8)}`));
check('kept as one piece', huge.length === 1, `got ${huge.length}`);

console.log('\n== ord is unique and sequential ==');
const ords = big.map((s) => s.ord);
check('ord sequential from 0', ords.every((o, i) => o === i), `[${ords.join(',')}]`);

console.log('\n== document title ==');
check('uses first h1', documentTitle('# Real Title\n\n## Other', 'x/react.md') === 'Real Title');
check('falls back to filename', documentTitle('no headings here', 'notes/react-hooks.md') === 'react-hooks');

console.log(failures === 0 ? '\nAll markdown checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
