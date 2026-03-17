// fix-sterling-paths.js — patch all phase scripts to use .env XAI/OpenRouter keys directly
const fs = require('fs');
const path = require('path');

const files = [
  'phase5-deep-research.js',
  'phase6-market-analysis.js', 
  'phase6-product-intelligence.js',
  'phase8-formula-brief.js',
  'phase9-formula-qa.js'
];

for (const file of files) {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) { console.log('Missing:', file); continue; }
  
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  // Replace sterling .env path pattern with process.env fallback
  const sterlingPattern = /const sterlingEnv[\s\S]*?return process\.env\.XAI_API_KEY \|\| null;/g;
  if (sterlingPattern.test(content)) {
    content = content.replace(sterlingPattern, 'return process.env.XAI_API_KEY || null;');
    changed = true;
  }

  // Also handle OPENROUTER variant
  const sterlingOR = /const sterlingEnv[\s\S]*?return process\.env\.OPENROUTER_API_KEY \|\| null;/g;
  if (sterlingOR.test(content)) {
    content = content.replace(sterlingOR, 'return process.env.OPENROUTER_API_KEY || null;');
    changed = true;
  }

  // Brute force replace — find all getXaiKey/getOpenRouterKey functions and simplify
  content = content.replace(/function getXaiKey\(\) \{[\s\S]*?\n\}/g, 
    `function getXaiKey() {\n  return process.env.XAI_API_KEY || null;\n}`);
  content = content.replace(/function getOpenRouterKey\(\) \{[\s\S]*?\n\}/g,
    `function getOpenRouterKey() {\n  return process.env.OPENROUTER_API_KEY || null;\n}`);
  content = content.replace(/function getGrokKey\(\) \{[\s\S]*?\n\}/g,
    `function getGrokKey() {\n  return process.env.XAI_API_KEY || null;\n}`);

  // Add dotenv if not present
  if (!content.includes('dotenv')) {
    content = `require('dotenv').config({ path: require('path').join(__dirname, '.env') });\n` + content;
  }

  fs.writeFileSync(filePath, content);
  console.log(`✅ Patched: ${file}`);
}

console.log('\nAll done. Re-upload these files to Hostinger.');
