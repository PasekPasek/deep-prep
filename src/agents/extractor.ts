import 'server-only';

import { safeFetchText } from '@/lib/safeFetch';

import { callAgent, type CallMeta, type CallResult } from './call';
import { ExtractedOffer } from './contracts';
import { EXTRACTOR_SYSTEM, extractorPrompt } from './prompts/extractor';

/**
 * Job offer -> ExtractedOffer.
 *
 * Layer 1 handles URLs only; the vision path for screenshots arrives in Layer 2 and
 * will reuse this system prompt with an image part instead of `offerText`.
 */

export async function extractOffer(
  offerText: string,
  meta: CallMeta = {},
): Promise<CallResult<ExtractedOffer>> {
  if (offerText.trim().length === 0) {
    throw new Error('Cannot extract from empty offer text');
  }

  return callAgent({
    role: 'extractor',
    schema: ExtractedOffer,
    system: EXTRACTOR_SYSTEM,
    prompt: extractorPrompt(offerText),
    meta,
  });
}

/**
 * Cap on the text handed to the model. A real job ad fits comfortably; anything
 * longer is page chrome the parser failed to strip — or padding aimed at the
 * context window. Truncation keeps the head, where offers put the requirements.
 */
export const MAX_OFFER_CHARS = 40_000;

/**
 * Fetch a job offer URL and reduce it to readable text.
 *
 * Deliberately dependency-free: job boards render heavily but the offer body is plain
 * prose, and a full headless browser is disproportionate here. Scripts and styles are
 * stripped before tags so their contents never reach the model. The fetch itself goes
 * through the SSRF guard — the URL is user input pointed at our own server.
 */
export async function fetchOfferText(url: string): Promise<string> {
  const html = await safeFetchText(url, {
    headers: {
      // Some boards return a stub page to unrecognised clients.
      'User-Agent': 'Mozilla/5.0 (compatible; DeepPrep/1.0; +https://github.com/PasekPasek/deep-prep)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  const text = htmlToText(html);
  return text.length > MAX_OFFER_CHARS ? `${text.slice(0, MAX_OFFER_CHARS)}\n[truncated]` : text;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    // Block-level tags become newlines so list items and paragraphs stay separated;
    // without this the whole offer collapses into one unreadable line.
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}
