'use strict';

/**
 * Forbidden-content filter for user-submitted descriptions (bios, group
 * descriptions, channel descriptions, posts, event descriptions).
 *
 * Categories blocked:
 *   - child_safety  : pedophilia / CSAM references
 *   - zoophilia     : bestiality / animal sex
 *   - non_consent   : rape, drug-facilitated assault, non-consensual scenes
 *   - bug_chasing   : intentional HIV transmission / conversion culture
 *   - iv_drug_use   : needle-use language (slamming, IV meth, hotshots)
 *
 * Tuning note: this platform's core context is adult PNP (party-and-play).
 * Generic terms like "meth" / "tina" / "pnp" / "chem" are NOT blocked — only
 * the specific *dangerous-vector* language (needle injection, intentional
 * infection, non-consent, minors, animals) is rejected.
 */

// Patterns use a leading \b for word-start anchoring but intentionally omit a
// trailing \b so common suffixes ("pedophile/pedophilia", "chaser/chasing",
// "giver/giving") still match the stem.
const FORBIDDEN_PATTERNS = [
  // ── Pedophilia / CSAM ───────────────────────────────────────────────
  {
    category: 'child_safety',
    pattern: /\b(?:p(?:a)?edophil|child[-\s]*(?:porn|sex|rape|abuse)|kiddie[-\s]*(?:porn|sex)|underage|jailbait|pre[-\s]?teen|lolit[ao]|shotacon|shota[-\s]|minor[-\s]attracted|cp[-\s]*(?:trade|pack|bundle|dump|content)|young[-\s]*teen[-\s]*(?:sex|porn))/i,
  },
  // ── Zoophilia / bestiality ──────────────────────────────────────────
  {
    category: 'zoophilia',
    pattern: /\b(?:zoophil|bestiality|(?:animal|dog|horse|zoo)[-\s]*(?:sex|porn|fuck|breed|cum|cock)|fuck[-\s]*(?:my|a)[-\s]*(?:dog|horse|animal)|beast[-\s]*(?:sex|porn))/i,
  },
  // ── Rape / non-consent ──────────────────────────────────────────────
  {
    category: 'non_consent',
    pattern: /\b(?:rape[-\s]*(?:fantasy|play|kink|scene|me|you|her|him|them|slave|bait)|raping|rapist|non[-\s]?consen|forced[-\s]*sex|drug[-\s]*rape|date[-\s]*rape|roof(?:ie|y)|spike[-\s]*(?:drink|load)|cnc[-\s]+(?:play|scene|kink|bottom|top|session))/i,
  },
  // ── Bug chasing / intentional HIV transmission ──────────────────────
  {
    category: 'bug_chasing',
    pattern: /\b(?:bug[-\s]?chas|chas(?:e|er|ing)[-\s]+bugs?|breed[-\s]+(?:me[-\s]+)?(?:bug|poz|toxic)|gift[-\s]?giv|poz(?:z|)[-\s]*me[-\s]*up|pozz?(?:ing|ed)?[-\s]*(?:load|seed|cum|up[-\s]*(?:me|bottom))|toxic[-\s]*(?:load|seed|cum|poz|breed)|conversion[-\s]*(?:party|seed|load)|converting[-\s]*(?:me|bottom|neg)|charge[-\s]*me[-\s]*up|stealth[-\s]*(?:poz|load|infect)|intentional[-\s]*infect|give[-\s]*me[-\s]*(?:the|your)[-\s]*(?:bug|gift|poz))/i,
  },
  // ── Dangerous drug use: IV / slamming / hotshots ────────────────────
  {
    category: 'iv_drug_use',
    pattern: /\b(?:slam(?:ming|med|mer|sesh)|slam[-\s]+(?:session|party|sesh|bro|buddy|chem|meth|tina|bottom|hot)|iv[-\s]*(?:meth|tina|t\b)|inject(?:ing)?[-\s]*(?:meth|tina|t\b)|needle[-\s]*shar|shared?[-\s]*needles?|hot[-\s]?shot|suicide[-\s]*dose|shoot(?:ing)?[-\s]*(?:tina|meth|t\b)|point(?:ing)?[-\s]*each[-\s]*other|pointing[-\s]*party)/i,
  },
];

// Human-readable labels for each category. Surfaced directly to the user in
// the error message so they know WHY the save was rejected without needing
// to decode backend codes.
const CATEGORY_LABELS = {
  child_safety: 'minors / underage content',
  zoophilia: 'zoophilia / bestiality',
  non_consent: 'rape or non-consensual content',
  bug_chasing: 'intentional HIV transmission ("bug chasing")',
  iv_drug_use: 'dangerous drug injection ("slamming")',
};

function findForbiddenTerms(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = [];
  for (const { category, pattern } of FORBIDDEN_PATTERNS) {
    const m = text.match(pattern);
    if (m) matches.push({ category, term: m[0] });
  }
  return matches;
}

/**
 * Throws a typed Error when the text contains forbidden terms so controllers
 * can catch and return 400. The message is user-facing — it names the field
 * and the policy category that matched so the user understands what to edit.
 *
 * @param {string|null|undefined} text
 * @param {string} field  Human-friendly field name for the error message.
 */
function assertCleanText(text, field = 'text') {
  const hits = findForbiddenTerms(text);
  if (hits.length === 0) return;
  const categories = [...new Set(hits.map((h) => h.category))];
  const labels = categories.map((c) => CATEGORY_LABELS[c] || c);
  const list = labels.length > 1
    ? `${labels.slice(0, -1).join(', ')} and ${labels.slice(-1)}`
    : labels[0];
  const err = new Error(
    `Your ${field} can't be saved — it contains content that violates our community guidelines (${list}). ` +
    `Please remove the prohibited wording and try again.`
  );
  err.status = 400;
  err.code = 'FORBIDDEN_CONTENT';
  err.field = field;
  err.categories = categories;
  throw err;
}

module.exports = { FORBIDDEN_PATTERNS, CATEGORY_LABELS, findForbiddenTerms, assertCleanText };
