/**
 * Heading-based markdown sectioning.
 *
 * A section is the retrieval unit for RAG, the reading unit for browse (Layer 4), and
 * the provenance unit — one table, three roles (CLAUDE.md §7). That is why sections
 * follow headings rather than a fixed chunk size: chunk boundaries would cut lists and
 * code mid-thought and make citations meaningless.
 *
 * Pure functions only — no IO — so scripts/verify-markdown.ts can exercise them.
 */

/** Target band per section, in approximate tokens. */
export const MIN_TOKENS = 200;
export const MAX_TOKENS = 800;

/**
 * Rough token estimate at ~4 characters per token.
 *
 * A real tokenizer would be exact but adds a dependency for no benefit: the targets
 * are a soft band, not a hard limit, and the only consequence of being off by 15% is a
 * slightly larger or smaller section.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export type RawSection = {
  headingPath: string[];
  content: string;
};

export type Section = RawSection & {
  /** Index within a heading whose body had to be split. Stable across re-ingest. */
  part: number;
  ord: number;
};

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;

/**
 * Remove YAML frontmatter.
 *
 * Docusaurus-style docs (tech-interview-handbook among them) open with an `---` block
 * of id/title/description metadata. Left in place it becomes the opening text of the
 * first section and gets embedded, so retrieval matches on metadata keys rather than
 * substance — observed live: a "dynamic programming" query returned a section whose
 * body began "--- id: dynamic-programming title: ...".
 */
export function stripFrontmatter(markdown: string): string {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  return match ? markdown.slice(match[0].length) : markdown;
}

/**
 * Remove non-prose markup that markdown files carry for the sake of the site that
 * renders them.
 *
 * Docusaurus pages follow their frontmatter with a `<head>` block of social/meta tags.
 * Embedded, it outranks real content: before this, "negotiating a software engineering
 * job offer" returned an og:image meta block at 0.561 as its TOP hit, ahead of the
 * actual negotiation guidance. Import statements and HTML comments are stripped for
 * the same reason — they carry no answerable content but do carry keywords.
 */
export function stripMarkup(markdown: string): string {
  // Applied only outside fenced code, so an HTML question that *demonstrates* <head>
  // in a code sample keeps its example intact. Stripping the whole document would
  // silently gut exactly the content this corpus exists to teach.
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let buffer: string[] = [];
  let fence: string | null = null;

  const flushProse = () => {
    if (buffer.length > 0) {
      out.push(stripProseMarkup(buffer.join('\n')));
      buffer = [];
    }
  };

  for (const line of lines) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) {
        flushProse();
        fence = marker[0].repeat(3);
      } else if (marker.startsWith(fence)) {
        fence = null;
      }
      out.push(line);
      continue;
    }

    if (fence === null) buffer.push(line);
    else out.push(line);
  }

  flushProse();
  return out.join('\n');
}

function stripProseMarkup(text: string): string {
  return text
    .replace(/<head>[\s\S]*?<\/head>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // MDX component imports, e.g. `import TOCInline from '@theme/TOCInline';`
    .replace(/^import\s+.+\s+from\s+['"].+['"];?\s*$/gm, '');
}

/**
 * Split a document into raw sections, one per heading.
 *
 * Fenced code blocks are tracked so that a `# comment` inside a shell example is not
 * mistaken for a heading — a real hazard in interview-question repos, which are full
 * of bash and python snippets.
 */
export function parseMarkdownSections(markdown: string): RawSection[] {
  const lines = stripMarkup(stripFrontmatter(markdown)).split(/\r?\n/);
  const sections: RawSection[] = [];

  const stack: string[] = [];
  let buffer: string[] = [];
  let currentPath: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    const content = buffer.join('\n').trim();
    if (content.length > 0) {
      sections.push({ headingPath: [...currentPath], content });
    }
    buffer = [];
  };

  for (const line of lines) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) {
        fence = marker[0].repeat(3);
      } else if (marker.startsWith(fence)) {
        fence = null;
      }
      buffer.push(line);
      continue;
    }

    if (fence === null) {
      const heading = HEADING.exec(line);
      if (heading) {
        flush();
        const depth = heading[1].length;
        const title = heading[2].trim();
        // Headings can skip levels (h1 -> h3); truncating to depth-1 keeps the stack
        // consistent regardless.
        stack.length = Math.min(stack.length, depth - 1);
        stack[depth - 1] = title;
        for (let i = 0; i < depth; i++) stack[i] ??= '';
        currentPath = stack.slice(0, depth).filter((s) => s.length > 0);
        continue;
      }
    }

    buffer.push(line);
  }

  flush();
  return sections;
}

/**
 * Bring raw sections into the target token band.
 *
 * Oversized sections split at paragraph boundaries; undersized ones merge forward into
 * the previous section, carrying their heading into the body so no structure is lost.
 * A heading with no body of its own disappears here, which is correct: it already
 * survives inside its children's headingPath.
 */
export function normalizeSections(raw: RawSection[]): Section[] {
  const merged: RawSection[] = [];

  for (const section of raw) {
    const previous = merged[merged.length - 1];
    const tooSmall = estimateTokens(section.content) < MIN_TOKENS;

    if (tooSmall && previous && estimateTokens(previous.content) < MAX_TOKENS) {
      const heading = section.headingPath[section.headingPath.length - 1];
      const depth = Math.min(section.headingPath.length, 6);
      previous.content += heading
        ? `\n\n${'#'.repeat(depth)} ${heading}\n\n${section.content}`
        : `\n\n${section.content}`;
      continue;
    }

    merged.push({ ...section });
  }

  const out: Section[] = [];
  let ord = 0;

  for (const section of merged) {
    for (const [part, content] of splitToBand(section.content).entries()) {
      out.push({ headingPath: section.headingPath, content, part, ord: ord++ });
    }
  }

  return out;
}

/**
 * Split text into pieces under the ceiling, breaking at blank lines. A single
 * paragraph longer than the ceiling (a big code block, typically) is left whole rather
 * than cut mid-snippet — an oversized but coherent section beats a broken one.
 */
function splitToBand(content: string): string[] {
  if (estimateTokens(content) <= MAX_TOKENS) return [content];

  const paragraphs = content.split(/\n{2,}/);
  const pieces: string[] = [];
  let current: string[] = [];

  for (const paragraph of paragraphs) {
    const candidate = [...current, paragraph].join('\n\n');
    if (current.length > 0 && estimateTokens(candidate) > MAX_TOKENS) {
      pieces.push(current.join('\n\n'));
      current = [paragraph];
    } else {
      current.push(paragraph);
    }
  }

  if (current.length > 0) pieces.push(current.join('\n\n'));
  return pieces.filter((p) => p.trim().length > 0);
}

/**
 * Title for a document: frontmatter `title:` if present, else the first h1, else the
 * filename.
 *
 * Frontmatter comes first because the files that have it are usually the ones whose
 * filenames are useless — exported course articles named
 * "s01e01-programowanie-interakcji-z-modelem-jezykowym-1773230257" carry a clean
 * "S01E01 — Programowanie interakcji z modelem językowym" in their metadata. The title
 * ends up in every provenance label, so it is worth reading properly.
 */
export function documentTitle(markdown: string, path: string): string {
  const frontmatter = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (frontmatter) {
    const title = /^title:\s*(.+?)\s*$/m.exec(frontmatter[1]);
    if (title) return title[1].replace(/^['"]|['"]$/g, '').trim();
  }

  for (const line of stripFrontmatter(markdown).split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading && heading[1].length === 1) return heading[2].trim();
  }

  return path.replace(/\.mdx?$/, '').split('/').pop() ?? path;
}
