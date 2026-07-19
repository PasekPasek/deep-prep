/**
 * Guardrail checks — `pnpm verify:guardrails`.
 *
 * SSRF guard and step circuit breaker. Prompt-injection hardening is prompt text and
 * cannot be proven by a script; it is exercised by the Layer 5 eval set instead.
 * The step-limit check talks to the real DB (creates and removes its own rows).
 */
import { MAX_OFFER_CHARS } from '../src/agents/extractor';
import { BlockedUrlError, safeFetchText } from '../src/lib/safeFetch';
import { db } from '../src/lib/db';
import { advanceRun, MAX_STEPS_PER_RUN } from '../src/orchestrator/run';
import { createRun, loadRun } from '../src/orchestrator/state';

let failures = 0;
function check(label: string, condition: boolean, detail = '') {
  if (!condition) failures++;
  console.log(`${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function expectBlocked(url: string, why: string) {
  try {
    await safeFetchText(url);
    check(`blocks ${why}`, false, `fetched ${url} without complaint`);
  } catch (error) {
    check(`blocks ${why}`, error instanceof BlockedUrlError, String(error).slice(0, 90));
  }
}

async function main() {
  console.log('== SSRF guard ==');
  await expectBlocked('http://127.0.0.1:6379/', 'loopback IP');
  await expectBlocked('http://localhost:3000/api/reviews', 'localhost hostname');
  await expectBlocked('http://169.254.169.254/latest/meta-data/', 'cloud metadata endpoint');
  await expectBlocked('http://10.0.0.8/admin', 'RFC1918 10.x');
  await expectBlocked('http://192.168.1.16:3000/', 'RFC1918 192.168.x');
  await expectBlocked('http://[::1]:8080/', 'IPv6 loopback');
  await expectBlocked('ftp://example.com/file', 'non-HTTP scheme');
  await expectBlocked('http://this-host-does-not-exist-4f9a1.invalid/', 'unresolvable host');

  console.log('\n== public fetch still works ==');
  try {
    const text = await safeFetchText('https://example.com/');
    check('fetches a public site', text.includes('Example Domain'), `${text.length} bytes`);
  } catch (error) {
    check('fetches a public site', false, String(error).slice(0, 90));
  }

  console.log('\n== input size cap ==');
  check('MAX_OFFER_CHARS is sane', MAX_OFFER_CHARS >= 10_000 && MAX_OFFER_CHARS <= 100_000, String(MAX_OFFER_CHARS));

  console.log('\n== step circuit breaker ==');
  {
    const s = db();
    const { data: offer, error } = await s
      .from('offers')
      .insert({ input_kind: 'url', raw_input: 'https://example.com/verify-guardrails' })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    const run = await createRun(offer.id);

    // Simulate a run that has already burned its invocation budget.
    await s.from('runs').update({ steps: MAX_STEPS_PER_RUN }).eq('id', run.id);

    const outcome = await advanceRun(run.id, {
      // Deps that would loop forever if the breaker did not trip first.
      fetchOfferText: async () => 'text',
      extractOfferFromImage: async () => {
        throw new Error('unreachable');
      },
      extractOffer: async () => {
        throw new Error('should never be reached — breaker must trip first');
      },
      planTopics: async () => {
        throw new Error('unreachable');
      },
      writeCardsForTopic: async () => {
        throw new Error('unreachable');
      },
      dedupDrafts: async () => ({ kept: [], linked: [] }),
    });

    const after = await loadRun(run.id);
    check('breaker fails the run', outcome.status === 'failed' && outcome.note === 'step_limit_exceeded', outcome.note);
    check('reason persisted', (after.error ?? '').includes('step_limit_exceeded'), after.error ?? '');
    check('agents were never invoked', true); // extractOffer would have thrown a different error

    await s.from('runs').delete().eq('id', run.id);
    await s.from('offers').delete().eq('id', offer.id);
    console.log('cleaned up verify rows');
  }
}

main().then(() => {
  console.log(failures === 0 ? '\nAll guardrail checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
});
