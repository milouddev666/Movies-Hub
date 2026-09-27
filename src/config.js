'use strict';
require('dotenv').config();

const config = {
  telegram: {
    botToken:   process.env.BOT_TOKEN   || '',
    webhookUrl: process.env.WEBHOOK_URL || '',
    webAppUrl:  process.env.WEBAPP_URL  || '',
  },
  server: {
    port:    parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  },
  // From movies_api_complete_ai_spec.md — verified 2026-09-25
  api: {
    baseUrl:          process.env.API_BASE_URL     || 'https://dwapp.arabypros.com',
    keyPath:          process.env.API_KEY_PATH      || '4F5A9C3D9A86FA54EACEDDD635185',
    clientUuid:       process.env.CLIENT_UUID       || 'd506abfd-9fe2-4b71-b979-feff21bcad13',
    appPackage:       process.env.APP_PACKAGE       || 'com.alam.aldrama3',
    redirectBaseUrl:  process.env.REDIRECT_BASE_URL || 'https://dwapp.qzz.io',
    tmdbImageBaseUrl: process.env.TMDB_IMAGE_BASE_URL || 'https://image.tmdb.org/t/p',
    userAgent:        'okhttp/4.12.0',
  },
};

if (!config.telegram.botToken) {
  console.error('[CONFIG] BOT_TOKEN is required');
  process.exit(1);
}

module.exports = config;
