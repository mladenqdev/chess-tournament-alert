import axios from 'axios';
import { config } from '../config.js';
import { haversineKm } from '../geo.js';

const FIDE_API_URL = 'https://calendar.fide.com/calendar_edit.php';

/**
 * Fetch tournaments from FIDE calendar and filter by distance.
 * FIDE's internal API returns GeoJSON with venue coordinates.
 */
export async function scrapeFide() {
  const now = new Date();
  const fromDate = now.toISOString().split('T')[0];

  // Look 3 months ahead
  const toDate = new Date(now);
  toDate.setMonth(toDate.getMonth() + 3);
  const toDateStr = toDate.toISOString().split('T')[0];

  console.log(`[FIDE] Fetching tournaments from ${fromDate} to ${toDateStr}...`);

  const params = new URLSearchParams();
  params.append('command', 'venues');
  params.append('all', '0');
  params.append('country', '');
  params.append('name_filter', '');
  params.append('event_type', '');
  params.append('time_control', '');
  params.append('from_date', fromDate);
  params.append('to_date', toDateStr);

  const response = await axios.post(FIDE_API_URL, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': 'https://calendar.fide.com/calendar.php',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': 'https://calendar.fide.com',
    },
    timeout: 30000,
  });

  const geojson = response.data;

  if (!geojson?.features?.length) {
    console.log('[FIDE] No features returned');
    return [];
  }

  console.log(`[FIDE] Got ${geojson.features.length} venues from API`);

  const tournaments = [];
  const { lat, lng, radiusKm } = config.location;

  for (const feature of geojson.features) {
    const coords = feature.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;

    // FIDE returns coordinates as [lat, lng] (non-standard GeoJSON order)
    const venueLat = coords[0];
    const venueLng = coords[1];
    const distance = haversineKm(lat, lng, venueLat, venueLng);

    if (distance > radiusKm) continue;

    const props = feature.properties || {};
    const events = parseEventsList(props.events_list || '');

    for (const event of events) {
      tournaments.push({
        id: `fide-${event.id || props.venue_id}-${event.name}`,
        name: event.name,
        city: props.venue_name || 'Unknown',
        country: '',
        startDate: event.startDate || '',
        endDate: event.endDate || '',
        distanceKm: Math.round(distance),
        source: 'fide',
        lat: venueLat,
        lng: venueLng,
        timeControl: event.timeControl || '',
        url: event.url || '',
      });
    }
  }

  console.log(`[FIDE] Found ${tournaments.length} tournaments within ${radiusKm}km`);
  return tournaments;
}

/**
 * Parse the events_list HTML string from FIDE's response.
 * Contains <a> tags with event links separated by <BR>.
 */
function parseEventsList(html) {
  if (!html) return [];

  const events = [];
  const linkRegex = /<a[^>]*href=['"]([^'"]*)['"'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1];
    const text = match[2].replace(/<[^>]*>/g, '').trim();

    // Extract event ID from URL like "calendar.php?id=13904"
    const idMatch = url.match(/id=(\d+)/);
    const id = idMatch ? idMatch[1] : '';

    events.push({
      id,
      name: text,
      startDate: '',
      endDate: '',
      url: url.startsWith('http') ? url : `https://calendar.fide.com/${url}`,
      timeControl: '',
    });
  }

  // If no links found, treat the whole string as one event
  if (events.length === 0 && html.trim()) {
    const cleanText = html.replace(/<[^>]*>/g, '').trim();
    if (cleanText) {
      events.push({
        id: cleanText.substring(0, 30),
        name: cleanText,
        startDate: '',
        endDate: '',
        url: '',
        timeControl: '',
      });
    }
  }

  return events;
}
