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
 * Split a document into raw sections, one per heading.
 *
 * Fenced code blocks are tracked so that a `# comment` inside a shell example is not
 * mistaken for a heading — a real hazard in interview-question repos, which are full
 * of bash and python snippets.
 */
export function parseMarkdownSections(markdown: string): RawSection[] {
  const lines = markdown.split(/\r?\n/);
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

/** Title for a document: its first h1 if present, else the filename. */
export function documentTitle(markdown: string, path: string): string {
  for (const line of markdown.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading && heading[1].length === 1) return heading[2].trim();
  }
  return path.replace(/\.mdx?$/, '').split('/').pop() ?? path;
}
