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
 *   - firearms      : guns / ammo / weapons sales + trades
 *   - drug_sales    : selling / trading illicit drugs (distinct from personal
 *                     use — "hosting"/"pnp"/"partying" stay allowed, only the
 *                     commerce language is rejected: "for sale", "$ per g",
 *                     "delivering", "shipping", "menu", etc.)
 *
 * Tuning note: this platform's core context is adult PNP (party-and-play).
 * Generic terms like "meth" / "tina" / "pnp" / "chem" are NOT blocked — only
 * the specific *dangerous-vector* language (needle injection, intentional
 * infection, non-consent, minors, animals, weapons, and commercial supply)
 * is rejected.
 */

// Patterns use a leading \b for word-start anchoring but intentionally omit a
// trailing \b so common suffixes ("pedophile/pedophilia", "chaser/chasing",
// "giver/giving") still match the stem.
const FORBIDDEN_PATTERNS = [
  // ── Pedophilia / CSAM ───────────────────────────────────────────────
  {
    category: 'child_safety',
    pattern: /\b(?:p(?:a)?edophil|child[-\s]*(?:porn|sex|rape|abuse)|kiddie[-\s]*(?:porn|sex)|underage|jailbait|pre[-\s]?teen|lolit[ao]|shotacon|shota[-\s]|minor[-\s]attracted|cp[-\s]*(?:trade|pack|bundle|dump|content|for[-\s]*sale|menu|available|dm|hmu)|young[-\s]*teen[-\s]*(?:sex|porn))/i,
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
  // ── Firearms / weapons trade ────────────────────────────────────────
  // Blocks the commerce language, not fictional or joking mentions.
  // Allows a determiner ("a", "the", "some") between the verb and the noun
  // so "buying a glock" is caught, not just "buying glock".
  {
    category: 'firearms',
    pattern: /\b(?:sell(?:ing)?|buy(?:ing)?|trad(?:e|ing)|deliver(?:y|ing)|ship(?:ping)?|for[-\s]*sale)[-\s]+(?:a|the|some|my)?[-\s]*(?:gun|guns|firearm|pistol|handgun|glock|rifle|shotgun|ak[-\s]?47|ar[-\s]?15|ammo|ammunition|bullets?|magazine|silencer|suppressor)\b|\b(?:gun|firearm|pistol|glock|rifle|shotgun|ak[-\s]?47|ar[-\s]?15|ammo)[-\s]+(?:for[-\s]*sale|available|in[-\s]*stock|delivery|dm[-\s]*for|hit[-\s]*me[-\s]*up)|\b(?:untraceable|ghost|off[-\s]*paper|no[-\s]*paper|no[-\s]*ffl)[-\s]+(?:gun|firearm|pistol|glock|rifle|shotgun)/i,
  },
  // ── Drug sales / dealing ────────────────────────────────────────────
  // Explicitly targets commerce/supply — pricing, packaging, delivery,
  // "menus," dealer callouts. Personal-use language stays untouched so
  // legitimate PNP hosting is not swept up. Allows filler words ("for",
  // "some", "a") between the commerce word and the drug name.
  {
    category: 'drug_sales',
    pattern: /\b(?:sell(?:ing)?|for[-\s]*sale|plug|plugged|delivery|shipping|mailing|menu|prices?|price[-\s]*list|wholesale|bulk|stocked|in[-\s]*stock)[-\s]+(?:for[-\s]+|of[-\s]+|some[-\s]+|a[-\s]+)?(?:meth|tina|t\b|crystal|ice|shard|shards|g\b|gram|grams|q\b|zip|oz|ounce|pound|kilo|k\b|molly|mdma|ghb|g[-\s]?juice|cocaine|coke|blow|snow|coca|xanax|xannies|bars|percs?|percocet|oxy|oxycodone|fenta?nyl|fent|adderall|addy|weed|kush|zaza|pot|mushrooms?|shrooms|acid|lsd|dmt|ketamine|k[-\s]?hole|ket|special[-\s]?k)|\b(?:hmu|dm|inbox|text[-\s]+me|hit[-\s]+me[-\s]+up)[-\s]+for[-\s]+(?:meth|tina|t\b|crystal|ice|shard|molly|mdma|ghb|g[-\s]?juice|coke|blow|xanax|percs?|oxy|fent|weed|kush|shrooms?|acid|lsd|ketamine|ket|k\b)|(?:\$|\busd\b|\bper\b)[-\s]*\d+[-\s]*(?:\/|per)?[-\s]*(?:g|gram|grams|q\b|zip|oz|ounce|point|points?)\b/i,
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
  firearms: 'firearms / weapons trade',
  drug_sales: 'drug sales / dealing',
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
