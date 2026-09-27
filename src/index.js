'use strict';
require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const config     = require('./config');
const logger     = require('./utils/logger');
const webRoutes  = require('./web/routes');
const { createBot, getBot } = require('./bot');

const app       = express();
const publicDir = path.join(__dirname, 'web', 'public');

app.set('trust proxy', 1);

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", 'telegram.org', 'vjs.zencdn.net', 'cdn.jsdelivr.net'],
      styleSrc:   ["'self'", "'unsafe-inline'", 'vjs.zencdn.net'],
      imgSrc:     ["'self'", 'data:', 'https:'],
      mediaSrc:   ["'self'", 'https:', 'blob:'],
      frameSrc:   ['https:'],
      connectSrc: ["'self'", 'https:'],
      workerSrc:  ["'self'", 'blob:'],
    },
  },
}));

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use('/api', rateLimit({ windowMs: 60000, max: 200, standardHeaders: true, legacyHeaders: false }));

// ── Health check (Render ping — no DB needed) ─────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'movies-hub', status: 'running', ts: Date.now() });
});

// ── Telegram webhook ──────────────────────────────────────────────────────────
app.post('/telegram/webhook', (req, res) => {
  res.sendStatus(200);
  setImmediate(() => {
    try { const b = getBot(); if (b) b.processUpdate(req.body); }
    catch (e) { logger.error('WEBHOOK', e.message); }
  });
});

// ── Internal API for Mini App ─────────────────────────────────────────────────
app.use('/api', webRoutes);

// ── Static Mini App ───────────────────────────────────────────────────────────
app.use(express.static(publicDir, { index: false }));
app.get(['/app', '/app/*'], (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/', (_req, res) => res.redirect(302, '/app'));

// ── 404 / Error ───────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
app.use((err, _req, res, _next) => {
  logger.error('WEB', err.message);
  if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  const PORT = config.server.port;

  app.listen(PORT, '0.0.0.0', async () => {
    logger.info('SERVER', `Server listening on Render port ${PORT}`);
    logger.info('SERVER', `Health → http://0.0.0.0:${PORT}/health`);
    logger.info('SERVER', `Mini App → http://0.0.0.0:${PORT}/app`);

    // Start bot AFTER server is ready
    const isProduction  = config.server.nodeEnv === 'production';
    const webhookBase   = config.telegram.webhookUrl;

    if (isProduction && webhookBase) {
      const bot     = createBot(true);
      const hookUrl = `${webhookBase.replace(/\/$/, '')}/telegram/webhook`;
      logger.info('BOT', `Setting webhook → ${hookUrl}`);
      try {
        await bot.setWebHook(hookUrl);
        logger.info('BOT', 'Webhook configured successfully');
      } catch (e) {
        logger.error('BOT', `setWebHook failed: ${e.message} — URL used: ${hookUrl}`);
      }
    } else {
      logger.info('BOT', 'Polling mode (development)');
      createBot(false);
    }
  });
}

start().catch(e => {
  logger.error('FATAL', e.message);
  process.exit(1);
});

process.on('SIGTERM', () => { logger.info('SERVER', 'SIGTERM — shutting down'); process.exit(0); });
process.on('unhandledRejection', r => logger.error('UNHANDLED', String(r)));
process.on('uncaughtException',  e => { logger.error('UNCAUGHT', e.message); process.exit(1); });
