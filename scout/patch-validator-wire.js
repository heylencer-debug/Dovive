const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'phase9-formula-qa.js');
let c = fs.readFileSync(file, 'utf8');
const lines = c.split('\n');

// Find adjustmentsTable line
const adjustmentsTableIdx = lines.findIndex(l => l.includes("const adjustmentsTable = adjustmentsMatch"));
if (adjustmentsTableIdx === -1) { console.log('adjustmentsTable line not found'); process.exit(1); }
console.log('Inserting after line', adjustmentsTableIdx + 1);

const validatorBlock = [
  '',
  '  // ── Formula Validator — hard manufacturing constraint check ─────────────────',
  "  const { validateFormula, formatValidationReport } = require('./formula-validator');",
  "  const validationResult = validateFormula(adjustedFormula || finalFormulaBrief || '');",
  '  const validationReport = formatValidationReport(validationResult);',
  "  console.log('Formula Validation: ' + (validationResult.valid ? 'PASS ✅' : 'FAIL ❌') + ' | ' + validationResult.perGummy_mg + 'mg/gummy | ' + validationResult.errors.length + ' errors');",
  '  validationResult.errors.forEach(e => console.log("  VALIDATOR ERROR:", e));',
  '  validationResult.warnings.forEach(w => console.log("  VALIDATOR WARN:", w));',
  '',
];

lines.splice(adjustmentsTableIdx + 1, 0, ...validatorBlock);
c = lines.join('\n');

// Also append validationReport to qa_report when saving
c = c.replace(
  "    qa_report: qaReport,",
  "    qa_report: qaReport + '\\n\\n' + validationReport,"
);
// And add formula_validation to saved ingredients
c = c.replace(
  '    adjustments_table: adjustmentsTable,',
  '    adjustments_table: adjustmentsTable,\n    formula_validation: validationResult,'
);

fs.writeFileSync(file, c, 'utf8');

const { execSync } = require('child_process');
try {
  execSync(`node -c "${file}"`, { stdio: 'pipe' });
  console.log('Syntax OK');
} catch (e) {
  console.log('Syntax error:', e.stderr.toString().slice(0, 300));
  process.exit(1);
}
console.log('Validator wired into phase9-formula-qa.js');
