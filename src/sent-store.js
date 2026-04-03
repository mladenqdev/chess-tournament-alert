import { readFileSync, writeFileSync } from 'fs';

const SENT_FILE = 'data/sent.json';

/**
 * Load sent tournament IDs from the JSON file.
 */
export function loadSentIds() {
  try {
    const data = JSON.parse(readFileSync(SENT_FILE, 'utf-8'));
    return new Set(data);
  } catch {
    return new Set();
  }
}

/**
 * Save sent tournament IDs to the JSON file.
 */
export function saveSentIds(sentIds) {
  const arr = [...sentIds];
  // Keep only the last 500 entries to prevent unbounded growth
  const trimmed = arr.slice(-500);
  writeFileSync(SENT_FILE, JSON.stringify(trimmed, null, 2));
}
