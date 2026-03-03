# Scout Agent Setup

Scout is a fully automated market research agent for Dovive that scrapes Amazon US for supplement market data.

## Features

- **Automated Scraping**: Playwright-powered browser automation scrapes Amazon search results
- **Product Details**: Gets BSR, brand, category for top products
- **AI Analysis**: Uses OpenRouter API to generate market summaries
- **Telegram Reports**: Sends daily summaries to Carlo via Telegram
- **Job Queue**: Supabase-backed job queue for reliability
- **Auto-restart**: start.js keeps the agent running 24/7

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Install Chromium browser
npx playwright install chromium

# 3. Configure environment (already done if .env exists)
# Edit scout/.env with your Supabase service role key

# 4. Register daily cron (optional - requires OpenClaw Gateway)
node register-cron.js

# 5. Start the agent (keeps running and polling)
node start.js
```

## Manual Trigger

```bash
# Queue a manual run
node trigger-scout.js manual

# Scout will pick it up within 60 seconds
```

## Configuration

Edit `scout/.env`:

```env
SUPABASE_URL=https://fhfqjcvwcxizbioftvdw.supabase.co
SUPABASE_KEY=your_service_role_key_here

# For Telegram notifications
OPENCLAW_GATEWAY=http://127.0.0.1:18789
OPENCLAW_TOKEN=your_token_here
TELEGRAM_CHAT_ID=your_chat_id
```

## How It Works

1. **Job Polling**: Scout polls `dovive_jobs` every 60 seconds for status='queued' jobs
2. **Scraping**: Opens a visible Chrome window and scrapes Amazon search results
3. **Product Pages**: Visits top 5 non-sponsored products to get BSR
4. **AI Summary**: Generates market analysis using Claude via OpenRouter
5. **Reports**: Saves to `dovive_reports` and sends Telegram summary
6. **Completion**: Marks job as 'complete' with timestamps

## Files

- `scout-agent.js` - Main agent with scraping and AI logic
- `trigger-scout.js` - Queue a new job (manual or cron)
- `start.js` - Launcher with auto-restart on crash
- `register-cron.js` - Register daily 6AM cron with OpenClaw Gateway

## Logs

Logs are saved to `scout/logs/scout-YYYY-MM-DD.log`

## Dashboard

View results at: https://heylencer-debug.github.io/Dovive

The dashboard shows:
- Live job status (IDLE/QUEUED/RUNNING/COMPLETE)
- Research results with sortable columns
- AI market summaries with entry recommendations
- ENTER/MONITOR/AVOID badges per keyword

## Troubleshooting

**Scout not picking up jobs?**
- Check if `node start.js` is running
- Verify SUPABASE_KEY is correct in .env

**No Telegram notifications?**
- Check OPENCLAW_GATEWAY, OPENCLAW_TOKEN, TELEGRAM_CHAT_ID in .env
- Verify OpenClaw Gateway is running

**Scraping fails with captcha?**
- Amazon may be rate-limiting; wait and retry
- Consider using different user-agent or proxies

**AI summary not generating?**
- Check `openrouter_api_key` in Supabase `app_settings` table
