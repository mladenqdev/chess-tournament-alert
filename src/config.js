import 'dotenv/config';

export const config = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },
  location: {
    lat: parseFloat(process.env.HOME_LAT || '45.2671'),
    lng: parseFloat(process.env.HOME_LNG || '19.8335'),
    radiusKm: parseFloat(process.env.RADIUS_KM || '100'),
  },
};
