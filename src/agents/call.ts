import 'server-only';

import { propagateAttributes } from '@langfuse/tracing';
import { generateText, Output } from 'ai';
import type { z } from 'zod';

import { costOf, MODELS, type AgentRole } from '@/lib/models';
import { modelFor } from '@/lib/openrouter';

/**
 * The single path every LLM call in the pipeline takes.
 *
 * Responsibilities (CLAUDE.md §6): telemetry metadata, schema-validated output, one
 * repair attempt on validation failure, and token accounting the orchestrator bills
 * against the run budget. Agents contain prompts and domain logic — never retry loops
 * or cost maths.
 */

export type CallMeta = {
  runId?: string;
  topicSlug?: string;
};

export type CallResult<T> = {
  value: T;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export class AgentCallError extends Error {
  constructor(
    readonly role: AgentRole,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AgentCallError';
  }
}

export async function callAgent<S extends z.ZodType>({
  role,
  schema,
  system,
  prompt,
  imageUrl,
  meta = {},
}: {
  role: AgentRole;
  schema: S;
  system: string;
  prompt: string;
  /** Attach an image (e.g. an offer screenshot) — requires a vision-capable model. */
  imageUrl?: string;
  meta?: CallMeta;
}): Promise<CallResult<z.infer<S>>> {
  const model = MODELS[role];

  // Accumulated across the repair attempt: a failed call still consumed tokens, and
  // hiding that would let a run exceed its budget without the guard noticing.
  let inputTokens = 0;
  let outputTokens = 0;

  const attempt = async (userPrompt: string) => {
    // AI SDK 7 dropped `metadata` from telemetry options, so trace-level dimensions go
    // through Langfuse's context propagation instead. sessionId = runId groups every
    // agent call of a pipeline run under one session in the UI.
    const result = await propagateAttributes(
      {
        traceName: `deep-prep:${role}`,
        ...(meta.runId ? { sessionId: meta.runId } : {}),
        tags: ['deep-prep', role],
        metadata: {
          agent: role,
          model,
          ...(meta.topicSlug ? { topicSlug: meta.topicSlug } : {}),
        },
      },
      () =>
        generateText({
          model: modelFor(role),
          system,
          ...(imageUrl
            ? {
                messages: [
                  {
                    role: 'user' as const,
                    content: [
                      { type: 'text' as const, text: userPrompt },
                      { type: 'image' as const, image: new URL(imageUrl) },
                    ],
                  },
                ],
              }
            : { prompt: userPrompt }),
          output: Output.object({ schema }),
          telemetry: { functionId: `agent:${role}` },
        }),
    );

    inputTokens += result.usage.inputTokens ?? 0;
    outputTokens += result.usage.outputTokens ?? 0;

    return result.output as z.infer<S>;
  };

  try {
    const value = await attempt(prompt);
    return { value, inputTokens, outputTokens, costUsd: costOf(model, inputTokens, outputTokens) };
  } catch (firstError) {
    // Output.object validates against the schema and throws on a mismatch. Feed the
    // failure back once — models usually correct a named structural error — then give
    // up rather than burning budget on a model that cannot satisfy the contract.
    const detail = firstError instanceof Error ? firstError.message : String(firstError);

    try {
      const value = await attempt(
        `${prompt}\n\n--- PREVIOUS ATTEMPT REJECTED ---\nYour last response did not satisfy the required schema:\n${detail}\n\nReturn a corrected response. Change only what the error requires.`,
      );
      return { value, inputTokens, outputTokens, costUsd: costOf(model, inputTokens, outputTokens) };
    } catch (secondError) {
      throw new AgentCallError(
        role,
        `${role} failed schema validation twice: ${secondError instanceof Error ? secondError.message : String(secondError)}`,
        secondError,
      );
    }
  }
}
