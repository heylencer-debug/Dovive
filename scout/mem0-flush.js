const { execSync } = require('child_process');
const SKILLS_DIR = 'C:\\Users\\Carl Rebadomia\\.openclaw\\workspace\\skills';
const facts = [
  'Hostinger VPS 148.230.96.172 is permanent Scout pipeline host. pm2 manages scout-pipeline process with auto-restart and systemd boot persistence. Scripts at /root/dovive/scout/. SSH key at C:\\Users\\Carl Rebadomia\\.ssh\\id_hostinger.',
  'Scout pipeline uses pipeline-queue.json to queue keywords. Add keyword to queue file and pm2 restarts the pipeline automatically. Max 2 retries per keyword before Telegram alert fires.',
  'Telegram crash alerts use Scout bot token 8698744115. Chat ID 1424637649. Alerts fire on pipeline start, success, retry, and abandonment.',
  'human-bsr.js fixed: headless mode auto-detected by platform (headless on Linux, headed on Windows). Committed 2026-03-13.',
  'keepa-phase2.js fixed: keyword saved as KEYWORD not undefined lowercase keyword. All null-keyword keepa records patched 2026-03-13.',
];
facts.forEach(fact => {
  try {
    execSync(`node mem0-memory-skill/scripts/mem0.js add scout "${fact.replace(/"/g, "'")}" type:infrastructure`, { cwd: SKILLS_DIR, stdio: 'inherit' });
  } catch(e) {}
});
console.log('Mem0 flush done');
