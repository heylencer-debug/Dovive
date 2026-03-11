/**
 * Formula Validator — runs after P9, before P10
 * Hard rules for gummy manufacturability. Rejects/flags violations automatically.
 * Called by phase9-formula-qa.js before saving to Supabase.
 */

// ── Hard constraints (gummy manufacturing physics) ───────────────────────────
const GUMMY_CONSTRAINTS = {
  maxActivesPerGummy_mg: 350,      // Absolute ceiling — beyond this gummies won't set properly
  targetActivesPerGummy_mg: 275,   // Sweet spot for taste + texture
  maxSingleIngredient_mg: 600,     // No single ingredient > 600mg per serving (2 gummies)
  minServingSize_gummies: 2,
  maxServingWeight_g: 4.5,         // Per gummy max weight (g)

  // Ingredients that CANNOT be in gummies at meaningful doses
  BANNED_IN_GUMMIES: [
    { name: 'magnesium glycinate', maxSafe_mg: 50, reason: 'Hygroscopic — absorbs moisture, makes gummies sticky and unstable' },
    { name: 'magnesium', maxSafe_mg: 50, reason: 'Hygroscopic at therapeutic doses' },
    { name: 'creatine', maxSafe_mg: 0, reason: 'Requires 3000-5000mg per dose — impossible in gummies' },
    { name: 'protein', maxSafe_mg: 0, reason: 'Incompatible with gummy matrix' },
    { name: 'collagen', maxSafe_mg: 500, reason: 'Requires 5000mg+ for efficacy — gummy format can\'t deliver' },
  ],

  // Ingredients that need special CMO handling
  REQUIRES_NOTE: [
    { name: 'vitamin d3', note: 'Oil-soluble — requires emulsification or use D3 powder form (cholecalciferol on carrier)' },
    { name: 'coq10', note: 'Oil-soluble — requires solubilization; use water-dispersible form' },
    { name: 'curcumin', note: 'Bioavailability issue — use BCM-95 or Meriva; specify form explicitly' },
    { name: 'bioperine', note: 'Piperine — strong flavor at >5mg; keep at 2.5-5mg max in gummies' },
  ],
};

/**
 * Parse ingredient rows from a formula text block
 * Handles markdown table format: | Ingredient | Amount | ...
 */
function parseFormulaTable(formulaText) {
  if (!formulaText) return [];
  const ingredients = [];
  const lines = formulaText.split('\n');
  for (const line of lines) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const name = cells[0].replace(/\*+/g, '').toLowerCase().trim();
    const amountStr = cells[1].replace(/\*+/g, '').trim();
    // Skip header rows
    if (name === 'ingredient' || name === '---' || name.includes('---')) continue;
    // Parse mg amount
    const mgMatch = amountStr.match(/(\d+(?:\.\d+)?)\s*mg/i);
    const mcgMatch = amountStr.match(/(\d+(?:\.\d+)?)\s*mcg/i);
    const mgAmount = mgMatch ? parseFloat(mgMatch[1]) : (mcgMatch ? parseFloat(mcgMatch[1]) / 1000 : null);
    if (name && mgAmount !== null) {
      ingredients.push({ name, amount_mg: mgAmount, raw: amountStr });
    }
  }
  return ingredients;
}

/**
 * Run validation — returns { valid, warnings, errors, totalActiveMg, perGummy_mg }
 */
function validateFormula(formulaText, servingGummies = 2) {
  const ingredients = parseFormulaTable(formulaText);
  const errors = [];
  const warnings = [];
  const notes = [];

  if (!ingredients.length) {
    return { valid: false, errors: ['Could not parse any ingredients from formula text'], warnings: [], notes: [], ingredients: [] };
  }

  // Total active load
  const totalActiveMg = ingredients.reduce((sum, i) => sum + i.amount_mg, 0);
  const perGummy_mg = totalActiveMg / servingGummies;

  // Check total active load
  if (perGummy_mg > GUMMY_CONSTRAINTS.maxActivesPerGummy_mg) {
    errors.push(`CRITICAL: ${perGummy_mg.toFixed(0)}mg actives/gummy exceeds max (${GUMMY_CONSTRAINTS.maxActivesPerGummy_mg}mg). Gummies will not set properly. Reduce total actives by ${(perGummy_mg - GUMMY_CONSTRAINTS.targetActivesPerGummy_mg).toFixed(0)}mg/gummy.`);
  } else if (perGummy_mg > GUMMY_CONSTRAINTS.targetActivesPerGummy_mg) {
    warnings.push(`CAUTION: ${perGummy_mg.toFixed(0)}mg actives/gummy is above sweet spot (${GUMMY_CONSTRAINTS.targetActivesPerGummy_mg}mg). Pilot testing required — flavor masking will be challenging.`);
  }

  // Check single ingredient limits
  for (const ing of ingredients) {
    if (ing.amount_mg > GUMMY_CONSTRAINTS.maxSingleIngredient_mg) {
      errors.push(`CRITICAL: ${ing.name} at ${ing.amount_mg}mg/serving exceeds single-ingredient max (${GUMMY_CONSTRAINTS.maxSingleIngredient_mg}mg). Split across variants or reduce.`);
    }
  }

  // Check banned ingredients
  for (const banned of GUMMY_CONSTRAINTS.BANNED_IN_GUMMIES) {
    const found = ingredients.find(i => i.name.includes(banned.name.toLowerCase()));
    if (found) {
      if (found.amount_mg > banned.maxSafe_mg) {
        errors.push(`BANNED: ${found.name} at ${found.amount_mg}mg — ${banned.reason}. Max safe in gummies: ${banned.maxSafe_mg}mg (cosmetic only).`);
      } else {
        warnings.push(`WARNING: ${found.name} at ${found.amount_mg}mg — ${banned.reason}. Keep at this level or remove.`);
      }
    }
  }

  // Add handling notes
  for (const req of GUMMY_CONSTRAINTS.REQUIRES_NOTE) {
    const found = ingredients.find(i => i.name.includes(req.name.toLowerCase()));
    if (found) notes.push(`NOTE [${found.name}]: ${req.note}`);
  }

  const valid = errors.length === 0;

  return {
    valid,
    errors,
    warnings,
    notes,
    ingredients,
    totalActiveMg: Math.round(totalActiveMg),
    perGummy_mg: Math.round(perGummy_mg),
    ingredientCount: ingredients.length,
  };
}

/**
 * Format validation result as a markdown summary for inclusion in QA report
 */
function formatValidationReport(result) {
  const lines = [
    `## FORMULA VALIDATION REPORT`,
    `**Status:** ${result.valid ? '✅ PASSES MANUFACTURING CONSTRAINTS' : '❌ FAILS — MUST FIX BEFORE CMO SUBMISSION'}`,
    `**Total Actives per Serving:** ${result.totalActiveMg}mg (${result.ingredients.length} ingredients)`,
    `**Actives per Gummy:** ${result.perGummy_mg}mg ${result.perGummy_mg <= 275 ? '✅ Optimal' : result.perGummy_mg <= 350 ? '⚠️ Acceptable' : '❌ Too high'}`,
    '',
  ];

  if (result.errors.length) {
    lines.push(`### ❌ Critical Errors (must fix):`);
    result.errors.forEach(e => lines.push(`- ${e}`));
    lines.push('');
  }
  if (result.warnings.length) {
    lines.push(`### ⚠️ Warnings (pilot test required):`);
    result.warnings.forEach(w => lines.push(`- ${w}`));
    lines.push('');
  }
  if (result.notes.length) {
    lines.push(`### 📋 Manufacturing Notes:`);
    result.notes.forEach(n => lines.push(`- ${n}`));
    lines.push('');
  }
  if (result.ingredients.length) {
    lines.push(`### Parsed Ingredient Stack:`);
    result.ingredients.forEach(i => lines.push(`- ${i.name}: ${i.amount_mg}mg`));
  }

  return lines.join('\n');
}

module.exports = { validateFormula, formatValidationReport, parseFormulaTable, GUMMY_CONSTRAINTS };

// ── CLI test ──────────────────────────────────────────────────────────────────
if (require.main === module) {
  const testFormula = `
| Ingredient | Amount per Serving | Form / Grade | Role |
|---|---|---|---|
| KSM-66® Ashwagandha | 600 mg | KSM-66®, 5% withanolides | Primary adaptogen |
| L-Theanine | 200 mg | Suntheanine® | Calming synergy |
| Vitamin D3 | 25 mcg | Cholecalciferol powder | Immune support |
| BioPerine® | 5 mg | 95% piperine | Bioavailability |
`;
  const result = validateFormula(testFormula);
  console.log(formatValidationReport(result));
  console.log('\nRaw result:', JSON.stringify(result, null, 2));
}
