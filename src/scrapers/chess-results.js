import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { haversineKm } from '../geo.js';

const BASE_URL = 'https://chess-results.com';

// Cache geocoding results to avoid repeated API calls
const geocodeCache = new Map();

/**
 * Geocode a location string using OpenStreetMap Nominatim.
 * Returns { lat, lng } or null if not found.
 */
async function geocode(query) {
  if (geocodeCache.has(query)) return geocodeCache.get(query);

  try {
    // Nominatim requires max 1 request per second
    await sleep(1100);

    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: { q: query, format: 'json', limit: 1 },
      headers: { 'User-Agent': 'chess-alert-bot/1.0' },
      timeout: 10000,
    });

    if (response.data?.length > 0) {
      const result = {
        lat: parseFloat(response.data[0].lat),
        lng: parseFloat(response.data[0].lon),
      };
      geocodeCache.set(query, result);
      return result;
    }
  } catch (err) {
    console.warn(`[geocode] Failed for "${query}": ${err.message}`);
  }

  geocodeCache.set(query, null);
  return null;
}

/**
 * Scrape chess-results.com for nearby rapid/blitz tournaments.
 */
export async function scrapeChessResults() {
  const tournaments = [];

  try {
    const results = await scrapeFederation('SRB');
    tournaments.push(...results);
  } catch (err) {
    console.warn(`[chess-results] Failed to scrape SRB: ${err.message}`);
  }

  console.log(`[chess-results] Total: ${tournaments.length} rapid/blitz tournaments within ${config.location.radiusKm}km`);
  return tournaments;
}

async function scrapeFederation(fed) {
  console.log(`[chess-results] Fetching ${fed} tournament list...`);

  const url = `${BASE_URL}/fed.aspx?lan=1&fed=${fed}`;
  const response = await axios.get(url, {
    timeout: 30000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  const $ = cheerio.load(response.data);

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

    if (!isRapid && !isBlitz) return;

    // Skip youth/kids categories
    if (/deca|decac|devojcic|mladih|kadet/i.test(name)) return;

    tournamentLinks.push({
      id: idMatch[1],
      name,
      href: href.startsWith('http') ? href : `${BASE_URL}/${href}`,
      fed,
      type: isRapid ? 'rapid' : 'blitz',
    });
  });

  console.log(`[chess-results] ${fed}: ${tournamentLinks.length} rapid/blitz tournaments found`);

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
  const details = {};
  $('tr').each((_, row) => {
    const cells = $(row).find('td.CR, td.CRnowrap');
    if (cells.length >= 2) {
      const label = $(cells[0]).text().trim().toLowerCase();
      const value = $(cells[1]).text().trim();
      if (label && value) details[label] = value;
    }
  });

  const locationRaw = details['location'] || '';

  // Extract dates — can be "2026/04/05" or "2026/03/29 to 2026/04/05"
  const dateStr = details['date'] || '';
  const rangeMatch = dateStr.match(/(\d{4}\/\d{2}\/\d{2})\s*to\s*(\d{4}\/\d{2}\/\d{2})/);
  const singleMatch = !rangeMatch && dateStr.match(/(\d{4}\/\d{2}\/\d{2})/);
  const startDate = rangeMatch ? rangeMatch[1].replace(/\//g, '-') : singleMatch ? singleMatch[1].replace(/\//g, '-') : '';
  const endDate = rangeMatch ? rangeMatch[2].replace(/\//g, '-') : '';

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
    if (daysAway < -1) return null;
  }

  // Geocode the location and check distance
  const { city, distance } = await geocodeAndDistance(locationRaw, link.name);
  if (distance === null) {
    console.log(`[chess-results] No geocode result for "${link.name}" (${locationRaw})`);
    return null;
  }
  if (distance > config.location.radiusKm) {
    console.log(`[chess-results] Too far: "${link.name}" (${city}, ${Math.round(distance)}km)`);
    return null;
  }

  return {
    id: `cr-${link.id}`,
    name: link.name,
    city: city || locationRaw,
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
 * Geocode a location string and calculate distance from home.
 * Tries the full location first, then cleaned/transliterated, then parts, then tournament name.
 */
async function geocodeAndDistance(location, tournamentName) {
  const { lat, lng } = config.location;

  if (location) {
    // Try geocoding the raw location with "Serbia"
    let coords = await geocode(`${location}, Serbia`);
    if (coords) {
      const distance = haversineKm(lat, lng, coords.lat, coords.lng);
      return { city: extractCityName(location), distance };
    }

    // Try cleaned/transliterated location
    const cleaned = cleanLocation(location);
    if (cleaned && cleaned !== location) {
      coords = await geocode(`${cleaned}, Serbia`);
      if (coords) {
        const distance = haversineKm(lat, lng, coords.lat, coords.lng);
        return { city: cleaned, distance };
      }
    }

    // Try individual parts (split by comma/dash), each with "Serbia"
    const parts = location.split(/[,\-]/).map((p) => transliterate(p).trim()).filter(Boolean);
    for (const part of parts) {
      coords = await geocode(`${part}, Serbia`);
      if (coords) {
        const distance = haversineKm(lat, lng, coords.lat, coords.lng);
        return { city: part, distance };
      }
    }
  }

  // Fallback: try to extract a city name from the tournament name
  if (tournamentName) {
    const city = extractCityFromName(tournamentName);
    if (city) {
      const coords = await geocode(`${city}, Serbia`);
      if (coords) {
        const distance = haversineKm(lat, lng, coords.lat, coords.lng);
        console.log(`[chess-results] Geocoded "${tournamentName}" via city in name: ${city}`);
        return { city, distance };
      }
    }
  }

  console.log(`[chess-results] Could not geocode: "${location || tournamentName}"`);
  return { city: extractCityName(location || ''), distance: null };
}

/**
 * Extract a clean city name from a location string.
 */
function extractCityName(location) {
  const parts = location.split(/[,\-]/).map((p) => p.trim()).filter(Boolean);
  const countryNames = ['serbia', 'srb', 'croatia', 'hungary', 'bosnia', 'romania'];
  for (const part of parts) {
    if (!countryNames.includes(part.toLowerCase())) return part;
  }
  return parts[0] || location;
}

/**
 * Transliterate Serbian Cyrillic to Latin.
 */
const CYR_TO_LAT = {
  'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Ђ':'Đ','Е':'E','Ж':'Ž','З':'Z','И':'I',
  'Ј':'J','К':'K','Л':'L','Љ':'Lj','М':'M','Н':'N','Њ':'Nj','О':'O','П':'P','Р':'R',
  'С':'S','Т':'T','Ћ':'Ć','У':'U','Ф':'F','Х':'H','Ц':'C','Ч':'Č','Џ':'Dž','Ш':'Š',
  'а':'a','б':'b','в':'v','г':'g','д':'d','ђ':'đ','е':'e','ж':'ž','з':'z','и':'i',
  'ј':'j','к':'k','л':'l','љ':'lj','м':'m','н':'n','њ':'nj','о':'o','п':'p','р':'r',
  'с':'s','т':'t','ћ':'ć','у':'u','ф':'f','х':'h','ц':'c','ч':'č','џ':'dž','ш':'š',
};

function transliterate(text) {
  return text.replace(/[А-Яа-яЂђЉљЊњЋћЏџ]/g, (ch) => CYR_TO_LAT[ch] || ch);
}

/**
 * Clean a location string for geocoding: strip club names, street prefixes, house numbers.
 */
function cleanLocation(loc) {
  let s = transliterate(loc);
  // Remove chess club prefixes
  s = s.replace(/\bŠK\b/gi, '').replace(/\bSK\b/gi, '');
  // Remove street prefixes
  s = s.replace(/\bul\.\s*/gi, '');
  // Remove quoted club names like "Radnički"
  s = s.replace(/"[^"]*"/g, '');
  // Remove house numbers at end of parts
  s = s.replace(/\b\d+\s*$/g, '');
  // Clean up
  s = s.replace(/[,\s]+$/g, '').replace(/^\s*[,\-]\s*/, '').replace(/\s{2,}/g, ' ').trim();
  return s;
}

/**
 * List of Serbian cities/towns to look for in tournament names as fallback.
 */
const SERBIAN_CITIES = [
  'Beograd','Belgrade','Novi Sad','Niš','Nis','Kragujevac','Subotica','Zrenjanin',
  'Pančevo','Pancevo','Čačak','Cacak','Novi Pazar','Kraljevo','Smederevo','Leskovac',
  'Užice','Uzice','Valjevo','Kruševac','Krusevac','Vranje','Šabac','Sabac','Sombor',
  'Požarevac','Pozarevac','Pirot','Zaječar','Zajecar','Kikinda','Sremska Mitrovica',
  'Jagodina','Loznica','Prokuplje','Vrnjačka Banja','Vrsac','Vršac','Ruma','Inđija',
  'Indjija','Stara Pazova','Bačka Palanka','Temerin','Apatin','Kula','Vrbas',
  'Bečej','Becej','Aranđelovac','Ada','Titel','Futog','Petrovaradin','Sremski Karlovci',
  'Resavica','Ritisevo','Vidikovac','Voždovac','Vracar','Vračar','Zemun','Rakovica',
  'Čukarica','Palilula','Zvezdara','Savski Venac','Stari Grad','Obrenovac',
  'Lazarevac','Mladenovac','Sopot','Grocka','Surčin','Barajevo','Bor','Negotin',
  'Despotovac','Paraćin','Ćuprija','Aleksinac','Knjaževac','Sokobanja',
];

const CITIES_LOWER = SERBIAN_CITIES.map((c) => ({ original: c, lower: c.toLowerCase() }));

/**
 * Try to find a city name in the tournament name.
 */
function extractCityFromName(name) {
  const latinName = transliterate(name).toLowerCase();
  // Sort by length descending to match longer names first (e.g., "Sremska Mitrovica" before "Ruma")
  for (const { original, lower } of CITIES_LOWER.sort((a, b) => b.lower.length - a.lower.length)) {
    if (latinName.includes(lower)) return original;
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
