function extractJsonCandidate(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
}

function parseLooseJson(text) {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function parseKvFallback(text) {
  if (!text || typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const facts = [];
  for (const line of lines) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9 \-\(\)\/%]+?)\s{1,}([0-9\.]+\s*(?:mg|mcg|g|IU|CFU|Billion CFU|Million CFU|B)?)\s*(.*)$/i);
    if (m) {
      facts.push({ name: m[1].trim(), amount: m[2].trim(), dv_percent: null });
    }
  }
  if (!facts.length) return null;
  return {
    has_supplement_facts: true,
    serving_size: null,
    servings_per_container: null,
    supplement_facts: facts,
    other_ingredients: null,
    health_claims: [],
    certifications: [],
    raw_text: text
  };
}

function parseModelJson(raw) {
  if (!raw) return { parsed: null, method: 'empty' };
  if (typeof raw !== 'string') return { parsed: raw, method: 'object' };

  try {
    return { parsed: JSON.parse(raw), method: 'json.parse' };
  } catch {}

  const loose = parseLooseJson(raw);
  if (loose) return { parsed: loose, method: 'json.regex' };

  const kv = parseKvFallback(raw);
  if (kv) return { parsed: kv, method: 'kv.fallback' };

  return { parsed: null, method: 'failed' };
}

function normalizeFacts(facts) {
  if (!Array.isArray(facts)) return [];
  return facts
    .map(f => ({
      name: (f?.name || '').toString().trim(),
      amount: (f?.amount || '').toString().trim() || null,
      dv_percent: (f?.dv_percent || '').toString().trim() || null,
    }))
    .filter(f => f.name.length > 0);
}

function isValidFacts(facts) {
  return normalizeFacts(facts).length > 0;
}

function scoreImageUrl(url = '') {
  const u = String(url).toLowerCase();
  let s = 0;
  if (/(facts|supplement|nutrition|label|panel)/.test(u)) s += 30;
  if (/(back|rear|side)/.test(u)) s += 20;
  if (/(main|front|hero)/.test(u)) s -= 10;
  return s;
}

module.exports = {
  parseModelJson,
  normalizeFacts,
  isValidFacts,
  scoreImageUrl,
};
