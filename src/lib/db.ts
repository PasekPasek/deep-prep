import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from './database.types';

/**
 * Server-side Supabase client using the service-role key.
 *
 * Every table has RLS enabled with no policies, so anon/authenticated callers see
 * nothing at all (verified against the live project). The service-role key bypasses
 * RLS, which is why this module is `server-only`: importing it from a client
 * component is a build error rather than a leaked key.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.local.example to .env.local and fill it in.`,
    );
  }
  return value;
}

let client: SupabaseClient<Database> | undefined;

export function db(): SupabaseClient<Database> {
  if (!client) {
    client = createClient<Database>(
      requireEnv('SUPABASE_URL'),
      requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: {
          // No user sessions on this client — it is a trusted server actor.
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  }
  return client;
}
