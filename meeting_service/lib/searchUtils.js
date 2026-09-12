/**
 * Standard Bengali grammatical inflections and case markers (বিভক্তি, বহুবচন ও নির্দেশক)
 * Ordered strictly by descending character length to ensure greedy stripping of compound affixes.
 */
const INFLECTIONS = [
  // Plural & Locative / Genitive (4-5 chars)
  'গুলোতে', 'গুলিতে', 'গুলোর', 'গুলির', 'দেরকে', 'দিগকে',
  // Plurals (2-3 chars)
  'গুলো', 'গুলি', 'দের', 'গণ',
  // Case Markers (বিভক্তি: ষষ্ঠী, সপ্তমী, দ্বিতীয়া, তৃতীয়া)
  'েরূপে', 'েরসহ', 'েরটি', 'েরটা',
  'দের', 'ের', 'তে', 'কে', 'রে', 'য়ে', 'ে', 'র',
  // Definitive particles
  'খানি', 'খানা', 'টা', 'টি'
];

/**
 * Strips inflectional suffixes from a Bengali token using pure grammar rules.
 * Does not depend on any keyword dictionaries.
 */
function stripInflection(token) {
  if (!token || token.length <= 3) return token;

  let stemmed = token;
  for (const suffix of INFLECTIONS) {
    // Ensure the remaining stem retains a viable grammatical root (>= 3 chars)
    if (stemmed.length - suffix.length >= 3 && stemmed.endsWith(suffix)) {
      stemmed = stemmed.slice(0, -suffix.length);
      break;
    }
  }
  return stemmed;
}

/**
 * Normalizes query string: trims punctuation, converts to lowercase, and strips inflections.
 */
function normalizeQueryTokens(queryString) {
  if (!queryString) return { raw: '', tokens: [], normalizedString: '' };

  const rawTokens = queryString
    .replace(/[^\u0980-\u09FFa-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const stemmedTokens = rawTokens.map(stripInflection);

  return {
    raw: queryString.trim(),
    tokens: stemmedTokens,
    normalizedString: stemmedTokens.join(' ')
  };
}

/**
 * Database-driven Entity Matcher using Token Set Jaccard Coverage.
 * Eliminates false sub-word matching (e.g., "শিক্ষাছুটি" matching "শিক্ষা শাখা").
 *
 * @param {string[]} queryTokens - Stemmed tokens from user query
 * @param {Array<{id: string, name_bangla: string}>} dbEntities - Preloaded list of offices/departments
 * @returns {string|null} - ID of the genuinely matched entity, or null
 */
function resolveMatchedEntity(queryTokens, dbEntities) {
  if (!queryTokens || queryTokens.length === 0 || !dbEntities) return null;

  const querySet = new Set(queryTokens);
  let bestEntityId = null;
  let highestCoverage = 0;

  for (const entity of dbEntities) {
    if (!entity.name_bangla) continue;

    // Tokenize entity name (e.g., "শিক্ষা শাখা" -> ['শিক্ষা', 'শাখা'])
    const entityTokens = entity.name_bangla
      .replace(/[^\u0980-\u09FFa-zA-Z0-9\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .map(stripInflection)
      .filter(t => t.length > 1);

    if (entityTokens.length === 0) continue;

    const entityTokenSet = new Set(entityTokens);
    let matchedCount = 0;
    for (const token of entityTokenSet) {
      if (querySet.has(token)) {
        matchedCount++;
      }
    }

    const coverage = matchedCount / entityTokenSet.size;

    // Multi-token entity: requires at least 75% coverage of its tokens.
    // Single-token entity (e.g., "যন্ত্রকৌশল"): requires an exact 100% standalone token match.
    const requiredThreshold = entityTokenSet.size > 1 ? 0.75 : 1.0;

    if (coverage >= requiredThreshold && coverage > highestCoverage) {
      highestCoverage = coverage;
      bestEntityId = entity.id;
    }
  }

  return bestEntityId;
}

module.exports = {
  INFLECTIONS,
  stripInflection,
  normalizeQueryTokens,
  resolveMatchedEntity
};
