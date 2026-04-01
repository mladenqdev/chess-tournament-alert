import { scrapeChessResults } from './scrapers/chess-results.js';
import { wasAlertSent, markAlertSent } from './db.js';
import { postToChannel, formatTournamentAlert } from './viber.js';

/**
 * Run a single scrape cycle: fetch tournaments, filter new ones, send alerts.
 */
export async function runScrapeAndAlert() {
  let allTournaments = [];

  try {
    allTournaments = await scrapeChessResults();
  } catch (err) {
    console.error('[chess-results] Scrape failed:', err.message);
  }

  console.log(`[scrape] Total tournaments found: ${allTournaments.length}`);

  // Filter out already-sent alerts
  const newTournaments = allTournaments.filter((t) => !wasAlertSent(t.id));
  console.log(`[scrape] New tournaments to alert: ${newTournaments.length}`);

  // Send alerts
  for (const tournament of newTournaments) {
    try {
      const message = formatTournamentAlert(tournament);
      await postToChannel(message);
      markAlertSent(tournament);
      console.log(`[alert] Sent: ${tournament.name} (${tournament.city}, ${tournament.distanceKm}km)`);

      // Small delay between messages to avoid rate limiting
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.error(`[alert] Failed to send alert for ${tournament.name}: ${err.message}`);
    }
  }

  console.log(`[scrape] Done. ${newTournaments.length} alerts sent.`);
}

// Allow running directly: node src/scrape-once.js
const isDirectRun = process.argv[1]?.endsWith('scrape-once.js');
if (isDirectRun) {
  import('./config.js');
  runScrapeAndAlert()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
