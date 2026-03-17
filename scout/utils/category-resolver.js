async function countProductsForCategory(DASH, categoryId) {
  const { count } = await DASH.from('products').select('*', { count: 'exact', head: true }).eq('category_id', categoryId);
  return count || 0;
}

/**
 * Resolve category with strict contract:
 * 1) exact search_term match first
 * 2) fallback strict all-word match on name
 * 3) tie-break by highest product count
 * 4) fail hard on unresolved or ambiguous ties
 */
async function resolveCategory(DASH, keyword) {
  // 1) exact search_term
  const { data: exact } = await DASH
    .from('categories')
    .select('id,name,search_term')
    .eq('search_term', keyword)
    .limit(20);

  if (exact?.length === 1) {
    return { id: exact[0].id, name: exact[0].name, method: 'search_term_exact' };
  }

  if (exact?.length > 1) {
    const withCounts = await Promise.all(exact.map(async c => ({
      ...c,
      product_count: await countProductsForCategory(DASH, c.id)
    })));
    withCounts.sort((a, b) => b.product_count - a.product_count);

    if (withCounts.length > 1 && withCounts[0].product_count === withCounts[1].product_count) {
      throw new Error(`Ambiguous categories for search_term='${keyword}' (same product counts)`);
    }

    return { id: withCounts[0].id, name: withCounts[0].name, method: 'search_term_tiebreak_count' };
  }

  // 2) fallback name word-match
  const words = keyword.toLowerCase().split(' ').filter(Boolean);
  const { data: cats } = await DASH
    .from('categories')
    .select('id,name')
    .ilike('name', `%${words[0]}%`)
    .limit(50);

  if (!cats?.length) throw new Error(`No category candidates found for '${keyword}'`);

  const scored = cats
    .map(c => {
      const lower = c.name.toLowerCase();
      const score = words.filter(w => lower.includes(w)).length;
      return { ...c, score };
    })
    .filter(c => c.score >= words.length)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) throw new Error(`No category matched all keyword words for '${keyword}'`);

  const topScore = scored[0].score;
  const tied = scored.filter(c => c.score === topScore);

  if (tied.length === 1) {
    return { id: tied[0].id, name: tied[0].name, method: 'name_word_match' };
  }

  const withCounts = await Promise.all(tied.map(async c => ({
    ...c,
    product_count: await countProductsForCategory(DASH, c.id)
  })));
  withCounts.sort((a, b) => b.product_count - a.product_count);

  if (withCounts.length > 1 && withCounts[0].product_count === withCounts[1].product_count) {
    throw new Error(`Ambiguous category tie for '${keyword}' (name match + equal product_count)`);
  }

  return { id: withCounts[0].id, name: withCounts[0].name, method: 'name_word_tiebreak_count' };
}

module.exports = { resolveCategory };
