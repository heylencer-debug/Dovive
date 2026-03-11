const fs = require('fs');
const filePath = __dirname + '/phase9-formula-qa.js';
const lines = fs.readFileSync(filePath, 'utf8').split('\n');

// Find line ranges to replace
let getXaiStart = -1, getXaiEnd = -1;
let callGrokStart = -1, callGrokEnd = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('function getXaiKey()')) getXaiStart = i;
  if (getXaiStart >= 0 && getXaiEnd < 0 && lines[i].trim() === '}' && i > getXaiStart) { getXaiEnd = i; }
  if (lines[i].includes('async function callGrok(')) callGrokStart = i;
  if (callGrokStart >= 0 && callGrokEnd < 0 && lines[i].trim() === '}' && i > callGrokStart + 5) callGrokEnd = i;
}

console.log('getXaiKey:', getXaiStart, '-', getXaiEnd);
console.log('callGrok:', callGrokStart, '-', callGrokEnd);

// Build replacement lines
const newGetKey = [
  `function getOpenRouterKey() {`,
  `  const sterlingEnv = require('path').join(__dirname, '../../sterling/.env');`,
  `  if (require('fs').existsSync(sterlingEnv)) {`,
  `    const m = require('fs').readFileSync(sterlingEnv, 'utf8').match(/OPENROUTER_API_KEY\\s*=\\s*(.+)/);`,
  `    if (m) return m[1].trim();`,
  `  }`,
  `  return process.env.OPENROUTER_API_KEY || null;`,
  `}`,
];

const newCallClaude = [
  `async function callClaudeOpusQA(prompt, maxTokens = 16000) {`,
  `  const key = getOpenRouterKey();`,
  `  if (!key) throw new Error('No OpenRouter key');`,
  `  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {`,
  `    method: 'POST',`,
  `    headers: { 'Authorization': \`Bearer \${key}\`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://dovive.com', 'X-Title': 'DOVIVE Scout P10 QA' },`,
  `    body: JSON.stringify({ model: 'anthropic/claude-opus-4.6', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),`,
  `  });`,
  `  const j = await res.json();`,
  `  if (j.error) throw new Error(\`Claude Opus QA error: \${j.error.message || JSON.stringify(j.error)}\`);`,
  `  return j.choices?.[0]?.message?.content || null;`,
  `}`,
];

// Replace in reverse order (end first to keep indices valid)
let result = [...lines];
result.splice(callGrokStart, callGrokEnd - callGrokStart + 1, ...newCallClaude);
// Recalculate getXaiEnd after splice
result.splice(getXaiStart, getXaiEnd - getXaiStart + 1, ...newGetKey);

// Fix call sites
const out = result.map(l => {
  if (l.includes('Calling Grok (grok-4-1-fast-reasoning)')) return l.replace('Calling Grok (grok-4-1-fast-reasoning)', 'Calling Claude Opus 4.6 via OpenRouter (QA adjudicator)');
  if (l.includes('await callGrok(prompt, 12000)')) return l.replace('await callGrok(prompt, 12000)', 'await callClaudeOpusQA(prompt, 16000)');
  return l;
});

fs.writeFileSync(filePath, out.join('\n'), 'utf8');
console.log('\nDone. Final check:');
out.forEach((l, i) => {
  if (/callGrok|callClaudeOpus|getXaiKey|getOpenRouterKey|grok-4-1-fast|Calling/.test(l)) {
    console.log((i+1) + ': ' + l.trim());
  }
});
