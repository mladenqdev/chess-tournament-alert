import express from 'express';
import cron from 'node-cron';
import { config } from './config.js';
import { runScrapeAndAlert } from './scrape-once.js';
import { setupWebhook } from './viber.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check endpoint — ping this every 14 min to keep Render awake
app.get('/', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Viber webhook callback — just acknowledge
app.post('/viber-webhook', (_req, res) => {
  res.sendStatus(200);
});

app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Location: ${config.location.lat}, ${config.location.lng}`);
  console.log(`Radius: ${config.location.radiusKm}km`);
  console.log(`Schedule: ${config.cronSchedule}`);
  console.log(`Viber token: ${config.viber.channelToken ? '***configured***' : 'MISSING!'}`);

  if (!config.viber.channelToken) {
    console.error('ERROR: VIBER_CHANNEL_TOKEN is not set. Check your .env file.');
    process.exit(1);
  }

  // Register Viber webhook if we have a public URL
  if (process.env.RENDER_EXTERNAL_URL) {
    await setupWebhook(`${process.env.RENDER_EXTERNAL_URL}/viber-webhook`);
  } else if (process.env.PUBLIC_URL) {
    await setupWebhook(`${process.env.PUBLIC_URL}/viber-webhook`);
  } else {
    console.log('No PUBLIC_URL set — skipping webhook registration (set it after deploy)');
  }

  // Run once on startup (short delay to let webhook register)
  setTimeout(() => {
    console.log('Running initial scrape...');
    runScrapeAndAlert().catch((err) => {
      console.error('Initial scrape failed:', err.message);
    });
  }, 5000);

  // Then schedule periodic runs
  cron.schedule(config.cronSchedule, () => {
    console.log(`\n[${new Date().toISOString()}] Scheduled scrape starting...`);
    runScrapeAndAlert().catch((err) => {
      console.error('Scheduled scrape failed:', err.message);
    });
  });

  console.log('Bot is running.');
});
