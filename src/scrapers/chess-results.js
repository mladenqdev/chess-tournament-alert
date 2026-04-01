import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { haversineKm } from '../geo.js';

const BASE_URL = 'https://chess-results.com';

// Cities/towns within ~120km of Novi Sad (giving buffer beyond the 100km radius).
// Covers Vojvodina, northern Serbia, and nearby cross-border cities.
const CITY_COORDS = {
  // Vojvodina
  'novi sad': { lat: 45.2671, lng: 19.8335 },
  'subotica': { lat: 46.1003, lng: 19.6658 },
  'zrenjanin': { lat: 45.3816, lng: 20.3897 },
  'sombor': { lat: 45.7747, lng: 19.1128 },
  'sremska mitrovica': { lat: 44.9764, lng: 19.6122 },
  'backa palanka': { lat: 45.2500, lng: 19.3917 },
  'bačka palanka': { lat: 45.2500, lng: 19.3917 },
  'kikinda': { lat: 45.8297, lng: 20.4653 },
  'vrsac': { lat: 45.1167, lng: 21.3000 },
  'vršac': { lat: 45.1167, lng: 21.3000 },
  'pancevo': { lat: 44.8707, lng: 20.6403 },
  'pančevo': { lat: 44.8707, lng: 20.6403 },
  'ruma': { lat: 45.0078, lng: 19.8225 },
  'stara pazova': { lat: 44.9853, lng: 20.1589 },
  'indjija': { lat: 45.0481, lng: 20.0828 },
  'inđija': { lat: 45.0481, lng: 20.0828 },
  'becej': { lat: 45.6172, lng: 20.0481 },
  'bečej': { lat: 45.6172, lng: 20.0481 },
  'apatin': { lat: 45.6722, lng: 18.9836 },
  'vrbas': { lat: 45.5700, lng: 19.6411 },
  'temerin': { lat: 45.4056, lng: 19.8875 },
  'futog': { lat: 45.2414, lng: 19.7192 },
  'petrovaradin': { lat: 45.2500, lng: 19.8667 },
  'sremski karlovci': { lat: 45.2028, lng: 19.9333 },
  'backa topola': { lat: 45.8158, lng: 19.6333 },
  'bačka topola': { lat: 45.8158, lng: 19.6333 },
  'kula': { lat: 45.6083, lng: 19.5297 },
  'sid': { lat: 45.1267, lng: 19.2286 },
  'šid': { lat: 45.1267, lng: 19.2286 },
  'kovin': { lat: 44.7500, lng: 20.9667 },
  'novi becej': { lat: 45.5964, lng: 20.1300 },
  'novi bečej': { lat: 45.5964, lng: 20.1300 },
  // Belgrade area (edge of 100km)
  'beograd': { lat: 44.7866, lng: 20.4489 },
  'belgrade': { lat: 44.7866, lng: 20.4489 },
  'zemun': { lat: 44.8456, lng: 20.4011 },
  'vidikovac': { lat: 44.7500, lng: 20.4600 },
  'sabac': { lat: 44.7553, lng: 19.6903 },
  'šabac': { lat: 44.7553, lng: 19.6903 },
  // Cross-border (Croatia)
  'osijek': { lat: 45.5550, lng: 18.6939 },
  'vukovar': { lat: 45.3511, lng: 18.9978 },
  'vinkovci': { lat: 45.2886, lng: 18.8069 },
  // Cross-border (Hungary)
  'szeged': { lat: 46.2530, lng: 20.1414 },
  'baja': { lat: 46.1833, lng: 18.9536 },
  // Cross-border (Romania)
  'timisoara': { lat: 45.7489, lng: 21.2087 },
  'temisvar': { lat: 45.7489, lng: 21.2087 },
  'timișoara': { lat: 45.7489, lng: 21.2087 },
  // Cross-border (Bosnia)
  'bijeljina': { lat: 44.7569, lng: 19.2142 },
};

const FEDERATIONS = ['SRB'];

/**
 * Scrape chess-results.com for nearby rapid tournaments.
 * Checks multiple federations since tournaments near the border
 * might be listed under neighboring countries.
 */
export async function scrapeChessResults() {
  const allTournaments = [];

  for (const fed of FEDERATIONS) {
    try {
      const tournaments = await scrapeFederation(fed);
      allTournaments.push(...tournaments);
    } catch (err) {
      console.warn(`[chess-results] Failed to scrape ${fed}: ${err.message}`);
    }
  }

  console.log(`[chess-results] Total: ${allTournaments.length} rapid tournaments within ${config.location.radiusKm}km`);
  return allTournaments;
}

async function scrapeFederation(fed) {
  console.log(`[chess-results] Fetching ${fed} tournament list...`);

  const url = `${BASE_URL}/fed.aspx?lan=1&fed=${fed}`;
  const response = await axios.get(url, {
    timeout: 30000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  const $ = cheerio.load(response.data);

  // Extract tournament links — on the listing page, each row has the tournament type
  // indicator (St=Standard, Rp=Rapid, Bz=Blitz) in the text near the link
  const tournamentLinks = [];
  $('a[href*="tnr"]').each((_, el) => {
    const href = $(el).attr('href');
    const name = $(el).text().trim();
    if (!href || !name || !href.includes('tnr')) return;

    const idMatch = href.match(/tnr(\d+)/);
    if (!idMatch) return;

    // Check the surrounding row text for time control type
    const rowText = $(el).closest('tr').text() || $(el).parent().text() || '';
    const isRapid = rowText.includes('Rp') || /rapid/i.test(name);
    const isBlitz = rowText.includes('Bz') || /blitz|blic/i.test(name);

    // Only include rapid and blitz tournaments
    if (!isRapid && !isBlitz) return;

    tournamentLinks.push({
      id: idMatch[1],
      name,
      href: href.startsWith('http') ? href : `${BASE_URL}/${href}`,
      fed,
      type: isRapid ? 'rapid' : 'blitz',
    });
  });

  console.log(`[chess-results] ${fed}: ${tournamentLinks.length} rapid/blitz tournaments found`);

  // Fetch details for each tournament
  const tournaments = [];

  for (const link of tournamentLinks) {
    try {
      const details = await fetchTournamentDetails(link);
      if (details) {
        tournaments.push(details);
      }
    } catch (err) {
      console.warn(`[chess-results] Failed to fetch ${link.name}: ${err.message}`);
    }

    // Be polite — small delay between requests
    await sleep(500);
  }

  return tournaments;
}

async function fetchTournamentDetails(link) {
  const response = await axios.get(link.href, {
    timeout: 15000,
    maxRedirects: 5,
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });

  const $ = cheerio.load(response.data);

  // Tournament details are in <tr> rows with <td class="CR"> cells
  // Format: <tr><td class="CR">Label</td><td class="CR">Value</td></tr>
  const details = {};
  $('tr').each((_, row) => {
    const cells = $(row).find('td.CR, td.CRnowrap');
    if (cells.length >= 2) {
      const label = $(cells[0]).text().trim().toLowerCase();
      const value = $(cells[1]).text().trim();
      if (label && value) details[label] = value;
    }
  });

  // Extract city from location field
  // Formats seen: "Pozarevac - Hotel Dunav", "Serbia, Novi Sad, Hotel Putnik, ...", "Beograd, Ustanička 64"
  const locationRaw = details['location'] || '';
  const city = extractCity(locationRaw);

  // Extract dates
  const dateStr = details['date'] || '';
  const dateMatch = dateStr.match(/(\d{4}\/\d{2}\/\d{2})\s*to\s*(\d{4}\/\d{2}\/\d{2})/);
  const startDate = dateMatch ? dateMatch[1].replace(/\//g, '-') : '';
  const endDate = dateMatch ? dateMatch[2].replace(/\//g, '-') : '';

  // Extract time control
  const timeControl = details['time control (standard)'] || details['time control (rapid)'] || details['time control (blitz)'] || '';

  // Check if tournament is finished
  const pageText = $('body').text();
  const isFinished = pageText.includes('Tournament is finished');
  if (isFinished) return null;

  // Only include tournaments starting within the next 30 days
  if (startDate) {
    const start = new Date(startDate);
    const now = new Date();
    const daysAway = (start - now) / (1000 * 60 * 60 * 24);
    if (daysAway > 30) return null;
    if (daysAway < -1) return null; // already started more than a day ago
  }

  // Check distance using city lookup
  const distance = getCityDistance(city);
  if (distance === null || distance > config.location.radiusKm) return null;

  return {
    id: `cr-${link.id}`,
    name: link.name,
    city,
    country: 'SRB',
    startDate,
    endDate,
    distanceKm: Math.round(distance),
    source: 'chess-results',
    timeControl,
    url: link.href,
  };
}

/**
 * Extract the city name from a location string.
 * Handles formats like: "Pozarevac - Hotel Dunav", "Serbia, Novi Sad, Hotel Putnik, ...",
 * "Beograd, Ustanička 64", "Hotel Atlas, Novi Pazar"
 */
function extractCity(location) {
  if (!location) return '';

  // Split by comma and dash, then try to match known cities
  const parts = location.split(/[,\-]/).map((p) => p.trim()).filter(Boolean);

  // Check each part against our known cities
  for (const part of parts) {
    const normalized = part.toLowerCase().trim();
    if (CITY_COORDS[normalized]) return part;
    // Partial match
    for (const name of Object.keys(CITY_COORDS)) {
      if (normalized.includes(name) || name.includes(normalized)) return part;
    }
  }

  // If no known city found, return the first non-country part
  const countryNames = ['serbia', 'srb', 'croatia', 'hungary', 'bosnia', 'romania'];
  for (const part of parts) {
    if (!countryNames.includes(part.toLowerCase().trim())) return part;
  }

  return parts[0] || '';
}

/**
 * Look up a city name in our local coordinates table and calculate distance.
 * Returns distance in km, or null if city not found.
 */
function getCityDistance(city) {
  if (!city) return null;

  const normalized = city.toLowerCase().trim();
  const { lat, lng } = config.location;

  // Try exact match first
  if (CITY_COORDS[normalized]) {
    const coords = CITY_COORDS[normalized];
    return haversineKm(lat, lng, coords.lat, coords.lng);
  }

  // Try partial match
  for (const [name, coords] of Object.entries(CITY_COORDS)) {
    if (normalized.includes(name) || name.includes(normalized)) {
      return haversineKm(lat, lng, coords.lat, coords.lng);
    }
  }

  // Unknown city — skip rather than include with wrong distance
  console.log(`[chess-results] Unknown city: "${city}" — skipping (not in lookup table)`);
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
