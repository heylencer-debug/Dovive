const { execSync } = require('child_process');
const path = require('path');

const script = path.join(__dirname, '..', '..', '..', 'skills', 'mem0-memory-skill', 'scripts', 'mem0.js');
const memory = "P1-P4 status as of 2026-03-10: ashwagandha gummies fully complete (P1:159 P2:159 P3:491 P4:619). vitamin D3 gummies nearly complete (P1:124 P2:122 P3:508 P4:381). magnesium gummies partial P2 (P1:64 P2:53 P3:0 P4:0). All other keywords only P1 done. 182 orphan rows in dovive_keepa with unknown keyword. No background scripts running.";
const meta = JSON.stringify({ type: "status" });

const { spawnSync } = require('child_process');
const result = spawnSync('node', [script, 'add', 'scout', memory, meta], {
  cwd: path.join(__dirname, '..', '..', '..', 'skills'),
  encoding: 'utf8'
});
console.log(result.stdout);
console.log(result.stderr);
