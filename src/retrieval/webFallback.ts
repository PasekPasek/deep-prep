import 'server-only';

import type { PlanTopic, Provenance } from '@/agents/contracts';

/**
 * Layer 3: the external cascade, used only when the corpus runs thin (§7.3).
 *
 * Order is deliberate: Context7 first for library/API topics (authoritative docs),
 * Tavily for concepts, Stack Overflow for practitioner pitfalls. Every result
 * carries URL provenance, and the whole cascade is capped at
 * MAX_EXTERNAL_CALLS_PER_TOPIC — external search is a fallback, not a firehose.
 *
 * Context7 requires CONTEXT7_API_KEY and is skipped gracefully without one; the
 * cascade still works on Tavily + Stack Overflow alone.
 */

export const MAX_EXTERNAL_CALLS_PER_TOPIC = 6;
const RESULTS_PER_CALL = 4;
const SNIPPET_CHARS = 1600;

export type ExternalSource = {
  kind: 'context7' | 'web' | 'stackoverflow';
  url: string;
  title: string;
  content: string;
};

/** IO seam for tests: each engine is a function returning sources or throwing. */
export type CascadeEngines = {
  context7: (query: string) => Promise<ExternalSource[]>;
  tavily: (query: string) => Promise<ExternalSource[]>;
  stackoverflow: (query: string) => Promise<ExternalSource[]>;
};

async function context7Search(query: string): Promise<ExternalSource[]> {
  const key = process.env.CONTEXT7_API_KEY;
  if (!key) return []; // no key — engine contributes nothing, cascade moves on
  const response = await fetch(
    `https://context7.com/api/v1/search?query=${encodeURIComponent(query)}`,
    { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new Error(`context7 HTTP ${response.status}`);
  const data = (await response.json()) as { results?: { id: string; title: string; description?: string }[] };
  return (data.results ?? []).slice(0, RESULTS_PER_CALL).map((r) => ({
    kind: 'context7' as const,
    url: `https://context7.com${r.id}`,
    title: r.title,
    content: (r.description ?? '').slice(0, SNIPPET_CHARS),
  }));
}

async function tavilySearch(query: string): Promise<ExternalSource[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error('TAVILY_API_KEY not set');
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: RESULTS_PER_CALL, search_depth: 'basic' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`tavily HTTP ${response.status}`);
  const data = (await response.json()) as {
    results?: { url: string; title: string; content: string }[];
  };
  return (data.results ?? []).map((r) => ({
    kind: 'web' as const,
    url: r.url,
    title: r.title,
    content: r.content.slice(0, SNIPPET_CHARS),
  }));
}

async function stackOverflowSearch(query: string): Promise<ExternalSource[]> {
  const params = new URLSearchParams({
    order: 'desc',
    sort: 'relevance',
    q: query,
    site: 'stackoverflow',
    filter: 'withbody',
    pagesize: String(RESULTS_PER_CALL),
  });
  const response = await fetch(`https://api.stackexchange.com/2.3/search/advanced?${params}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`stackexchange HTTP ${response.status}`);
  const data = (await response.json()) as {
    items?: { title: string; link: string; body?: string; is_answered: boolean; score: number }[];
  };
  return (data.items ?? [])
    .filter((item) => item.is_answered && item.score > 0)
    .map((item) => ({
      kind: 'stackoverflow' as const,
      url: item.link,
      title: item.title,
      content: stripHtml(item.body ?? '').slice(0, SNIPPET_CHARS),
    }));
}

function stripHtml(html: string): string {
  return html
    .replace(/<pre><code>/g, '\n```\n')
    .replace(/<\/code><\/pre>/g, '\n```\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .trim();
}

const defaultEngines: CascadeEngines = {
  context7: context7Search,
  tavily: tavilySearch,
  stackoverflow: stackOverflowSearch,
};

/**
 * Run the cascade for a topic. Each engine failure is logged and skipped — a search
 * outage must degrade coverage, never kill the run. Returns deduplicated-by-URL
 * sources and the number of calls actually spent.
 */
export async function webFallback(
  topic: PlanTopic,
  engines: CascadeEngines = defaultEngines,
): Promise<{ sources: ExternalSource[]; callsUsed: number }> {
  const query = `${topic.name}: ${topic.concepts.slice(0, 4).join(', ')}`;
  const order: (keyof CascadeEngines)[] = ['context7', 'tavily', 'stackoverflow'];

  const seen = new Set<string>();
  const sources: ExternalSource[] = [];
  let callsUsed = 0;

  for (const engine of order) {
    if (callsUsed >= MAX_EXTERNAL_CALLS_PER_TOPIC) break;
    // An engine that cannot run (no API key) must not consume budget.
    if (engine === 'context7' && !process.env.CONTEXT7_API_KEY) continue;
    callsUsed++;
    try {
      for (const source of await engines[engine](query)) {
        if (!seen.has(source.url)) {
          seen.add(source.url);
          sources.push(source);
        }
      }
    } catch (error) {
      console.warn(`[webFallback] ${engine} failed for "${topic.slug}":`, error);
    }
  }

  return { sources, callsUsed };
}

/** Prompt rendering: citation header + snippet, ref is the URL. */
export function renderExternalForPrompt(sources: ExternalSource[]): string {
  return sources
    .map((s, i) => `[ext ${i + 1}] ${s.title} (${s.kind}) (url:${s.url})\n${s.content}`)
    .join('\n\n---\n\n');
}

export function externalToProvenance(source: ExternalSource): Provenance {
  return { kind: source.kind, ref: source.url, label: source.title };
}
