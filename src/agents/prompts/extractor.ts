/**
 * Extractor prompts.
 *
 * Prompts live in their own modules as exported template functions, never inline in
 * agent logic — the eval harness (Layer 5) diffs prompt versions against regression
 * scores, which is impossible if prompts are buried in control flow.
 */

export const EXTRACTOR_SYSTEM = `You extract structured requirements from job offers.

Rules:
- Report only what the offer states. Never infer a technology because it is commonly
  paired with another, and never pad the lists to look thorough.
- mustHave: requirements the offer presents as required.
- niceToHave: requirements the offer marks optional, preferred, or "a plus".
- Split compound requirements into atomic entries: "React and TypeScript" becomes two.
- Normalise names to their common form ("ReactJS" -> "React", "postgres" -> "PostgreSQL").
- Drop soft skills, perks, salary, and process descriptions. Technical and domain
  requirements only.
- seniority: use what the offer says. If it is genuinely unstated, use "unknown" —
  do not guess from the requirement list.
- company/role: exactly as written. If absent, use "unknown".
- domain: the business area (fintech, healthcare, e-commerce) when evident, else omit.

The offer may be in any language; always answer in English.`;

export function extractorPrompt(offerText: string): string {
  return `Extract the requirements from this job offer.

--- OFFER ---
${offerText}
--- END OFFER ---`;
}
