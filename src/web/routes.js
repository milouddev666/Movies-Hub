'use strict';

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();

const apiClient      = require('../api/apiClient');
const sourceResolver = require('../api/sourceResolver');
const store          = require('../storage/jsonStore');
const logger         = require('../utils/logger');
const config         = require('../config');

// ── Telegram initData verification ────────────────────────────────────────────
function verifyInitData(initData) {
  if (!initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash   = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const checkStr = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData')
      .update(config.telegram.botToken).digest();
    const expected = crypto.createHmac('sha256', secret)
      .update(checkStr).digest('hex');
    if (expected !== hash) return null;
    const u = params.get('user');
    return u ? JSON.parse(u) : {};
  } catch (_) { return null; }
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function optionalAuth(req, _res, next) {
  const raw = req.headers['x-telegram-init-data'] || req.query.initData;
  if (raw) {
    const user = verifyInitData(raw);
    if (user) {
      req.telegramUser = user;
      try {
        store.upsertUser({
          telegramId: user.id, username: user.username,
          firstName: user.first_name, lastName: user.last_name,
        });
      } catch (_) {}
    }
  }
  next();
}

router.use(optionalAuth);

// ── Normalize API response arrays ─────────────────────────────────────────────
function norm(data) {
  if (Array.isArray(data))             return data;
  if (Array.isArray(data?.data))       return data.data;
  if (Array.isArray(data?.posters))    return data.posters;
  if (Array.isArray(data?.results))    return data.results;
  if (Array.isArray(data?.seasons))    return data.seasons;
  if (Array.isArray(data?.genres))     return data.genres;
  if (Array.isArray(data?.years))      return data.years;
  return [];
}

/**
 * apiErr — log and respond with appropriate HTTP status.
 *
 * IMPORTANT: [ERROR] [WEB] here means the call to dwapp.arabypros.com failed.
 * It does NOT mean we fetched an external video/source URL.
 * The fix is caching in apiClient to avoid repeated calls to dwapp.arabypros.com.
 */
function apiErr(res, err, context) {
  const st   = err.response?.status;
  const host = (() => {
    try { return new URL(config.api.baseUrl).hostname; } catch (_) { return 'unknown'; }
  })();

  // Log with context so it's clear which endpoint failed and why
  logger.error('WEB', `${context || 'API call'} failed — status=${st || 'network'} host=${host} msg=${err.message}`);

  // Return a clean error to the frontend — no stack traces, no secrets
  if (st === 403) return res.status(200).json({ error: 'api_rate_limited', message: 'خدمة المحتوى مشغولة مؤقتاً، جرّب مجدداً.' });
  if (st === 404) return res.status(404).json({ error: 'not_found' });
  if (st === 429) return res.status(200).json({ error: 'api_rate_limited', message: 'طلبات كثيرة، جرّب بعد قليل.' });
  return res.status(500).json({ error: 'internal_error', message: 'خطأ مؤقت.' });
}

// ── Routes — all calls go to dwapp.arabypros.com ONLY via apiClient ───────────
// Frontend receives data and handles video URLs client-side.
// Backend NEVER fetches video/embed/source URLs.

router.get('/home', async (_req, res) => {
  try {
    const [f, r] = await Promise.allSettled([
      apiClient.getFirst(),
      apiClient.getRandomMovies(10),
    ]);
    // Return partial results — don't fail completely if one call 403s
    res.json({
      first:  f.status === 'fulfilled' ? f.value : null,
      random: r.status === 'fulfilled' ? norm(r.value) : [],
      errors: [
        f.status === 'rejected' ? `first: ${f.reason?.response?.status || f.reason?.message}` : null,
        r.status === 'rejected' ? `random: ${r.reason?.response?.status || r.reason?.message}` : null,
      ].filter(Boolean),
    });
  } catch (e) { apiErr(res, e, 'GET /home'); }
});

router.get('/genres', async (_req, res) => {
  try { res.json({ genres: norm(await apiClient.getGenres()) }); }
  catch (e) { apiErr(res, e, 'GET /genres'); }
});

router.get('/years', async (_req, res) => {
  try { res.json({ years: norm(await apiClient.getYears()) }); }
  catch (e) { apiErr(res, e, 'GET /years'); }
});

router.get('/movies', async (req, res) => {
  try {
    const { filter = 0, sort = 'created', flag = 0 } = req.query;
    res.json({ movies: norm(await apiClient.getMovies({ filter, sort, flag })) });
  } catch (e) { apiErr(res, e, 'GET /movies'); }
});

router.get('/series', async (req, res) => {
  try {
    const { filter = 0, sort = 'created', flag = 0 } = req.query;
    res.json({ series: norm(await apiClient.getSeries({ filter, sort, flag })) });
  } catch (e) { apiErr(res, e, 'GET /series'); }
});

router.get('/posters', async (req, res) => {
  try {
    const { filter = 0, sort = 'views', direction = 0 } = req.query;
    res.json({ posters: norm(await apiClient.getPosters({ filter, sort, direction })) });
  } catch (e) { apiErr(res, e, 'GET /posters'); }
});

router.get('/random', async (req, res) => {
  try { res.json({ movies: norm(await apiClient.getRandomMovies(req.query.limit || 20)) }); }
  catch (e) { apiErr(res, e, 'GET /random'); }
});

router.get('/search', async (req, res) => {
  try {
    const { q = '', page = 0 } = req.query;
    if (!q.trim()) return res.json({ results: [] });
    res.json({ results: norm(await apiClient.search(q, page)) });
  } catch (e) { apiErr(res, e, `GET /search q=${req.query.q}`); }
});

router.get('/movie/:id/roles', async (req, res) => {
  try { res.json({ roles: norm(await apiClient.getRoles(req.params.id)) }); }
  catch (e) { apiErr(res, e, `GET /movie/${req.params.id}/roles`); }
});

router.get('/serie/:id/seasons', async (req, res) => {
  try { res.json({ seasons: norm(await apiClient.getSeasons(req.params.id)) }); }
  catch (e) { apiErr(res, e, `GET /serie/${req.params.id}/seasons`); }
});

/**
 * GET /movie/:id/sources
 *
 * Fetches raw source body from dwapp.arabypros.com (ONLY endpoint that talks to it),
 * decodes it server-side, and returns structured source list to frontend.
 *
 * The frontend then sends the source URL DIRECTLY to the player (embed/HLS/video).
 * Backend does NOT fetch or proxy the video/embed URLs.
 */
router.get('/movie/:id/sources', async (req, res) => {
  try {
    const raw    = await apiClient.getMovieSources(req.params.id);
    const result = sourceResolver.decodeSourceBody(raw);
    if (!result.resolved) {
      return res.json({ resolved: false, reason: result.reason, sources: [] });
    }
    const sources = sourceResolver.sortSources(result.sources);
    logger.info('WEB', `Movie ${req.params.id} sources resolved: count=${sources.length} types=${sources.map(s=>s.type).join(',')}`);
    res.json({ resolved: true, sources });
  } catch (e) { apiErr(res, e, `GET /movie/${req.params.id}/sources`); }
});

/**
 * GET /episode/:id/sources
 * Same as movie sources — backend only fetches from dwapp.arabypros.com.
 */
router.get('/episode/:id/sources', async (req, res) => {
  try {
    const raw    = await apiClient.getEpisodeSources(req.params.id);
    const result = sourceResolver.decodeSourceBody(raw);
    if (!result.resolved) {
      return res.json({ resolved: false, reason: result.reason, sources: [] });
    }
    apiClient.addEpisodeView(req.params.id).catch(() => {});
    const sources = sourceResolver.sortSources(result.sources);
    logger.info('WEB', `Episode ${req.params.id} sources resolved: count=${sources.length} types=${sources.map(s=>s.type).join(',')}`);
    res.json({ resolved: true, sources });
  } catch (e) { apiErr(res, e, `GET /episode/${req.params.id}/sources`); }
});

// ── Favorites (JSON storage — no external HTTP) ───────────────────────────────
router.get('/favorites', (req, res) => {
  const u = req.telegramUser;
  if (!u?.id) return res.status(401).json({ error: 'unauthorized' });
  res.json({ favorites: store.getFavorites(u.id) });
});

router.post('/favorites', (req, res) => {
  const u = req.telegramUser;
  if (!u?.id) return res.status(401).json({ error: 'unauthorized' });
  const { posterId, posterType, title, image } = req.body;
  if (!posterId || !posterType || !title) return res.status(400).json({ error: 'missing_fields' });
  try {
    const fav = store.addFavorite({ telegramId: u.id, posterId: parseInt(posterId, 10), posterType, title, image });
    res.json({ ok: true, fav });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/favorites/:posterId', (req, res) => {
  const u = req.telegramUser;
  if (!u?.id) return res.status(401).json({ error: 'unauthorized' });
  const { posterType = 'movie' } = req.query;
  try {
    const removed = store.removeFavorite({ telegramId: u.id, posterId: parseInt(req.params.posterId, 10), posterType });
    res.json({ ok: removed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Watch history (JSON storage — no external HTTP) ───────────────────────────
router.get('/history', (req, res) => {
  const u = req.telegramUser;
  if (!u?.id) return res.status(401).json({ error: 'unauthorized' });
  res.json({ history: store.getWatchHistory(u.id, 20) });
});

router.post('/history', (req, res) => {
  const u = req.telegramUser;
  if (!u?.id) return res.status(401).json({ error: 'unauthorized' });
  const { posterId, posterType, episodeId, seasonTitle, episodeTitle, title, image, positionSec } = req.body;
  if (!posterId || !posterType || !title) return res.status(400).json({ error: 'missing_fields' });
  try {
    const entry = store.addWatchHistory({
      telegramId: u.id, posterId: parseInt(posterId, 10), posterType,
      episodeId: episodeId ? parseInt(episodeId, 10) : null,
      seasonTitle, episodeTitle, title, image,
      positionSec: parseInt(positionSec || 0, 10),
    });
    res.json({ ok: true, entry });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
