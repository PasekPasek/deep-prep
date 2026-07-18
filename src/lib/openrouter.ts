import 'server-only';

import { createOpenRouter } from '@openrouter/ai-sdk-provider';

import { MODELS, type AgentRole } from './models';

let provider: ReturnType<typeof createOpenRouter> | undefined;

function openrouter() {
  if (!provider) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('Missing OPENROUTER_API_KEY. Copy .env.local.example to .env.local.');
    }
    provider = createOpenRouter({
      apiKey,
      // Surfaces the app in OpenRouter's dashboard so per-app spend is attributable.
      appName: 'DeepPrep',
    });
  }
  return provider;
}

/** Resolve an agent role to a model instance. Agents never name a model directly. */
export function modelFor(role: AgentRole) {
  return openrouter()(MODELS[role]);
}
