import 'server-only';

import { callAgent, type CallMeta } from './call';
import { CriticVerdict, type DraftCard } from './contracts';
import { CRITIC_SYSTEM, criticPrompt } from './prompts/critic';
import { db } from '@/lib/db';
import { embedMany, toVectorLiteral } from '@/lib/embeddings';

/**
 * Critic, Layer 2 shape: deterministic dedup only. The LLM rubric check and the
 * revision loop arrive with the full multi-agent split in Layer 4.
 *
 * Dedup is code, not an LLM call (CLAUDE.md §5): embed each draft, cosine-match
 * against the saved pool, and above the threshold the draft is NOT rejected into a
 * void — the existing card is linked to this offer instead. The user studies the same
 * material either way; the pool just stops accumulating near-copies.
 *
 * The embedded text is `${front}\n\n${back}` — exactly what the approve route embeds
 * when saving. Same text, same vector space, or the comparison is meaningless.
 */

/**
 * Cosine similarity above which a draft is considered a duplicate of a saved card.
 * From the spec (§5). Not yet calibrated against real data — revisit once the pool
 * is big enough to measure false-positive rate (Layer 5 material).
 */
export const DUPLICATE_THRESHOLD = 0.9;

export type DedupLink = {
  front: string;
  existingCardId: string;
  existingFront: string;
  similarity: number;
};

export type DedupResult = {
  kept: DraftCard[];
  linked: DedupLink[];
};

/** IO seams, injectable so the decision logic is testable without network or DB. */
export type DedupIo = {
  embedAll: (texts: string[]) => Promise<number[][]>;
  nearestCard: (
    embedding: number[],
  ) => Promise<{ cardId: string; front: string; similarity: number } | null>;
  linkCardToOffer: (cardId: string, offerId: string) => Promise<void>;
};

const defaultIo: DedupIo = {
  embedAll: embedMany,
  async nearestCard(embedding) {
    const { data, error } = await db().rpc('match_cards', {
      query_embedding: toVectorLiteral(embedding),
      match_count: 1,
    });
    if (error) throw new Error(`match_cards failed: ${error.message}`);
    const top = data?.[0];
    return top ? { cardId: top.card_id, front: top.front, similarity: top.similarity } : null;
  },
  async linkCardToOffer(cardId, offerId) {
    // Upsert: the offer may already link this card from a previous run.
    const { error } = await db()
      .from('card_offers')
      .upsert({ card_id: cardId, offer_id: offerId }, { onConflict: 'card_id,offer_id' });
    if (error) throw new Error(`linking duplicate failed: ${error.message}`);
  },
};

export async function dedupDrafts(
  drafts: DraftCard[],
  offerId: string,
  io: DedupIo = defaultIo,
): Promise<DedupResult> {
  if (drafts.length === 0) return { kept: [], linked: [] };

  const embeddings = await io.embedAll(drafts.map((d) => `${d.front}\n\n${d.back}`));

  const kept: DraftCard[] = [];
  const linked: DedupLink[] = [];

  for (const [i, draft] of drafts.entries()) {
    const nearest = await io.nearestCard(embeddings[i]);

    if (nearest && nearest.similarity > DUPLICATE_THRESHOLD) {
      await io.linkCardToOffer(nearest.cardId, offerId);
      linked.push({
        front: draft.front,
        existingCardId: nearest.cardId,
        existingFront: nearest.front,
        similarity: nearest.similarity,
      });
    } else {
      kept.push(draft);
    }
  }

  return { kept, linked };
}

/**
 * LLM rubric check (Layer 4). Runs AFTER code dedup, on the kept drafts only.
 *
 * The verdict maps rejected indices back to full cards; out-of-range or
 * contradictory indices from the model are discarded — a card is rejected only if
 * the verdict names it coherently. Defaults to acceptance: the rubric is a defect
 * net in front of a human reviewer, not a gatekeeper with taste.
 */
export type RubricResult = {
  accepted: DraftCard[];
  rejected: { card: DraftCard; reason: string; note: string }[];
  costUsd: number;
};

export async function rubricCheck(drafts: DraftCard[], meta: CallMeta = {}): Promise<RubricResult> {
  if (drafts.length === 0) return { accepted: [], rejected: [], costUsd: 0 };

  const result = await callAgent({
    role: 'critic',
    schema: CriticVerdict,
    system: CRITIC_SYSTEM,
    prompt: criticPrompt(drafts),
    meta,
  });

  const rejectedByIndex = new Map<number, { reason: string; note: string }>();
  for (const r of result.value.rejected) {
    const index = Math.round(r.index);
    if (index >= 0 && index < drafts.length && !rejectedByIndex.has(index)) {
      rejectedByIndex.set(index, { reason: r.reason, note: r.note });
    }
  }

  const accepted: DraftCard[] = [];
  const rejected: RubricResult['rejected'] = [];
  for (const [i, card] of drafts.entries()) {
    const rejection = rejectedByIndex.get(i);
    if (rejection) rejected.push({ card, ...rejection });
    else accepted.push(card);
  }

  return { accepted, rejected, costUsd: result.costUsd };
}
