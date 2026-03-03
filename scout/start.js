/**
 * Dovive Scout Launcher
 * Keeps scout-agent.js running with auto-restart on crash
 *
 * Usage: node start.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const RESTART_DELAY = 10000; // 10 seconds
const LOG_DIR = path.join(__dirname, 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Get log file path for today
function getLogPath() {
  const today = new Date().toISOString().split('T')[0];
  return path.join(LOG_DIR, `scout-${today}.log`);
}

// Append to log file
function logToFile(message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(getLogPath(), logLine);
}

// Start the scout agent
function startScout() {
  const logPath = getLogPath();
  console.log(`Starting Scout agent...`);
  console.log(`Logging to: ${logPath}`);
  logToFile('Scout agent starting...');

  const child = spawn('node', ['scout-agent.js'], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env
  });

  // Pipe stdout and stderr to console and log file
  child.stdout.on('data', (data) => {
    const text = data.toString();
    process.stdout.write(text);
    fs.appendFileSync(getLogPath(), text);
  });

  child.stderr.on('data', (data) => {
    const text = data.toString();
    process.stderr.write(text);
    fs.appendFileSync(getLogPath(), `[ERROR] ${text}`);
  });

  child.on('exit', (code, signal) => {
    const msg = `Scout agent exited with code ${code} (signal: ${signal})`;
    console.log(msg);
    logToFile(msg);

    if (signal !== 'SIGINT' && signal !== 'SIGTERM') {
      console.log(`Restarting in ${RESTART_DELAY / 1000} seconds...`);
      logToFile(`Restarting in ${RESTART_DELAY / 1000} seconds...`);
      setTimeout(startScout, RESTART_DELAY);
    }
  });

  child.on('error', (err) => {
    const msg = `Failed to start Scout agent: ${err.message}`;
    console.error(msg);
    logToFile(msg);
    console.log(`Retrying in ${RESTART_DELAY / 1000} seconds...`);
    setTimeout(startScout, RESTART_DELAY);
  });

  // Handle parent process signals
  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT, stopping Scout...');
    logToFile('Received SIGINT, stopping Scout...');
    child.kill('SIGINT');
    setTimeout(() => process.exit(0), 1000);
  });

  process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM, stopping Scout...');
    logToFile('Received SIGTERM, stopping Scout...');
    child.kill('SIGTERM');
    setTimeout(() => process.exit(0), 1000);
  });
}

// Main
console.log('');
console.log('DOVIVE SCOUT LAUNCHER');
console.log('=====================');
console.log('');
console.log('This process will keep Scout running and restart it if it crashes.');
console.log('Press Ctrl+C to stop.');
console.log('');

startScout();
