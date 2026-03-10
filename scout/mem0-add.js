const { execSync } = require('child_process');
const text = "P1-P4 cron check Mar 10 2026 9:18 AM: no data changes since 8:48 AM. Counts unchanged: P1=574 P2=520 P3=2164 P4=1642. Ashwagandha gummies fully complete all phases. VD3 P4 incomplete at 381. Magnesium/all other keywords P3/P4 still zero. Background: only OpenClaw gateway and supplement-scope-dash Vite dev server running, no scrapers.";
const meta = JSON.stringify({ type: "fact" });
const args = ['add', 'scout', text, meta];
const cmd = `node "C:/Users/Carl Rebadomia/.openclaw/workspace/skills/mem0-memory-skill/scripts/mem0.js" ${args.map(a => JSON.stringify(a)).join(' ')}`;
console.log('Running:', cmd);
try {
  const out = execSync(cmd, { cwd: 'C:/Users/Carl Rebadomia/.openclaw/workspace/skills' });
  console.log(out.toString());
} catch(e) {
  console.error(e.message);
}
