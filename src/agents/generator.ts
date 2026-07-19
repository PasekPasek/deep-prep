import 'server-only';

import { callAgent, type CallMeta } from './call';
import { clampEstimatedCards, Plan, type ExtractedOffer } from './contracts';
import { PLANNER_SYSTEM, plannerPrompt } from './prompts/generator';

/**
 * Planner: requirements → topic tree.
 *
 * Historically this module also held Layer 1's single research+write agent; that
 * path now lives in researcher.ts and writer.ts (Layer 4 split). The Planner stayed
 * because its signature never changed — it was always its own call.
 */

export async function planTopics(offer: ExtractedOffer, meta: CallMeta = {}) {
  const result = await callAgent({
    role: 'planner',
    schema: Plan,
    system: PLANNER_SYSTEM,
    prompt: plannerPrompt(offer),
    meta,
  });

  // The card-count bound cannot be expressed in the schema (see contracts.ts), so it
  // is enforced here instead.
  return {
    ...result,
    value: {
      topics: result.value.topics.map((topic) => ({
        ...topic,
        estimatedCards: clampEstimatedCards(topic.estimatedCards),
      })),
    },
  };
}
