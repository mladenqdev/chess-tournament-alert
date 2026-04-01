import axios from 'axios';
import { config } from './config.js';

const API_BASE = 'https://chatapi.viber.com/pa';

// Will be set on first post by fetching account info
let adminId = null;

/**
 * Get the superadmin's member ID (required as 'from' in post requests).
 */
async function getAdminId() {
  if (adminId) return adminId;

  const response = await axios.post(
    `${API_BASE}/get_account_info`,
    {},
    {
      headers: {
        'X-Viber-Auth-Token': config.viber.channelToken,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    }
  );

  const members = response.data?.members || [];
  const superadmin = members.find((m) => m.role === 'superadmin');
  if (!superadmin) throw new Error('No superadmin found in channel members');

  adminId = superadmin.id;
  console.log(`[viber] Using admin ID: ${adminId}`);
  return adminId;
}

/**
 * Register webhook with Viber (required before posting).
 */
export async function setupWebhook(webhookUrl) {
  try {
    const response = await axios.post(
      `${API_BASE}/set_webhook`,
      { url: webhookUrl },
      {
        headers: {
          'X-Viber-Auth-Token': config.viber.channelToken,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    console.log(`[viber] Webhook set to ${webhookUrl}:`, response.data.status_message);
  } catch (err) {
    console.error('[viber] Failed to set webhook:', err.message);
  }
}

/**
 * Send a text message to the Viber Channel.
 */
export async function postToChannel(text) {
  const from = await getAdminId();

  const response = await axios.post(
    `${API_BASE}/post`,
    {
      from,
      type: 'text',
      text,
    },
    {
      headers: {
        'X-Viber-Auth-Token': config.viber.channelToken,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    }
  );

  if (response.data?.status !== 0) {
    throw new Error(`Viber API error: ${JSON.stringify(response.data)}`);
  }

  return response.data;
}

/**
 * Format a tournament into a nice alert message.
 */
export function formatTournamentAlert(tournament) {
  const lines = [];

  lines.push(`♟ ${tournament.name}`);
  lines.push('');

  if (tournament.city) {
    lines.push(`📍 ${tournament.city}${tournament.country ? `, ${tournament.country}` : ''}`);
  }

  if (tournament.distanceKm !== undefined) {
    lines.push(`📏 ~${tournament.distanceKm}km from Novi Sad`);
  }

  if (tournament.startDate) {
    const dateStr = tournament.endDate
      ? `${formatDate(tournament.startDate)} - ${formatDate(tournament.endDate)}`
      : formatDate(tournament.startDate);
    lines.push(`📅 ${dateStr}`);
  }

  if (tournament.timeControl) {
    lines.push(`⏱ ${tournament.timeControl}`);
  }

  if (tournament.url) {
    lines.push(`🔗 ${tournament.url}`);
  }

  lines.push('');
  lines.push(`Source: ${tournament.source === 'fide' ? 'FIDE Calendar' : 'chess-results.com'}`);

  return lines.join('\n');
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}
