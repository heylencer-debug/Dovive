/**
 * ecosystem.config.js — pm2 Scout Pipeline Daemon
 * Usage:
 *   pm2 start ecosystem.config.js     — start the runner
 *   pm2 restart scout-pipeline        — restart
 *   pm2 logs scout-pipeline           — tail logs
 *   pm2 stop scout-pipeline           — pause (queue preserved)
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

module.exports = {
  apps: [
    {
      name: 'scout-pipeline',
      script: 'pipeline-runner.js',
      cwd: '/root/dovive/scout',
      interpreter: 'node',

      // Auto-restart on crash — but NOT when process exits cleanly (exit 0)
      autorestart: true,
      watch: false,
      max_memory_restart: '1500M',
      restart_delay: 15000,   // 15s before restart after crash
      max_restarts: 20,       // give up after 20 consecutive crashes
      min_uptime: '10s',      // must be up 10s to count as stable

      // Pass all env from .env file
      env: {
        NODE_ENV: 'production',
        SUPABASE_URL:        process.env.SUPABASE_URL,
        SUPABASE_KEY:        process.env.SUPABASE_KEY,
        TELEGRAM_CHAT_ID:    process.env.TELEGRAM_CHAT_ID    || '1424637649',
        TELEGRAM_BOT_TOKEN:  process.env.TELEGRAM_BOT_TOKEN,
        OPENCLAW_GATEWAY:    process.env.OPENCLAW_GATEWAY,
        OPENCLAW_TOKEN:      process.env.OPENCLAW_TOKEN,
        AMAZON_EMAIL:        process.env.AMAZON_EMAIL,
        AMAZON_PASSWORD:     process.env.AMAZON_PASSWORD,
        APIFY_KEY:           process.env.APIFY_KEY,
        XAI_API_KEY:         process.env.XAI_API_KEY,
        OPENROUTER_API_KEY:  process.env.OPENROUTER_API_KEY,
        OPENAI_API_KEY:      process.env.OPENAI_API_KEY,
      },

      // Logging
      error_file:      '/root/dovive/scout/logs/pm2-error.log',
      out_file:        '/root/dovive/scout/logs/pm2-out.log',
      merge_logs:      true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
