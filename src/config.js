import 'dotenv/config';

export const config = {
  viber: {
    channelToken: process.env.VIBER_CHANNEL_TOKEN,
  },
  location: {
    lat: parseFloat(process.env.HOME_LAT || '45.2671'),
    lng: parseFloat(process.env.HOME_LNG || '19.8335'),
    radiusKm: parseFloat(process.env.RADIUS_KM || '100'),
  },
  cronSchedule: process.env.CRON_SCHEDULE || '0 */6 * * *',
  dbPath: process.env.DB_PATH || 'data/alerts.db',
};
