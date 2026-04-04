import { scrapeChessResults } from './scrapers/chess-results.js';
import { loadSentIds, saveSentIds } from './sent-store.js';
import { sendMessage, formatTournamentAlert } from './telegram.js';

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
  const sentIds = loadSentIds();
  const newTournaments = allTournaments.filter((t) => !sentIds.has(t.id));
  console.log(`[scrape] New tournaments to alert: ${newTournaments.length}`);

  // Send alerts
  let sentCount = 0;
  for (const tournament of newTournaments) {
    try {
      const message = formatTournamentAlert(tournament);
      await sendMessage(message);
      sentIds.add(tournament.id);
      sentCount++;
      console.log(`[alert] Sent: ${tournament.name} (${tournament.city}, ${tournament.distanceKm}km)`);

      // Small delay between messages
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.error(`[alert] Failed to send alert for ${tournament.name}: ${err.message}`);
    }
  }

  // Persist sent IDs
  saveSentIds(sentIds);
  console.log(`[scrape] Done. ${sentCount}/${newTournaments.length} alerts sent.`);
}

// Run directly
runScrapeAndAlert()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
