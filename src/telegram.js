import axios from 'axios';
import { config } from './config.js';

const API = `https://api.telegram.org/bot${config.telegram.botToken}`;

/**
 * Send a text message to the Telegram group.
 */
export async function sendMessage(text) {
  const response = await axios.post(`${API}/sendMessage`, {
    chat_id: config.telegram.chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  }, { timeout: 10000 });

  return response.data;
}

/**
 * Format a tournament into a Telegram alert message.
 */
export function formatTournamentAlert(tournament) {
  const lines = [];

  lines.push(`♟ <b>${escapeHtml(cleanName(tournament.name))}</b>`);

  if (tournament.city) {
    lines.push(`📍 ${escapeHtml(tournament.city)}${tournament.country ? `, ${escapeHtml(tournament.country)}` : ''}`);
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
    lines.push(`⏱ ${escapeHtml(tournament.timeControl)}`);
  }

  if (tournament.url) {
    lines.push(`🔗 <a href="${tournament.url}">chess-results.com</a>`);
  }

  return lines.join('\n');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cleanName(name) {
  return name
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}\u{2B05}-\u{2B07}\u{2B1B}\u{2B1C}\u{2B50}\u{25AA}-\u{25FE}\u{25B6}\u{25C0}\u{23E9}-\u{23FA}\u{2934}\u{2935}]/gu, '')
    .replace(/[►▶◄☼⓳★⭐⬛⬜♞♖\u{25A0}-\u{25FF}\u{2700}-\u{27BF}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}
