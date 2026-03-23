// category-resolver.js
// Shared utility module for category resolution across multiple scripts

const { getCategoriesFromDB } = require('./db-access'); // hypothetical DB access module

/**
 * Resolve category based on the contract:
 * - Exact match on categories.search_term first
 * - Fallback strict word-match on categories.name
 * - Tie-break by highest product_count
 * - Fail hard on unresolved or ambiguous cases
 *
 * @param {string} searchTerm - The search term to resolve
 * @returns {object} category object
 * @throws {Error} on unresolved or ambiguous category
 */
async function resolveCategory(searchTerm) {
  const categories = await getCategoriesFromDB();

  // 1) Exact match on search_term
  const exactMatches = categories.filter(cat => cat.search_term === searchTerm);
  if (exactMatches.length === 1) {
    return exactMatches[0];
  } else if (exactMatches.length > 1) {
    // tie-break by highest product_count
    const sorted = exactMatches.sort((a, b) => b.product_count - a.product_count);
    return sorted[0];
  }

  // 2) Fallback strict word-match on categories.name (all words must match)
  const searchWords = searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
  const wordMatches = categories.filter(cat => {
    const nameWords = cat.name.toLowerCase().split(/\s+/);
    return searchWords.every(word => nameWords.includes(word));
  });

  if (wordMatches.length === 1) {
    return wordMatches[0];
  } else if (wordMatches.length > 1) {
    // tie-break by highest product_count
    const sorted = wordMatches.sort((a, b) => b.product_count - a.product_count);
    return sorted[0];
  }

  throw new Error(`Category resolution failed for search term '${searchTerm}': unresolved or ambiguous`);
}

module.exports = { resolveCategory };
